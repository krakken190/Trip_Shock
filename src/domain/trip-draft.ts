import { z } from "zod";
import { airportCity, codesForPlace } from "./airports";
import { addDays, diffDays, shortDate } from "./dates";
import { sortNodes } from "./graph";
import { Cabin, HotelTier, TripNode, type NodeKind, type PlaceCandidate } from "./types";

// ---------------------------------------------------------------------------------------------
// 1. What the language model returns. Parsed leniently: missing keys become null / [].

const str = z.string().trim().min(1).nullish().transform((v) => v ?? null).catch(null);
const num = z.coerce.number().finite().nullish().transform((v) => v ?? null).catch(null);
const list = <T extends z.ZodType>(item: T) => z.array(item).nullish().transform((v) => v ?? []).catch([]);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().transform((v) => v ?? null).catch(null);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullish().transform((v) => v ?? null).catch(null);
const iata = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).nullish().transform((v) => v ?? null).catch(null);

export const DraftFlight = z.object({
  from_city: str, from_iata: iata, to_city: str, to_iata: iata, date,
  cabin: Cabin.nullish().transform((v) => v ?? null).catch(null),
  depart_after: hhmm, depart_before: hhmm, arrive_before: hhmm, source_text: str,
});
export const DraftStay = z.object({
  city: str, check_in: date, check_out: date, hotel_name: str,
  budget_tier: HotelTier.nullish().transform((v) => v ?? null).catch(null),
  max_per_night_inr: num, source_text: str,
});
export const DraftActivity = z.object({
  city: str, date, place_name: str, interest: str, near: str, count: num, source_text: str,
});
export const DraftTransfer = z.object({
  from: str, to: str,
  mode: z.enum(["taxi", "train", "shuttle", "ferry", "other"]).nullish().transform((v) => v ?? null).catch(null),
  date, source_text: str,
});

export const TripDraft = z.object({
  trip_name: str,
  adults: num,
  children: num,
  flights: list(DraftFlight),
  stays: list(DraftStay),
  activities: list(DraftActivity),
  transfers: list(DraftTransfer),
  unmapped: list(z.string()),
});
export type TripDraft = z.infer<typeof TripDraft>;

const S = (description?: string) => ({ type: ["string", "null"], ...(description ? { description } : {}) });
const N = (description?: string) => ({ type: ["number", "null"], ...(description ? { description } : {}) });
const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const DATE = "YYYY-MM-DD, or null if not stated";
const TIME = "24h HH:MM local time, or null";
const SOURCE = "Short exact phrase from the traveller's text that this item comes from";

/** JSON Schema sent to the model (strict structured-output compatible). */
export const TRIP_DRAFT_JSON_SCHEMA = obj({
  trip_name: S("Short name like 'Pune to Goa', or null"),
  adults: N("Adults travelling, only if stated or clearly implied"),
  children: N("Children travelling, only if stated"),
  flights: {
    type: "array",
    description: "One entry per one-way flight in travel order. Include a return flight only if the traveller mentions returning.",
    items: obj({
      from_city: S(), from_iata: S("Main airport IATA code if confident, else null"),
      to_city: S(), to_iata: S("Main airport IATA code if confident, else null"),
      date: S(DATE),
      cabin: { type: ["string", "null"], enum: ["economy", "premium_economy", "business", "first", null] },
      depart_after: S(TIME), depart_before: S(TIME), arrive_before: S(TIME),
      source_text: { type: "string", description: SOURCE },
    }),
  },
  stays: {
    type: "array",
    items: obj({
      city: S(), check_in: S(DATE), check_out: S(DATE),
      hotel_name: S("Only if a specific hotel was named"),
      budget_tier: { type: ["string", "null"], enum: ["budget", "mid", "luxury", null] },
      max_per_night_inr: N("Only if the traveller stated a nightly amount"),
      source_text: { type: "string", description: SOURCE },
    }),
  },
  activities: {
    type: "array",
    items: obj({
      city: S(), date: S(DATE),
      place_name: S("Only if a specific place was named"),
      interest: S("Kind of activity when no place was named, e.g. 'adventure', 'beaches'"),
      near: S("Area or landmark the traveller mentioned"),
      count: N("How many places they want suggested, if stated"),
      source_text: { type: "string", description: SOURCE },
    }),
  },
  transfers: {
    type: "array",
    items: obj({
      from: S(), to: S(),
      mode: { type: ["string", "null"], enum: ["taxi", "train", "shuttle", "ferry", "other", null] },
      date: S(DATE),
      source_text: { type: "string", description: SOURCE },
    }),
  },
  unmapped: { type: "array", items: { type: "string" }, description: "Requests understood but not representable (e.g. 'window seat', 'cost estimate')" },
});

// ---------------------------------------------------------------------------------------------
// 2. Editable review items. Flat on purpose so the review form can bind to them directly.

export type TransferMode = "taxi" | "train" | "shuttle" | "ferry" | "other";

export interface DraftItem {
  key: string;
  kind: NodeKind;
  /** Phrase from the traveller's text this came from */
  source: string | null;
  /** Fields filled with a default rather than stated */
  defaulted: string[];
  start: string | null;
  end: string | null;
  // flight
  from?: string;
  to?: string;
  fromCity?: string | null;
  toCity?: string | null;
  arrival?: number;
  cabin?: z.infer<typeof Cabin>;
  departAfter?: string | null;
  departBefore?: string | null;
  arriveBefore?: string | null;
  // stay
  city?: string;
  hotelName?: string | null;
  tier?: z.infer<typeof HotelTier> | null;
  maxPerNight?: number | null;
  // activity
  name?: string | null;
  placeQuery?: string | null;
  interest?: string | null;
  near?: string | null;
  count?: number | null;
  estimatedCost?: number | null;
  // transfer
  mode?: TransferMode;
}

export interface DraftPlan {
  name: string;
  travelers: { adults: number; children: number };
  travelersDefaulted: boolean;
  items: DraftItem[];
  unmapped: string[];
}

let seq = 0;
const key = (k: string) => `${k}_${Date.now().toString(36)}${(seq++).toString(36)}`;

function resolveIata(code: string | null, city: string | null): string {
  if (code) return code;
  if (city) return codesForPlace(city)[0] ?? "";
  return "";
}

/** Converts the model's draft into editable items. Only fills defaults that are labelled as such. */
export function draftToPlan(d: TripDraft): DraftPlan {
  const items: DraftItem[] = [];
  for (const f of d.flights) {
    items.push({
      key: key("fl"),
      kind: "flight",
      source: f.source_text,
      defaulted: f.cabin ? [] : ["cabin"],
      from: resolveIata(f.from_iata, f.from_city),
      to: resolveIata(f.to_iata, f.to_city),
      fromCity: f.from_city,
      toCity: f.to_city,
      start: f.date,
      end: f.date,
      arrival: 0,
      cabin: f.cabin ?? "economy",
      departAfter: f.depart_after,
      departBefore: f.depart_before,
      arriveBefore: f.arrive_before,
    });
  }
  for (const s of d.stays) {
    items.push({
      key: key("st"),
      kind: "stay",
      source: s.source_text,
      defaulted: [],
      city: s.city ?? "",
      hotelName: s.hotel_name,
      tier: s.budget_tier,
      maxPerNight: s.max_per_night_inr && s.max_per_night_inr > 0 ? s.max_per_night_inr : null,
      start: s.check_in,
      end: s.check_out,
    });
  }
  for (const a of d.activities) {
    items.push({
      key: key("ac"),
      kind: "activity",
      source: a.source_text,
      defaulted: [],
      city: a.city ?? "",
      name: a.place_name,
      placeQuery: a.place_name ? `${a.place_name} ${a.city ?? ""}`.trim() : null,
      interest: a.place_name ? null : a.interest,
      near: a.near,
      count: a.count ? Math.max(1, Math.min(5, Math.round(a.count))) : null,
      start: a.date,
      end: a.date,
      estimatedCost: null,
    });
  }
  // Models sometimes answer "GOI" for "the airport" — make it a readable place that still reads as an airport
  const place = (v: string | null) => (v && /^[A-Z]{3}$/.test(v.trim()) ? `${airportCity(v.trim())} Airport` : v ?? "");
  for (const t of d.transfers) {
    items.push({
      key: key("tr"),
      kind: "transfer",
      source: t.source_text,
      defaulted: t.mode ? [] : ["mode"],
      from: place(t.from),
      to: place(t.to),
      mode: t.mode ?? "taxi",
      start: t.date,
      end: t.date,
      estimatedCost: null,
    });
  }
  const adults = d.adults && d.adults >= 1 ? Math.min(9, Math.round(d.adults)) : null;
  const children = d.children && d.children >= 0 ? Math.min(8, Math.round(d.children)) : 0;
  const firstLeg = d.flights[0];
  const lastStay = d.stays[d.stays.length - 1];
  const fallbackName = firstLeg?.from_city && (lastStay?.city ?? firstLeg.to_city) ? `${firstLeg.from_city} to ${lastStay?.city ?? firstLeg.to_city}` : lastStay?.city ? `Trip to ${lastStay.city}` : "New trip";
  return {
    name: d.trip_name ?? fallbackName,
    travelers: { adults: adults ?? 1, children },
    travelersDefaulted: adults == null,
    items: orderItems(items),
    unmapped: d.unmapped.filter((u) => u.trim()),
  };
}

export function orderItems(items: DraftItem[]): DraftItem[] {
  const rank: Record<NodeKind, number> = { transfer: 0, flight: 1, stay: 2, activity: 3 };
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => {
      const sa = a.it.start ?? "9999";
      const sb = b.it.start ?? "9999";
      // A transfer *to* the airport goes before the flight on the same day
      const ra = a.it.kind === "transfer" && !/airport/i.test(a.it.to ?? "") ? 1.5 : rank[a.it.kind];
      const rb = b.it.kind === "transfer" && !/airport/i.test(b.it.to ?? "") ? 1.5 : rank[b.it.kind];
      return sa.localeCompare(sb) || ra - rb || a.i - b.i;
    })
    .map((x) => x.it);
}

// ---------------------------------------------------------------------------------------------
// 3. Validation, suggestions, conversion

export function needsPlaces(it: DraftItem): boolean {
  return it.kind === "activity" && !it.name && !!it.interest;
}

export function placesQuery(it: DraftItem): string {
  const what = it.interest ?? "things to do";
  return it.near ? `${what} near ${it.near}, ${it.city}` : `${what} in ${it.city}`;
}

/** Blocking problems — the item can't become part of the plan until they're resolved. */
export function itemIssues(it: DraftItem): string[] {
  const out: string[] = [];
  const need = (cond: unknown, msg: string) => !cond && out.push(msg);
  switch (it.kind) {
    case "flight":
      need(/^[A-Z]{3}$/.test(it.from ?? ""), `Airport code for ${it.fromCity || "origin"}`);
      need(/^[A-Z]{3}$/.test(it.to ?? ""), `Airport code for ${it.toCity || "destination"}`);
      need(it.start, "Departure date");
      if (it.from && it.from === it.to) out.push("Origin and destination are the same");
      break;
    case "stay":
      need(it.city, "City");
      need(it.start, "Check-in date");
      need(it.end, "Check-out date");
      if (it.start && it.end && diffDays(it.start, it.end) < 1) out.push("Check-out must be after check-in");
      break;
    case "activity":
      if (needsPlaces(it)) out.push("Pick places");
      else need(it.name, "Activity or place name");
      need(it.city, "City");
      need(it.start, "Date");
      break;
    case "transfer":
      need(it.from, "From");
      need(it.to, "To");
      need(it.start, "Date");
      break;
  }
  return out;
}

/** Non-blocking notes */
export function itemWarnings(it: DraftItem, today: string): string[] {
  const out: string[] = [];
  if (it.start && it.start < today) out.push(`${shortDate(it.start)} is in the past`);
  return out;
}

export function itemToNode(it: DraftItem, id: string): TripNode | null {
  if (itemIssues(it).length) return null;
  const s = it.start!;
  let raw: unknown;
  switch (it.kind) {
    case "flight": {
      const tp = { departAfter: it.departAfter ?? null, departBefore: it.departBefore ?? null, arriveBefore: it.arriveBefore ?? null };
      raw = {
        id, kind: "flight", from: it.from, to: it.to, start: s, end: addDays(s, it.arrival ?? 0), cabin: it.cabin ?? "economy", fixed: false,
        timePreference: tp.departAfter || tp.departBefore || tp.arriveBefore ? tp : null,
      };
      break;
    }
    case "stay":
      raw = {
        id, kind: "stay", city: it.city, hotelName: it.hotelName?.trim() || null, start: s, end: it.end, fixed: false,
        budget: it.tier || it.maxPerNight ? { tier: it.tier ?? null, maxPerNight: it.maxPerNight ?? null } : null,
      };
      break;
    case "activity":
      raw = { id, kind: "activity", name: it.name, city: it.city, placeQuery: it.placeQuery || `${it.name} ${it.city}`, start: s, end: s, estimatedCost: it.estimatedCost ?? null, fixed: false };
      break;
    case "transfer":
      raw = { id, kind: "transfer", from: it.from, to: it.to, mode: it.mode ?? "taxi", start: s, end: s, estimatedCost: it.estimatedCost ?? null, fixed: false };
      break;
  }
  const r = TripNode.safeParse(raw);
  return r.success ? r.data : null;
}

/** Turns a picked place into a concrete activity item on the interest item's date. */
export function activityFromPlace(interest: DraftItem, place: PlaceCandidate): DraftItem {
  return {
    key: key("ac"),
    kind: "activity",
    source: interest.source,
    defaulted: [],
    city: interest.city,
    name: place.name,
    placeQuery: `${place.name} ${interest.city ?? ""}`.trim(),
    interest: null,
    near: interest.near,
    count: null,
    start: interest.start,
    end: interest.start,
    estimatedCost: null,
  };
}

export interface Suggestion {
  id: string;
  label: string;
  /** Patch an existing item */
  itemKey?: string;
  patch?: Partial<DraftItem>;
  /** Or add a new item */
  add?: DraftItem;
}

const sameCity = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && (a.toLowerCase() === b.toLowerCase() || codesForPlace(a).some((c) => codesForPlace(b).includes(c)));

function flightCity(code: string | undefined, city: string | null | undefined) {
  return city || (code ? airportCity(code) : "");
}

/**
 * One-click fixes derived from what the traveller did say (e.g. "use the Goa check-in date for this
 * flight"). Nothing is applied until the traveller clicks it.
 */
export function planSuggestions(items: DraftItem[]): Suggestion[] {
  const out: Suggestion[] = [];
  const flights = items.filter((i) => i.kind === "flight");
  const stays = items.filter((i) => i.kind === "stay");

  for (const f of flights) {
    if (f.start) continue;
    const dest = flightCity(f.to, f.toCity);
    const origin = flightCity(f.from, f.fromCity);
    const arriving = stays.find((s) => sameCity(s.city, dest) && s.start);
    const leaving = stays.find((s) => sameCity(s.city, origin) && s.end);
    if (arriving) out.push({ id: `fd-${f.key}`, itemKey: f.key, patch: { start: arriving.start, end: arriving.start }, label: `Fly on ${shortDate(arriving.start!)} (check-in in ${arriving.city})` });
    else if (leaving) out.push({ id: `fd-${f.key}`, itemKey: f.key, patch: { start: leaving.end, end: leaving.end }, label: `Fly on ${shortDate(leaving.end!)} (check-out in ${leaving.city})` });
  }
  for (const s of stays) {
    const inbound = flights.find((f) => sameCity(flightCity(f.to, f.toCity), s.city) && f.start);
    const outbound = flights.find((f) => sameCity(flightCity(f.from, f.fromCity), s.city) && f.start);
    if (!s.start && inbound) out.push({ id: `si-${s.key}`, itemKey: s.key, patch: { start: inbound.start }, label: `Check in ${shortDate(inbound.start!)} (when you land)` });
    if (!s.end && outbound) out.push({ id: `so-${s.key}`, itemKey: s.key, patch: { end: outbound.start }, label: `Check out ${shortDate(outbound.start!)} (when you fly out)` });
  }
  for (const t of items.filter((i) => i.kind === "transfer" && !i.start)) {
    const toAirport = /airport/i.test(t.to ?? "");
    const f = toAirport ? flights.find((x) => x.start) : [...flights].reverse().find((x) => x.start);
    if (f) out.push({ id: `td-${t.key}`, itemKey: t.key, patch: { start: f.start, end: f.start }, label: `On ${shortDate(f.start!)} (${toAirport ? "departure" : "arrival"} day)` });
  }
  for (const a of items.filter((i) => i.kind === "activity" && !i.start)) {
    const host = stays.find((s) => sameCity(s.city, a.city) && s.start);
    if (host) {
      const day = host.end && diffDays(host.start!, host.end) > 1 ? addDays(host.start!, 1) : host.start!;
      out.push({ id: `ad-${a.key}`, itemKey: a.key, patch: { start: day, end: day }, label: `On ${shortDate(day)} (day ${day === host.start ? 1 : 2} in ${host.city})` });
    }
  }

  // A cabin stated for one flight but only defaulted on others
  const statedCabin = flights.find((f) => !f.defaulted.includes("cabin") && f.cabin && f.cabin !== "economy")?.cabin;
  if (statedCabin) {
    for (const f of flights.filter((x) => x.defaulted.includes("cabin") && x.cabin !== statedCabin)) {
      out.push({ id: `cab-${f.key}`, itemKey: f.key, patch: { cabin: statedCabin, defaulted: f.defaulted.filter((d) => d !== "cabin") }, label: `Fly ${statedCabin.replace("_", " ")} on this leg too` });
    }
  }

  // Return flight: the trip starts with a flight out of X, the last stay ends, nothing flies back.
  const first = flights[0];
  const lastStay = [...stays].reverse().find((s) => s.end);
  if (first && lastStay?.end) {
    const home = flightCity(first.from, first.fromCity);
    const returning = flights.some((f) => sameCity(flightCity(f.to, f.toCity), home) && f !== first);
    const lastCityCode = codesForPlace(lastStay.city ?? "")[0] ?? (sameCity(flightCity(first.to, first.toCity), lastStay.city) ? first.to : "");
    if (!returning && home && !sameCity(home, lastStay.city)) {
      out.push({
        id: "return-flight",
        label: `Add a return flight ${lastCityCode || lastStay.city} → ${first.from} on ${shortDate(lastStay.end)}`,
        add: {
          key: key("fl"), kind: "flight", source: null, defaulted: ["cabin"],
          from: lastCityCode, to: first.from, fromCity: lastStay.city, toCity: first.fromCity ?? home,
          start: lastStay.end, end: lastStay.end, arrival: 0, cabin: first.cabin ?? "economy",
          departAfter: null, departBefore: null, arriveBefore: null,
        },
      });
    }
  }
  return out;
}

/** Everything the traveller confirmed, as plan nodes. */
export function planToNodes(items: DraftItem[], newId: (kind: NodeKind) => string): TripNode[] {
  const nodes: TripNode[] = [];
  for (const it of items) {
    const n = itemToNode(it, newId(it.kind));
    if (n) nodes.push(n);
  }
  return sortNodes(nodes);
}
