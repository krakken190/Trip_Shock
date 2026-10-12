import { z } from "zod";
import { tripSummary } from "@/domain/graph";
import { sampleTrip } from "@/domain/sample";
import { TripInput } from "@/domain/types";
import { body, handle } from "@/server/http";
import * as repo from "@/server/repo";
import { baselineView, createTrip } from "@/server/service";

export const dynamic = "force-dynamic";

export const GET = handle(() =>
  repo.listTrips().map((t) => {
    const v = baselineView(t.id);
    return {
      id: t.id,
      name: t.name,
      travelers: t.travelers,
      ...tripSummary(t.nodes),
      items: t.nodes.length,
      scenarios: v.scenarios.length,
      observedTotal: v.totals.observed,
      missing: v.totals.missing,
      updatedAt: t.updatedAt,
    };
  }),
);

/** Body: a TripInput, or { "sample": true } for the reference Delhi → Singapore → Bali trip. */
export const POST = handle(async (req) => {
  const b = await body(req);
  const input = z.object({ sample: z.literal(true) }).safeParse(b).success ? sampleTrip() : TripInput.parse(b);
  return createTrip(input);
});
