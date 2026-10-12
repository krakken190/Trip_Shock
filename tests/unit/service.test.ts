import { beforeEach, describe, expect, it } from "vitest";
import { sampleTrip } from "@/domain/sample";
import type { TripInput } from "@/domain/types";
import { setFaults } from "@/server/provider";
import * as repo from "@/server/repo";
import * as svc from "@/server/service";

process.env.TRIPSHOCK_MOCK_LATENCY_MS = "0";

/** Spec E2E acceptance tests, run against the service layer with the deterministic mock provider. */
describe("TripShock service (mock provider)", () => {
  beforeEach(() => setFaults({}));

  async function baseline(mutate?: (t: TripInput) => void) {
    const input = sampleTrip();
    mutate?.(input);
    const trip = svc.createTrip(input);
    await svc.refreshTrip(trip.id);
    return trip;
  }

  it("E2E-01 shift entire trip: dates propagate, only affected refetch, diff has evidence", async () => {
    const trip = await baseline();
    const before = svc.baselineView(trip.id);
    const v = await svc.createScenario(trip.id, { ops: [{ op: "shift_trip", days: 1 }], policy: { downstream: "shift" } });

    expect(v.nodes.find((n) => n.id === "st_sin")!.start).toBe("2026-11-11");
    // Flights + stays change search params; the activity place lookups and transfer don't.
    expect(v.plan.refetch.sort()).toEqual(["fl_del_sin", "fl_dps_del", "fl_sin_dps", "st_bali", "st_sin"]);
    expect(v.plan.reuse.sort()).toEqual(["ac_museum", "ac_uluwatu"]);

    const priceFields = v.diff.fields.filter((f) => f.category === "price");
    expect(priceFields.length).toBeGreaterThan(0);
    for (const f of priceFields) {
      expect(f.evidence_ids.length).toBe(2);
      expect(f.before).not.toBeNull();
      expect(f.after).not.toBeNull();
    }
    // Scenario evidence is new, baseline evidence untouched
    for (const id of v.plan.refetch) {
      expect(v.scenarioObservations[id].id).not.toBe(before.observations[id].id);
      expect(v.scenarioObservations[id].observedAt).toBeTruthy();
    }
    expect(v.diff.aggregate.total.complete).toBe(true);
    // Museum Wed → Thu, which the mock marks as closed
    expect(v.conflicts.some((c) => c.kind === "activity_closed")).toBe(true);
    expect(v.diff.aggregate.activities.constraintsAffected).toBe(1);
  });

  it("E2E-02 extend one city by one night: only affected searches run", async () => {
    const trip = await baseline();
    const v = await svc.createScenario(trip.id, {
      ops: [{ op: "resize_stay", nodeId: "st_sin", nights: 1 }],
      policy: { downstream: "absorb" },
    });
    expect(v.nodes.find((n) => n.id === "st_sin")!.end).toBe("2026-11-14");
    expect(v.plan.refetch.sort()).toEqual(["fl_sin_dps", "st_bali", "st_sin"]);
    expect(v.plan.reuse).toContain("fl_del_sin");
    expect(v.plan.reuse).toContain("fl_dps_del");
    const bali = v.diff.nodes.find((n) => n.nodeId === "st_bali")!;
    expect(bali.structural).toBe("resized");
  });

  it("E2E-03 locked node: conflict surfaced, fixed flight does not move", async () => {
    const trip = await baseline((t) => {
      t.nodes.find((n) => n.id === "fl_del_sin")!.fixed = true;
    });
    const v = await svc.createScenario(trip.id, { ops: [{ op: "shift_trip", days: 1 }], policy: { downstream: "shift" } });
    const f = v.nodes.find((n) => n.id === "fl_del_sin")!;
    expect(f.start).toBe("2026-11-10");
    expect(v.diff.nodes.find((n) => n.nodeId === "fl_del_sin")!.structural).toBe("held");
    expect(v.conflicts.some((c) => c.nodeIds.includes("fl_del_sin") && c.severity === "error" && !c.preexisting)).toBe(true);
    expect(v.plan.refetch).not.toContain("fl_del_sin");
  });

  it("E2E-04 price search unavailable: dates recompute, price unknown, nothing mislabeled", async () => {
    const trip = await baseline();
    setFaults({ flights: "error" });
    // +5 so no cached evidence from earlier tests applies
    const v = await svc.createScenario(trip.id, { ops: [{ op: "shift_trip", days: 5 }], policy: { downstream: "shift" } });

    expect(v.nodes.find((n) => n.id === "fl_del_sin")!.start).toBe("2026-11-15");
    for (const id of ["fl_del_sin", "fl_sin_dps", "fl_dps_del"]) {
      const d = v.diff.nodes.find((n) => n.nodeId === id)!;
      expect(d.price.after.status).toBe("error");
      expect(d.price.after.amount).toBeNull();
      expect(d.price.delta).toBeNull();
      expect(d.price.state).toBe("unknown");
    }
    expect(v.diff.aggregate.flights.state).toBe("unknown");
    expect(v.diff.aggregate.total.complete).toBe(false);
    expect(v.diff.aggregate.total.excluded).toEqual(expect.arrayContaining(["DEL → SIN", "SIN → DPS", "DPS → DEL"]));
    // Hotels still work
    expect(v.diff.aggregate.hotels.delta).not.toBeNull();
    // Scenario remains viewable
    expect(svc.scenarioView(v.scenario.id).nodes.length).toBe(8);
  });

  it("E2E-04b baseline refresh failure replaces the price instead of keeping the old one", async () => {
    const trip = await baseline();
    setFaults({ flights: "error" });
    const view = await svc.refreshTrip(trip.id, ["fl_del_sin"]);
    expect(view.observations.fl_del_sin.status).toBe("error");
    expect(view.lastKnown.fl_del_sin.status).toBe("ok"); // shown separately, as historical
    expect(view.totals.missing).toBe(1);
  });

  it("E2E-05 revert: deleting a scenario leaves the baseline unchanged", async () => {
    const trip = await baseline();
    const before = repo.getTrip(trip.id);
    const v = await svc.createScenario(trip.id, { ops: [{ op: "shift_trip", days: 2 }], policy: { downstream: "shift" } });
    svc.deleteScenario(v.scenario.id);
    expect(repo.getScenario(v.scenario.id)).toBeNull();
    expect(repo.getTrip(trip.id)).toEqual(before);
  });

  it("uses cached evidence for identical searches instead of re-querying", async () => {
    const trip = await baseline();
    const a = await svc.createScenario(trip.id, { ops: [{ op: "shift_trip", days: 1 }], policy: { downstream: "shift" } });
    const b = await svc.createScenario(trip.id, { ops: [{ op: "shift_trip", days: 1 }], policy: { downstream: "shift" } });
    expect(b.scenarioObservations.fl_del_sin.id).toBe(a.scenarioObservations.fl_del_sin.id);
    const c = await svc.refreshScenario(b.scenario.id, { force: true });
    expect(c.scenarioObservations.fl_del_sin.id).not.toBe(a.scenarioObservations.fl_del_sin.id);
  });

  it("rejects operations on unknown nodes", async () => {
    const trip = await baseline();
    await expect(
      svc.createScenario(trip.id, { ops: [{ op: "resize_stay", nodeId: "x", nights: 1 }], policy: { downstream: "shift" } }),
    ).rejects.toThrow(/Unknown/);
  });
});
