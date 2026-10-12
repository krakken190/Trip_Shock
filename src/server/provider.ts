import { createMockProvider } from "@/providers/mock";
import { createSerpApiProvider } from "@/providers/serpapi";
import { ProviderError, type TravelProvider } from "@/providers/types";
import { getSetting, setSetting } from "./repo";

export type ProviderMode = "serpapi" | "mock";

export function providerMode(): ProviderMode {
  const forced = process.env.TRIPSHOCK_PROVIDER;
  if (forced === "mock" || forced === "serpapi") return forced;
  return serpApiKey() ? "serpapi" : "mock";
}

/** Accepts SERPAPI_API_KEY (documented) or SERPAPI_KEY. */
export function serpApiKey(): string | undefined {
  return process.env.SERPAPI_API_KEY || process.env.SERPAPI_KEY || undefined;
}

/** Fault injection for demos and E2E tests. Only honoured by the mock provider. */
export interface Faults {
  flights?: "error" | "empty";
  hotels?: "error" | "empty";
  places?: "error" | "empty";
}

export function getFaults(): Faults {
  return providerMode() === "mock" ? getSetting<Faults>("faults", {}) : {};
}

export function setFaults(f: Faults) {
  setSetting("faults", f);
}

export function getProvider(): TravelProvider {
  if (providerMode() === "serpapi") {
    const key = serpApiKey();
    if (!key) throw new Error("TRIPSHOCK_PROVIDER=serpapi but SERPAPI_API_KEY is not set");
    return createSerpApiProvider(key);
  }
  const mock = createMockProvider();
  const f = getFaults();
  const fail = (what: string) => {
    throw new ProviderError(`Simulated ${what} outage (fault injection)`, false);
  };
  return {
    id: "mock",
    async searchFlights(req, s) {
      if (f.flights === "error") fail("Google Flights");
      const r = await mock.searchFlights(req, s);
      return f.flights === "empty" ? { ...r, options: [] } : r;
    },
    async searchHotels(req, s) {
      if (f.hotels === "error") fail("Google Hotels");
      const r = await mock.searchHotels(req, s);
      return f.hotels === "empty" ? { ...r, options: [] } : r;
    },
    async suggestPlaces(q, s) {
      if (f.places === "error") fail("Google Maps");
      const r = await mock.suggestPlaces(q, s);
      return f.places === "empty" ? { ...r, candidates: [] } : r;
    },
    async searchPlace(req, s) {
      if (f.places === "error") fail("Google Maps");
      const r = await mock.searchPlace(req, s);
      return f.places === "empty" ? { ...r, place: null } : r;
    },
  };
}
