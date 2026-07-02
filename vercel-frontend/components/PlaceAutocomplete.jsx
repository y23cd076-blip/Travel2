"use client";

import { useEffect, useRef, useState } from "react";

const PHOTON_URL = "https://photon.komoot.io/api/";
const DEBOUNCE_MS = 300;

/**
 * Wraps a plain text input with as-you-type place suggestions from Photon
 * (https://photon.komoot.io), a free, keyless geocoding API built on
 * OpenStreetMap data. No API key, no billing account -- replaces the old
 * google.maps.places.Autocomplete widget. Still works as a plain text
 * input if the network request fails; the form just won't offer
 * suggestions for that keystroke.
 */
export default function PlaceAutocomplete({ id, label, value, onChange, placeholder }) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function fetchSuggestions(text) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!text || text.trim().length < 2) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `${PHOTON_URL}?q=${encodeURIComponent(text)}&limit=5`
        );
        const data = await res.json();
        const features = data?.features || [];
        const results = features
          .map((f) => {
            const p = f.properties || {};
            const parts = [p.name, p.city, p.state, p.country].filter(
              (part, idx, arr) => part && arr.indexOf(part) === idx
            );
            return { label: parts.join(", "), name: p.name };
          })
          .filter((r) => r.label);
        setSuggestions(results);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
  }

  function handleInputChange(e) {
    const text = e.target.value;
    onChange(text);
    setOpen(true);
    fetchSuggestions(text);
  }

  function handleSelect(suggestion) {
    onChange(suggestion.label);
    setSuggestions([]);
    setOpen(false);
  }

  return (
    <div className="field" ref={containerRef} style={{ position: "relative" }}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={handleInputChange}
        onFocus={() => value && setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
        required
      />
      {open && (loading || suggestions.length > 0) && (
        <ul
          role="listbox"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: 4,
            padding: 4,
            listStyle: "none",
            background: "var(--surface-raised)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
            zIndex: 20,
            maxHeight: 240,
            overflowY: "auto",
          }}
        >
          {loading && suggestions.length === 0 && (
            <li style={{ padding: "8px 10px", color: "var(--text-faint)", fontSize: 13 }}>
              Searching…
            </li>
          )}
          {suggestions.map((s, i) => (
            <li key={`${s.label}-${i}`}>
              <button
                type="button"
                onClick={() => handleSelect(s)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 10px",
                  background: "transparent",
                  border: "none",
                  borderRadius: "var(--radius-sm)",
                  color: "var(--text)",
                  fontSize: 13,
                  cursor: "pointer",
                }}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--accent-soft)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
