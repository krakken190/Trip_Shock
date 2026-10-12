import { diffDays } from "./dates";
import type { Anchor, Edge, EdgeKind, TripNode } from "./types";

const KIND_RANK: Record<TripNode["kind"], number> = { flight: 0, transfer: 1, stay: 2, activity: 3 };

export function nodeTitle(n: TripNode): string {
  switch (n.kind) {
    case "flight":
      return `${n.from} → ${n.to}`;
    case "stay":
      return n.hotelName?.trim() || `Stay in ${n.city}`;
    case "activity":
      return n.name;
    case "transfer":
      return `${n.from} → ${n.to}`;
  }
}

export function nodeLocation(n: TripNode): string {
  switch (n.kind) {
    case "flight":
      return `${n.from} → ${n.to}`;
    case "stay":
    case "activity":
      return n.city;
    case "transfer":
      return n.to;
  }
}

export function isSpine(n: TripNode): boolean {
  return n.kind === "flight" || n.kind === "stay";
}

/** Chronological order, stable for same-day items (flight, transfer, stay, activity). */
export function sortNodes<T extends TripNode>(nodes: T[]): T[] {
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  return [...nodes].sort(
    (a, b) =>
      a.start.localeCompare(b.start) ||
      KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
      index.get(a.id)! - index.get(b.id)!,
  );
}

export function anchorDate(n: TripNode, a: Anchor): string {
  return a === "start" ? n.start : n.end;
}

function edge(kind: EdgeKind, from: TripNode, fa: Anchor, to: TripNode, ta: Anchor, mode: Edge["mode"]): Edge {
  return {
    id: `${from.id}.${fa}->${to.id}.${ta}`,
    kind,
    from: { node: from.id, anchor: fa },
    to: { node: to.id, anchor: ta },
    lag: diffDays(anchorDate(from, fa), anchorDate(to, ta)),
    mode,
  };
}

/**
 * Derives dependency edges from a baseline's chronology. Deterministic: the same nodes always
 * produce the same edges, and the baseline's own gaps are preserved as edge lags.
 *
 *  - Spine (flights + stays): consecutive items are coupled end → start.
 *  - Activities follow the stay whose window contains them (relative to check-in).
 *  - Transfers follow the latest flight that has landed by then.
 */
export function buildEdges(nodes: TripNode[]): Edge[] {
  const sorted = sortNodes(nodes);
  const spine = sorted.filter(isSpine);
  const edges: Edge[] = [];

  for (let i = 1; i < spine.length; i++) {
    const prev = spine[i - 1];
    const next = spine[i];
    const kind: EdgeKind =
      prev.kind === "flight" && next.kind === "stay"
        ? "arrival_checkin"
        : prev.kind === "stay" && next.kind === "flight"
          ? "checkout_departure"
          : "sequence";
    edges.push(edge(kind, prev, "end", next, "start", "couple"));
  }

  const stays = spine.filter((n) => n.kind === "stay");
  const flights = spine.filter((n) => n.kind === "flight");

  for (const n of sorted) {
    if (n.kind === "activity") {
      const host =
        stays.find((s) => s.start <= n.start && n.start < s.end) ??
        stays.find((s) => s.start <= n.start && n.start <= s.end) ??
        latestBefore(spine, n.start);
      if (host) edges.push(edge("activity_in_stay", host, "start", n, "start", "follow"));
    } else if (n.kind === "transfer") {
      // "Home → Airport" runs ahead of the next departure; anything else follows the last arrival.
      if (/airport/i.test(n.to)) {
        const next = flights.find((f) => f.start >= n.start);
        if (next) {
          edges.push(edge("transfer_before_departure", next, "start", n, "start", "follow"));
          continue;
        }
      }
      const host = latestBefore(flights, n.start, "end") ?? latestBefore(spine, n.start);
      if (host) {
        edges.push(
          edge(host.kind === "flight" ? "transfer_after_arrival" : "sequence", host, "end", n, "start", "follow"),
        );
      }
    }
  }
  return edges;
}

function latestBefore(list: TripNode[], date: string, anchor: Anchor = "start"): TripNode | undefined {
  let best: TripNode | undefined;
  for (const n of list) if (anchorDate(n, anchor) <= date) best = n;
  return best;
}

export interface ValidationIssue {
  nodeId: string;
  message: string;
}

export function validateNodes(nodes: TripNode[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  for (const n of nodes) {
    if (seen.has(n.id)) issues.push({ nodeId: n.id, message: "Duplicate id" });
    seen.add(n.id);
    const len = diffDays(n.start, n.end);
    if (n.kind === "stay" && len < 1) issues.push({ nodeId: n.id, message: "Check-out must be after check-in" });
    if (n.kind === "flight" && (len < 0 || len > 2))
      issues.push({ nodeId: n.id, message: "Arrival must be 0–2 days after departure" });
    if ((n.kind === "activity" || n.kind === "transfer") && len < 0)
      issues.push({ nodeId: n.id, message: "End must not be before start" });
    if (n.kind === "flight" && n.from === n.to)
      issues.push({ nodeId: n.id, message: "Origin and destination are the same" });
  }
  return issues;
}

export function tripSummary(nodes: TripNode[]) {
  const sorted = sortNodes(nodes);
  const flights = sorted.filter((n) => n.kind === "flight");
  const route: string[] = [];
  for (const f of flights) {
    if (route[route.length - 1] !== f.from) route.push(f.from);
    route.push(f.to);
  }
  const start = sorted.length ? sorted.reduce((m, n) => (n.start < m ? n.start : m), sorted[0].start) : null;
  const end = sorted.length ? sorted.reduce((m, n) => (n.end > m ? n.end : m), sorted[0].end) : null;
  return { route, start, end, days: start && end ? diffDays(start, end) : 0 };
}
