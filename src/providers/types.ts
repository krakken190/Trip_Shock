import type { FlightSearch, HotelSearch, PlaceSearch } from "@/domain/affected";
import type { FlightOption, HotelOption, PlaceCandidate, PlaceResult } from "@/domain/types";

/**
 * Provider contract. Implementations translate a domain search into provider calls and return
 * normalized options only — nothing downstream sees provider JSON. Choosing which option
 * represents a plan node is domain logic (see domain/select.ts).
 */
export interface FlightSearchResponse {
  options: FlightOption[];
  currency: string;
  params: Record<string, string | number>;
  raw?: unknown;
}

export interface HotelSearchResponse {
  options: HotelOption[];
  nights: number;
  currency: string;
  params: Record<string, string | number>;
  raw?: unknown;
}

export interface PlaceSearchResponse {
  place: PlaceResult | null;
  params: Record<string, string | number>;
  raw?: unknown;
}

export interface PlaceSuggestResponse {
  candidates: PlaceCandidate[];
  params: Record<string, string | number>;
}

export interface TravelProvider {
  readonly id: "serpapi" | "mock";
  searchFlights(req: FlightSearch, signal?: AbortSignal): Promise<FlightSearchResponse>;
  searchHotels(req: HotelSearch, signal?: AbortSignal): Promise<HotelSearchResponse>;
  searchPlace(req: PlaceSearch, signal?: AbortSignal): Promise<PlaceSearchResponse>;
  /** Free-text places search ("adventure activities near Baga, Goa") → ranked candidates */
  suggestPlaces(query: string, signal?: AbortSignal): Promise<PlaceSuggestResponse>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly params: Record<string, string | number> = {},
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
