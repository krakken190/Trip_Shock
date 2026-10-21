import { writeFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { sampleTrip } from "@/domain/sample";
import { setFaults } from "@/server/provider";
import { itineraryFor } from "@/server/itinerary";
import { renderItineraryPdf } from "@/server/itinerary-pdf";
import * as svc from "@/server/service";

process.env.TRIPSHOCK_MOCK_LATENCY_MS = "0";

describe("finalized itinerary", () => {
  beforeEach(() => setFaults({}));

  async function pricedSample() {
    const trip = svc.createTrip(sampleTrip());
    await svc.refreshTrip(trip.id);
    return trip;
  }

  it("builds the baseline itinerary: route, day plan and cost breakdown", async () => {
    const trip = await pricedSample();
    const it = itineraryFor(trip.id);

    expect(it.version.kind).toBe("baseline");
    expect(it.route.map((r) => r.code)).toEqual(["DEL", "SIN", "DPS", "DEL"]);
    expect(it.route[1]).toMatchObject({ arrive: "2026-11-10", depart: "2026-11-13" });
    expect(it.nights).toBe(7);
    expect(it.days).toHaveLength(8);

    // Day 4 (Nov 13): check out of Singapore before flying on and checking in to Bali
    const d4 = it.days[3];
    expect(d4.date).toBe("2026-11-13");
    expect(d4.events.map((e) => `${e.role}:${e.item.id}`)).toEqual(["check_out:st_sin", "depart:fl_sin_dps", "check_in:st_bali"]);
    expect(d4.overnight).toBe("Alila Seminyak");
    expect(it.days[7].overnight).toBeNull();

    // Costs: observed flights + hotels, user estimates for activities + transfers
    const byKey = Object.fromEntries(it.costs.lines.map((l) => [l.key, l]));
    expect(byKey.flights.count).toBe(3);
    expect(byKey.hotels.count).toBe(2);
    expect(byKey.activities.amount).toBe(2700);
    expect(byKey.transfers.amount).toBe(1600);
    expect(it.costs.estimates).toBe(4300);
    expect(it.costs.total).toBe(it.costs.observed + it.costs.estimates);
    expect(it.costs.excluded).toEqual([]);
    const flight = it.items.find((i) => i.id === "fl_del_sin")!;
    expect(flight.source).toBe("observed");
    expect(flight.times?.depart).toMatch(/^\d{2}:\d{2}$/);
    expect(flight.evidenceId).toMatch(/^ev_/);
  });

  it("adopts a saved what-if as the final plan", async () => {
    const trip = await pricedSample();
    const sc = await svc.createScenario(trip.id, { ops: [{ op: "shift_trip", days: 1 }], policy: { downstream: "shift" } });
    const it = itineraryFor(trip.id, sc.scenario.id);

    expect(it.version).toMatchObject({ kind: "scenario", scenarioId: sc.scenario.id, changes: ["Shift whole trip +1 day"] });
    expect(it.version.deltaVsBaseline).toBe(sc.diff.aggregate.total.delta);
    expect(it.start).toBe("2026-11-11");
    expect(it.items.find((i) => i.id === "st_sin")).toMatchObject({ start: "2026-11-11", end: "2026-11-14" });
    // The museum lands on its (simulated) closed day: flagged in the item and the readiness check
    expect(it.items.find((i) => i.id === "ac_museum")!.warnings.join()).toMatch(/Closed on/);
    expect(it.readiness.conflicts).toBeGreaterThan(0);
    expect(it.readiness.ready).toBe(false);

    expect(() => itineraryFor(svc.createTrip(sampleTrip()).id, sc.scenario.id)).toThrow(/Scenario not found/);
  });

  it("excludes failed searches from the total and lists them", async () => {
    const trip = await pricedSample();
    setFaults({ hotels: "error" });
    await svc.refreshTrip(trip.id, ["st_bali"]);
    const it = itineraryFor(trip.id);
    const bali = it.items.find((i) => i.id === "st_bali")!;
    expect(bali).toMatchObject({ amount: null, source: "unavailable", priceNote: "Search failed" });
    expect(it.costs.excluded).toEqual(["Alila Seminyak"]);
    expect(it.readiness.unpriced).toBe(1);
  });

  it("renders a PDF", async () => {
    const trip = await pricedSample();
    const sc = await svc.createScenario(trip.id, { ops: [{ op: "shift_trip", days: 1 }], policy: { downstream: "shift" } });
    const pdf = await renderItineraryPdf(itineraryFor(trip.id, sc.scenario.id));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(20_000);
    if (process.env.TRIPSHOCK_PDF_OUT) writeFileSync(process.env.TRIPSHOCK_PDF_OUT, pdf);
  }, 30_000);
});
