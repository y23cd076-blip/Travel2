"""
Intercity travel (source -> destination) via free, keyless OpenStreetMap
services: Photon (geocoding) + OSRM (routing).

Why this exists: TripRequest.source was being collected from the user and
sent to the backend, but nothing ever used it -- it was only echoed back
for display ("Hyderabad -> Goa"). The budget breakdown's
`local_transport_buffer` is a flat 8% guess and is meant for *local* travel
inside the destination (autos/cabs between attractions), not the
source -> destination leg, so trips were silently missing the single
biggest line item in most travel budgets.

This module makes two real calls -- Photon to turn "source"/"destination"
free text into coordinates, then OSRM (mode=driving) to get the real road
distance and duration between them -- to ground the intercity leg in real
data, the same "grounded, not hallucinated" principle the rest of the app
follows. Neither service has a flight or India-rail API, so flight/train
duration and cost are derived from that real road distance using
clearly-labeled heuristic multipliers rather than invented outright.

Both Photon and OSRM are free, public, keyless services -- no API key, no
billing account, no signup. Returns None if either call fails or returns no
result -- callers should fall back gracefully (see main.py), never fail the
whole trip plan just because the intercity leg couldn't be resolved.
"""

from typing import Any, Dict, List, Optional

import requests

PHOTON_URL = "https://photon.komoot.io/api/"
OSRM_URL = "https://router.project-osrm.org/route/v1/driving"

# Heuristic multipliers to derive flight/train/car estimates from the one
# real (road) distance OSRM gives us. Flagged clearly in the API response
# as "estimated", same spirit as places_service.py's tag/price estimates.
FLIGHT_SPEED_KMPH = 700
FLIGHT_OVERHEAD_HOURS = 2.0          # check-in, security, boarding, taxi-to-gate
FLIGHT_RATE_PER_KM = 6.0
FLIGHT_MIN_FARE = 2500

TRAIN_SPEED_KMPH = 60
TRAIN_OVERHEAD_HOURS = 0.75
TRAIN_RATE_PER_KM = 1.5
TRAIN_MIN_FARE = 400
TRAIN_MAX_DISTANCE_KM = 1800         # beyond this, overnight+ train isn't realistic to suggest

CAR_RATE_PER_KM = 13.0               # taxi/cab, round-trip-agnostic per-leg rate
CAR_MIN_FARE = 500


def _geocode(place: str) -> Optional[Dict[str, float]]:
    """Free-text place name -> {lat, lng} via Photon."""
    try:
        resp = requests.get(
            PHOTON_URL,
            params={"q": place, "limit": 1},
            timeout=10,
        )
        data = resp.json()
        features = data.get("features") or []
        if not features:
            return None
        lng, lat = features[0]["geometry"]["coordinates"]
        return {"lat": lat, "lng": lng}
    except (requests.RequestException, KeyError, IndexError, ValueError):
        return None


def _route(origin: Dict[str, float], destination: Dict[str, float]) -> Optional[Dict[str, float]]:
    """Real driving distance (km) and duration (hours) between two coordinates via OSRM."""
    try:
        coords = f"{origin['lng']},{origin['lat']};{destination['lng']},{destination['lat']}"
        resp = requests.get(
            f"{OSRM_URL}/{coords}",
            params={"overview": "false"},
            timeout=10,
        )
        data = resp.json()
        if data.get("code") != "Ok" or not data.get("routes"):
            return None
        route = data["routes"][0]
        return {
            "distance_km": route["distance"] / 1000.0,
            "duration_hours": route["duration"] / 3600.0,
        }
    except (requests.RequestException, KeyError, IndexError, ValueError):
        return None


def _distance_matrix(origin: str, destination: str) -> Optional[Dict[str, float]]:
    """Chain Photon (geocode both ends) -> OSRM (route between them)."""
    origin_coords = _geocode(origin)
    dest_coords = _geocode(destination)
    if not origin_coords or not dest_coords:
        return None
    return _route(origin_coords, dest_coords)


def _round(x: float) -> float:
    return round(x, 1)


def get_travel_options(source: str, destination: str) -> Optional[Dict[str, Any]]:
    """
    Real road distance/duration (Photon + OSRM) plus derived flight/train/car
    options, source -> destination. Returns None if the route couldn't be
    resolved (unroutable input, service outage, etc.) so callers can fall
    back to the old flat-buffer behavior instead of failing the trip.
    """
    base = _distance_matrix(source, destination)
    if base is None:
        return None

    distance_km = base["distance_km"]
    road_hours = base["duration_hours"]

    options: List[Dict[str, Any]] = [
        {
            "mode": "car",
            "label": "Cab / self-drive",
            "distance_km": _round(distance_km),
            "duration_hours": _round(road_hours),
            "estimated_cost": _round(max(distance_km * CAR_RATE_PER_KM, CAR_MIN_FARE)),
            "source": "osrm",  # this leg is the real, non-derived one
        },
    ]

    if distance_km <= TRAIN_MAX_DISTANCE_KM:
        options.append({
            "mode": "train",
            "label": "Train",
            "distance_km": _round(distance_km),
            "duration_hours": _round(distance_km / TRAIN_SPEED_KMPH + TRAIN_OVERHEAD_HOURS),
            "estimated_cost": _round(max(distance_km * TRAIN_RATE_PER_KM, TRAIN_MIN_FARE)),
            "source": "estimated",
        })

    if distance_km >= 150:  # flight isn't a sane suggestion for very short hops
        options.append({
            "mode": "flight",
            "label": "Flight",
            "distance_km": _round(distance_km),
            "duration_hours": _round(distance_km / FLIGHT_SPEED_KMPH + FLIGHT_OVERHEAD_HOURS),
            "estimated_cost": _round(max(distance_km * FLIGHT_RATE_PER_KM, FLIGHT_MIN_FARE)),
            "source": "estimated",
        })

    # Recommend fastest, breaking ties by cost -- a reasonable default the
    # frontend can highlight; the user still sees (and can pick) all options.
    recommended = min(options, key=lambda o: (o["duration_hours"], o["estimated_cost"]))

    return {
        "distance_km": _round(distance_km),
        "options": options,
        "recommended_mode": recommended["mode"],
    }
