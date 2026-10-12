import { diffDays, toISODate } from "./dates";



const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};
const MON = String.raw`(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?`;

/**
 * Finds an explicit calendar date in free text ("Nov 15", "15th November", "2026-11-15") and
 * resolves the year relative to a reference date in the trip. Returns null when none is present.
 */
export function IsoDateFrom(text: string, reference: string): string | null {
  const t = text.toLowerCase();
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  let month: number | undefined;
  let day: number | undefined;
  let m = new RegExp(String.raw`\b${MON}\s+(\d{1,2})(?:st|nd|rd|th)?\b`).exec(t);
  if (m) {
    month = MONTHS[m[1]];
    day = Number(m[2]);
  } else {
    m = new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?${MON}`).exec(t);
    if (m) {
      day = Number(m[1]);
      month = MONTHS[m[2]];
    }
  }
  if (month === undefined || !day || day > 31) return null;

  const refYear = Number(reference.slice(0, 4));
  let candidate = toISODate(Date.UTC(refYear, month, day));
  // Choose the year that puts the date closest to the trip
  if (diffDays(reference, candidate) < -180) candidate = toISODate(Date.UTC(refYear + 1, month, day));
  if (diffDays(reference, candidate) > 180) candidate = toISODate(Date.UTC(refYear - 1, month, day));
  return candidate;
}


