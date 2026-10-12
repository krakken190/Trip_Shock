import { parseScenario } from "@/domain/parse";
import { ScenarioInput } from "@/domain/types";
import { body, handle } from "@/server/http";
import * as repo from "@/server/repo";
import { baselineView, createScenario, HttpError } from "@/server/service";

export const dynamic = "force-dynamic";

export const GET = handle((_req, { id }) => baselineView(id).scenarios);

/**
 * Body: { ops: Operation[], policy?, name?, prompt? } — or only { prompt } to have the server
 * parse natural language into operations. Add ?refresh=0 to skip the initial searches.
 */
export const POST = handle(async (req, { id }) => {
  const raw = (await body(req)) as Record<string, unknown>;
  if (!raw.ops && typeof raw.prompt === "string") {
    const trip = repo.getTrip(id);
    if (!trip) throw new HttpError(404, "Trip not found");
    const parsed = parseScenario(raw.prompt, trip.nodes);
    if (!parsed.ok) throw new HttpError(422, parsed.error);
    raw.ops = parsed.ops;
    raw.policy ??= { downstream: parsed.policy ?? "shift" };
  }
  const refresh = new URL(req.url).searchParams.get("refresh") !== "0";
  return createScenario(id, ScenarioInput.parse(raw), { refresh });
});
