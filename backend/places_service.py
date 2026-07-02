"""
Live OpenStreetMap grounding for destinations outside the curated pilot
dataset (backend/data/destinations.json).

Why this exists: the optimizer (optimizer.py) needs real attractions,
restaurants, and hotels with costs/durations/ratings to do its knapsack
selection -- it can't work on a bare place name. For the 5 curated pilot
cities that data comes from the static JSON file. For anywhere else, this
module fetches the equivalent shape live from free OpenStreetMap services
(Photon for geocoding, Overpass for nearby POIs), so the "grounded, not
hallucinated" guarantee still holds -- we're swapping a static curated
source for a live real-world source, not dropping grounding entirely.

Photon and Overpass are free, public, keyless services -- no API key, no
billing account, no signup required. The one tradeoff: OSM is a map
database, not a review platform, so it has no star ratings or price levels
like Google does. Ratings/costs below are reasonable category-based
defaults rather than real per-place numbers -- flagged in the README as a
known limitation, same as the old Google price_level -> INR bucket mapping
was.
"""

import time
from typing import Any, Dict, List, Optional

import requests

PHOTON_URL = "https://photon.komoot.io/api/"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# OSM tag value -> this app's interest tags. Deliberately coarse; anything
# unmapped just falls back to a generic "sightseeing" tag, which still
# scores fine on rating even if it doesn't match a chosen interest.
TAG_MAP = {
    "night_club": "nightlife", "bar": "nightlife", "casino": "nightlife", "pub": "nightlife",
    "museum": "history", "gallery": "history", "castle": "history", "monument": "history",
    "memorial": "history", "ruins": "history", "archaeological_site": "history",
    "church": "history", "temple": "history", "mosque": "history", "synagogue": "history",
    "place_of_worship": "history", "tomb": "history", "artwork": "history",
    "theme_park": "adventure", "zoo": "adventure", "aquarium": "adventure",
    "viewpoint": "adventure", "wilderness_hut": "adventure", "park": "adventure",
    "peak": "adventure", "waterfall": "adventure",
    "beach": "beaches",
    "restaurant": "food", "cafe": "food", "fast_food": "food", "food_court": "food",
}

DURATION_OVERRIDES = {
    "theme_park": 3.5, "zoo": 3.0, "aquarium": 2.5, "museum": 1.5,
    "gallery": 1.5, "viewpoint": 1.0, "park": 1.5, "beach": 2.0,
    "church": 1.0, "temple": 1.0, "mosque": 1.0, "place_of_worship": 1.0,
    "castle": 1.5, "ruins": 1.5, "mall": 2.0, "waterfall": 1.5,
}

# OSM has no price/rating data, so these are flat category defaults used as
# a budget-feasibility estimate, not a real quote -- same spirit as the old
# Google price_level -> INR bucket conversion.
DEFAULT_ATTRACTION_COST = 300
DEFAULT_RESTAURANT_COST = 600
DEFAULT_HOTEL_COST = 3000
DEFAULT_RATING = 4.0

# Smaller cities/towns often don't have much tagged within a tight radius --
# escalate outward rather than failing outright. Stops early once a category
# has a workable amount of data (see MIN_RESULTS below).
SEARCH_RADII_M = [15000, 30000, 60000, 100000]
MIN_RESULTS = 3

# For genuinely small towns, OSM sometimes just doesn't have a category
# tagged even 100km out. Rather than failing the whole trip, fall back to a
# small number of clearly-labeled generic placeholder entries so the
# optimizer still has something to work with. These are NOT invented named
# businesses -- they're honestly flagged as unnamed/generic, which is a
# different (and defensible) thing from hallucinating "Hotel Sunrise Palace"
# out of nowhere.
FALLBACK_ATTRACTIONS = [
    {"name": "Local sightseeing spot (unnamed on OpenStreetMap)", "tags": ["sightseeing"], "duration_hours": 1.5},
    {"name": "Local temple/landmark (unnamed on OpenStreetMap)", "tags": ["history"], "duration_hours": 1.0},
]
FALLBACK_RESTAURANTS = [
    {"name": "Local restaurant (unnamed on OpenStreetMap)", "cuisine": "Local"},
    {"name": "Local eatery (unnamed on OpenStreetMap)", "cuisine": "Local"},
]
FALLBACK_HOTELS = [
    {"name": "Local guesthouse/lodge (unnamed on OpenStreetMap)"},
]


def _tags_for(osm_tags: Dict[str, str]) -> List[str]:
    values = [v for v in osm_tags.values()]
    tags = {TAG_MAP[v] for v in values if v in TAG_MAP}
    return sorted(tags) if tags else ["sightseeing"]


def _duration_for(osm_tags: Dict[str, str]) -> float:
    for v in osm_tags.values():
        if v in DURATION_OVERRIDES:
            return DURATION_OVERRIDES[v]
    return 2.0


def find_place(query: str) -> Optional[Dict[str, Any]]:
    """Resolve a free-text place name to a place_id + lat/lng via Photon."""
    try:
        resp = requests.get(
            PHOTON_URL,
            params={"q": query, "limit": 1},
            timeout=10,
        )
        data = resp.json()
        features = data.get("features") or []
        if not features:
            return None
        f = features[0]
        lng, lat = f["geometry"]["coordinates"]
        props = f.get("properties", {})
        name = props.get("name", query)
        address_parts = [props.get(k) for k in ("city", "state", "country") if props.get(k)]
        return {
            "place_id": f"osm_{props.get('osm_type', 'n')}{props.get('osm_id', '')}",
            "name": name,
            "formatted_address": ", ".join(address_parts) or name,
            "lat": lat,
            "lng": lng,
        }
    except (requests.RequestException, KeyError, IndexError, ValueError):
        return None


def _overpass_query(lat: float, lng: float, filters: List[str], radius: int) -> List[Dict[str, Any]]:
    """
    Run one Overpass QL query for a set of "key=value" filters, return raw
    elements. Uses `nwr` (node/way/relation) since plenty of real POIs --
    parks, malls, temple complexes -- are mapped as ways/relations, not
    just nodes; `node`-only queries silently miss them.
    """
    clauses = "".join(f'  nwr["{f}"](around:{radius},{lat},{lng});\n' for f in filters)
    ql = f"[out:json][timeout:25];\n(\n{clauses});\nout center 60;"
    for attempt in range(2):
        try:
            resp = requests.post(OVERPASS_URL, data={"data": ql}, timeout=30)
            data = resp.json()
            return data.get("elements", [])
        except (requests.RequestException, ValueError):
            if attempt == 0:
                time.sleep(2)  # Overpass rate-limits; brief backoff and one retry
                continue
            return []
    return []


def _search_with_escalating_radius(lat: float, lng: float, filters: List[str]) -> List[Dict[str, Any]]:
    """Try increasingly wide radii until we have a workable number of named
    results, or we've exhausted the radius list (return whatever we've got)."""
    results: List[Dict[str, Any]] = []
    for radius in SEARCH_RADII_M:
        results = _overpass_query(lat, lng, filters, radius)
        named = [el for el in results if el.get("tags", {}).get("name")]
        if len(named) >= MIN_RESULTS:
            break
    return results


def _nearby_attractions(lat: float, lng: float) -> List[Dict[str, Any]]:
    filters = [
        "tourism=attraction", "tourism=museum", "tourism=gallery", "tourism=zoo",
        "tourism=aquarium", "tourism=theme_park", "tourism=viewpoint",
        "tourism=artwork", "tourism=information",
        "historic=castle", "historic=monument", "historic=memorial",
        "historic=ruins", "historic=archaeological_site", "historic=tomb",
        "amenity=place_of_worship",
        "leisure=park", "leisure=stadium", "leisure=water_park",
        "natural=beach", "natural=peak", "waterway=waterfall",
        "shop=mall",
    ]
    return _search_with_escalating_radius(lat, lng, filters)


def _nearby_restaurants(lat: float, lng: float) -> List[Dict[str, Any]]:
    filters = ["amenity=restaurant", "amenity=cafe", "amenity=fast_food", "amenity=food_court"]
    return _search_with_escalating_radius(lat, lng, filters)


def _nearby_hotels(lat: float, lng: float) -> List[Dict[str, Any]]:
    filters = [
        "tourism=hotel", "tourism=guest_house", "tourism=hostel",
        "tourism=motel", "tourism=resort",
    ]
    return _search_with_escalating_radius(lat, lng, filters)


def build_destination_data(query: str) -> Optional[Dict[str, Any]]:
    """
    Build an optimizer-compatible destination_data dict (same shape as an
    entry in destinations.json) from live OpenStreetMap data.

    Returns None only if the place name itself can't be geocoded at all
    (Photon has no match). If Overpass comes back empty for a category near
    a genuinely small town, we don't fail the whole trip -- we fall back to
    a couple of clearly-labeled generic placeholder entries for that
    category (see FALLBACK_* above) so the optimizer still has something to
    work with, rather than blocking the user entirely.
    """
    place = find_place(query)
    if not place:
        return None

    lat, lng = place["lat"], place["lng"]

    attractions_raw = _nearby_attractions(lat, lng)
    restaurants_raw = _nearby_restaurants(lat, lng)
    hotels_raw = _nearby_hotels(lat, lng)

    attractions = []
    for i, el in enumerate(attractions_raw[:25]):
        tags = el.get("tags", {})
        name = tags.get("name")
        if not name:
            continue
        attractions.append({
            "id": f"osm_attr_{el.get('id', i)}",
            "name": name,
            "tags": _tags_for(tags),
            "cost": DEFAULT_ATTRACTION_COST,
            "duration_hours": _duration_for(tags),
            "rating": DEFAULT_RATING,
        })
    if not attractions:
        for i, fb in enumerate(FALLBACK_ATTRACTIONS):
            attractions.append({
                "id": f"fallback_attr_{i}",
                "name": fb["name"],
                "tags": fb["tags"],
                "cost": DEFAULT_ATTRACTION_COST,
                "duration_hours": fb["duration_hours"],
                "rating": DEFAULT_RATING,
            })

    restaurants = []
    for i, el in enumerate(restaurants_raw[:25]):
        tags = el.get("tags", {})
        name = tags.get("name")
        if not name:
            continue
        cuisine = tags.get("cuisine", "local").replace("_", " ").replace(";", ", ").title()
        restaurants.append({
            "id": f"osm_rest_{el.get('id', i)}",
            "name": name,
            "cuisine": cuisine,
            "cost_per_person": DEFAULT_RESTAURANT_COST,
            "rating": DEFAULT_RATING,
            "tags": ["food"],
        })
    if not restaurants:
        for i, fb in enumerate(FALLBACK_RESTAURANTS):
            restaurants.append({
                "id": f"fallback_rest_{i}",
                "name": fb["name"],
                "cuisine": fb["cuisine"],
                "cost_per_person": DEFAULT_RESTAURANT_COST,
                "rating": DEFAULT_RATING,
                "tags": ["food"],
            })

    hotels = []
    for i, el in enumerate(hotels_raw[:15]):
        tags = el.get("tags", {})
        name = tags.get("name")
        if not name:
            continue
        hotels.append({
            "id": f"osm_hotel_{el.get('id', i)}",
            "name": name,
            "cost_per_night": DEFAULT_HOTEL_COST,
            "rating": DEFAULT_RATING,
        })
    if not hotels:
        for i, fb in enumerate(FALLBACK_HOTELS):
            hotels.append({
                "id": f"fallback_hotel_{i}",
                "name": fb["name"],
                "cost_per_night": DEFAULT_HOTEL_COST,
                "rating": DEFAULT_RATING,
            })

    return {
        "name": place["name"],
        "state": place["formatted_address"],
        "hours_per_day": 8,
        "attractions": attractions,
        "restaurants": restaurants,
        "hotels": hotels,
    }
