import { airportCity } from "@/domain/airports";
import type { Conflict } from "@/domain/constraints";
import { addDays, diffDays, WEEKDAY_NAMES, weekday } from "@/domain/dates";
import { sortNodes, tripSummary } from "@/domain/graph";
import { describeTimeWindow } from "@/domain/select";
import type { NodeKind, Observation, Travelers, TripNode } from "@/domain/types";
import { duration, hhmm, inr, plural } from "@/lib/format";
import type { ProviderMode } from "./provider";
import { baselineView, HttpError, scenarioView } from "./service";

/** Prices older than this are flagged in the readiness check (matches the UI's "stale"). */
const STALE_MS = 6 * 3_600_000;

export type PriceSource = "observed" | "estimate" | "unavailable" | "none";

export interface ItineraryItem {
  id: string;
  kind: NodeKind;
  title: string;
  subtitle: string;
  start: string;
  end: string;
  fixed: boolean;
  /** Human-readable facts from the evidence, e.g. "6E 1013 · 09:30 → 17:45 · 5h 15m · nonstop" */
  details: string[];
  /** Flight depart/arrive clock times when observed */
  times?: { depart: string; arrive: string };
  amount: number | null;
  source: PriceSource;
  /** Why there's no price, or how the price was chosen */
  priceNote: string;
  observedAt: string | null;
  evidenceId: string | null;
  engine: string | null;
  warnings: string[];
}

export type DayEventRole = "check_out" | "depart" | "transfer" | "check_in" | "activity";

export interface ItineraryDay {
  date: string;
  index: number;
  events: { role: DayEventRole; item: ItineraryItem; note?: string }[];
  /** Where the travellers sleep that night, if anywhere on the plan */
  overnight: string | null;
}

export interface CostLine {
  key: "flights" | "hotels" | "activities" | "transfers";
  label: string;
  amount: number;
  count: number;
  source: "observed" | "estimate";
}

export interface Itinerary {
  trip: { id: string; name: string; travelers: Travelers };
  version: { kind: "baseline" | "scenario"; scenarioId: string | null; name: string; changes: string[]; deltaVsBaseline: number | null };
  provider: ProviderMode;
  generatedAt: string;
  start: string | null;
  end: string | null;
  nights: number;
  /** Airports in travel order with the day the travellers land there and the day they leave */
  route: { code: string; city: string; arrive: string | null; depart: string | null }[];
  items: ItineraryItem[];
  days: ItineraryDay[];
  costs: { lines: CostLine[]; observed: number; estimates: number; total: number; excluded: string[] };
  conflicts: Conflict[];
  readiness: { unpriced: number; conflicts: number; stale: number; ready: boolean };
  observedRange: { oldest: string; newest: string } | null;
}

export function travellerLabel(t: Travelers) {
  return `${plural(t.adults, "adult")}${t.children ? `, ${plural(t.children, "child", "children")}` : ""}`;
}

function buildItem(n: TripNode, obs: Observation | undefined): ItineraryItem {
  const base = {
    id: n.id,
    kind: n.kind,
    start: n.start,
    end: n.end,
    fixed: n.fixed,
    details: [] as string[],
    warnings: [] as string[],
    observedAt: obs?.observedAt ?? null,
    evidenceId: obs?.id ?? null,
    engine: obs?.engine ?? null,
  };
  const failed = obs && obs.status !== "ok" ? (obs.status === "error" ? "Search failed" : (obs.note ?? "No results for these dates")) : null;
  const r = obs?.status === "ok" ? obs.result : null;

  switch (n.kind) {
    case "flight": {
      const tw = describeTimeWindow(n.timePreference);
      const cabin = n.cabin.replace("_", " ");
      const item: ItineraryItem = {
        ...base,
        title: `${airportCity(n.from)} → ${airportCity(n.to)}`,
        subtitle: `${n.from} → ${n.to} · ${cabin[0].toUpperCase()}${cabin.slice(1)}${tw ? ` · ${tw}` : ""}`,
        amount: null,
        source: "none",
        priceNote: "Not searched yet",
      };
      if (r?.type === "flight") {
        const o = r.option;
        item.amount = r.price;
        item.source = "observed";
        item.priceNote = r.match === "preferred" ? "Pinned flight" : "Cheapest matching option";
        item.times = { depart: hhmm(o.departTime), arrive: hhmm(o.arriveTime) };
        item.details.push(`${o.airline} ${o.flightNumbers.join(" + ")}`, `${duration(o.durationMin)} · ${o.stops === 0 ? "nonstop" : plural(o.stops, "stop")}`);
        if (r.preferredFound === false) item.warnings.push("Pinned flight not found; cheapest option shown");
        if (r.timeWindowMatched === false) item.warnings.push("Nothing fit the requested time window");
        if (o.arriveTime.slice(0, 10) > n.end) item.warnings.push(`Lands ${o.arriveTime.slice(0, 10)}, after the planned arrival date`);
      } else if (failed) {
        item.source = "unavailable";
        item.priceNote = failed;
      }
      return item;
    }
    case "stay": {
      const nights = diffDays(n.start, n.end);
      const named = n.hotelName?.trim();
      const item: ItineraryItem = {
        ...base,
        title: named || `Stay in ${n.city}`,
        subtitle: `${n.city} · ${plural(nights, "night")}`,
        amount: null,
        source: "none",
        priceNote: "Not searched yet",
      };
      if (r?.type === "hotel") {
        item.amount = r.total;
        item.source = "observed";
        if (!named) item.title = r.hotel.name;
        item.priceNote = r.match === "named" ? "Named hotel" : (r.rule ?? "Cheapest well-rated option");
        item.details.push(`${inr(r.perNight)} / night`);
        if (r.hotel.rating != null) item.details.push(`Rated ${r.hotel.rating}${r.hotel.stars ? ` · ${r.hotel.stars}-star` : ""}`);
      } else if (failed) {
        item.source = "unavailable";
        item.priceNote = failed;
      }
      return item;
    }
    case "activity": {
      const item: ItineraryItem = {
        ...base,
        title: n.name,
        subtitle: n.city,
        amount: n.estimatedCost ?? null,
        source: n.estimatedCost != null ? "estimate" : "none",
        priceNote: n.estimatedCost != null ? "Your estimate" : "No estimate",
      };
      if (r?.type === "place") {
        if (r.address) item.details.push(r.address);
        const day = WEEKDAY_NAMES[weekday(n.start)];
        const hours = r.hours?.[day.toLowerCase()];
        if (r.closedWeekdays?.includes(weekday(n.start))) item.warnings.push(`Closed on ${day}s`);
        else if (hours) item.details.push(`${day}: ${hours}`);
        if (r.rating != null) item.details.push(`Rated ${r.rating}`);
      }
      return item;
    }
    case "transfer": {
      const mode = n.mode[0].toUpperCase() + n.mode.slice(1);
      return {
        ...base,
        title: `${n.from} → ${n.to}`,
        subtitle: mode,
        amount: n.estimatedCost ?? null,
        source: n.estimatedCost != null ? "estimate" : "none",
        priceNote: n.estimatedCost != null ? "Your estimate" : "No estimate",
      };
    }
  }
}

function buildDays(items: ItineraryItem[], start: string | null, end: string | null): ItineraryDay[] {
  if (!start || !end) return [];
  const days: ItineraryDay[] = [];
  const count = diffDays(start, end) + 1;
  for (let i = 0; i < count; i++) {
    const date = addDays(start, i);
    const events: ItineraryDay["events"] = [];
    for (const it of items) {
      if (it.kind === "stay") {
        if (it.end === date) events.push({ role: "check_out", item: it });
        if (it.start === date) events.push({ role: "check_in", item: it, note: `until ${it.end}` });
      } else if (it.start === date) {
        events.push({ role: it.kind === "flight" ? "depart" : it.kind === "transfer" ? "transfer" : "activity", item: it });
      }
    }
    // Check-outs happen first; everything else keeps chronological plan order.
    events.sort((a, b) => Number(b.role === "check_out") - Number(a.role === "check_out"));
    const night = items.find((it) => it.kind === "stay" && it.start <= date && date < it.end);
    days.push({ date, index: i + 1, events, overnight: night ? night.title : null });
  }
  return days;
}

const COST_LABELS: Record<CostLine["key"], string> = { flights: "Flights", hotels: "Hotels", activities: "Activities", transfers: "Transfers" };
const KIND_TO_COST: Record<NodeKind, CostLine["key"]> = { flight: "flights", stay: "hotels", activity: "activities", transfer: "transfers" };

/**
 * The finalized plan as a self-contained document model: the chosen version's nodes (baseline or a
 * saved what-if), the evidence behind each price, a day-by-day schedule and a cost breakdown.
 */
export function itineraryFor(tripId: string, scenarioId?: string | null): Itinerary {
  let nodes: TripNode[];
  let observations: Record<string, Observation>;
  let conflicts: Conflict[];
  let version: Itinerary["version"];
  const base = baselineView(tripId);

  if (scenarioId) {
    const sv = scenarioView(scenarioId);
    if (sv.trip.id !== tripId) throw new HttpError(404, "Scenario not found for this trip");
    nodes = sv.nodes;
    observations = sv.scenarioObservations;
    conflicts = sv.conflicts;
    version = { kind: "scenario", scenarioId, name: sv.scenario.name, changes: sv.opLabels, deltaVsBaseline: sv.diff.aggregate.total.complete ? sv.diff.aggregate.total.delta : null };
  } else {
    nodes = base.trip.nodes;
    observations = base.observations;
    conflicts = base.conflicts;
    version = { kind: "baseline", scenarioId: null, name: "Baseline plan", changes: [], deltaVsBaseline: null };
  }

  const sorted = sortNodes(nodes);
  const items = sorted.map((n) => buildItem(n, observations[n.id]));
  const summary = tripSummary(nodes);

  const flights = sorted.filter((n) => n.kind === "flight");
  const route: Itinerary["route"] = [];
  for (const f of flights) {
    const last = route[route.length - 1];
    if (last?.code === f.from) last.depart = f.start;
    else route.push({ code: f.from, city: airportCity(f.from), arrive: null, depart: f.start });
    route.push({ code: f.to, city: airportCity(f.to), arrive: f.end, depart: null });
  }

  const lines = new Map<CostLine["key"], CostLine>();
  const excluded: string[] = [];
  let observed = 0;
  let estimates = 0;
  for (const it of items) {
    if (it.amount == null) {
      if (it.kind === "flight" || it.kind === "stay") excluded.push(it.title);
      continue;
    }
    const key = KIND_TO_COST[it.kind];
    const line = lines.get(key) ?? { key, label: COST_LABELS[key], amount: 0, count: 0, source: it.source === "observed" ? "observed" : "estimate" };
    line.amount += it.amount;
    line.count++;
    lines.set(key, line);
    if (it.source === "observed") observed += it.amount;
    else estimates += it.amount;
  }

  const now = Date.now();
  const stamps = items.filter((i) => i.source === "observed" && i.observedAt).map((i) => i.observedAt!);
  stamps.sort();
  const stale = stamps.filter((s) => now - new Date(s).getTime() > STALE_MS).length;
  const unpriced = excluded.length;
  const open = conflicts.filter((c) => c.severity === "error" || !c.preexisting).length;

  return {
    trip: { id: base.trip.id, name: base.trip.name, travelers: base.trip.travelers },
    version,
    provider: base.provider,
    generatedAt: new Date(now).toISOString(),
    start: summary.start,
    end: summary.end,
    nights: summary.days,
    route,
    items,
    days: buildDays(items, summary.start, summary.end),
    costs: {
      lines: (["flights", "hotels", "activities", "transfers"] as const).map((k) => lines.get(k)).filter((l): l is CostLine => !!l && l.amount > 0),
      observed,
      estimates,
      total: observed + estimates,
      excluded,
    },
    conflicts,
    readiness: { unpriced, conflicts: open, stale, ready: unpriced === 0 && open === 0 && stale === 0 },
    observedRange: stamps.length ? { oldest: stamps[0], newest: stamps[stamps.length - 1] } : null,
  };
}
