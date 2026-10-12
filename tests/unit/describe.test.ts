import { afterEach, describe, expect, it, vi } from "vitest";
import { buildEdges } from "@/domain/graph";
import { fitsTimeWindow, selectFlight, selectHotel } from "@/domain/select";
import { draftToPlan, itemIssues, planSuggestions, planToNodes, TripDraft, type DraftItem } from "@/domain/trip-draft";
import type { FlightOption, HotelOption } from "@/domain/types";
import { extractJson, extractTripDraft } from "@/server/llm";

// The model's output for: "Pune to Goa with my wife on 12 Nov, arrive before 2 pm, business class.
// Budget hotel 12–16 Nov. Something adventurous near Baga beach on the 14th, top 3. Taxi to the airport."
const PUNE_GOA = {
  trip_name: "Pune to Goa",
  adults: 2,
  children: null,
  flights: [{ from_city: "Pune", from_iata: "PNQ", to_city: "Goa", to_iata: "GOI", date: "2026-11-12", cabin: "business", depart_after: null, depart_before: null, arrive_before: "14:00", source_text: "Pune to Goa … business class" }],
  stays: [{ city: "Goa", check_in: "2026-11-12", check_out: "2026-11-16", hotel_name: null, budget_tier: "budget", max_per_night_inr: null, source_text: "Budget hotel 12–16 Nov" }],
  activities: [{ city: "Goa", date: "2026-11-14", place_name: null, interest: "adventure", near: "Baga beach", count: 3, source_text: "Something adventurous near Baga" }],
  transfers: [{ from: "Home", to: "Pune Airport", mode: "taxi", date: "2026-11-12", source_text: "Taxi to the airport" }],
  unmapped: ["cost estimate for activities"],
};

const idGen = () => {
  let i = 0;
  return (k: string) => `${k.slice(0, 2)}_${i++}`;
};

describe("draft → plan", () => {
  it("maps every stated detail and nothing else", () => {
    const plan = draftToPlan(TripDraft.parse(PUNE_GOA));
    expect(plan.travelers).toEqual({ adults: 2, children: 0 });
    expect(plan.travelersDefaulted).toBe(false);
    const flight = plan.items.find((i) => i.kind === "flight")!;
    expect(flight).toMatchObject({ from: "PNQ", to: "GOI", cabin: "business", arriveBefore: "14:00", departAfter: null });
    expect(flight.defaulted).toEqual([]);
    const stay = plan.items.find((i) => i.kind === "stay")!;
    expect(stay).toMatchObject({ tier: "budget", maxPerNight: null, hotelName: null });
    const act = plan.items.find((i) => i.kind === "activity")!;
    expect(act).toMatchObject({ name: null, interest: "adventure", near: "Baga beach", count: 3 });
    expect(itemIssues(act)).toContain("Pick places");
    // Transfer to the airport sorts before the flight
    expect(plan.items[0].kind).toBe("transfer");
  });

  it("is lenient with messy model output and never guesses", () => {
    const plan = draftToPlan(TripDraft.parse({ flights: [{ from_city: "Pune", to_city: "Goa", date: "12/11", cabin: "super" }], unmapped: null }));
    const f = plan.items[0];
    expect(f.start).toBeNull(); // invalid date format dropped, not coerced
    expect(f.cabin).toBe("economy");
    expect(f.defaulted).toContain("cabin");
    expect(f.from).toBe("PNQ"); // resolved from the offline airport list
    expect(plan.travelersDefaulted).toBe(true);
    expect(itemIssues(f)).toContain("Departure date");
  });

  it("suggests fixes from what was said, and a return flight", () => {
    const d = TripDraft.parse({
      flights: [{ from_city: "Pune", from_iata: "PNQ", to_city: "Goa", to_iata: "GOI", date: null, cabin: "business" }],
      stays: [{ city: "Goa", check_in: "2026-11-12", check_out: "2026-11-16" }],
    });
    const plan = draftToPlan(d);
    const s = planSuggestions(plan.items);
    expect(s.find((x) => x.itemKey)?.patch).toEqual({ start: "2026-11-12", end: "2026-11-12" });
    const ret = s.find((x) => x.id === "return-flight")!;
    expect(ret.add).toMatchObject({ from: "GOI", to: "PNQ", start: "2026-11-16", cabin: "business" });
  });

  it("converts confirmed items into valid plan nodes with preferences", () => {
    const plan = draftToPlan(TripDraft.parse(PUNE_GOA));
    const items = plan.items.filter((i) => i.kind !== "activity");
    const nodes = planToNodes(items, idGen());
    expect(nodes.map((n) => n.kind).sort()).toEqual(["flight", "stay", "transfer"]);
    const f = nodes.find((n) => n.kind === "flight");
    expect(f?.kind === "flight" && f.timePreference).toEqual({ departAfter: null, departBefore: null, arriveBefore: "14:00" });
    const st = nodes.find((n) => n.kind === "stay");
    expect(st?.kind === "stay" && st.budget).toEqual({ tier: "budget", maxPerNight: null });
    // Taxi to the airport runs ahead of the departure
    const edges = buildEdges(nodes);
    expect(edges.find((e) => e.kind === "transfer_before_departure")).toBeTruthy();
  });

  it("skips items with blocking issues", () => {
    const bad: DraftItem = { key: "x", kind: "stay", source: null, defaulted: [], city: "Goa", start: "2026-11-12", end: null };
    expect(planToNodes([bad], idGen())).toEqual([]);
  });
});

describe("preference-aware selection", () => {
  const f = (dep: string, arr: string, price: number): FlightOption => ({ airline: "X", flightNumbers: [`X ${price}`], departTime: dep, arriveTime: arr, durationMin: 60, stops: 0, price });
  const opts = [f("2026-11-12 06:00", "2026-11-12 07:10", 5000), f("2026-11-12 12:30", "2026-11-12 13:40", 7000), f("2026-11-12 19:00", "2026-11-12 20:10", 6000)];

  it("honours arrive-by and departure windows", () => {
    expect(fitsTimeWindow(f("2026-11-12 23:00", "2026-11-13 01:00", 1), { arriveBefore: "14:00" })).toBe(false);
    const r = selectFlight(opts, null, "INR", { departAfter: "10:00", arriveBefore: "14:00" });
    expect(r?.price).toBe(7000);
    expect(r?.timeWindowMatched).toBe(true);
  });

  it("falls back to cheapest and says so when nothing fits", () => {
    const r = selectFlight(opts, null, "INR", { departAfter: "21:00" });
    expect(r?.price).toBe(5000);
    expect(r?.timeWindowMatched).toBe(false);
  });

  const h = (name: string, perNight: number, rating: number, stars: number): HotelOption => ({ name, total: perNight * 2, perNight, rating, stars, token: null });
  const hotels = [h("Hostel", 900, 3.2, 2), h("Budget Inn", 1800, 3.8, 3), h("Mid Hotel", 4000, 4.3, 4), h("Palace", 15000, 4.8, 5)];

  it("budget tier picks the cheapest decent option; max per night filters hard", () => {
    expect(selectHotel(hotels, null, 2, "INR", { tier: "budget" }).result?.hotel.name).toBe("Budget Inn");
    expect(selectHotel(hotels, null, 2, "INR", { tier: "luxury" }).result?.hotel.name).toBe("Palace");
    expect(selectHotel(hotels, null, 2, "INR", null).result?.hotel.name).toBe("Mid Hotel");
    const capped = selectHotel(hotels, null, 2, "INR", { maxPerNight: 500 });
    expect(capped.result).toBeNull();
    expect(capped.note).toMatch(/under|at or under/);
  });
});

describe("OpenRouter extraction", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENROUTER_API_KEY;
  });

  it("extracts JSON from fenced or reasoning-wrapped replies", () => {
    expect(extractJson('<think>hmm</think>```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(() => extractJson("no json here")).toThrow();
  });

  it("falls back to the next model when the first is rate-limited", async () => {
    process.env.OPENROUTER_API_KEY = "test";
    process.env.OPENROUTER_MODEL = "a/free";
    process.env.OPENROUTER_FALLBACK_MODELS = "b/free";
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      calls.push(body.model);
      if (body.model === "a/free") return new Response(JSON.stringify({ error: { message: "Provider returned error", code: 429, metadata: { raw: "rate-limited upstream" } } }), { status: 429 });
      return new Response(JSON.stringify({ model: "b/free", choices: [{ message: { content: JSON.stringify(PUNE_GOA) }, finish_reason: "stop" }] }));
    });
    const r = await extractTripDraft("Pune to Goa…", "2026-09-29");
    expect(r.model).toBe("b/free");
    expect(r.draft.flights[0].to_iata).toBe("GOI");
    expect(calls).toEqual(["a/free", "a/free", "b/free"]); // one retry on 429, then fallback
    expect(r.attempts[0].error).toMatch(/rate-limited/);
  }, 15_000);

  it("retries in JSON mode when structured output returns nothing usable", async () => {
    process.env.OPENROUTER_API_KEY = "test";
    process.env.OPENROUTER_MODEL = "a/free";
    process.env.OPENROUTER_FALLBACK_MODELS = "";
    const modes: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      modes.push(body.response_format.type);
      const content = body.response_format.type === "json_schema" ? "" : JSON.stringify(PUNE_GOA);
      return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: content ? "stop" : "length" }] }));
    });
    const r = await extractTripDraft("Pune to Goa…", "2026-09-29");
    expect(modes).toEqual(["json_schema", "json_object"]);
    expect(r.draft.stays[0].budget_tier).toBe("budget");
  });
});
