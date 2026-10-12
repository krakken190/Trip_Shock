import { addDays, diffDays, shortDate, signedDays } from "./dates";
import { nodeTitle } from "./graph";
import type { Anchor, Edge, Operation, Policy, TripNode } from "./types";

export interface TraceStep {
  opIndex: number;
  nodeId: string;
  anchor: Anchor;
  delta: number;
  /** Why this anchor moved */
  via: { type: "operation" } | { type: "rigid" } | { type: "stay_shift" } | { type: "edge"; edgeId: string; fromNode: string };
}

export interface BlockedMove {
  opIndex: number;
  nodeId: string;
  anchor: Anchor | "both";
  delta: number;
  /** Node that tried to push this one (absent for whole-trip shifts) */
  byNode?: string;
  edgeId?: string;
}

export interface PropagationResult {
  nodes: TripNode[];
  /** nodeId → human-readable causes, in order */
  reasons: Record<string, string[]>;
  trace: TraceStep[];
  blocked: BlockedMove[];
  /** Operation-level problems (unknown node, wrong kind …) */
  errors: string[];
}

export function describeOperation(op: Operation, nodes: TripNode[]): string {
  const title = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    return n ? nodeTitle(n) : id;
  };
  switch (op.op) {
    case "shift_trip":
      return op.days === 0 ? "Keep trip dates" : `Shift whole trip ${signedDays(op.days)}`;
    case "resize_stay":
      return `${op.nights >= 0 ? "Extend" : "Shorten"} ${title(op.nodeId)} by ${Math.abs(op.nights)} night${Math.abs(op.nights) === 1 ? "" : "s"}`;
    case "move_flight":
      return `Move ${title(op.nodeId)} to ${shortDate(op.date)}`;
  }
}

const RIGID = new Set<TripNode["kind"]>(["flight", "activity", "transfer"]);

/**
 * Applies scenario operations to a clone of the baseline and propagates date changes through the
 * dependency edges. Pure and deterministic: identical inputs always yield identical outputs, and
 * the baseline array is never mutated.
 *
 * Propagation rules
 *  - Flights, activities and transfers are rigid: moving one anchor moves the other.
 *  - Stays are elastic. Reached at check-out (from a later flight), a stay stretches/shrinks.
 *    Reached at check-in (from an earlier flight), it shifts whole under the "shift" policy and
 *    absorbs the change under the "absorb" policy.
 *  - "couple" edges propagate both ways; "follow" edges only from → to.
 *  - Fixed nodes never move automatically. A push into a fixed node is recorded as blocked and
 *    later surfaces as a conflict on the edge whose lag no longer holds.
 */
export function applyOperations(
  baseNodes: TripNode[],
  edges: Edge[],
  ops: Operation[],
  policy: Policy,
): PropagationResult {
  const nodes = new Map(baseNodes.map((n) => [n.id, structuredClone(n)]));
  const reasons: Record<string, string[]> = {};
  const trace: TraceStep[] = [];
  const blocked: BlockedMove[] = [];
  const errors: string[] = [];

  const outgoing = new Map<string, Edge[]>();
  const incoming = new Map<string, Edge[]>();
  const key = (id: string, a: Anchor) => `${id}.${a}`;
  for (const e of edges) {
    const f = key(e.from.node, e.from.anchor);
    const t = key(e.to.node, e.to.anchor);
    outgoing.set(f, [...(outgoing.get(f) ?? []), e]);
    incoming.set(t, [...(incoming.get(t) ?? []), e]);
  }

  const addReason = (id: string, r: string) => {
    const list = (reasons[id] ??= []);
    if (!list.includes(r)) list.push(r);
  };

  const shiftAnchor = (n: TripNode, a: Anchor, delta: number) => {
    if (a === "start") n.start = addDays(n.start, delta);
    else n.end = addDays(n.end, delta);
  };

  ops.forEach((op, opIndex) => {
    const label = describeOperation(op, [...nodes.values()]);

    if (op.op === "shift_trip") {
      if (op.days === 0) return;
      for (const n of nodes.values()) {
        if (n.fixed) {
          blocked.push({ opIndex, nodeId: n.id, anchor: "both", delta: op.days });
          addReason(n.id, `Held in place (fixed) — ${label.toLowerCase()}`);
          continue;
        }
        shiftAnchor(n, "start", op.days);
        shiftAnchor(n, "end", op.days);
        trace.push({ opIndex, nodeId: n.id, anchor: "start", delta: op.days, via: { type: "operation" } });
        trace.push({ opIndex, nodeId: n.id, anchor: "end", delta: op.days, via: { type: "operation" } });
        addReason(n.id, label);
      }
      return;
    }

    const target = nodes.get(op.nodeId);
    if (!target) {
      errors.push(`Unknown item "${op.nodeId}"`);
      return;
    }

    let seeds: Anchor[];
    let delta: number;
    if (op.op === "resize_stay") {
      if (target.kind !== "stay") {
        errors.push(`${nodeTitle(target)} is not a stay`);
        return;
      }
      seeds = ["end"];
      delta = op.nights;
    } else {
      if (target.kind !== "flight") {
        errors.push(`${nodeTitle(target)} is not a flight`);
        return;
      }
      seeds = ["start", "end"];
      delta = diffDays(target.start, op.date);
    }
    if (delta === 0) return;

    // Breadth-first propagation over anchors. Explicitly targeted nodes move even if fixed:
    // "fixed" protects against automatic changes, not against the user's own instruction.
    const visited = new Set<string>();
    type Item = { id: string; anchor: Anchor; via: TraceStep["via"]; seed: boolean };
    const queue: Item[] = seeds.map((a) => ({ id: target.id, anchor: a, via: { type: "operation" }, seed: true }));

    const enqueue = (item: Item, pusher?: { nodeId: string; edgeId: string }) => {
      if (visited.has(key(item.id, item.anchor))) return;
      const n = nodes.get(item.id)!;
      if (n.fixed && !item.seed) {
        if (!blocked.some((b) => b.opIndex === opIndex && b.nodeId === n.id && b.anchor === item.anchor)) {
          blocked.push({ opIndex, nodeId: n.id, anchor: item.anchor, delta, byNode: pusher?.nodeId, edgeId: pusher?.edgeId });
          addReason(n.id, `Held in place (fixed) — would have moved ${signedDays(delta)}`);
        }
        return;
      }
      queue.push(item);
    };

    while (queue.length) {
      const item = queue.shift()!;
      const k = key(item.id, item.anchor);
      if (visited.has(k)) continue;
      visited.add(k);

      const n = nodes.get(item.id)!;
      shiftAnchor(n, item.anchor, delta);
      trace.push({ opIndex, nodeId: n.id, anchor: item.anchor, delta, via: item.via });

      if (item.seed) addReason(n.id, label);
      else if (item.via.type === "edge") {
        const from = nodes.get(item.via.fromNode)!;
        addReason(n.id, `Follows ${nodeTitle(from)} (${signedDays(delta)})`);
      }

      // Intra-node coupling
      const other: Anchor = item.anchor === "start" ? "end" : "start";
      if (RIGID.has(n.kind)) {
        enqueue({ id: n.id, anchor: other, via: { type: "rigid" }, seed: item.seed });
      } else if (n.kind === "stay" && item.anchor === "start" && !item.seed && policy.downstream === "shift") {
        enqueue({ id: n.id, anchor: "end", via: { type: "stay_shift" }, seed: false });
      }

      // Dependency edges
      for (const e of outgoing.get(k) ?? []) {
        enqueue(
          { id: e.to.node, anchor: e.to.anchor, via: { type: "edge", edgeId: e.id, fromNode: n.id }, seed: false },
          { nodeId: n.id, edgeId: e.id },
        );
      }
      for (const e of incoming.get(k) ?? []) {
        if (e.mode !== "couple") continue;
        enqueue(
          { id: e.from.node, anchor: e.from.anchor, via: { type: "edge", edgeId: e.id, fromNode: n.id }, seed: false },
          { nodeId: n.id, edgeId: e.id },
        );
      }
    }
  });

  // Preserve the baseline's input order
  return { nodes: baseNodes.map((b) => nodes.get(b.id)!), reasons, trace, blocked, errors };
}
