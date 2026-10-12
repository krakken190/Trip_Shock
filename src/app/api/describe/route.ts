import { z } from "zod";
import { airportCity } from "@/domain/airports";
import { sortNodes, nodeTitle } from "@/domain/graph";
import { draftToPlan } from "@/domain/trip-draft";
import { body, handle } from "@/server/http";
import { extractTripDraft, LlmError, llmConfig } from "@/server/llm";
import * as repo from "@/server/repo";
import { HttpError } from "@/server/service";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Body = z.object({
  text: z.string().trim().min(8, "Describe the trip in a sentence or two").max(3000),
  /** The traveller's local date, so "next Friday" resolves in their time zone */
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** When adding to an existing trip */
  tripId: z.string().optional(),
});

/** Natural language → editable draft plan. Nothing is saved; the client confirms first. */
export const POST = handle(async (req) => {
  if (!llmConfig().enabled) throw new HttpError(503, "Trip description needs OPENROUTER_API_KEY in .env.local");
  const { text, today, tripId } = Body.parse(await body(req));

  let context: string | undefined;
  if (tripId) {
    const trip = repo.getTrip(tripId);
    if (!trip) throw new HttpError(404, "Trip not found");
    context = sortNodes(trip.nodes)
      .map((n) => `- ${n.kind} ${nodeTitle(n)}${n.kind === "flight" ? ` (${airportCity(n.from)} → ${airportCity(n.to)})` : ""}: ${n.start}${n.end !== n.start ? ` → ${n.end}` : ""}`)
      .join("\n");
  }

  try {
    const r = await extractTripDraft(text, today ?? new Date().toISOString().slice(0, 10), context);
    return { plan: draftToPlan(r.draft), model: r.model, ms: r.ms, fallbacksUsed: r.attempts.length };
  } catch (e) {
    if (e instanceof LlmError) throw new HttpError(502, e.message, e.attempts);
    throw e;
  }
});
