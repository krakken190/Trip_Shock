// Small offline lookup used only for labels and for resolving city names in scenario text.
// Searches always use the IATA code the user entered.
export const AIRPORTS: Record<string, { city: string; aliases?: string[] }> = {
  DEL: { city: "Delhi", aliases: ["new delhi"] },
  BOM: { city: "Mumbai", aliases: ["bombay"] },
  BLR: { city: "Bengaluru", aliases: ["bangalore"] },
  MAA: { city: "Chennai", aliases: ["madras"] },
  CCU: { city: "Kolkata", aliases: ["calcutta"] },
  HYD: { city: "Hyderabad" },
  GOI: { city: "Goa" },
  COK: { city: "Kochi", aliases: ["cochin"] },
  AMD: { city: "Ahmedabad" },
  PNQ: { city: "Pune" },
  SIN: { city: "Singapore" },
  DPS: { city: "Bali", aliases: ["denpasar"] },
  CGK: { city: "Jakarta" },
  BKK: { city: "Bangkok" },
  HKT: { city: "Phuket" },
  KUL: { city: "Kuala Lumpur", aliases: ["kl"] },
  HAN: { city: "Hanoi" },
  SGN: { city: "Ho Chi Minh City", aliases: ["saigon", "ho chi minh"] },
  MNL: { city: "Manila" },
  HKG: { city: "Hong Kong" },
  TPE: { city: "Taipei" },
  ICN: { city: "Seoul" },
  NRT: { city: "Tokyo", aliases: ["narita"] },
  HND: { city: "Tokyo", aliases: ["haneda"] },
  KIX: { city: "Osaka" },
  DXB: { city: "Dubai" },
  AUH: { city: "Abu Dhabi" },
  DOH: { city: "Doha" },
  MLE: { city: "Malé", aliases: ["male", "maldives"] },
  CMB: { city: "Colombo", aliases: ["sri lanka"] },
  KTM: { city: "Kathmandu" },
  IST: { city: "Istanbul" },
  LHR: { city: "London", aliases: ["heathrow"] },
  CDG: { city: "Paris" },
  AMS: { city: "Amsterdam" },
  FRA: { city: "Frankfurt" },
  ZRH: { city: "Zurich" },
  FCO: { city: "Rome" },
  BCN: { city: "Barcelona" },
  JFK: { city: "New York", aliases: ["nyc"] },
  SFO: { city: "San Francisco" },
  LAX: { city: "Los Angeles", aliases: ["la"] },
  SYD: { city: "Sydney" },
  MEL: { city: "Melbourne" },
};

export function airportCity(code: string): string {
  return AIRPORTS[code]?.city ?? code;
}

/** Codes whose city or alias matches the text (case-insensitive) */
export function codesForPlace(text: string): string[] {
  const t = text.trim().toLowerCase();
  if (/^[a-z]{3}$/.test(t) && AIRPORTS[t.toUpperCase()]) return [t.toUpperCase()];
  return Object.entries(AIRPORTS)
    .filter(([, a]) => a.city.toLowerCase() === t || a.aliases?.includes(t))
    .map(([code]) => code);
}
