import { describe, expect, it } from "vitest";
import { addDays } from "@/domain/dates";
import { createSerpApiProvider } from "@/providers/serpapi";

// Opt-in live integration test. Uses real SerpApi credits.
//   SERPAPI_API_KEY=... npm run test:live
const enabled = process.env.TRIPSHOCK_LIVE_TEST === "1" && !!(process.env.SERPAPI_API_KEY || process.env.SERPAPI_KEY);

describe.skipIf(!enabled)("SerpApi live", () => {
  const provider = createSerpApiProvider((process.env.SERPAPI_API_KEY || process.env.SERPAPI_KEY) ?? "");
  const date = addDays(new Date().toISOString().slice(0, 10), 45);

  it("Google Flights returns normalized options", { timeout: 60_000 }, async () => {
    const r = await provider.searchFlights({ engine: "google_flights", key: "live", from: "DEL", to: "SIN", date, adults: 1, children: 0, cabin: "economy", preferred: null, time: null });
    expect(r.options.length).toBeGreaterThan(0);
    expect(r.options[0].price).toBeGreaterThan(0);
    expect(r.options[0].flightNumbers.length).toBeGreaterThan(0);
  });

  it("Google Hotels returns normalized options", { timeout: 60_000 }, async () => {
    const r = await provider.searchHotels({ engine: "google_hotels", key: "live", city: "Singapore", hotelName: null, checkIn: date, checkOut: addDays(date, 2), adults: 2, children: 0, budget: null });
    expect(r.options.length).toBeGreaterThan(0);
    expect(r.options[0].total).toBeGreaterThan(0);
  });
});
