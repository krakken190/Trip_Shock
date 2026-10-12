import type { FlightSearch, HotelSearch, PlaceSearch } from "@/domain/affected";
import { addDays, diffDays, weekday } from "@/domain/dates";
import type { FlightOption, HotelOption, PlaceCandidate, PlaceResult } from "@/domain/types";
import type { TravelProvider } from "./types";

// Deterministic simulated provider for demos and tests. Same inputs → same outputs, with prices
// that vary plausibly by date so scenarios produce meaningful diffs. Every observation it creates
// is labelled provider "mock" and shown as "Simulated" in the UI.

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
const unit = (s: string) => hash(s) / 0xffffffff; // [0, 1]
const round = (n: number, to = 50) => Math.round(n / to) * to;

const CARRIERS: Record<string, [string, string][]> = {
  SIN: [["Singapore Airlines", "SQ"], ["IndiGo", "6E"], ["Air India", "AI"], ["Scoot", "TR"]],
  DPS: [["Garuda Indonesia", "GA"], ["Singapore Airlines", "SQ"], ["Scoot", "TR"], ["AirAsia", "QZ"]],
  DEFAULT: [["IndiGo", "6E"], ["Air India", "AI"], ["Emirates", "EK"], ["Vistara", "UK"]],
};

function carriersFor(from: string, to: string) {
  return CARRIERS[to] ?? CARRIERS[from] ?? CARRIERS.DEFAULT;
}

function dateFactor(seed: string, date: string): number {
  const wd = weekday(date);
  const dow = wd === 5 || wd === 0 ? 1.1 : wd === 2 || wd === 3 ? 0.94 : 1;
  return dow * (0.88 + unit(`${seed}|${date}`) * 0.24);
}

function mockFlights(req: FlightSearch): FlightOption[] {
  const route = `${req.from}-${req.to}`;
  const base = 7000 + unit(route) * 13000;
  const pax = req.adults + req.children * 0.75;
  const cabin = { economy: 1, premium_economy: 1.8, business: 3.6, first: 6 }[req.cabin];
  const carriers = carriersFor(req.from, req.to);
  const options: FlightOption[] = [];
  for (let i = 0; i < 6; i++) {
    const [airline, code] = carriers[i % carriers.length];
    const num = 100 + (hash(`${route}|${i}`) % 800);
    const flightNo = `${code} ${num}`;
    // A given flight occasionally doesn't operate on a given date
    if (hash(`${flightNo}|${req.date}`) % 9 === 0) continue;
    const stops = i < 3 ? 0 : 1;
    const depMin = 360 + (hash(`${route}|t|${i}`) % 67) * 15; // 06:00–22:30
    const dur = Math.round((150 + unit(route) * 240) * (stops ? 1.6 : 1));
    const arrMin = depMin + dur;
    const fmt = (d: string, m: number) =>
      `${addDays(d, Math.floor(m / 1440))} ${String(Math.floor((m % 1440) / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const optFactor = (stops ? 0.82 : 1) * (0.92 + unit(`${flightNo}`) * 0.3);
    options.push({
      airline,
      flightNumbers: stops ? [flightNo, `${code} ${num + 1}`] : [flightNo],
      departTime: fmt(req.date, depMin),
      arriveTime: fmt(req.date, arrMin),
      durationMin: dur,
      stops,
      price: round(base * optFactor * dateFactor(flightNo, req.date) * pax * cabin, 1),
    });
  }
  return options;
}

const HOTEL_WORDS = ["Grand", "Harbour", "Garden", "Heritage", "Park", "Residence", "Bay", "Central", "Royal", "Canopy"];

function mockHotels(req: HotelSearch): HotelOption[] {
  const nights = diffDays(req.checkIn, req.checkOut);
  const suffix = ["Hotel", "Suites", "Resort", "Inn"];
  const names = Array.from(
    { length: 8 },
    (_, i) => `${req.city} ${HOTEL_WORDS[(hash(req.city) + i * 3) % HOTEL_WORDS.length]} ${suffix[i % suffix.length]}`,
  );
  if (req.hotelName) names.unshift(req.hotelName);
  const out: HotelOption[] = [];
  for (const name of names) {
    // Occasionally sold out for a date range
    if (hash(`${name}|${req.checkIn}|${req.checkOut}`) % 13 === 0) continue;
    const base = 3500 + unit(`${name}|base`) * 12500;
    let total = 0;
    for (let d = 0; d < nights; d++) {
      const night = addDays(req.checkIn, d);
      const wd = weekday(night);
      const weekend = wd === 5 || wd === 6 ? 1.18 : 1;
      total += base * weekend * (0.9 + unit(`${name}|${night}`) * 0.2);
    }
    const rooms = Math.max(1, Math.ceil((req.adults + req.children) / 3));
    total = round(total * rooms);
    out.push({
      name,
      total,
      perNight: round(total / Math.max(1, nights)),
      rating: Math.round((3.6 + unit(`${name}|r`) * 1.2) * 10) / 10,
      stars: 3 + (hash(`${name}|s`) % 3),
      token: `mock_${hash(name).toString(36)}`,
    });
  }
  return out;
}

const PLACES: Record<string, { closed: number[] | null; open: string }> = {
  "peranakan museum": { closed: [4], open: "10 AM–7 PM" },
  "uluwatu temple": { closed: [], open: "7 AM–7 PM" },
};
const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function mockPlace(req: PlaceSearch): PlaceResult | null {
  const q = req.query.toLowerCase();
  const known = Object.entries(PLACES).find(([k]) => q.includes(k));
  const h = hash(q);
  const spec = known?.[1] ?? (h % 3 === 0 ? { closed: null, open: "" } : { closed: h % 7 === 1 ? [1] : [], open: "9 AM–6 PM" });
  const name = req.query.replace(/\b(singapore|bali)\b/gi, "").trim() || req.query;
  if (spec.closed === null) {
    return { type: "place", name, address: null, closedWeekdays: null, hours: null, rating: 4.4 };
  }
  const hours = Object.fromEntries(DAY_KEYS.map((d, i) => [d, spec.closed!.includes(i) ? "Closed" : spec.open]));
  return { type: "place", name, address: null, closedWeekdays: spec.closed, hours, rating: Math.round((4 + unit(q) * 0.8) * 10) / 10 };
}

const PLACE_KINDS: [RegExp, string[]][] = [
  [/adventure|thrill|sport|water|dive|trek|hike/i, ["Watersports Centre", "Adventure Park", "Zipline & Rope Course", "Kayaking Point", "Trekking Base"]],
  [/beach|sea|coast/i, ["Beach", "Bay Beach", "Sunset Point", "Beach Shack Row", "Cove"]],
  [/museum|history|heritage|culture/i, ["Heritage Museum", "Old Fort", "City Museum", "Art Gallery", "Heritage Walk"]],
  [/food|eat|restaurant|cafe/i, ["Food Street", "Night Market", "Seafood Kitchen", "Café Quarter", "Spice Market"]],
];

function mockSuggest(query: string): PlaceCandidate[] {
  const kinds = PLACE_KINDS.find(([re]) => re.test(query))?.[1] ?? ["Viewpoint", "Market", "Park", "Old Quarter", "Lake"];
  const where = /near ([^,]+)/i.exec(query)?.[1] ?? /in (.+)$/i.exec(query)?.[1] ?? "City";
  const place = where.trim().replace(/\b\w/g, (c) => c.toUpperCase());
  return kinds
    .map((k, i) => ({
      name: `${place} ${k}`,
      rating: Math.round((3.9 + unit(`${query}|${i}`) * 1) * 10) / 10,
      reviews: 80 + (hash(`${query}|r|${i}`) % 4000),
      address: `${place} (simulated)`,
      category: k.split(" ").slice(-1)[0],
    }))
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
}

const latency = () => {
  const ms = Number(process.env.TRIPSHOCK_MOCK_LATENCY_MS ?? 250);
  return ms > 0 ? new Promise((r) => setTimeout(r, ms * (0.5 + Math.random()))) : Promise.resolve();
};

export function createMockProvider(): TravelProvider {
  return {
    id: "mock",
    async searchFlights(req) {
      await latency();
      const params = { engine: "google_flights", departure_id: req.from, arrival_id: req.to, outbound_date: req.date, adults: req.adults, children: req.children, travel_class: req.cabin, currency: "INR" };
      return { options: mockFlights(req), currency: "INR", params };
    },
    async searchHotels(req) {
      await latency();
      const params = { engine: "google_hotels", q: req.hotelName ? `${req.hotelName} ${req.city}` : `hotels in ${req.city}`, check_in_date: req.checkIn, check_out_date: req.checkOut, adults: req.adults, children: req.children, currency: "INR" };
      return { options: mockHotels(req), nights: diffDays(req.checkIn, req.checkOut), currency: "INR", params };
    },
    async suggestPlaces(query) {
      await latency();
      return { candidates: mockSuggest(query), params: { engine: "google_maps", type: "search", q: query } };
    },
    async searchPlace(req) {
      await latency();
      return { place: mockPlace(req), params: { engine: "google_maps", type: "search", q: req.query } };
    },
  };
}
