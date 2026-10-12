import { describe, expect, it } from "vitest";
import { planRefresh } from "@/domain/affected";
import { detectConflicts } from "@/domain/constraints";
import { buildEdges } from "@/domain/graph";
import { parseScenario } from "@/domain/parse";
import { applyOperations } from "@/domain/propagate";
import { sampleTrip } from "@/domain/sample";
import { selectFlight, selectHotel } from "@/domain/select";
import type { Operation, Policy, TripNode } from "@/domain/types";

const T = { adults: 2, children: 0 };

function setup(mutate?: (nodes: TripNode[]) => void) {
  const nodes = sampleTrip().nodes as TripNode[];
  mutate?.(nodes);
  return { nodes, edges: buildEdges(nodes) };
}

function run(ops: Operation[], policy: Policy = { downstream: "shift" }, mutate?: (n: TripNode[]) => void) {
  const { nodes, edges } = setup(mutate);
  const r = applyOperations(nodes, edges, ops, policy);
  const by = Object.fromEntries(r.nodes.map((n) => [n.id, n]));
  return { ...r, by, base: nodes, edges };
}

describe("dependency graph", () => {
  it("couples the spine and attaches activities/transfers", () => {
    const { edges } = setup();
    const kinds = edges.map((e) => `${e.kind}:${e.from.node}->${e.to.node}`);
    expect(kinds).toContain("arrival_checkin:fl_del_sin->st_sin");
    expect(kinds).toContain("checkout_departure:st_sin->fl_sin_dps");
    expect(kinds).toContain("arrival_checkin:fl_sin_dps->st_bali");
    expect(kinds).toContain("checkout_departure:st_bali->fl_dps_del");
    expect(kinds).toContain("activity_in_stay:st_sin->ac_museum");
    expect(kinds).toContain("transfer_after_arrival:fl_del_sin->tr_changi");
  });

  it("is deterministic", () => {
    expect(buildEdges(sampleTrip().nodes as TripNode[])).toEqual(buildEdges(sampleTrip().nodes as TripNode[]));
  });

  it("a fresh baseline has no conflicts", () => {
    const { nodes, edges } = setup();
    expect(detectConflicts(nodes, edges)).toEqual([]);
  });
});

describe("propagation", () => {
  it("E2E-01 shift entire trip +1: every date moves, no conflicts", () => {
    const r = run([{ op: "shift_trip", days: 1 }]);
    for (const n of r.nodes) {
      const b = r.base.find((x) => x.id === n.id)!;
      expect(n.start > b.start).toBe(true);
    }
    expect(r.by.st_sin.start).toBe("2026-11-11");
    expect(r.by.st_sin.end).toBe("2026-11-14");
    expect(detectConflicts(r.nodes, r.edges)).toEqual([]);
  });

  it("does not mutate the baseline", () => {
    const { nodes, edges } = setup();
    const snapshot = structuredClone(nodes);
    applyOperations(nodes, edges, [{ op: "shift_trip", days: 3 }], { downstream: "shift" });
    expect(nodes).toEqual(snapshot);
  });

  it("E2E-02 extend one city (shift policy): checkout moves, downstream follows", () => {
    const r = run([{ op: "resize_stay", nodeId: "st_sin", nights: 1 }]);
    expect(r.by.st_sin.start).toBe("2026-11-10");
    expect(r.by.st_sin.end).toBe("2026-11-14");
    expect(r.by.fl_sin_dps.start).toBe("2026-11-14");
    expect(r.by.st_bali.start).toBe("2026-11-14");
    expect(r.by.st_bali.end).toBe("2026-11-18");
    expect(r.by.fl_dps_del.start).toBe("2026-11-18");
    // activity anchored to check-in and the arrival transfer don't move
    expect(r.by.ac_museum.start).toBe("2026-11-11");
    expect(r.by.tr_changi.start).toBe("2026-11-10");
    expect(r.by.ac_uluwatu.start).toBe("2026-11-16");
  });

  it("E2E-02 extend one city (absorb policy): next stay shrinks, return unchanged", () => {
    const r = run([{ op: "resize_stay", nodeId: "st_sin", nights: 1 }], { downstream: "absorb" });
    expect(r.by.fl_sin_dps.start).toBe("2026-11-14");
    expect(r.by.st_bali.start).toBe("2026-11-14");
    expect(r.by.st_bali.end).toBe("2026-11-17");
    expect(r.by.fl_dps_del.start).toBe("2026-11-17");
  });

  it("moving a middle flight stretches the previous stay", () => {
    const r = run([{ op: "move_flight", nodeId: "fl_sin_dps", date: "2026-11-14" }], { downstream: "absorb" });
    expect(r.by.st_sin.end).toBe("2026-11-14");
    expect(r.by.st_sin.start).toBe("2026-11-10");
    expect(r.by.st_bali.start).toBe("2026-11-14");
    expect(r.by.fl_dps_del.start).toBe("2026-11-17");
  });

  it("E2E-03 fixed flight: not moved, conflict surfaced", () => {
    const r = run([{ op: "shift_trip", days: 1 }], { downstream: "shift" }, (nodes) => {
      nodes.find((n) => n.id === "fl_del_sin")!.fixed = true;
    });
    expect(r.by.fl_del_sin.start).toBe("2026-11-10");
    expect(r.blocked.map((b) => b.nodeId)).toContain("fl_del_sin");
    const conflicts = detectConflicts(r.nodes, r.edges);
    const gap = conflicts.find((c) => c.kind === "gap" && c.nodeIds.includes("fl_del_sin"));
    expect(gap?.severity).toBe("error");
    expect(gap?.message).toMatch(/without a hotel/);
  });

  it("a fixed downstream flight blocks propagation", () => {
    const r = run([{ op: "resize_stay", nodeId: "st_bali", nights: 1 }], { downstream: "shift" }, (nodes) => {
      nodes.find((n) => n.id === "fl_dps_del")!.fixed = true;
    });
    expect(r.by.fl_dps_del.start).toBe("2026-11-17");
    expect(r.by.st_bali.end).toBe("2026-11-18");
    expect(detectConflicts(r.nodes, r.edges).some((c) => c.kind === "overlap")).toBe(true);
  });

  it("shortening a stay to zero nights is flagged", () => {
    const r = run([{ op: "resize_stay", nodeId: "st_sin", nights: -3 }], { downstream: "shift" });
    expect(detectConflicts(r.nodes, r.edges).some((c) => c.kind === "invalid_duration")).toBe(true);
  });

  it("reports unknown nodes instead of throwing", () => {
    const r = run([{ op: "resize_stay", nodeId: "nope", nights: 1 }]);
    expect(r.errors[0]).toMatch(/Unknown/);
  });
});

describe("affected-node detection", () => {
  it("only nodes whose search changed are refetched", () => {
    const r = run([{ op: "resize_stay", nodeId: "st_bali", nights: 1 }]);
    const plan = planRefresh(r.base, r.nodes, T);
    expect(plan.refetch.sort()).toEqual(["fl_dps_del", "st_bali"]);
    expect(plan.reuse).toContain("fl_del_sin");
    expect(plan.reuse).toContain("st_sin");
    expect(plan.reuse).toContain("ac_museum"); // opening hours don't depend on date
    expect(plan.none).toEqual(["tr_changi"]);
  });
});

describe("activity constraints", () => {
  it("flags a closed day only when evidence exists", () => {
    const r = run([{ op: "shift_trip", days: 1 }]); // museum Wed → Thu
    const withEvidence = detectConflicts(r.nodes, r.edges, {
      ac_museum: { evidenceId: "ev_1", result: { type: "place", name: "Museum", address: null, closedWeekdays: [4], hours: null, rating: null } },
    });
    expect(withEvidence.find((c) => c.kind === "activity_closed")?.evidenceIds).toEqual(["ev_1"]);
    const noEvidence = detectConflicts(r.nodes, r.edges, {
      ac_museum: { evidenceId: "ev_2", result: { type: "place", name: "Museum", address: null, closedWeekdays: null, hours: null, rating: null } },
    });
    expect(noEvidence.find((c) => c.kind === "activity_closed")).toBeUndefined();
  });
});

describe("option selection", () => {
  const opt = (n: string, price: number) => ({ airline: "X", flightNumbers: [n], departTime: "", arriveTime: "", durationMin: 100, stops: 0, price });
  it("prefers the pinned flight, else cheapest", () => {
    const opts = [opt("SQ 1", 200), opt("6E 2", 100)];
    expect(selectFlight(opts, { airline: "SQ", flightNumbers: ["SQ1"] }, "INR")?.match).toBe("preferred");
    const r = selectFlight(opts, { airline: "SQ", flightNumbers: ["SQ 9"] }, "INR");
    expect(r?.match).toBe("cheapest");
    expect(r?.preferredFound).toBe(false);
  });
  it("never substitutes a different named hotel", () => {
    const opts = [{ name: "Other Hotel", total: 100, perNight: 50, rating: 4.5, stars: 4, token: null }];
    const r = selectHotel(opts, "Alila Seminyak", 2, "INR");
    expect(r.result).toBeNull();
    expect(r.note).toMatch(/not found/);
  });
});

describe("scenario parsing", () => {
  const nodes = sampleTrip().nodes as TripNode[];
  const cases: [string, Operation][] = [
    ["What if we leave one day later?", { op: "shift_trip", days: 1 }],
    ["move the whole trip 2 days earlier", { op: "shift_trip", days: -2 }],
    ["delay the trip by a week", { op: "shift_trip", days: 7 }],
    ["one more night in Singapore", { op: "resize_stay", nodeId: "st_sin", nights: 1 }],
    ["stay 2 extra nights in Bali", { op: "resize_stay", nodeId: "st_bali", nights: 2 }],
    ["shorten Bali by 1 night", { op: "resize_stay", nodeId: "st_bali", nights: -1 }],
    ["fly to Bali on Nov 15", { op: "move_flight", nodeId: "fl_sin_dps", date: "2026-11-15" }],
    ["fly home a day later", { op: "move_flight", nodeId: "fl_dps_del", date: "2026-11-18" }],
    ["move SIN → DPS to 14 November", { op: "move_flight", nodeId: "fl_sin_dps", date: "2026-11-14" }],
  ];
  for (const [text, op] of cases) {
    it(text, () => {
      const r = parseScenario(text, nodes);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.ops[0]).toEqual(op);
    });
  }
  it("detects the keep-return policy", () => {
    const r = parseScenario("one more night in Singapore but keep the return flight", nodes);
    expect(r.ok && r.policy).toBe("absorb");
  });
  it("refuses gibberish", () => {
    expect(parseScenario("make it nicer", nodes).ok).toBe(false);
  });
});
