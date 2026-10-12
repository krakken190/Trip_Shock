import { codesForPlace } from "./airports";
import { diffDays } from "./dates";
import { IsoDateFrom } from "./parse-date";
import { sortNodes } from "./graph";
import type { FlightNode, Operation, Policy, StayNode, TripNode } from "./types";

export type ParseResult =
  | { ok: true; ops: Operation[]; policy?: Policy["downstream"]; matched: string }
  | { ok: false; error: string };

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, single: 1, two: 2, couple: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, twelve: 12, fourteen: 14,
};

const NUM = String.raw`(\d{1,2}|a|an|one|single|two|couple(?: of)?|three|four|five|six|seven|eight|nine|ten|twelve|fourteen)`;

function num(s: string | undefined): number {
  if (!s) return 1;
  const t = s.replace(/ of$/, "").trim().toLowerCase();
  return /^\d+$/.test(t) ? Number(t) : (NUMBER_WORDS[t] ?? 1);
}

function unitDays(unit: string): number {
  return /week/.test(unit) ? 7 : 1;
}

function findStay(nodes: TripNode[], place: string): StayNode | undefined {
  const p = place.trim().toLowerCase();
  const stays = nodes.filter((n): n is StayNode => n.kind === "stay");
  const codes = codesForPlace(p);
  return (
    stays.find((s) => s.city.toLowerCase() === p) ??
    stays.find((s) => s.city.toLowerCase().includes(p) || p.includes(s.city.toLowerCase())) ??
    stays.find((s) => s.hotelName && s.hotelName.toLowerCase().includes(p)) ??
    stays.find((s) => codes.some((c) => codesForPlace(s.city).includes(c)))
  );
}

function findFlight(nodes: TripNode[], text: string): FlightNode | undefined {
  const flights = sortNodes(nodes.filter((n): n is FlightNode => n.kind === "flight"));
  if (!flights.length) return undefined;
  const t = text.toLowerCase();

  // "DEL → SIN", "del-sin", "sin to dps"
  const pair = /\b([a-z]{3})\s*(?:→|->|-|to)\s*([a-z]{3})\b/i.exec(text);
  if (pair) {
    const f = flights.find((x) => x.from === pair[1].toUpperCase() && x.to === pair[2].toUpperCase());
    if (f) return f;
  }
  if (/\b(return|home|back|last)\b/.test(t)) return flights[flights.length - 1];
  if (/\b(outbound|first|departure)\b/.test(t)) return flights[0];

  const to = /\b(?:to|into)\s+([a-z][a-z .]+?)(?=\s+(?:on|by|a|one|\d|to|$)|$)/i.exec(text)?.[1];
  if (to) {
    const codes = codesForPlace(to);
    const f = flights.find((x) => codes.includes(x.to));
    if (f) return f;
  }
  const from = /\b(?:from|out of|leaving)\s+([a-z][a-z .]+?)(?=\s+(?:on|by|a|one|\d|to|$)|$)/i.exec(text)?.[1];
  if (from) {
    const codes = codesForPlace(from);
    const f = flights.find((x) => codes.includes(x.from));
    if (f) return f;
  }
  // "the Bali flight"
  for (const f of flights) {
    for (const code of [f.to, f.from]) {
      const words = t.split(/[^a-z]+/).filter(Boolean);
      if (words.some((w) => codesForPlace(w).includes(code))) return f;
    }
  }
  return undefined;
}

/**
 * Deterministic natural-language → structured operation parser. Deliberately narrow: it either
 * produces an operation the user can see and confirm, or says it didn't understand.
 */
export function parseScenario(input: string, nodes: TripNode[]): ParseResult {
  const text = input.trim().replace(/[’']/g, "'").replace(/\s+/g, " ");
  const t = text.toLowerCase().replace(/^what if\s*/, "").replace(/[?.!]+$/, "");
  if (!t) return { ok: false, error: "Describe a change, e.g. “leave one day later”." };

  const policy: Policy["downstream"] | undefined = /\b(keep|same|without (?:changing|moving))\b.*\b(return|end|rest|flight home|last)\b/.test(t)
    ? "absorb"
    : /\b(push|shift|move) (?:the )?(rest|everything)\b/.test(t)
      ? "shift"
      : undefined;

  // --- Stay length -----------------------------------------------------------
  let m =
    new RegExp(String.raw`\b${NUM}?\s*(more|extra|additional|fewer|less)\s+nights?\s+(?:in|at|to|from)\s+(.+?)(?:\s+and\b.*)?$`).exec(t);
  if (m) {
    const stay = findStay(nodes, m[3]);
    if (!stay) return { ok: false, error: `No stay in “${m[3]}” on this trip.` };
    const n = num(m[1]);
    return { ok: true, ops: [{ op: "resize_stay", nodeId: stay.id, nights: /fewer|less/.test(m[2]) ? -n : n }], policy, matched: "resize_stay" };
  }
  m = new RegExp(String.raw`\b(extend|lengthen|shorten|cut|reduce|trim)\s+(?:the\s+|my\s+|our\s+)?(.+?)(?:\s+stay)?\s+by\s+${NUM}\s+(nights?|days?)`).exec(t);
  if (m) {
    const stay = findStay(nodes, m[2]);
    if (!stay) return { ok: false, error: `No stay in “${m[2]}” on this trip.` };
    const n = num(m[3]);
    return { ok: true, ops: [{ op: "resize_stay", nodeId: stay.id, nights: /extend|lengthen/.test(m[1]) ? n : -n }], policy, matched: "resize_stay" };
  }
  m = new RegExp(String.raw`\b(add|remove|drop)\s+${NUM}?\s*nights?\s+(?:in|at|to|from)\s+(.+?)$`).exec(t);
  if (m) {
    const stay = findStay(nodes, m[3]);
    if (!stay) return { ok: false, error: `No stay in “${m[3]}” on this trip.` };
    const n = num(m[2]);
    return { ok: true, ops: [{ op: "resize_stay", nodeId: stay.id, nights: m[1] === "add" ? n : -n }], policy, matched: "resize_stay" };
  }

  // --- Single flight to a date / by N days -------------------------------------
  const mentionsFlight =
    (/\b(fly|flight|return|come back|come home|head home)\b/.test(t) || /\b[a-z]{3}\s*(?:→|->)\s*[a-z]{3}\b/.test(t)) &&
    !/\b(whole|entire|all)\b/.test(t);
  if (mentionsFlight) {
    const flight = findFlight(nodes, t);
    if (flight) {
      const date = IsoDateFrom(t, flight.start);
      if (date) return { ok: true, ops: [{ op: "move_flight", nodeId: flight.id, date }], policy, matched: "move_flight" };
      const rel = new RegExp(String.raw`${NUM}\s+(days?|weeks?)\s+(later|earlier|after|before|early|sooner)`).exec(t) ??
        /\b()(day|week) (later|earlier|early|sooner)\b/.exec(t);
      if (rel) {
        const d = num(rel[1] || "1") * unitDays(rel[2]) * (/later|after/.test(rel[3]) ? 1 : -1);
        const target = shiftIso(flight.start, d);
        return { ok: true, ops: [{ op: "move_flight", nodeId: flight.id, date: target }], policy, matched: "move_flight" };
      }
    }
  }

  // --- Whole trip ----------------------------------------------------------------
  m = new RegExp(String.raw`${NUM}\s+(days?|weeks?)\s+(later|earlier|after|before|early|sooner)`).exec(t) ??
    /\b()(day|week) (later|earlier|early|sooner)\b/.exec(t);
  if (m) {
    const d = num(m[1] || "1") * unitDays(m[2]) * (/later|after/.test(m[3]) ? 1 : -1);
    return { ok: true, ops: [{ op: "shift_trip", days: d }], policy, matched: "shift_trip" };
  }
  m = new RegExp(String.raw`\b(?:delay|postpone|push(?: back)?|move|shift)\b.*?\bby\s+${NUM}\s+(days?|weeks?)`).exec(t);
  if (m) {
    const back = /\b(earlier|forward|ahead|bring)\b/.test(t) && !/\bdelay|postpone|push back\b/.test(t);
    return { ok: true, ops: [{ op: "shift_trip", days: num(m[1]) * unitDays(m[2]) * (back ? -1 : 1) }], policy, matched: "shift_trip" };
  }
  m = /\b(?:shift|move)\b.*?([+-]\d{1,2})\s*d(?:ays?)?\b/.exec(t) ?? /^([+-]\d{1,2})\s*d(?:ays?)?$/.exec(t);
  if (m) return { ok: true, ops: [{ op: "shift_trip", days: Number(m[1]) }], policy, matched: "shift_trip" };

  // "leave on Nov 12" → shift the whole trip so the first item starts then
  const first = sortNodes(nodes)[0];
  if (first && /\b(leave|depart|start|begin)\b/.test(t)) {
    const date = IsoDateFrom(t, first.start);
    if (date) return { ok: true, ops: [{ op: "shift_trip", days: diffDays(first.start, date) }], policy, matched: "shift_trip" };
  }

  return {
    ok: false,
    error: "Couldn't map that to a change. Try “leave 2 days later”, “one more night in Singapore” or “fly to Bali on Nov 15”.",
  };
}

function shiftIso(d: string, days: number): string {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day + days)).toISOString().slice(0, 10);
}
