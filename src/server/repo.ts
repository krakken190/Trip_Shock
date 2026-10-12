import { randomBytes } from "node:crypto";
import { buildEdges } from "@/domain/graph";
import type { Observation, Scenario, ScenarioInput, Trip, TripInput } from "@/domain/types";
import { db } from "./db";

export const newId = (prefix: string) => `${prefix}_${randomBytes(6).toString("base64url").replace(/[-_]/g, "x").toLowerCase()}`;
const now = () => new Date().toISOString();

// ---------------------------------------------------------------------------- trips

export function createTrip(input: TripInput): Trip {
  const ts = now();
  const trip: Trip = {
    ...input,
    id: newId("trip"),
    currency: "INR",
    edges: buildEdges(input.nodes),
    revision: 1,
    observations: {},
    createdAt: ts,
    updatedAt: ts,
  };
  db().prepare("INSERT INTO trips (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)").run(trip.id, JSON.stringify(trip), ts, ts);
  return trip;
}

export function getTrip(id: string): Trip | null {
  const row = db().prepare("SELECT data FROM trips WHERE id = ?").get(id) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as Trip) : null;
}

export function listTrips(): Trip[] {
  const rows = db().prepare("SELECT data FROM trips ORDER BY updated_at DESC").all() as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as Trip);
}

function saveTrip(trip: Trip): Trip {
  trip.updatedAt = now();
  db().prepare("UPDATE trips SET data = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(trip), trip.updatedAt, trip.id);
  return trip;
}

/** Replaces the baseline plan. Edges are re-derived and the revision bumped. */
export function updateTrip(id: string, input: TripInput): Trip | null {
  const trip = getTrip(id);
  if (!trip) return null;
  const ids = new Set(input.nodes.map((n) => n.id));
  const observations = Object.fromEntries(Object.entries(trip.observations).filter(([k]) => ids.has(k)));
  return saveTrip({ ...trip, ...input, edges: buildEdges(input.nodes), revision: trip.revision + 1, observations });
}

export function setTripObservations(id: string, obs: Record<string, string>): Trip | null {
  const trip = getTrip(id);
  if (!trip) return null;
  trip.observations = { ...trip.observations, ...obs };
  return saveTrip(trip);
}

export function deleteTrip(id: string): boolean {
  db().prepare("DELETE FROM scenarios WHERE trip_id = ?").run(id);
  return db().prepare("DELETE FROM trips WHERE id = ?").run(id).changes > 0;
}

// ---------------------------------------------------------------------------- scenarios

export function createScenario(trip: Trip, input: ScenarioInput & { name: string }): Scenario {
  const ts = now();
  const sc: Scenario = {
    id: newId("sc"),
    tripId: trip.id,
    name: input.name,
    prompt: input.prompt,
    ops: input.ops,
    policy: input.policy,
    baseRevision: trip.revision,
    observations: {},
    lastRefreshedAt: null,
    createdAt: ts,
    updatedAt: ts,
  };
  db()
    .prepare("INSERT INTO scenarios (id, trip_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(sc.id, trip.id, JSON.stringify(sc), ts, ts);
  return sc;
}

export function getScenario(id: string): Scenario | null {
  const row = db().prepare("SELECT data FROM scenarios WHERE id = ?").get(id) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as Scenario) : null;
}

export function listScenarios(tripId: string): Scenario[] {
  const rows = db().prepare("SELECT data FROM scenarios WHERE trip_id = ? ORDER BY created_at DESC").all(tripId) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as Scenario);
}

export function saveScenario(sc: Scenario): Scenario {
  sc.updatedAt = now();
  db().prepare("UPDATE scenarios SET data = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(sc), sc.updatedAt, sc.id);
  return sc;
}

export function deleteScenario(id: string): boolean {
  return db().prepare("DELETE FROM scenarios WHERE id = ?").run(id).changes > 0;
}

// ---------------------------------------------------------------------------- observations

export function insertObservation(o: Observation, raw?: unknown): Observation {
  db()
    .prepare("INSERT INTO observations (id, search_key, provider, engine, status, observed_at, data, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(o.id, o.searchKey, o.provider, o.engine, o.status, o.observedAt, JSON.stringify(o), raw === undefined ? null : JSON.stringify(raw));
  return o;
}

export function getObservations(ids: string[]): Record<string, Observation> {
  const uniq = [...new Set(ids)].filter(Boolean);
  if (!uniq.length) return {};
  const rows = db()
    .prepare(`SELECT data FROM observations WHERE id IN (${uniq.map(() => "?").join(",")})`)
    .all(...uniq) as { data: string }[];
  return Object.fromEntries(rows.map((r) => {
    const o = JSON.parse(r.data) as Observation;
    return [o.id, o];
  }));
}

export function getObservationWithRaw(id: string): { observation: Observation; raw: unknown } | null {
  const row = db().prepare("SELECT data, raw FROM observations WHERE id = ?").get(id) as { data: string; raw: string | null } | undefined;
  return row ? { observation: JSON.parse(row.data), raw: row.raw ? JSON.parse(row.raw) : null } : null;
}

/** Latest successful observation for the same search, if younger than maxAgeMs. */
export function findFreshObservation(searchKey: string, provider: string, maxAgeMs: number): Observation | null {
  const since = new Date(Date.now() - maxAgeMs).toISOString();
  const row = db()
    .prepare("SELECT data FROM observations WHERE search_key = ? AND provider = ? AND status != 'error' AND observed_at >= ? ORDER BY observed_at DESC LIMIT 1")
    .get(searchKey, provider, since) as { data: string } | undefined;
  return row ? JSON.parse(row.data) : null;
}

/** Most recent successful observation regardless of age — used to show "last known" beside failures. */
export function lastSuccessfulObservation(searchKey: string, provider: string): Observation | null {
  const row = db()
    .prepare("SELECT data FROM observations WHERE search_key = ? AND provider = ? AND status = 'ok' ORDER BY observed_at DESC LIMIT 1")
    .get(searchKey, provider) as { data: string } | undefined;
  return row ? JSON.parse(row.data) : null;
}

// ---------------------------------------------------------------------------- settings

export function getSetting<T>(key: string, fallback: T): T {
  const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : fallback;
}

export function setSetting(key: string, value: unknown) {
  db().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));
}
