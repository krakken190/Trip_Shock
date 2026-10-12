const inrFmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

export function inr(n: number | null | undefined): string {
  return n == null ? "—" : inrFmt.format(Math.round(n));
}

/** "+₹2,100", "−₹8,400", "₹0" */
export function signedInr(n: number | null | undefined): string {
  if (n == null) return "—";
  if (Math.round(n) === 0) return "₹0";
  return `${n > 0 ? "+" : "−"}${inrFmt.format(Math.abs(Math.round(n)))}`;
}

/** "23 Sep 2026, 14:05 IST" in the viewer's time zone */
export function timestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  })
    .format(new Date(iso))
    .replace(/ at /, ", ");
}

export function clock(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

export function relative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export type Freshness = "fresh" | "aging" | "stale";

/** Prices are volatile: under 1h fresh, under 6h aging, otherwise stale. */
export function freshness(iso: string | null | undefined, now = Date.now()): Freshness {
  if (!iso) return "stale";
  const h = (now - new Date(iso).getTime()) / 3_600_000;
  return h < 1 ? "fresh" : h < 6 ? "aging" : "stale";
}

export function duration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
}

/** "2026-11-10 23:30" → "23:30" */
export function hhmm(s: string): string {
  return s.split(" ")[1] ?? s;
}

export function plural(n: number, word: string, pluralWord = `${word}s`) {
  return `${n} ${n === 1 ? word : pluralWord}`;
}
