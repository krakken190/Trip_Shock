import { handle } from "@/server/http";
import { deleteScenario, scenarioView } from "@/server/service";

export const dynamic = "force-dynamic";

export const GET = handle((_req, { id }) => scenarioView(id));

export const DELETE = handle((_req, { id }) => {
  deleteScenario(id);
  return { ok: true };
});
