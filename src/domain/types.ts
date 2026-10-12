import { z } from "zod";

export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
export const Anchor = z.enum(["start", "end"]);
export type Anchor = z.infer<typeof Anchor>;

export const Cabin = z.enum(["economy", "premium_economy", "business", "first"]);
export type Cabin = z.infer<typeof Cabin>;

const nodeBase = {
  id: z.string().min(1),
  start: IsoDate,
  end: IsoDate,
  /** Fixed nodes never move automatically; changes that would move them surface as conflicts. */
  fixed: z.boolean().default(false),
  notes: z.string().max(500).optional(),
};

export const PreferredFlight = z.object({
  airline: z.string(),
  flightNumbers: z.array(z.string()).min(1),
  departTime: z.string().optional(),
});
export type PreferredFlight = z.infer<typeof PreferredFlight>;

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "24h time HH:MM");

/** Time window the traveller asked for ("leave after 6pm", "arrive before noon"). Local airport times. */
export const TimePreference = z.object({
  departAfter: HHMM.nullable().optional(),
  departBefore: HHMM.nullable().optional(),
  arriveBefore: HHMM.nullable().optional(),
});
export type TimePreference = z.infer<typeof TimePreference>;

export const HotelTier = z.enum(["budget", "mid", "luxury"]);
export type HotelTier = z.infer<typeof HotelTier>;

/** What kind of hotel the traveller wants when no specific property is named. */
export const HotelBudget = z.object({
  tier: HotelTier.nullable().optional(),
  /** Only set when the traveller stated a number — never inferred from the tier. */
  maxPerNight: z.number().positive().nullable().optional(),
});
export type HotelBudget = z.infer<typeof HotelBudget>;

export const FlightNode = z.object({
  ...nodeBase,
  kind: z.literal("flight"),
  from: z.string().regex(/^[A-Z]{3}$/, "3-letter IATA code"),
  to: z.string().regex(/^[A-Z]{3}$/, "3-letter IATA code"),
  cabin: Cabin.default("economy"),
  /** When set, refreshes try to find this exact flight on the new date before falling back. */
  preferredFlight: PreferredFlight.nullable().optional(),
  timePreference: TimePreference.nullable().optional(),
});

export const StayNode = z.object({
  ...nodeBase,
  kind: z.literal("stay"),
  city: z.string().min(1),
  /** Specific property; when empty the estimate uses the cheapest well-rated option. */
  hotelName: z.string().nullable().optional(),
  budget: HotelBudget.nullable().optional(),
});

export const ActivityNode = z.object({
  ...nodeBase,
  kind: z.literal("activity"),
  name: z.string().min(1),
  city: z.string().min(1),
  /** Query used to look up opening-hours evidence. */
  placeQuery: z.string().min(1),
  estimatedCost: z.number().nonnegative().nullable().optional(),
});

export const TransferNode = z.object({
  ...nodeBase,
  kind: z.literal("transfer"),
  from: z.string().min(1),
  to: z.string().min(1),
  mode: z.enum(["taxi", "train", "shuttle", "ferry", "other"]).default("taxi"),
  /** User estimate. Transfers have no live data source in the MVP. */
  estimatedCost: z.number().nonnegative().nullable().optional(),
});

export const TripNode = z.discriminatedUnion("kind", [FlightNode, StayNode, ActivityNode, TransferNode]);
export type FlightNode = z.infer<typeof FlightNode>;
export type StayNode = z.infer<typeof StayNode>;
export type ActivityNode = z.infer<typeof ActivityNode>;
export type TransferNode = z.infer<typeof TransferNode>;
export type TripNode = z.infer<typeof TripNode>;
export type NodeKind = TripNode["kind"];

export const EdgeKind = z.enum([
  "arrival_checkin", // flight arrival → hotel check-in
  "checkout_departure", // hotel checkout → next flight
  "sequence", // any other consecutive spine items
  "activity_in_stay", // activity scheduled relative to a stay's check-in
  "transfer_after_arrival", // transfer relative to a flight arrival
  "transfer_before_departure", // transfer to the airport ahead of a flight
]);
export type EdgeKind = z.infer<typeof EdgeKind>;

export const Edge = z.object({
  id: z.string(),
  kind: EdgeKind,
  from: z.object({ node: z.string(), anchor: Anchor }),
  to: z.object({ node: z.string(), anchor: Anchor }),
  /** Baseline day offset: to.anchor = from.anchor + lag */
  lag: z.number().int(),
  /**
   * couple: moving either side moves the other (flight ⇄ hotel on the trip spine).
   * follow: only `to` follows `from` (an activity follows its stay, never the reverse).
   */
  mode: z.enum(["couple", "follow"]),
});
export type Edge = z.infer<typeof Edge>;

export const Travelers = z.object({
  adults: z.number().int().min(1).max(9),
  children: z.number().int().min(0).max(8).default(0),
});
export type Travelers = z.infer<typeof Travelers>;

export const TripInput = z.object({
  name: z.string().min(1).max(120),
  travelers: Travelers,
  nodes: z.array(TripNode).max(60),
});
export type TripInput = z.infer<typeof TripInput>;

export interface Trip extends TripInput {
  id: string;
  currency: "INR";
  edges: Edge[];
  /** Bumped on every baseline edit; scenarios record which revision they branched from. */
  revision: number;
  /** nodeId → latest observation id (evidence) for the baseline */
  observations: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Scenario operations

export const ShiftTripOp = z.object({ op: z.literal("shift_trip"), days: z.number().int().min(-60).max(60) });
export const ResizeStayOp = z.object({
  op: z.literal("resize_stay"),
  nodeId: z.string(),
  nights: z.number().int().min(-30).max(30),
});
export const MoveFlightOp = z.object({ op: z.literal("move_flight"), nodeId: z.string(), date: IsoDate });
export const Operation = z.discriminatedUnion("op", [ShiftTripOp, ResizeStayOp, MoveFlightOp]);
export type Operation = z.infer<typeof Operation>;

export const Policy = z.object({
  /**
   * shift: later items move with the change (trip gets longer/shorter).
   * absorb: the next stay stretches/shrinks so the rest of the trip keeps its dates.
   */
  downstream: z.enum(["shift", "absorb"]).default("shift"),
});
export type Policy = z.infer<typeof Policy>;

export const ScenarioInput = z.object({
  name: z.string().min(1).max(120).optional(),
  prompt: z.string().max(300).optional(),
  ops: z.array(Operation).min(1).max(10),
  policy: Policy.default({ downstream: "shift" }),
});
export type ScenarioInput = z.infer<typeof ScenarioInput>;

export interface Scenario {
  id: string;
  tripId: string;
  name: string;
  prompt?: string;
  ops: Operation[];
  policy: Policy;
  baseRevision: number;
  observations: Record<string, string>;
  lastRefreshedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Evidence (observations). Normalized — never provider JSON shapes.

export interface FlightOption {
  airline: string;
  flightNumbers: string[];
  departTime: string; // "2026-11-10 23:30" local airport time as reported
  arriveTime: string;
  durationMin: number;
  stops: number;
  price: number;
}

export interface FlightResult {
  type: "flight";
  price: number;
  currency: string;
  match: "preferred" | "cheapest";
  /** Only meaningful when the node has a preferred flight */
  preferredFound: boolean | null;
  /** null = no time window requested; false = nothing fit the window, cheapest overall shown */
  timeWindowMatched?: boolean | null;
  option: FlightOption;
  alternatives: FlightOption[];
  optionsCount: number;
  lowestPrice: number;
}

export interface HotelOption {
  name: string;
  total: number;
  perNight: number;
  rating: number | null;
  stars: number | null;
  token: string | null;
}

export interface HotelResult {
  type: "hotel";
  total: number;
  perNight: number;
  nights: number;
  currency: string;
  match: "named" | "cheapest_rated";
  /** Human-readable selection rule, e.g. "Cheapest budget option rated 3.5+" */
  rule?: string;
  hotel: HotelOption;
  alternatives: HotelOption[];
  optionsCount: number;
}

export interface PlaceResult {
  type: "place";
  name: string;
  address: string | null;
  /** null = the source returned no opening-hours evidence */
  closedWeekdays: number[] | null;
  hours: Record<string, string> | null;
  rating: number | null;
}

export type ObservationResult = FlightResult | HotelResult | PlaceResult;

export type Engine = "google_flights" | "google_hotels" | "google_maps";

export interface Observation {
  id: string;
  provider: "serpapi" | "mock";
  engine: Engine;
  searchKey: string;
  params: Record<string, string | number>;
  observedAt: string; // ISO datetime
  status: "ok" | "no_results" | "error";
  error?: string;
  durationMs: number;
  result: ObservationResult | null;
  /** Human-readable reason for no_results, e.g. "Named hotel not found for these dates" */
  note?: string;
}

/** A place returned by a places search, offered to the traveller to pick from. */
export interface PlaceCandidate {
  name: string;
  rating: number | null;
  reviews: number | null;
  address: string | null;
  category: string | null;
}
