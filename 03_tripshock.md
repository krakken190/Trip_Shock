# TripShock — Dependency-Aware “What If?” Simulator for Trips

## 1. Product Summary

TripShock is a travel-plan simulator that answers:

> If I change one thing in my trip, what else changes?

Instead of generating a trip from scratch, TripShock models an existing trip as a dependency graph and uses current search data to recompute affected flights, hotel nights, activity constraints, and costs.

Example:

```text
Original
Delhi → Singapore → Bali
Total current estimate: ₹86,400

Scenario:
“What if we leave one day later?”
```

The product produces a **trip diff**, analogous to a code diff.

## 2. Problem

Travel plans are coupled systems.

Changing one date can affect:
- flight price;
- number and dates of hotel nights;
- hotel availability;
- transfer feasibility;
- attraction opening days;
- sequence of activities;
- downstream departure times.

Current travel tools make users manually redo searches.

TripShock makes dependencies explicit.

## 3. Target Users

- families;
- multi-city travelers;
- group-trip organizers;
- budget-sensitive travelers;
- travelers comparing date alternatives.

## 4. MVP User Story

A user creates/imports a simple multi-city plan:

```text
DEL → SIN | Nov 10
Singapore hotel | Nov 10–13
SIN → DPS | Nov 13
Bali hotel | Nov 13–17
DPS → DEL | Nov 17
```

Then enters:

> Move the whole trip one day later.

TripShock:
1. clones the baseline plan;
2. shifts the requested nodes;
3. propagates dependencies;
4. identifies which searches must refresh;
5. retrieves current flight/hotel options;
6. validates activity/date constraints when evidence exists;
7. shows a structured diff.

## 5. SerpApi Usage

Primary:
- Google Flights API;
- Google Flights Deals API for flexible alternatives;
- Google Hotels API;
- Google Maps / Search for activity/place data;
- Google Travel Explore API for optional alternatives.

Official references:
- https://serpapi.com/google-flights-api
- https://serpapi.com/google-flights-deals-api
- https://serpapi.com/google-hotels-api
- https://serpapi.com/google-travel-explore-api

## 6. Assumptions

- MVP accepts a manually entered plan. Calendar/email ingestion is not required.
- “Current price” is an observed search result at a timestamp, not a guaranteed booking quote.
- A plan node can be fixed or flexible.
- A scenario never mutates the baseline; it creates a branch.
- Opening-hours/activity constraints should only be enforced when current evidence is available.
- Weather is out of scope unless a weather provider is explicitly added.

## 7. Core Domain Model

```text
Trip
 ├── Segment: Flight
 ├── Stay: Hotel
 ├── Activity
 ├── Transfer
 └── Constraint
```

Each node has:
- start/end datetime;
- location;
- fixed/flexible flag;
- dependencies;
- observed cost;
- evidence timestamp;
- source metadata.

Example dependency edges:

```text
Flight Arrival
    |
    +--> Hotel Check-in
    |
    +--> Airport Transfer
    |
    +--> First Activity

Hotel Checkout
    |
    +--> Next Flight Departure
```

## 8. Architecture

```text
Baseline Trip
     |
     v
Dependency Graph Builder
     |
     v
Scenario Parser
     |
     v
Mutation Engine
     |
     v
Dependency Propagation
     |
     v
Affected-Node Detector
     |
     +---------+----------+
     |         |          |
     v         v          v
 Flights    Hotels    Activities/Search
     |         |          |
     +---------+----------+
               |
               v
       Scenario Snapshot
               |
               v
          Diff Engine
               |
               v
          Diff UI
```

Critical optimization: **only refetch affected nodes**.

## 9. Scenario Language

MVP can support structured scenario operations rather than open-ended language internally:

```json
{
  "operation": "shift_date",
  "scope": "entire_trip",
  "delta_days": 1
}
```

Other operations:
- change departure date;
- change one city duration;
- replace hotel;
- replace flight;
- delete activity;
- add budget ceiling.

Natural language can be parsed into these operations.

## 10. PRD — MVP

### P0

- manual trip builder;
- baseline snapshot;
- dependency graph;
- 3 scenario operations:
  - shift entire trip;
  - extend/shorten one city;
  - replace one flight date;
- current flight refresh;
- current hotel refresh;
- impact propagation;
- side-by-side scenario diff;
- explicit stale-data timestamps;
- partial failure handling;
- scenario save/restore.

### P1

- natural-language scenario parsing;
- attraction opening constraints;
- flexible-flight deal suggestions;
- route/transfer checks;
- multiple scenario comparison;
- optimize cheapest date shift within ±N days.

### Non-goals

- payment/booking;
- guarantee that fares remain available;
- full itinerary generation;
- automatic cancellation/rebooking;
- weather-dependent simulation unless another provider is added.

## 11. Diff Model

```json
{
  "node_id": "hotel_sin",
  "field": "estimated_total",
  "before": 18300,
  "after": 20400,
  "delta": 2100,
  "reason": "stay shifted to Nov 11–14",
  "evidence_ids": ["ev_441"]
}
```

Aggregate diff:

```text
+1 DAY

Flights             -₹8,400
Hotels               +₹2,100
Transfers            unchanged / unknown
Activities           1 constraint affected
-----------------------------
Observed total delta -₹6,300
```

Use “observed” or “estimated from current results,” not “you will save.”

## 12. UI

### Screen 1 — Baseline Builder

Timeline with cards:
- flight;
- stay;
- activity.

Each shows:
- date;
- location;
- current observed cost;
- refresh timestamp;
- fixed/flexible.

### Screen 2 — Scenario Workspace

Top:
> What if… [leave one day later]

or structured controls.

Center:
two timelines: **Baseline** and **Scenario**.

Right:
impact summary.

### Screen 3 — Dependency Inspector

Optional but useful:
graph view highlighting affected nodes in the scenario.

Example:

```text
DEL→SIN [changed]
   |
SIN hotel [changed]
   |
museum Tue [conflict]
   |
SIN→DPS [changed]
```

## 13. Backend Endpoints

```http
POST /api/trips
POST /api/trips/{id}/refresh
POST /api/trips/{id}/scenarios
GET  /api/scenarios/{id}
GET  /api/scenarios/{id}/diff
POST /api/scenarios/{id}/refresh
```

## 14. Data Freshness

Store:
- search timestamp;
- engine;
- exact parameters;
- returned option identifier where available.

The UI must visually mark stale prices.

Example:
> Flight price observed 23 Sep 2026, 14:05 IST.

## 15. End-to-End Tests

### E2E-01: Shift entire trip

Baseline has 2 flights + 2 hotel stays.

Shift +1 day.

Expected:
- dates propagate;
- only affected flights/hotels refetch;
- diff contains before/after and evidence.

### E2E-02: Extend one city by one night

Expected:
- first hotel's checkout moves;
- next flight/date relationship becomes affected;
- downstream items follow configured dependency policy.

### E2E-03: Locked node

Flight marked fixed.

Attempt entire-trip shift.

Expected:
- conflict is surfaced;
- fixed flight does not move automatically.

### E2E-04: Price search unavailable

Flights request fails.

Expected:
- dates still recompute;
- price becomes unavailable;
- scenario remains viewable;
- no previous price is mislabeled as current.

### E2E-05: Revert

Create scenario and delete it.

Expected:
- baseline remains unchanged.

## 16. Acceptance Criteria

- a user can create a baseline with flights and hotels;
- scenarios branch rather than mutate;
- dependency propagation is deterministic;
- affected-node detection prevents unnecessary searches;
- current data carries timestamps;
- scenario UI clearly distinguishes structural changes, observed price changes, conflicts, and unknowns;
- tests verify fixed-node conflicts, propagation, and provider failures.

## 17. Suggested Stack

- TypeScript or Python backend;
- graph model using NetworkX or an explicit adjacency list;
- SQLite/PostgreSQL;
- React/Next.js timeline UI;
- Playwright for E2E.

## 18. Build Order

1. Trip/node/edge schemas.
2. Baseline editor.
3. dependency propagation engine with no external API.
4. scenario branching.
5. flight adapter.
6. hotel adapter.
7. diff engine.
8. UI diff.
9. current-data refresh and timestamps.
10. activity constraints.


---

## Implementation Principles for the Coding Agent

1. Build the smallest end-to-end vertical slice first. A working path with real SerpApi data is more valuable than many mocked screens.
2. Keep all SerpApi calls behind a small provider/service layer. UI code must never call SerpApi directly.
3. Persist raw provider responses when useful for debugging, but expose normalized domain objects to the rest of the application.
4. Every derived conclusion shown to a user must keep provenance: which search result(s), timestamp, query, engine, and relevant fields produced it.
5. Treat search results as changing external data. Add retries, timeouts, caching, empty-state handling, and graceful degradation.
6. Never manufacture evidence when an engine returns no result. Show “insufficient evidence” instead.
7. Put secrets in environment variables. Never commit API keys.
8. Add a mock provider for deterministic tests, but maintain at least one opt-in live integration test.
9. Prefer a simple, polished UI over a large feature set.
10. Keep the architecture replaceable: domain logic should not depend on SerpApi response JSON shapes directly.
