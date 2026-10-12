import { z } from "zod";
import { body, handle } from "@/server/http";
import { refreshScenario } from "@/server/service";

export const dynamic = "force-dynamic";

const Body = z.object({ force: z.boolean().optional() });

export const POST = handle(async (req, { id }) => refreshScenario(id, { force: Body.parse(await body(req)).force }));
