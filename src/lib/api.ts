import type { DraftPlan } from "@/domain/trip-draft";
import type { Observation, PlaceCandidate, ScenarioInput, Trip, TripInput } from "@/domain/types";
import type { BaselineView, ScenarioSummary, ScenarioView } from "@/server/service";

export type { BaselineView, ScenarioSummary, ScenarioView };

export interface TripListItem {
  id: string;
  name: string;
  travelers: { adults: number; children: number };
  route: string[];
  start: string | null;
  end: string | null;
  days: number;
  items: number;
  scenarios: number;
  observedTotal: number | null;
  missing: number;
  updatedAt: string;
}

export interface Meta {
  provider: "serpapi" | "mock";
  faults: Record<string, string>;
  cacheTtlMin: number;
  nlp: { enabled: boolean; model: string | null };
}

export interface DescribeResult {
  plan: DraftPlan;
  model: string;
  ms: number;
  fallbacksUsed: number;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly details?: unknown) {
    super(message);
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details = (json as { details?: unknown }).details;
    const first = Array.isArray(details) && details[0] && typeof details[0] === "object" && "message" in details[0] ? `: ${(details[0] as { message: string }).message}` : "";
    throw new ApiError(((json as { error?: string }).error ?? `Request failed (${res.status})`) + first, res.status, details);
  }
  return json as T;
}

export const api = {
  meta: () => call<Meta>("GET", "/api/meta"),
  trips: () => call<TripListItem[]>("GET", "/api/trips"),
  createTrip: (input: TripInput | { sample: true }) => call<Trip>("POST", "/api/trips", input),
  trip: (id: string) => call<BaselineView>("GET", `/api/trips/${id}`),
  updateTrip: (id: string, input: TripInput) => call<BaselineView>("PUT", `/api/trips/${id}`, input),
  deleteTrip: (id: string) => call<{ ok: true }>("DELETE", `/api/trips/${id}`),
  refreshTrip: (id: string, nodeIds?: string[]) => call<BaselineView>("POST", `/api/trips/${id}/refresh`, { nodeIds }),
  createScenario: (tripId: string, input: ScenarioInput) => call<ScenarioView>("POST", `/api/trips/${tripId}/scenarios`, input),
  scenario: (id: string) => call<ScenarioView>("GET", `/api/scenarios/${id}`),
  refreshScenario: (id: string, force = true) => call<ScenarioView>("POST", `/api/scenarios/${id}/refresh`, { force }),
  deleteScenario: (id: string) => call<{ ok: true }>("DELETE", `/api/scenarios/${id}`),
  evidence: (id: string) => call<{ observation: Observation; raw: unknown }>("GET", `/api/evidence/${id}`),
  describe: (text: string, opts: { today: string; tripId?: string }) => call<DescribeResult>("POST", "/api/describe", { text, ...opts }),
  suggestPlaces: (query: string) =>
    call<{ query: string; provider: "serpapi" | "mock"; observedAt: string; candidates: PlaceCandidate[] }>("POST", "/api/places/suggest", { query }),
  setFaults: (f: Record<string, string | undefined>) => call("POST", "/api/dev/faults", f),
};
