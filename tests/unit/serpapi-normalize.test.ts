import { describe, expect, it } from "vitest";
import { normalizeFlights, normalizeHotels, normalizePlace } from "@/providers/serpapi";

// Fixtures mirror the documented SerpApi response shapes (trimmed to the fields we read).

describe("SerpApi normalizers", () => {
  it("flights: merges best/other, keeps legs, stops and price", () => {
    const opts = normalizeFlights({
      best_flights: [
        {
          flights: [
            { departure_airport: { id: "DEL", time: "2026-11-10 23:30" }, arrival_airport: { id: "SIN", time: "2026-11-11 07:40" }, airline: "Singapore Airlines", flight_number: "SQ 403", duration: 340 },
          ],
          total_duration: 340,
          price: 38210,
        },
      ],
      other_flights: [
        {
          flights: [
            { departure_airport: { id: "DEL", time: "2026-11-10 06:00" }, arrival_airport: { id: "BOM", time: "2026-11-10 08:10" }, airline: "IndiGo", flight_number: "6E 2012", duration: 130 },
            { departure_airport: { id: "BOM", time: "2026-11-10 10:00" }, arrival_airport: { id: "SIN", time: "2026-11-10 18:10" }, airline: "IndiGo", flight_number: "6E 1011", duration: 340 },
          ],
          total_duration: 610,
          price: 29990,
        },
        { flights: [], price: 1 }, // malformed — dropped
      ],
    });
    expect(opts).toHaveLength(2);
    expect(opts[0]).toMatchObject({ airline: "Singapore Airlines", flightNumbers: ["SQ 403"], stops: 0, price: 38210, arriveTime: "2026-11-11 07:40" });
    expect(opts[1]).toMatchObject({ airline: "IndiGo", flightNumbers: ["6E 2012", "6E 1011"], stops: 1, durationMin: 610 });
  });

  it("hotels: list response, skipping properties without prices", () => {
    const opts = normalizeHotels(
      {
        properties: [
          { name: "Hotel A", property_token: "t1", rate_per_night: { extracted_lowest: 6100 }, total_rate: { extracted_lowest: 18300 }, overall_rating: 4.3, extracted_hotel_class: 4 },
          { name: "Sold Out Inn", property_token: "t2" },
        ],
      },
      3,
    );
    expect(opts).toEqual([{ name: "Hotel A", total: 18300, perNight: 6100, rating: 4.3, stars: 4, token: "t1" }]);
  });

  it("hotels: single-property response for a named hotel", () => {
    const opts = normalizeHotels({ name: "Alila Seminyak", rate_per_night: { extracted_lowest: 21000 }, overall_rating: 4.6 }, 4);
    expect(opts[0]).toMatchObject({ name: "Alila Seminyak", perNight: 21000, total: 84000 });
  });

  it("places: reads operating hours and closed days; null when absent", () => {
    const p = normalizePlace({
      place_results: {
        title: "Some Museum",
        address: "1 Road",
        hours: [{ monday: "Closed" }, { tuesday: "10 AM–7 PM" }, { wednesday: "10 AM–7 PM" }],
        rating: 4.5,
      },
    });
    expect(p?.closedWeekdays).toEqual([1]);
    expect(p?.hours?.tuesday).toBe("10 AM–7 PM");

    const noHours = normalizePlace({ local_results: [{ title: "Beach" }] });
    expect(noHours?.closedWeekdays).toBeNull();
    expect(normalizePlace({})).toBeNull();
  });
});
