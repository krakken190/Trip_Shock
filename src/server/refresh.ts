import { searchFor, type SearchRequest } from "@/domain/affected";
import { selectFlight, selectHotel } from "@/domain/select";
import type { Observation, Travelers, TripNode } from "@/domain/types";
import type { TravelProvider } from "@/providers/types";
import { findFreshObservation, insertObservation, newId } from "./repo";

const CACHE_TTL_MS = Number(process.env.TRIPSHOCK_CACHE_TTL_MIN ?? 30) * 60_000;
const CONCURRENCY = 4;

/**
 * Runs (or reuses) the search a node needs and records the outcome as an observation.
 * Failures are recorded too — an error observation replaces the node's evidence so an older
 * price is never presented as current.
 */
export async function observeNode(
  node: TripNode,
  travelers: Travelers,
  provider: TravelProvider,
  { force = false }: { force?: boolean } = {},
): Promise<Observation | null> {
  const req = searchFor(node, travelers);
  if (!req) return null;
  if (!force) {
    const cached = findFreshObservation(req.key, provider.id, CACHE_TTL_MS);
    if (cached) return cached;
  }
  return runSearch(node, req, provider);
}

async function runSearch(node: TripNode, req: SearchRequest, provider: TravelProvider): Promise<Observation> {
  const started = Date.now();
  const base = {
    id: newId("ev"),
    provider: provider.id,
    engine: req.engine,
    searchKey: req.key,
    observedAt: new Date().toISOString(),
  } as const;

  try {
    if (req.engine === "google_flights") {
      const r = await provider.searchFlights(req);
      const pref = node.kind === "flight" ? node.preferredFlight : null;
      const result = selectFlight(r.options, pref, r.currency, req.time);
      const obs: Observation = {
        ...base,
        params: r.params,
        durationMs: Date.now() - started,
        status: result ? "ok" : "no_results",
        result,
        note: result ? undefined : "No flights returned for this date",
      };
      return insertObservation(obs, r.raw);
    }
    if (req.engine === "google_hotels") {
      const r = await provider.searchHotels(req);
      const { result, note } = selectHotel(r.options, req.hotelName, r.nights, r.currency, req.budget);
      const obs: Observation = {
        ...base,
        params: r.params,
        durationMs: Date.now() - started,
        status: result ? "ok" : "no_results",
        result,
        note,
      };
      return insertObservation(obs, r.raw);
    }
    const r = await provider.searchPlace(req);
    const obs: Observation = {
      ...base,
      params: r.params,
      durationMs: Date.now() - started,
      status: r.place ? "ok" : "no_results",
      result: r.place,
      note: r.place ? undefined : "Place not found",
    };
    return insertObservation(obs, r.raw);
  } catch (e) {
    const err = e as Error & { params?: Record<string, string | number> };
    const obs: Observation = {
      ...base,
      params: err.params ?? {},
      durationMs: Date.now() - started,
      status: "error",
      error: err.message || "Search failed",
      result: null,
    };
    return insertObservation(obs);
  }
}

/** Observes several nodes with bounded concurrency. Individual failures never reject the batch. */
export async function observeMany(
  nodes: TripNode[],
  travelers: Travelers,
  provider: TravelProvider,
  opts: { force?: boolean } = {},
): Promise<Record<string, Observation>> {
  const out: Record<string, Observation> = {};
  const queue = [...nodes];
  const worker = async () => {
    for (let n = queue.shift(); n; n = queue.shift()) {
      const o = await observeNode(n, travelers, provider, opts);
      if (o) out[n.id] = o;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, nodes.length) }, worker));
  return out;
}
