import { handle } from "@/server/http";
import { getObservationWithRaw } from "@/server/repo";
import { HttpError } from "@/server/service";

export const dynamic = "force-dynamic";

export const GET = handle((_req, { id }) => {
  const o = getObservationWithRaw(id);
  if (!o) throw new HttpError(404, "Evidence not found");
  return o;
});
