import { planRefresh, searchFor, type RefreshPlan } from "@/domain/affected";
import { detectConflicts, markPreexisting, type Conflict, type PlaceEvidence } from "@/domain/constraints";
import { computeDiff, headlineFor, type TripDiff } from "@/domain/diff";
import { validateNodes } from "@/domain/graph";
import { applyOperations, describeOperation, type BlockedMove, type TraceStep } from "@/domain/propagate";
import type { Observation, Scenario, ScenarioInput, Travelers, Trip, TripInput, TripNode } from "@/domain/types";
import { getProvider, providerMode, type ProviderMode } from "./provider";
import { observeMany } from "./refresh";
import * as repo from "./repo";

export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly details?: unknown) {
    super(message);
  }
}

/** Observations bound to nodes, dropping any whose search no longer matches the node. */
function resolveObservations(nodes: TripNode[], binding: Record<string, string>, travelers: Travelers): Record<string, Observation> {
  const byId = repo.getObservations(Object.values(binding));
  const out: Record<string, Observation> = {};
  for (const n of nodes) {
    const o = byId[binding[n.id]];
    const s = searchFor(n, travelers);
    if (o && s && o.searchKey === s.key) out[n.id] = o;
  }
  return out;
}

function placeEvidence(nodes: TripNode[], obs: Record<string, Observation>): Record<string, PlaceEvidence> {
  const out: Record<string, PlaceEvidence> = {};
  for (const n of nodes) {
    const o = obs[n.id];
    if (n.kind === "activity" && o) out[n.id] = { evidenceId: o.id, result: o.status === "ok" && o.result?.type === "place" ? o.result : null };
  }
  return out;
}

// ---------------------------------------------------------------------------- baseline

export interface ScenarioSummary {
  id: string;
  name: string;
  prompt?: string;
  headline: string;
  opLabels: string[];
  delta: number | null;
  complete: boolean;
  conflicts: number;
  createdAt: string;
  lastRefreshedAt: string | null;
}

export interface BaselineView {
  trip: Trip;
  provider: ProviderMode;
  observations: Record<string, Observation>;
  /** For nodes whose latest search failed: the last successful observation, clearly historical */
  lastKnown: Record<string, Observation>;
  conflicts: Conflict[];
  totals: { observed: number | null; pricedNodes: number; missing: number; estimates: number };
  scenarios: ScenarioSummary[];
}

export function baselineView(tripId: string): BaselineView {
  const trip = repo.getTrip(tripId);
  if (!trip) throw new HttpError(404, "Trip not found");
  const observations = resolveObservations(trip.nodes, trip.observations, trip.travelers);
  const provider = providerMode();

  const lastKnown: Record<string, Observation> = {};
  for (const n of trip.nodes) {
    const o = observations[n.id];
    if (o && o.status === "error") {
      const lk = repo.lastSuccessfulObservation(o.searchKey, o.provider);
      if (lk) lastKnown[n.id] = lk;
    }
  }

  let observed = 0;
  let pricedNodes = 0;
  let missing = 0;
  let estimates = 0;
  for (const n of trip.nodes) {
    if (n.kind === "flight" || n.kind === "stay") {
      pricedNodes++;
      const r = observations[n.id]?.status === "ok" ? observations[n.id].result : null;
      if (r?.type === "flight") observed += r.price;
      else if (r?.type === "hotel") observed += r.total;
      else missing++;
    } else if (n.estimatedCost) estimates += n.estimatedCost;
  }

  return {
    trip,
    provider,
    observations,
    lastKnown,
    conflicts: detectConflicts(trip.nodes, trip.edges, placeEvidence(trip.nodes, observations)),
    totals: { observed: pricedNodes - missing > 0 ? observed : null, pricedNodes, missing, estimates },
    scenarios: repo.listScenarios(trip.id).map((s) => summarize(trip, s)),
  };
}

export function createTrip(input: TripInput): Trip {
  const issues = validateNodes(input.nodes);
  if (issues.length) throw new HttpError(422, "Invalid plan", issues);
  return repo.createTrip(input);
}

export function updateTrip(id: string, input: TripInput): Trip {
  const issues = validateNodes(input.nodes);
  if (issues.length) throw new HttpError(422, "Invalid plan", issues);
  const t = repo.updateTrip(id, input);
  if (!t) throw new HttpError(404, "Trip not found");
  return t;
}

/** Explicit refresh — always queries the provider (no cache) for the requested nodes. */
export async function refreshTrip(id: string, nodeIds?: string[]): Promise<BaselineView> {
  const trip = repo.getTrip(id);
  if (!trip) throw new HttpError(404, "Trip not found");
  const targets = nodeIds?.length ? trip.nodes.filter((n) => nodeIds.includes(n.id)) : trip.nodes;
  const obs = await observeMany(targets, trip.travelers, getProvider(), { force: true });
  repo.setTripObservations(id, Object.fromEntries(Object.entries(obs).map(([k, o]) => [k, o.id])));
  return baselineView(id);
}

// ---------------------------------------------------------------------------- scenarios

export interface ScenarioView {
  scenario: Scenario;
  trip: Trip;
  provider: ProviderMode;
  nodes: TripNode[];
  opLabels: string[];
  plan: RefreshPlan;
  baseObservations: Record<string, Observation>;
  scenarioObservations: Record<string, Observation>;
  conflicts: Conflict[];
  diff: TripDiff;
  trace: TraceStep[];
  blocked: BlockedMove[];
  errors: string[];
  /** Baseline changed after this scenario branched; results are recomputed on the current baseline */
  baseChanged: boolean;
}

function compute(trip: Trip, sc: Scenario) {
  const prop = applyOperations(trip.nodes, trip.edges, sc.ops, sc.policy);
  const plan = planRefresh(trip.nodes, prop.nodes, trip.travelers);
  const baseObs = resolveObservations(trip.nodes, trip.observations, trip.travelers);
  const ownObs = resolveObservations(prop.nodes, sc.observations, trip.travelers);
  const scenarioObs: Record<string, Observation> = {};
  for (const id of plan.reuse) if (baseObs[id]) scenarioObs[id] = baseObs[id];
  for (const id of plan.refetch) if (ownObs[id]) scenarioObs[id] = ownObs[id];

  const baseConflicts = detectConflicts(trip.nodes, trip.edges, placeEvidence(trip.nodes, baseObs));
  const conflicts = markPreexisting(detectConflicts(prop.nodes, trip.edges, placeEvidence(prop.nodes, scenarioObs)), baseConflicts);
  const held = new Set(prop.blocked.map((b) => b.nodeId));
  const diff = computeDiff({
    ops: sc.ops,
    baseNodes: trip.nodes,
    scenarioNodes: prop.nodes,
    baseObs,
    scenarioObs,
    plan,
    conflicts,
    reasons: prop.reasons,
    heldNodeIds: held,
    headline: headlineFor(sc.ops, trip.nodes),
  });
  return { prop, plan, baseObs, scenarioObs, conflicts, diff };
}

function summarize(trip: Trip, sc: Scenario): ScenarioSummary {
  const { diff } = compute(trip, sc);
  return {
    id: sc.id,
    name: sc.name,
    prompt: sc.prompt,
    headline: diff.aggregate.headline,
    opLabels: sc.ops.map((o) => describeOperation(o, trip.nodes)),
    delta: diff.aggregate.total.delta,
    complete: diff.aggregate.total.complete,
    conflicts: diff.aggregate.conflicts.new,
    createdAt: sc.createdAt,
    lastRefreshedAt: sc.lastRefreshedAt,
  };
}

export function scenarioView(id: string): ScenarioView {
  const sc = repo.getScenario(id);
  if (!sc) throw new HttpError(404, "Scenario not found");
  const trip = repo.getTrip(sc.tripId);
  if (!trip) throw new HttpError(404, "Trip not found");
  const { prop, plan, baseObs, scenarioObs, conflicts, diff } = compute(trip, sc);
  return {
    scenario: sc,
    trip,
    provider: providerMode(),
    nodes: prop.nodes,
    opLabels: sc.ops.map((o) => describeOperation(o, trip.nodes)),
    plan,
    baseObservations: baseObs,
    scenarioObservations: scenarioObs,
    conflicts,
    diff,
    trace: prop.trace,
    blocked: prop.blocked,
    errors: prop.errors,
    baseChanged: sc.baseRevision !== trip.revision,
  };
}

export async function createScenario(tripId: string, input: ScenarioInput, { refresh = true } = {}): Promise<ScenarioView> {
  const trip = repo.getTrip(tripId);
  if (!trip) throw new HttpError(404, "Trip not found");
  const { errors } = applyOperations(trip.nodes, trip.edges, input.ops, input.policy);
  if (errors.length) throw new HttpError(422, errors.join("; "));
  const name = input.name?.trim() || input.ops.map((o) => describeOperation(o, trip.nodes)).join(" · ");
  const sc = repo.createScenario(trip, { ...input, name });
  if (refresh) return refreshScenario(sc.id);
  return scenarioView(sc.id);
}

/**
 * Re-searches only the nodes whose search parameters differ from the baseline. Nodes with an
 * identical search reuse the baseline's evidence. Missing baseline evidence is filled first so
 * the comparison has a "before".
 */
export async function refreshScenario(id: string, { force = false } = {}): Promise<ScenarioView> {
  const sc = repo.getScenario(id);
  if (!sc) throw new HttpError(404, "Scenario not found");
  const trip = repo.getTrip(sc.tripId);
  if (!trip) throw new HttpError(404, "Trip not found");
  const provider = getProvider();

  const baseObs = resolveObservations(trip.nodes, trip.observations, trip.travelers);
  const missingBase = trip.nodes.filter((n) => !baseObs[n.id] && searchFor(n, trip.travelers));

  const prop = applyOperations(trip.nodes, trip.edges, sc.ops, sc.policy);
  const plan = planRefresh(trip.nodes, prop.nodes, trip.travelers);
  const refetch = prop.nodes.filter((n) => plan.refetch.includes(n.id));

  const [baseNew, scNew] = await Promise.all([
    observeMany(missingBase, trip.travelers, provider),
    observeMany(refetch, trip.travelers, provider, { force }),
  ]);
  if (Object.keys(baseNew).length) {
    repo.setTripObservations(trip.id, Object.fromEntries(Object.entries(baseNew).map(([k, o]) => [k, o.id])));
  }
  sc.observations = { ...sc.observations, ...Object.fromEntries(Object.entries(scNew).map(([k, o]) => [k, o.id])) };
  sc.lastRefreshedAt = new Date().toISOString();
  repo.saveScenario(sc);
  return scenarioView(id);
}

export function deleteScenario(id: string) {
  if (!repo.deleteScenario(id)) throw new HttpError(404, "Scenario not found");
}
