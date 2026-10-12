import type {
  FlightOption,
  FlightResult,
  HotelBudget,
  HotelOption,
  HotelResult,
  PreferredFlight,
  TimePreference,
} from "./types";

const normFlightNo = (s: string) => s.replace(/\s+/g, "").toUpperCase();
const clock = (s: string) => s.split(" ")[1] ?? "";

export function hasTimeWindow(t: TimePreference | null | undefined): t is TimePreference {
  return !!(t && (t.departAfter || t.departBefore || t.arriveBefore));
}

/** Local-time window check. A next-day arrival never satisfies "arrive before". */
export function fitsTimeWindow(o: FlightOption, t: TimePreference): boolean {
  const dep = clock(o.departTime);
  const arr = clock(o.arriveTime);
  const nextDay = o.arriveTime.slice(0, 10) > o.departTime.slice(0, 10);
  if (t.departAfter && dep < t.departAfter) return false;
  if (t.departBefore && dep > t.departBefore) return false;
  if (t.arriveBefore && (nextDay || arr > t.arriveBefore)) return false;
  return true;
}

export function describeTimeWindow(t: TimePreference | null | undefined): string | null {
  if (!hasTimeWindow(t)) return null;
  const parts: string[] = [];
  if (t.departAfter && t.departBefore) parts.push(`departs ${t.departAfter}–${t.departBefore}`);
  else if (t.departAfter) parts.push(`departs after ${t.departAfter}`);
  else if (t.departBefore) parts.push(`departs before ${t.departBefore}`);
  if (t.arriveBefore) parts.push(`arrives by ${t.arriveBefore}`);
  return parts.join(", ");
}

/**
 * Picks the option that represents a flight node: the user's pinned flight when it appears in the
 * results, otherwise the cheapest option inside the requested time window (or the cheapest overall,
 * flagged, when nothing fits). The result says which rule applied.
 */
export function selectFlight(
  options: FlightOption[],
  preferred: PreferredFlight | null | undefined,
  currency: string,
  time?: TimePreference | null,
): FlightResult | null {
  const priced = options.filter((o) => Number.isFinite(o.price) && o.price > 0);
  if (!priced.length) return null;
  const sorted = [...priced].sort((a, b) => a.price - b.price);

  let pool = sorted;
  let timeWindowMatched: boolean | null = null;
  if (hasTimeWindow(time)) {
    const inWindow = sorted.filter((o) => fitsTimeWindow(o, time));
    timeWindowMatched = inWindow.length > 0;
    if (inWindow.length) pool = inWindow;
  }

  let match: FlightResult["match"] = "cheapest";
  let chosen = pool[0];
  let preferredFound: boolean | null = null;
  if (preferred) {
    const want = preferred.flightNumbers.map(normFlightNo).join("+");
    const hit = priced.find((o) => o.flightNumbers.map(normFlightNo).join("+") === want);
    preferredFound = !!hit;
    if (hit) {
      chosen = hit;
      match = "preferred";
    }
  }
  return {
    type: "flight",
    price: chosen.price,
    currency,
    match,
    preferredFound,
    timeWindowMatched,
    option: chosen,
    alternatives: sorted.filter((o) => o !== chosen).slice(0, 4),
    optionsCount: priced.length,
    lowestPrice: sorted[0].price,
  };
}

const normName = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(the|hotel|resort|and|by|a)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function hotelNameMatches(candidate: string, wanted: string): boolean {
  const a = normName(candidate);
  const b = normName(wanted);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const wa = new Set(a.split(" "));
  const wb = b.split(" ");
  return wb.filter((w) => wa.has(w)).length / wb.length >= 0.75;
}

export const MIN_RATING = 4;

const TIER_RULES = {
  budget: { label: "budget option rated 3.5+", test: (o: HotelOption) => (o.rating ?? 0) >= 3.5 },
  mid: { label: "option rated 4.0+", test: (o: HotelOption) => (o.rating ?? 0) >= MIN_RATING },
  luxury: { label: "5★ property", test: (o: HotelOption) => (o.stars ?? 0) >= 5 },
} as const;

/**
 * Named stays must match that property — a different hotel is never silently substituted.
 * Unnamed stays use the traveller's budget: a stated nightly ceiling filters hard; a tier picks the
 * cheapest option that fits it (default: rated 4.0+).
 */
export function selectHotel(
  options: HotelOption[],
  hotelName: string | null,
  nights: number,
  currency: string,
  budget?: HotelBudget | null,
): { result: HotelResult | null; note?: string } {
  const priced = options.filter((o) => Number.isFinite(o.total) && o.total > 0);
  const sorted = [...priced].sort((a, b) => a.total - b.total);
  const build = (hit: HotelOption, match: HotelResult["match"], rule: string): HotelResult => ({
    type: "hotel",
    total: hit.total,
    perNight: hit.perNight,
    nights,
    currency,
    match,
    rule,
    hotel: hit,
    alternatives: sorted.filter((o) => o !== hit).slice(0, 4),
    optionsCount: sorted.length,
  });

  if (hotelName) {
    const hit = sorted.find((o) => hotelNameMatches(o.name, hotelName));
    if (!hit) return { result: null, note: `${hotelName} not found with prices for these dates` };
    return { result: build(hit, "named", "Matched the hotel named in your plan") };
  }
  if (!sorted.length) return { result: null, note: "No priced hotels for these dates" };

  let pool = sorted;
  const max = budget?.maxPerNight ?? null;
  if (max) {
    pool = sorted.filter((o) => o.perNight <= max);
    if (!pool.length) return { result: null, note: `No hotels at or under ₹${Math.round(max).toLocaleString("en-IN")}/night for these dates` };
  }
  const tier = TIER_RULES[budget?.tier ?? "mid"];
  const fit = pool.filter(tier.test);
  const chosen = fit[0] ?? pool[0];
  const cap = max ? ` under ₹${Math.round(max).toLocaleString("en-IN")}/night` : "";
  const rule = fit.length
    ? `Cheapest ${tier.label}${cap} of ${pool.length}`
    : `No ${tier.label}${cap} — cheapest available of ${pool.length}`;
  return { result: build(chosen, "cheapest_rated", rule) };
}
