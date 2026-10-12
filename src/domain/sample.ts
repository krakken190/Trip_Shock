import type { TripInput } from "./types";

/** The spec's reference trip: Delhi → Singapore → Bali → Delhi, 2 adults. */
export function sampleTrip(): TripInput {
  return {
    name: "Singapore & Bali",
    travelers: { adults: 2, children: 0 },
    nodes: [
      { id: "fl_del_sin", kind: "flight", from: "DEL", to: "SIN", start: "2026-11-10", end: "2026-11-10", cabin: "economy", fixed: false },
      { id: "tr_changi", kind: "transfer", from: "Changi Airport", to: "Hotel", mode: "taxi", start: "2026-11-10", end: "2026-11-10", estimatedCost: 1600, fixed: false },
      { id: "st_sin", kind: "stay", city: "Singapore", hotelName: null, start: "2026-11-10", end: "2026-11-13", fixed: false },
      { id: "ac_museum", kind: "activity", name: "Peranakan Museum", city: "Singapore", placeQuery: "Peranakan Museum Singapore", start: "2026-11-11", end: "2026-11-11", estimatedCost: 1500, fixed: false },
      { id: "fl_sin_dps", kind: "flight", from: "SIN", to: "DPS", start: "2026-11-13", end: "2026-11-13", cabin: "economy", fixed: false },
      { id: "st_bali", kind: "stay", city: "Bali", hotelName: "Alila Seminyak", start: "2026-11-13", end: "2026-11-17", fixed: false },
      { id: "ac_uluwatu", kind: "activity", name: "Uluwatu Temple at sunset", city: "Bali", placeQuery: "Uluwatu Temple Bali", start: "2026-11-15", end: "2026-11-15", estimatedCost: 1200, fixed: false },
      { id: "fl_dps_del", kind: "flight", from: "DPS", to: "DEL", start: "2026-11-17", end: "2026-11-17", cabin: "economy", fixed: false },
    ],
  };
}
