import { z } from "zod";
import { body, handle } from "@/server/http";
import { refreshTrip } from "@/server/service";

export const dynamic = "force-dynamic";

const Body = z.object({ nodeIds: z.array(z.string()).optional() });

export const POST = handle(async (req, { id }) => refreshTrip(id, Body.parse(await body(req)).nodeIds));
