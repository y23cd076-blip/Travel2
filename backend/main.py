import json
from pathlib import Path
from datetime import date

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from models import (
    TripRequest, TripResponse, DayPlan, AttractionOut, RestaurantOut, HotelOut,
    BudgetBreakdown, IntercityTravel, TravelOption,
)
from optimizer import optimize_trip
from llm_service import generate_narrative
from database import trip_store
from places_service import build_destination_data
from travel_service import get_travel_options

app = FastAPI(
    title="SmartTrip AI - Travel Itinerary Planner",
    description="AI travel agent with constraint-based itinerary optimization and grounded LLM narrative generation.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_PATH = Path(__file__).parent / "data" / "destinations.json"
DESTINATIONS = json.loads(DATA_PATH.read_text())
# Defense-in-depth: accept a pilot city by its slug key ("kerala") OR its
# display name ("Kerala (Kochi & Munnar)"), case-insensitively. The
# frontend is expected to always send the key, but this guards any other
# caller (a script, a future frontend, manual API testing) from silently
# falling through to a live Places lookup for a name that Places can't
# resolve well (e.g. parenthetical multi-city names).
DESTINATION_NAME_TO_KEY = {v["name"].strip().lower(): k for k, v in DESTINATIONS.items()}


@app.get("/")
def root():
    return {"status": "ok", "message": "SmartTrip AI backend is running."}


@app.get("/destinations")
def list_destinations():
    """Returns pilot destinations available for planning (the dataset this MVP is grounded in)."""
    return [
        {"key": key, "name": val["name"], "state": val["state"]}
        for key, val in DESTINATIONS.items()
    ]


@app.post("/plan-trip", response_model=TripResponse)
def plan_trip(req: TripRequest):
    dest_key = req.destination.strip().lower()
    dest_key = DESTINATION_NAME_TO_KEY.get(dest_key, dest_key)
    if dest_key in DESTINATIONS:
        # Fast path: one of the 5 curated pilot cities, static real data.
        destination_data = DESTINATIONS[dest_key]
    else:
        # Any other place the user typed/selected via the Photon autocomplete:
        # fetch real nearby attractions/restaurants/hotels via Overpass.
        destination_data = build_destination_data(req.destination)
        if destination_data is None:
            raise HTTPException(
                status_code=404,
                detail=f"Couldn't find '{req.destination}' on the map. Check the "
                       f"spelling or try a more specific place name (e.g. add the "
                       f"state or country).",
            )
    if req.end_date < req.start_date:
        raise HTTPException(status_code=400, detail="end_date must be on or after start_date")

    # --- Step 1: constraint-based optimization (algorithmic core) ---
    result = optimize_trip(
        destination_data=destination_data,
        start_date=req.start_date,
        end_date=req.end_date,
        total_budget=req.budget,
        interests=req.interests,
    )

    # --- Step 2: LLM narrative generation, grounded in the fixed schedule ---
    narrative = generate_narrative(
        destination_name=destination_data["name"],
        interests=req.interests,
        day_plans=result["day_plans"],
    )

    # --- Step 2b: intercity travel (source -> destination) via Photon + OSRM ---
    # `req.source` used to be collected and never used anywhere except echoed
    # back for display. Real road distance/duration now comes from Photon
    # (geocoding) + the OSRM routing API, both free and keyless; flight/train
    # are derived estimates from that real distance (neither service has a
    # flight or India-rail API). If the route can't be resolved (bad input,
    # service outage, etc.) we degrade gracefully: no intercity block, and
    # the budget falls back to the old flat buffer only.
    dest_query = f"{destination_data['name']}, {destination_data.get('state', '')}".strip(", ")
    travel_data = get_travel_options(req.source, dest_query)

    intercity_travel = None
    intercity_transport_total = 0.0
    if travel_data:
        intercity_travel = IntercityTravel(
            distance_km=travel_data["distance_km"],
            options=[TravelOption(**opt) for opt in travel_data["options"]],
            recommended_mode=travel_data["recommended_mode"],
        )
        recommended = next(
            o for o in travel_data["options"] if o["mode"] == travel_data["recommended_mode"]
        )
        intercity_transport_total = recommended["estimated_cost"]

    grand_total = round(result["grand_total"] + intercity_transport_total, 2)
    remaining_budget = round(req.budget - grand_total, 2)
    within_budget = grand_total <= req.budget

    # --- Step 3: assemble response ---
    days_out = []
    for d in result["day_plans"]:
        days_out.append(DayPlan(
            day_number=d["day_number"],
            date=d["date"],
            attractions=[
                AttractionOut(name=a["name"], tags=a["tags"], cost=a["cost"],
                               duration_hours=a["duration_hours"], rating=a["rating"])
                for a in d["attractions"]
            ],
            restaurants=[
                RestaurantOut(name=r["name"], cuisine=r["cuisine"],
                               cost_per_person=r["cost_per_person"], rating=r["rating"])
                for r in d["restaurants"]
            ],
            summary=narrative["day_summaries"].get(str(d["day_number"]), ""),
            estimated_day_cost=d["estimated_day_cost"],
        ))

    hotel = result["hotel"]
    response = TripResponse(
        source=req.source,
        destination=destination_data["name"],
        days=result["days"],
        itinerary=days_out,
        hotel=HotelOut(
            name=hotel["name"], cost_per_night=hotel["cost_per_night"],
            rating=hotel["rating"], total_cost=result["hotel_total"],
        ),
        budget_breakdown=BudgetBreakdown(
            hotel_total=result["hotel_total"],
            attractions_total=result["attractions_total"],
            food_total=result["food_total"],
            local_transport_buffer=result["local_transport_buffer"],
            intercity_transport_total=intercity_transport_total,
            grand_total=grand_total,
            remaining_budget=remaining_budget,
            within_budget=within_budget,
        ),
        intercity_travel=intercity_travel,
        travel_tips=narrative["travel_tips"],
        things_to_avoid=narrative["things_to_avoid"],
        packing_tips=narrative["packing_tips"],
    )

    # --- Step 4: persist trip (Mongo if configured, else local JSON fallback) ---
    trip_store.save_trip({
        "source": req.source,
        "destination": req.destination,
        "start_date": str(req.start_date),
        "end_date": str(req.end_date),
        "budget": req.budget,
        "interests": req.interests,
        "response": response.model_dump(),
    })

    return response


@app.get("/trips")
def list_saved_trips():
    return trip_store.list_trips()
