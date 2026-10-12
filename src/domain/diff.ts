import type { Conflict } from "./constraints";
import { diffDays, rangeLabel, shortDate, signedDays } from "./dates";
import { nodeTitle } from "./graph";
import type { RefreshPlan } from "./affected";
import type { NodeKind, Observation, Operation, TripNode } from "./types";

export type PriceStatus = "ok" | "no_results" | "error" | "not_searched" | "estimate" | "no_source";

export interface PricePoint {
  amount: number | null;
  status: PriceStatus;
  evidenceId: string | null;
  observedAt: string | null;
  label: string;
}

export interface NodeDiff {
  nodeId: string;
  kind: NodeKind;
  title: string;
  before: { start: string; end: string };
  after: { start: string; end: string };
  startDelta: number;
  endDelta: number;
  structural: "unchanged" | "moved" | "resized" | "held";
  search: "refetch" | "reuse" | "none";
  price: {
    before: PricePoint;
    after: PricePoint;
    delta: number | null;
    state: "observed" | "unchanged" | "unknown" | "estimate" | "no_source";
  };
  reasons: string[];
  conflictIds: string[];
}

/** One changed field — mirrors the spec's diff record. */
export interface FieldDiff {
  node_id: string;
  node_title: string;
  field: string;
  before: string | number | null;
  after: string | number | null;
  delta: number | null;
  reason: string;
  evidence_ids: string[];
  category: "structural" | "price" | "unknown";
}

export interface CategorySummary {
  before: number | null;
  after: number | null;
  delta: number | null;
  state: "unchanged" | "observed" | "partial" | "unknown" | "no_source";
  changed: number;
  unknown: number;
  count: number;
}

export interface AggregateDiff {
  headline: string;
  flights: CategorySummary;
  hotels: CategorySummary;
  transfers: CategorySummary;
  activities: { count: number; moved: number; constraintsAffected: number; unknownHours: number };
  total: { before: number | null; after: number | null; delta: number | null; complete: boolean; excluded: string[] };
  conflicts: { new: number; preexisting: number; errors: number; warnings: number };
  searches: { refetched: number; reused: number; failed: number; noSource: number };
  unknowns: string[];
}

export interface TripDiff {
  nodes: NodeDiff[];
  fields: FieldDiff[];
  aggregate: AggregateDiff;
}

export interface DiffInput {
  ops: Operation[];
  baseNodes: TripNode[];
  scenarioNodes: TripNode[];
  baseObs: Record<string, Observation | undefined>;
  scenarioObs: Record<string, Observation | undefined>;
  plan: RefreshPlan;
  conflicts: Conflict[];
  reasons: Record<string, string[]>;
  heldNodeIds: Set<string>;
  headline: string;
}

function observedAmount(o: Observation | undefined): number | null {
  if (!o || o.status !== "ok" || !o.result) return null;
  if (o.result.type === "flight") return o.result.price;
  if (o.result.type === "hotel") return o.result.total;
  return null;
}

function pricePoint(n: TripNode, o: Observation | undefined): PricePoint {
  if (n.kind === "transfer" || n.kind === "activity") {
    const est = n.estimatedCost ?? null;
    return est == null
      ? { amount: null, status: "no_source", evidenceId: null, observedAt: null, label: "No live source" }
      : { amount: est, status: "estimate", evidenceId: null, observedAt: null, label: "Your estimate" };
  }
  if (!o) return { amount: null, status: "not_searched", evidenceId: null, observedAt: null, label: "Not yet searched" };
  const amount = observedAmount(o);
  const label =
    o.status === "ok" ? "Observed" : o.status === "no_results" ? (o.note ?? "No results") : "Search failed";
  return { amount, status: o.status, evidenceId: o.id, observedAt: o.observedAt, label };
}

function priceField(kind: NodeKind) {
  return kind === "flight" ? "observed_fare" : kind === "stay" ? "estimated_total" : "estimated_cost";
}

export function computeDiff(input: DiffInput): TripDiff {
  const baseById = new Map(input.baseNodes.map((n) => [n.id, n]));
  const refetch = new Set(input.plan.refetch);
  const reuse = new Set(input.plan.reuse);
  const nodes: NodeDiff[] = [];
  const fields: FieldDiff[] = [];

  for (const s of input.scenarioNodes) {
    const b = baseById.get(s.id);
    if (!b) continue;
    const startDelta = diffDays(b.start, s.start);
    const endDelta = diffDays(b.end, s.end);
    const held = input.heldNodeIds.has(s.id) && startDelta === 0 && endDelta === 0;
    const structural: NodeDiff["structural"] = held
      ? "held"
      : startDelta === 0 && endDelta === 0
        ? "unchanged"
        : startDelta === endDelta
          ? "moved"
          : "resized";

    const before = pricePoint(b, input.baseObs[s.id]);
    const after = pricePoint(s, input.scenarioObs[s.id]);
    let delta: number | null = null;
    let state: NodeDiff["price"]["state"];
    if (before.status === "no_source" || after.status === "no_source") state = "no_source";
    else if (before.status === "estimate") {
      state = "estimate";
      delta = (after.amount ?? 0) - (before.amount ?? 0);
    } else if (before.amount != null && after.amount != null) {
      delta = after.amount - before.amount;
      state = before.evidenceId === after.evidenceId ? "unchanged" : "observed";
    } else state = "unknown";

    const reasons = input.reasons[s.id] ?? [];
    const conflictIds = input.conflicts.filter((c) => c.nodeIds.includes(s.id)).map((c) => c.id);
    const search = refetch.has(s.id) ? "refetch" : reuse.has(s.id) ? "reuse" : "none";
    nodes.push({
      nodeId: s.id,
      kind: s.kind,
      title: nodeTitle(s),
      before: { start: b.start, end: b.end },
      after: { start: s.start, end: s.end },
      startDelta,
      endDelta,
      structural,
      search,
      price: { before, after, delta, state },
      reasons,
      conflictIds,
    });

    // Field-level records
    const title = nodeTitle(s);
    const why = reasons.join("; ") || "unchanged";
    const [startName, endName] =
      s.kind === "stay" ? ["check_in", "check_out"] : s.kind === "flight" ? ["departure_date", "arrival_date"] : ["date", "end_date"];
    if (startDelta !== 0)
      fields.push({ node_id: s.id, node_title: title, field: startName, before: b.start, after: s.start, delta: startDelta, reason: why, evidence_ids: [], category: "structural" });
    if (endDelta !== 0 && (s.kind === "stay" || startDelta !== endDelta))
      fields.push({ node_id: s.id, node_title: title, field: endName, before: b.end, after: s.end, delta: endDelta, reason: why, evidence_ids: [], category: "structural" });
    if (s.kind === "stay") {
      const nb = diffDays(b.start, b.end);
      const na = diffDays(s.start, s.end);
      if (nb !== na)
        fields.push({ node_id: s.id, node_title: title, field: "nights", before: nb, after: na, delta: na - nb, reason: why, evidence_ids: [], category: "structural" });
    }
    if (s.kind === "flight" || s.kind === "stay") {
      const ev = [before.evidenceId, after.evidenceId].filter((x): x is string => !!x);
      if (state === "observed" && delta !== 0) {
        const r = s.kind === "stay" ? `stay ${startDelta || endDelta ? "now" : ""} ${rangeLabel(s.start, s.end)}`.replace(/\s+/g, " ") : `departs ${shortDate(s.start)}`;
        fields.push({ node_id: s.id, node_title: title, field: priceField(s.kind), before: before.amount, after: after.amount, delta, reason: r, evidence_ids: [...new Set(ev)], category: "price" });
      } else if (state === "unknown" && (search === "refetch" || after.status !== "ok")) {
        fields.push({
          node_id: s.id,
          node_title: title,
          field: priceField(s.kind),
          before: before.amount,
          after: null,
          delta: null,
          reason: after.status === "not_searched" ? "Not yet searched for the new dates" : after.label,
          evidence_ids: [...new Set(ev)],
          category: "unknown",
        });
      }
    }
  }

  return { nodes, fields, aggregate: aggregate(input, nodes) };
}

function summarize(list: NodeDiff[], priced: boolean): CategorySummary {
  if (!list.length) return { before: null, after: null, delta: null, state: "unchanged", changed: 0, unknown: 0, count: 0 };
  let before = 0, after = 0, delta = 0, known = 0, unknown = 0, changed = 0;
  for (const n of list) {
    if (n.structural === "moved" || n.structural === "resized") changed++;
    const p = n.price;
    if (p.state === "no_source") {
      unknown++;
      continue;
    }
    if (p.before.amount != null) before += p.before.amount;
    if (p.after.amount != null) after += p.after.amount;
    if (p.delta != null) {
      delta += p.delta;
      known++;
    } else unknown++;
  }
  let state: CategorySummary["state"];
  // Unpriced categories only carry user estimates, which never change with dates
  if (!priced) state = "no_source";
  else if (known === 0) state = "unknown";
  else if (unknown > 0) state = "partial";
  else if (delta === 0 && changed === 0) state = "unchanged";
  else state = "observed";
  return {
    before: known || !unknown ? before : null,
    after: known || !unknown ? after : null,
    delta: known ? delta : null,
    state,
    changed,
    unknown,
    count: list.length,
  };
}

function aggregate(input: DiffInput, nodes: NodeDiff[]): AggregateDiff {
  const flights = nodes.filter((n) => n.kind === "flight");
  const stays = nodes.filter((n) => n.kind === "stay");
  const transfers = nodes.filter((n) => n.kind === "transfer");
  const activities = nodes.filter((n) => n.kind === "activity");

  const priced = [...flights, ...stays];
  const excluded = priced.filter((n) => n.price.delta == null).map((n) => n.title);
  const known = priced.filter((n) => n.price.delta != null);
  const sum = (xs: (number | null)[]) => xs.reduce<number>((a, x) => a + (x ?? 0), 0);

  const unknowns: string[] = [];
  for (const n of priced) {
    if (n.price.delta != null) continue;
    const p = n.price.after.status !== "ok" ? n.price.after : n.price.before;
    unknowns.push(`${n.title}: price ${p.status === "error" ? "unavailable — search failed" : p.status === "no_results" ? `unavailable — ${p.label.toLowerCase()}` : "not yet observed"}`);
  }
  for (const n of transfers) if (n.price.state === "no_source") unknowns.push(`${n.title}: no live data source for transfers`);
  const placeObs = input.scenarioObs;
  let unknownHours = 0;
  for (const n of activities) {
    const o = placeObs[n.nodeId];
    const hasHours = o?.status === "ok" && o.result?.type === "place" && o.result.closedWeekdays != null;
    if (!hasHours) {
      unknownHours++;
      unknowns.push(`${n.title}: opening hours — insufficient evidence`);
    }
  }

  const failed = nodes.filter((n) => n.search === "refetch" && n.price.after.status === "error").length;
  const actConflicts = input.conflicts.filter(
    (c) => !c.preexisting && c.nodeIds.some((id) => activities.some((a) => a.nodeId === id)),
  );

  return {
    headline: input.headline,
    flights: summarize(flights, true),
    hotels: summarize(stays, true),
    transfers: summarize(transfers, false),
    activities: {
      count: activities.length,
      moved: activities.filter((a) => a.structural === "moved" || a.structural === "resized").length,
      constraintsAffected: actConflicts.length,
      unknownHours,
    },
    total: {
      before: known.length ? sum(known.map((n) => n.price.before.amount)) : null,
      after: known.length ? sum(known.map((n) => n.price.after.amount)) : null,
      delta: known.length ? sum(known.map((n) => n.price.delta)) : null,
      complete: excluded.length === 0,
      excluded,
    },
    conflicts: {
      new: input.conflicts.filter((c) => !c.preexisting).length,
      preexisting: input.conflicts.filter((c) => c.preexisting).length,
      errors: input.conflicts.filter((c) => !c.preexisting && c.severity === "error").length,
      warnings: input.conflicts.filter((c) => !c.preexisting && c.severity === "warning").length,
    },
    searches: {
      refetched: input.plan.refetch.length,
      reused: input.plan.reuse.length,
      failed,
      noSource: input.plan.none.length,
    },
    unknowns,
  };
}

export function headlineFor(ops: Operation[], nodes: TripNode[]): string {
  if (ops.length === 1) {
    const op = ops[0];
    if (op.op === "shift_trip") return signedDays(op.days).toUpperCase();
    if (op.op === "resize_stay") {
      const n = nodes.find((x) => x.id === op.nodeId);
      return `${signedDays(op.nights, "night").toUpperCase()} ${n?.kind === "stay" ? n.city.toUpperCase() : ""}`.trim();
    }
    if (op.op === "move_flight") {
      const n = nodes.find((x) => x.id === op.nodeId);
      if (n) return `${nodeTitle(n)} ${signedDays(diffDays(n.start, op.date)).toUpperCase()}`;
    }
  }
  return `${ops.length} CHANGES`;
}
