import { diffDays, shortDate, WEEKDAY_NAMES, weekday } from "./dates";
import { nodeTitle } from "./graph";
import type { Edge, PlaceResult, TripNode } from "./types";

export type ConflictKind =
  | "gap"
  | "overlap"
  | "invalid_duration"
  | "activity_outside_stay"
  | "activity_closed"
  | "transfer_mismatch";

export interface Conflict {
  id: string;
  kind: ConflictKind;
  severity: "error" | "warning";
  nodeIds: string[];
  message: string;
  suggestion?: string;
  evidenceIds?: string[];
  /** true when the same conflict already exists in the baseline */
  preexisting?: boolean;
}

export interface PlaceEvidence {
  evidenceId: string;
  result: PlaceResult | null;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/**
 * Checks a node set against the baseline's dependency edges and any activity evidence.
 * Edge lags come from the baseline, so a freshly built baseline has no edge conflicts.
 */
export function detectConflicts(
  nodes: TripNode[],
  edges: Edge[],
  places: Record<string, PlaceEvidence | undefined> = {},
): Conflict[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: Conflict[] = [];

  for (const n of nodes) {
    if (n.kind === "stay" && diffDays(n.start, n.end) < 1) {
      out.push({
        id: `invalid_duration:${n.id}`,
        kind: "invalid_duration",
        severity: "error",
        nodeIds: [n.id],
        message: `${nodeTitle(n)} now has ${diffDays(n.start, n.end) === 0 ? "no nights" : "a negative stay"} (${shortDate(n.start)} → ${shortDate(n.end)}).`,
        suggestion: "Use the “push later items” policy, or remove this stay.",
      });
    }
  }

  for (const e of edges) {
    const a = byId.get(e.from.node);
    const b = byId.get(e.to.node);
    if (!a || !b) continue;
    const aDate = e.from.anchor === "start" ? a.start : a.end;
    const bDate = e.to.anchor === "start" ? b.start : b.end;
    const d = diffDays(aDate, bDate) - e.lag;

    if (e.kind === "activity_in_stay") {
      if (b.kind !== "activity" || a.kind !== "stay") continue;
      if (b.start < a.start || b.start > a.end) {
        out.push({
          id: `activity_outside_stay:${b.id}`,
          kind: "activity_outside_stay",
          severity: "warning",
          nodeIds: [b.id, a.id],
          message: `${nodeTitle(b)} on ${shortDate(b.start)} falls outside ${nodeTitle(a)} (${shortDate(a.start)}–${shortDate(a.end)}).`,
          suggestion: b.fixed ? "Unfix the activity so it follows its stay." : "Reschedule the activity inside the stay.",
        });
      }
      continue;
    }
    if (d === 0) continue;

    const fixedNote = [a, b].filter((n) => n.fixed).map((n) => `${nodeTitle(n)} is fixed. `).join("");
    const suggestion = fixedNote
      ? `${fixedNote}Unfix it to let it move, or adjust the neighbouring item.`
      : undefined;

    if (e.kind === "transfer_after_arrival" || e.kind === "transfer_before_departure" || (e.mode === "follow" && b.kind === "transfer")) {
      out.push({
        id: `transfer_mismatch:${b.id}`,
        kind: "transfer_mismatch",
        severity: "warning",
        nodeIds: [b.id, a.id],
        message:
          e.kind === "transfer_before_departure"
            ? `${nodeTitle(b)} is on ${shortDate(b.start)} but ${nodeTitle(a)} departs ${shortDate(a.start)}.`
            : `${nodeTitle(b)} is on ${shortDate(b.start)} but ${nodeTitle(a)} lands ${shortDate(a.end)}.`,
        suggestion,
      });
      continue;
    }

    const nights = Math.abs(d);
    let message: string;
    let severity: Conflict["severity"];
    if (e.kind === "arrival_checkin") {
      severity = d > 0 ? "error" : "warning";
      message =
        d > 0
          ? `Land ${shortDate(a.end)} but check-in at ${nodeTitle(b)} is ${shortDate(b.start)} — ${plural(nights, "night")} without a hotel.`
          : `Check-in ${shortDate(b.start)} is before you land (${shortDate(a.end)}) — ${plural(nights, "paid night")} unused.`;
    } else if (e.kind === "checkout_departure") {
      severity = d > 0 ? "error" : "warning";
      message =
        d > 0
          ? `Check out of ${nodeTitle(a)} ${shortDate(a.end)} but ${nodeTitle(b)} departs ${shortDate(b.start)} — ${plural(nights, "night")} without a hotel.`
          : `${nodeTitle(b)} departs ${shortDate(b.start)}, before check-out ${shortDate(a.end)} — ${plural(nights, "paid night")} unused.`;
    } else {
      severity = "error";
      message =
        d > 0
          ? `${plural(nights, "day")} gap between ${nodeTitle(a)} and ${nodeTitle(b)}.`
          : `${nodeTitle(a)} and ${nodeTitle(b)} overlap by ${plural(nights, "day")}.`;
    }
    out.push({
      id: `${d > 0 ? "gap" : "overlap"}:${e.id}`,
      kind: d > 0 ? "gap" : "overlap",
      severity,
      nodeIds: [a.id, b.id],
      message,
      suggestion,
    });
  }

  for (const n of nodes) {
    if (n.kind !== "activity") continue;
    const ev = places[n.id];
    const closed = ev?.result?.closedWeekdays;
    if (!ev || !closed) continue;
    const wd = weekday(n.start);
    if (closed.includes(wd)) {
      out.push({
        id: `activity_closed:${n.id}`,
        kind: "activity_closed",
        severity: "warning",
        nodeIds: [n.id],
        message: `${nodeTitle(n)} is listed as closed on ${WEEKDAY_NAMES[wd]}s — scheduled ${shortDate(n.start)}.`,
        suggestion: "Move the activity to another day of the stay.",
        evidenceIds: [ev.evidenceId],
      });
    }
  }
  return out;
}

/** Marks conflicts that also exist in the baseline so the UI can separate new from old. */
export function markPreexisting(scenario: Conflict[], baseline: Conflict[]): Conflict[] {
  const ids = new Set(baseline.map((c) => c.id));
  return scenario.map((c) => ({ ...c, preexisting: ids.has(c.id) }));
}
