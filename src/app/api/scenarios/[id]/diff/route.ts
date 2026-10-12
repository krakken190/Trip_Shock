import { handle } from "@/server/http";
import { scenarioView } from "@/server/service";

export const dynamic = "force-dynamic";

export const GET = handle((_req, { id }) => {
  const v = scenarioView(id);
  return { scenarioId: id, aggregate: v.diff.aggregate, fields: v.diff.fields, conflicts: v.conflicts };
});
