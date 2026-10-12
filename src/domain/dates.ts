// Calendar-day arithmetic on ISO dates (YYYY-MM-DD). Everything is computed in UTC
// so results never depend on the server or browser time zone.

const DAY_MS = 86_400_000;

export type ISODate = string;

export function parseISODate(d: ISODate): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) throw new Error(`Invalid ISO date: ${d}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function toISODate(ms: number): ISODate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(d: ISODate, days: number): ISODate {
  return toISODate(parseISODate(d) + days * DAY_MS);
}

/** b - a in whole days */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((parseISODate(b) - parseISODate(a)) / DAY_MS);
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(d: ISODate): number {
  return new Date(parseISODate(d)).getUTCDay();
}

export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 10" */
export function shortDate(d: ISODate): string {
  const dt = new Date(parseISODate(d));
  return `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
}

/** "Tue, Nov 10" */
export function dayLabel(d: ISODate): string {
  return `${WEEKDAY_NAMES[weekday(d)].slice(0, 3)}, ${shortDate(d)}`;
}

/** "Nov 10–13" or "Nov 30–Dec 2" */
export function rangeLabel(a: ISODate, b: ISODate): string {
  const da = new Date(parseISODate(a));
  const db = new Date(parseISODate(b));
  if (da.getUTCMonth() === db.getUTCMonth()) return `${shortDate(a)}–${db.getUTCDate()}`;
  return `${shortDate(a)}–${shortDate(b)}`;
}

export function signedDays(n: number, unit = "day"): string {
  const abs = Math.abs(n);
  return `${n > 0 ? "+" : n < 0 ? "−" : "±"}${abs} ${unit}${abs === 1 ? "" : "s"}`;
}
