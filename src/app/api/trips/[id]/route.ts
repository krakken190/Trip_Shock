import { TripInput } from "@/domain/types";
import { body, handle } from "@/server/http";
import * as repo from "@/server/repo";
import { baselineView, HttpError, updateTrip } from "@/server/service";

export const dynamic = "force-dynamic";

export const GET = handle((_req, { id }) => baselineView(id));

export const PUT = handle(async (req, { id }) => {
  updateTrip(id, TripInput.parse(await body(req)));
  return baselineView(id);
});

export const DELETE = handle((_req, { id }) => {
  if (!repo.deleteTrip(id)) throw new HttpError(404, "Trip not found");
  return { ok: true };
});
