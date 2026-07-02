"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../lib/AuthContext";
import PlaceAutocomplete from "../components/PlaceAutocomplete";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

const ALL_INTERESTS = ["beaches", "adventure", "food", "history", "nightlife"];

function todayPlus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatINR(n) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export default function Page() {
  const { user, loading: authLoading, logout } = useAuth();
  const router = useRouter();

  const [pilotCities, setPilotCities] = useState([]);

  const [source, setSource] = useState("Hyderabad");
  const [destination, setDestination] = useState("");
  const [destinationKey, setDestinationKey] = useState(null);
  const [startDate, setStartDate] = useState(todayPlus(14));
  const [endDate, setEndDate] = useState(todayPlus(17));
  const [budget, setBudget] = useState(25000);
  const [interests, setInterests] = useState(["food", "history"]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [trip, setTrip] = useState(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  useEffect(() => {
    // Pilot cities are just shown as quick-pick chips now -- destination is
    // free text (Places autocomplete), not restricted to this list.
    fetch(`${BACKEND_URL}/destinations`)
      .then((r) => {
        if (!r.ok) throw new Error("bad response");
        return r.json();
      })
      .then((data) => setPilotCities(data))
      .catch(() => setPilotCities([]));
  }, []);

  function toggleInterest(tag) {
    setInterests((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!destination.trim()) {
      setError("Type or select a destination.");
      return;
    }
    if (interests.length === 0) {
      setError("Pick at least one interest so the optimizer has something to score attractions against.");
      return;
    }
    if (endDate < startDate) {
      setError("End date needs to be on or after the start date.");
      return;
    }

    setLoading(true);
    setTrip(null);
    try {
      const res = await fetch(`${BACKEND_URL}/plan-trip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source,
          destination: destinationKey || destination,
          start_date: startDate,
          end_date: endDate,
          budget: Number(budget),
          interests,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Backend returned ${res.status}`);
      }
      const data = await res.json();
      setTrip(data);
    } catch (err) {
      setError(
        err.message === "Failed to fetch"
          ? "Couldn't reach the backend. It may still be waking up if it's on a free-tier host — try again in a moment."
          : err.message
      );
    } finally {
      setLoading(false);
    }
  }

  const destCode = destination ? destination.slice(0, 3).toUpperCase() : "———";

  if (authLoading || !user) {
    return (
      <main className="page">
        <div className="loading-row" style={{ margin: "80px auto" }}>
          <span className="spinner" aria-hidden="true" />
          Checking sign-in status…
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="top-strip">
        <div className="brand">
          <span className="brand-mark">ST</span>
          SmartTrip AI
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span>Knapsack-optimized itineraries</span>
          <span style={{ color: "var(--text-muted)" }}>{user.email}</span>
          <button
            type="button"
            onClick={() => logout()}
            style={{
              background: "none",
              border: "1px solid var(--border)",
              color: "var(--text)",
              borderRadius: "var(--radius-sm)",
              padding: "6px 12px",
              cursor: "pointer",
              font: "inherit",
              fontSize: "0.85rem",
            }}
          >
            Log out
          </button>
        </div>
      </div>

      <section className="hero">
        <div className="hero-eyebrow">Constraint-based planning, not a guess</div>
        <h1>
          An itinerary <em>an algorithm can afford</em> — before an AI ever writes a word.
        </h1>
        <p>
          A 0/1 knapsack solver picks attractions that fit your time and budget from real,
          rated places — curated data for pilot cities, live OpenStreetMap data for anywhere
          else. Only after the schedule is fixed does the AI write about it — it can&rsquo;t
          invent a place that isn&rsquo;t already on the ticket.
        </p>
      </section>

      <form className="pass" onSubmit={handleSubmit}>
        <div className="pass-main">
          <div className="pass-label-row">
            <span className="pass-tag">Trip request</span>
            <span className="pass-tag">{ALL_INTERESTS.length} interest tags available</span>
          </div>

          <div className="field-grid">
            <PlaceAutocomplete
              id="source"
              label="From"
              value={source}
              onChange={setSource}
              placeholder="Departure city"
            />

            <PlaceAutocomplete
              id="destination"
              label="To"
              value={destination}
              onChange={(val) => {
                setDestination(val);
                setDestinationKey(null);
              }}
              placeholder="Search any destination"
            />

            {pilotCities.length > 0 && (
              <div className="field full" style={{ marginTop: -8 }}>
                <div className="interest-pills">
                  {pilotCities.map((d) => (
                    <button
                      type="button"
                      key={d.key}
                      className="interest-pill"
                      data-active={destination === d.name}
                      onClick={() => {
                        setDestination(d.name);
                        setDestinationKey(d.key);
                      }}
                      title="Curated pilot city — fastest, always has full real data"
                    >
                      {d.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="field">
              <label htmlFor="start">Depart</label>
              <input
                id="start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </div>

            <div className="field">
              <label htmlFor="end">Return</label>
              <input
                id="end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
              />
            </div>

            <div className="field">
              <label htmlFor="budget">Total budget (INR)</label>
              <input
                id="budget"
                type="number"
                min={1000}
                step={500}
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                required
              />
            </div>

            <div className="field full">
              <label>Interests</label>
              <div className="interest-pills">
                {ALL_INTERESTS.map((tag) => (
                  <button
                    type="button"
                    key={tag}
                    className="interest-pill"
                    data-active={interests.includes(tag)}
                    onClick={() => toggleInterest(tag)}
                    aria-pressed={interests.includes(tag)}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {error && <div className="form-error">{error}</div>}

          {loading && (
            <div className="loading-row">
              <span className="spinner" aria-hidden="true" />
              Optimizing schedule and generating your trip plan…
            </div>
          )}
        </div>

        <div className="pass-side">
          <div className="pass-side-top">
            <div className="pass-side-eyebrow">Destination</div>
            <div className="pass-side-code">{destCode}</div>
          </div>
          <div className="barcode" aria-hidden="true" />
          <button type="submit" className="submit-btn" disabled={loading}>
            {loading ? "Optimizing…" : "Generate itinerary"}
          </button>
        </div>
      </form>

      {trip && (
        <section className="results">
          <div className="results-header">
            <div className="route">
              {trip.source}
              <span className="arrow">→</span>
              {trip.destination}
            </div>
            <div className="route-meta">
              {trip.days} day{trip.days === 1 ? "" : "s"} · {startDate} – {endDate}
            </div>
          </div>

          <div className="budget-stub">
            <div className="budget-cell">
              <div className="budget-cell-label">Hotel</div>
              <div className="budget-cell-value">{formatINR(trip.budget_breakdown.hotel_total)}</div>
            </div>
            <div className="budget-cell">
              <div className="budget-cell-label">Attractions</div>
              <div className="budget-cell-value">
                {formatINR(trip.budget_breakdown.attractions_total)}
              </div>
            </div>
            <div className="budget-cell">
              <div className="budget-cell-label">Food</div>
              <div className="budget-cell-value">{formatINR(trip.budget_breakdown.food_total)}</div>
            </div>
            <div className="budget-cell">
              <div className="budget-cell-label">Intercity travel</div>
              <div className="budget-cell-value">
                {formatINR(trip.budget_breakdown.intercity_transport_total)}
              </div>
            </div>
            <div className="budget-cell">
              <div className="budget-cell-label">Total</div>
              <div className="budget-cell-value">{formatINR(trip.budget_breakdown.grand_total)}</div>
            </div>
            <div className="budget-status" data-ok={trip.budget_breakdown.within_budget}>
              {trip.budget_breakdown.within_budget
                ? `Within budget · ${formatINR(trip.budget_breakdown.remaining_budget)} left`
                : `Over budget by ${formatINR(-trip.budget_breakdown.remaining_budget)}`}
            </div>
          </div>

          {trip.intercity_travel ? (
            <div className="intercity">
              <div className="intercity-header">
                <span className="intercity-title">
                  {trip.source} → {trip.destination}
                </span>
                <span className="intercity-distance">
                  {trip.intercity_travel.distance_km.toLocaleString("en-IN")} km by road
                </span>
              </div>
              <div className="mode-grid">
                {trip.intercity_travel.options.map((opt) => {
                  const icon = { car: "🚕", train: "🚆", flight: "✈️" }[opt.mode] || "🚗";
                  const isRecommended = opt.mode === trip.intercity_travel.recommended_mode;
                  return (
                    <div className="mode-card" data-recommended={isRecommended} key={opt.mode}>
                      <span className="mode-icon">{icon}</span>
                      <div className="mode-label">
                        {opt.label}
                        {isRecommended && <span className="mode-recommended-flag">Recommended</span>}
                      </div>
                      <div className="mode-cost">{formatINR(opt.estimated_cost)}</div>
                      <div className="mode-duration">~{opt.duration_hours}h</div>
                      <div className="mode-source">
                        {opt.source === "osrm"
                          ? "Live distance/time from OpenStreetMap routing"
                          : "Estimated from road distance"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="intercity-fallback">
              Intercity travel distance/cost unavailable — the routing service couldn&rsquo;t
              resolve this route (try a more specific city name for &ldquo;From&rdquo;/&ldquo;To&rdquo;).
            </div>
          )}

          <div className="hotel-line">
            Staying at <strong>{trip.hotel.name}</strong> · {formatINR(trip.hotel.cost_per_night)}
            /night · rated {trip.hotel.rating}
          </div>

          <div className="day-list">
            {trip.itinerary.map((day) => (
              <div className="day-card" key={day.day_number}>
                <div className="day-stub">
                  <div className="day-stub-label">Day</div>
                  <div className="day-stub-num">{String(day.day_number).padStart(2, "0")}</div>
                  <div className="day-stub-date">{day.date}</div>
                </div>
                <div className="day-body">
                  <div className="day-top">
                    <span className="day-cost">Est. {formatINR(day.estimated_day_cost)}</span>
                  </div>
                  {day.summary && <p className="day-summary">{day.summary}</p>}

                  <div className="day-group">
                    <div className="day-group-label">Attractions</div>
                    {day.attractions.length === 0 && (
                      <div className="empty-day">Free day — rest or explore on foot.</div>
                    )}
                    {day.attractions.map((a) => (
                      <div className="item-row" key={a.name}>
                        <span>
                          <span className="item-name">{a.name}</span>{" "}
                          <span className="item-tags">({a.tags.join(", ")})</span>
                        </span>
                        <span className="item-meta">
                          {formatINR(a.cost)} · {a.duration_hours}h · ★{a.rating}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="day-group">
                    <div className="day-group-label">Dining</div>
                    {day.restaurants.map((r) => (
                      <div className="item-row" key={r.name}>
                        <span>
                          <span className="item-name">{r.name}</span>{" "}
                          <span className="item-tags">({r.cuisine})</span>
                        </span>
                        <span className="item-meta">
                          {formatINR(r.cost_per_person)}/person · ★{r.rating}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="tip-grid">
            <div className="tip-card">
              <div className="tip-card-title">Travel tips</div>
              <ul>
                {trip.travel_tips.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
            <div className="tip-card">
              <div className="tip-card-title">Avoid</div>
              <ul>
                {trip.things_to_avoid.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
            <div className="tip-card">
              <div className="tip-card-title">Pack</div>
              <ul>
                {trip.packing_tips.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}

      <div className="footer">
        <span>SmartTrip AI</span>
        <span>Gemini narrative layer · Firestore storage · 0/1 knapsack core</span>
      </div>
    </main>
  );
}
