import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

// node:sqlite ships with Node ≥ 22.5 — no native build step. Loaded through getBuiltinModule so
// bundlers never try to resolve it.
const { DatabaseSync: Database } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scenarios (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS scenarios_trip ON scenarios(trip_id);
CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY,
  search_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  engine TEXT NOT NULL,
  status TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  data TEXT NOT NULL,
  raw TEXT
);
CREATE INDEX IF NOT EXISTS observations_key ON observations(search_key, provider, observed_at);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const g = globalThis as unknown as { __tripshockDb?: DatabaseSync };

export function db(): DatabaseSync {
  if (g.__tripshockDb) return g.__tripshockDb;
  const file = process.env.TRIPSHOCK_DB || path.join(process.cwd(), "data", "tripshock.db");
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const conn = new Database(file);
  conn.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;");
  conn.exec(SCHEMA);
  g.__tripshockDb = conn;
  return conn;
}
