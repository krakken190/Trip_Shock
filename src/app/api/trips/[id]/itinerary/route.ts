import { handle } from "@/server/http";
import { itineraryFor } from "@/server/itinerary";
import { renderItineraryPdf } from "@/server/itinerary-pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** "Singapore & Bali" → "Singapore-Bali-itinerary.pdf" (ASCII fallback for old clients) */
function filename(name: string) {
  const ascii = name.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-") || "trip";
  return `${ascii}-itinerary.pdf`;
}

/**
 * GET /api/trips/{id}/itinerary?scenario={scenarioId}&format=json|pdf
 * The finalized plan (baseline, or a saved what-if adopted as final) as a downloadable PDF,
 * or as JSON for the finalize dialog's preview and readiness check.
 */
export const GET = handle(async (req, { id }) => {
  const url = new URL(req.url);
  const it = itineraryFor(id, url.searchParams.get("scenario"));
  if (url.searchParams.get("format") === "json") return it;

  const pdf = await renderItineraryPdf(it);
  const name = filename(it.trip.name);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-length": String(pdf.length),
      "content-disposition": `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(`${it.trip.name} - itinerary.pdf`)}`,
      "cache-control": "no-store",
    },
  });
});
