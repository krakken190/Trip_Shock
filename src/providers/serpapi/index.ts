import type { FlightSearch, HotelSearch, PlaceSearch } from "@/domain/affected";
import { diffDays } from "@/domain/dates";
import type { FlightOption, HotelOption, PlaceCandidate, PlaceResult } from "@/domain/types";
import type { FlightSearchResponse, HotelSearchResponse, PlaceSearchResponse, TravelProvider } from "../types";
import { serpGet } from "./client";

// Docs: https://serpapi.com/google-flights-api · https://serpapi.com/google-hotels-api
// Every function below is the only place that knows a SerpApi response shape.

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const CABIN: Record<FlightSearch["cabin"], number> = { economy: 1, premium_economy: 2, business: 3, first: 4 };
const LOCALE = { currency: "INR", hl: "en", gl: "in" } as const;

export function normalizeFlights(body: Json): FlightOption[] {
  const all: Json[] = [...(body.best_flights ?? []), ...(body.other_flights ?? [])];
  const out: FlightOption[] = [];
  for (const o of all) {
    const legs: Json[] = o.flights ?? [];
    if (!legs.length || typeof o.price !== "number") continue;
    const airlines = [...new Set(legs.map((l) => String(l.airline ?? "")).filter(Boolean))];
    out.push({
      airline: airlines.join(" + ") || "Unknown airline",
      flightNumbers: legs.map((l) => String(l.flight_number ?? "").replace(/\s+/g, " ").trim()).filter(Boolean),
      departTime: String(legs[0].departure_airport?.time ?? ""),
      arriveTime: String(legs[legs.length - 1].arrival_airport?.time ?? ""),
      durationMin: Number(o.total_duration ?? legs.reduce((a, l) => a + Number(l.duration ?? 0), 0)),
      stops: legs.length - 1,
      price: o.price,
    });
  }
  return out;
}

function hotelFrom(p: Json, nights: number): HotelOption | null {
  const perNight = p.rate_per_night?.extracted_lowest ?? p.rate_per_night?.extracted_before_taxes_fees;
  const total = p.total_rate?.extracted_lowest ?? (typeof perNight === "number" ? perNight * nights : undefined);
  if (typeof total !== "number" || typeof perNight !== "number" || !p.name) return null;
  return {
    name: String(p.name),
    total,
    perNight,
    rating: typeof p.overall_rating === "number" ? p.overall_rating : null,
    stars: typeof p.extracted_hotel_class === "number" ? p.extracted_hotel_class : null,
    token: p.property_token ? String(p.property_token) : null,
  };
}

export function normalizeHotels(body: Json, nights: number): HotelOption[] {
  // A query that names one property can return that property's page instead of a list.
  if (!Array.isArray(body.properties) && body.name) {
    const one = hotelFrom(body, nights);
    return one ? [one] : [];
  }
  return ((body.properties ?? []) as Json[]).map((p) => hotelFrom(p, nights)).filter((x): x is HotelOption => !!x);
}

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function normalizePlace(body: Json): PlaceResult | null {
  const p: Json | undefined = body.place_results ?? body.local_results?.[0];
  if (!p) return null;
  let hours: Record<string, string> | null = null;
  const raw = p.operating_hours ?? p.hours;
  if (raw && typeof raw === "object") {
    const entries: [string, string][] = Array.isArray(raw)
      ? raw.flatMap((o: Json) => Object.entries(o).map(([k, v]) => [k, String(v)] as [string, string]))
      : Object.entries(raw).map(([k, v]) => [k, String(v)]);
    const known = entries.filter(([k]) => DAYS.includes(k.toLowerCase()));
    if (known.length) hours = Object.fromEntries(known.map(([k, v]) => [k.toLowerCase(), v]));
  }
  const closed = hours
    ? DAYS.map((d, i) => (hours![d] && /closed/i.test(hours![d]) ? i : -1)).filter((i) => i >= 0)
    : null;
  return {
    type: "place",
    name: String(p.title ?? p.name ?? ""),
    address: p.address ? String(p.address) : null,
    closedWeekdays: closed,
    hours,
    rating: typeof p.rating === "number" ? p.rating : null,
  };
}

export function normalizePlaceList(body: Json): PlaceCandidate[] {
  const list: Json[] = Array.isArray(body.local_results) ? body.local_results : body.place_results ? [body.place_results] : [];
  return list
    .filter((p) => p.title)
    .map((p) => ({
      name: String(p.title),
      rating: typeof p.rating === "number" ? p.rating : null,
      reviews: typeof p.reviews === "number" ? p.reviews : null,
      address: p.address ? String(p.address) : null,
      category: p.type ? String(p.type) : Array.isArray(p.types) ? String(p.types[0]) : null,
    }));
}

/** Google Flights `outbound_times`: "depFrom,depTo[,arrFrom,arrTo]" in whole hours (0–23). */
export function outboundTimes(req: Pick<FlightSearch, "time">): Record<string, string> {
  const t = req.time;
  if (!t) return {};
  const hour = (s: string) => Number(s.split(":")[0]);
  const ceil = (s: string) => Math.min(23, hour(s) + (s.endsWith(":00") ? 0 : 1));
  const dep = `${t.departAfter ? ceil(t.departAfter) : 0},${t.departBefore ? hour(t.departBefore) : 23}`;
  // "arrive by 18:00" → arrival hour range 0–17
  const arr = t.arriveBefore ? `,0,${Math.max(0, hour(t.arriveBefore) - (t.arriveBefore.endsWith(":00") ? 1 : 0))}` : "";
  return { outbound_times: dep + arr };
}

/** Google Hotels filters mirroring the traveller's stated budget. Final selection still happens in domain/select. */
function hotelFilters(req: HotelSearch): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (req.hotelName) return out;
  if (req.budget?.maxPerNight) out.max_price = Math.round(req.budget.maxPerNight);
  if (req.budget?.tier === "luxury") out.hotel_class = 5;
  else if (req.budget?.tier === "budget") out.rating = 7; // 3.5+
  else out.rating = 8; // 4.0+
  return out;
}

/** Keep stored raw payloads small: drop images and long lists we never read. */
function trimRaw(body: Json): Json {
  const { search_metadata, search_parameters, error } = body;
  return { search_metadata, search_parameters, error };
}

export function createSerpApiProvider(apiKey: string): TravelProvider {
  return {
    id: "serpapi",

    async searchFlights(req: FlightSearch, signal): Promise<FlightSearchResponse> {
      const params = {
        engine: "google_flights",
        departure_id: req.from,
        arrival_id: req.to,
        outbound_date: req.date,
        type: 2, // one-way
        adults: req.adults,
        children: req.children,
        travel_class: CABIN[req.cabin],
        ...LOCALE,
        ...outboundTimes(req),
      };
      const body = await serpGet(params, { apiKey, signal });
      return { options: body.__noResults ? [] : normalizeFlights(body), currency: "INR", params, raw: trimRaw(body) };
    },

    async searchHotels(req: HotelSearch, signal): Promise<HotelSearchResponse> {
      const nights = diffDays(req.checkIn, req.checkOut);
      const params = {
        engine: "google_hotels",
        q: req.hotelName ? `${req.hotelName} ${req.city}` : `hotels in ${req.city}`,
        check_in_date: req.checkIn,
        check_out_date: req.checkOut,
        adults: req.adults,
        children: req.children,
        ...LOCALE,
        ...hotelFilters(req),
      };
      const body = await serpGet(params, { apiKey, signal });
      return { options: body.__noResults ? [] : normalizeHotels(body, nights), nights, currency: "INR", params, raw: trimRaw(body) };
    },

    async suggestPlaces(query, signal) {
      const params = { engine: "google_maps", type: "search", q: query, hl: "en" };
      const body = await serpGet(params, { apiKey, signal });
      return { candidates: body.__noResults ? [] : normalizePlaceList(body), params };
    },

    async searchPlace(req: PlaceSearch, signal): Promise<PlaceSearchResponse> {
      const params = { engine: "google_maps", type: "search", q: req.query, hl: "en" };
      const body = await serpGet(params, { apiKey, signal });
      return { place: body.__noResults ? null : normalizePlace(body), params, raw: trimRaw(body) };
    },
  };
}
