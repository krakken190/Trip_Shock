import type { Cabin, Engine, HotelBudget, TimePreference, Travelers, TripNode } from "./types";

export interface FlightSearch {
  engine: "google_flights";
  key: string;
  from: string;
  to: string;
  date: string;
  adults: number;
  children: number;
  cabin: Cabin;
  preferred: string[] | null;
  time: TimePreference | null;
}

export interface HotelSearch {
  engine: "google_hotels";
  key: string;
  city: string;
  hotelName: string | null;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  budget: HotelBudget | null;
}

export interface PlaceSearch {
  engine: "google_maps";
  key: string;
  query: string;
}

export type SearchRequest = FlightSearch | HotelSearch | PlaceSearch;

/**
 * The exact search a node needs. Two nodes with the same key can share evidence; a node whose key
 * changed between baseline and scenario must be re-searched. Returns null for nodes without a
 * data source (transfers).
 */
export function searchFor(n: TripNode, t: Travelers): SearchRequest | null {
  switch (n.kind) {
    case "flight": {
      const preferred = n.preferredFlight?.flightNumbers ?? null;
      const tp = n.timePreference;
      const time = tp && (tp.departAfter || tp.departBefore || tp.arriveBefore) ? tp : null;
      const window = time ? `t${time.departAfter ?? ""}-${time.departBefore ?? ""}-${time.arriveBefore ?? ""}` : "anytime";
      return {
        engine: "google_flights",
        key: ["flights", n.from, n.to, n.start, `a${t.adults}`, `c${t.children}`, n.cabin, preferred?.join("+") ?? "any", window].join("|"),
        from: n.from,
        to: n.to,
        date: n.start,
        adults: t.adults,
        children: t.children,
        cabin: n.cabin,
        preferred,
        time,
      };
    }
    case "stay": {
      const hotelName = n.hotelName?.trim() || null;
      const budget = !hotelName && n.budget && (n.budget.tier || n.budget.maxPerNight) ? n.budget : null;
      const b = budget ? `${budget.tier ?? "mid"}${budget.maxPerNight ? `<${budget.maxPerNight}` : ""}` : "mid";
      return {
        engine: "google_hotels",
        key: ["hotels", n.city.toLowerCase(), hotelName?.toLowerCase() ?? "any", n.start, n.end, `a${t.adults}`, `c${t.children}`, b].join("|"),
        city: n.city,
        hotelName,
        checkIn: n.start,
        checkOut: n.end,
        adults: t.adults,
        children: t.children,
        budget,
      };
    }
    case "activity":
      // Opening hours don't depend on the date, so date shifts never trigger a new place search.
      return { engine: "google_maps", key: ["places", n.placeQuery.toLowerCase()].join("|"), query: n.placeQuery };
    case "transfer":
      return null;
  }
}

export interface RefreshPlan {
  /** Search parameters changed → must query the provider */
  refetch: string[];
  /** Identical search as the baseline → baseline evidence applies */
  reuse: string[];
  /** No data source for this node */
  none: string[];
}

export function planRefresh(base: TripNode[], scenario: TripNode[], t: Travelers): RefreshPlan {
  const baseById = new Map(base.map((n) => [n.id, n]));
  const plan: RefreshPlan = { refetch: [], reuse: [], none: [] };
  for (const n of scenario) {
    const s = searchFor(n, t);
    if (!s) {
      plan.none.push(n.id);
      continue;
    }
    const b = baseById.get(n.id);
    const bs = b ? searchFor(b, t) : null;
    if (bs && bs.key === s.key) plan.reuse.push(n.id);
    else plan.refetch.push(n.id);
  }
  return plan;
}

export const ENGINE_LABEL: Record<Engine, string> = {
  google_flights: "Google Flights",
  google_hotels: "Google Hotels",
  google_maps: "Google Maps",
};
