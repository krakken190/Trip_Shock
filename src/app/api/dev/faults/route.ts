import { z } from "zod";
import { body, handle } from "@/server/http";
import { providerMode, setFaults } from "@/server/provider";
import { HttpError } from "@/server/service";

export const dynamic = "force-dynamic";

const Fault = z.enum(["error", "empty"]).optional();
const Body = z.object({ flights: Fault, hotels: Fault, places: Fault });

/** Mock-provider fault injection, for demos and E2E tests. Disabled with a live provider. */
export const POST = handle(async (req) => {
  if (providerMode() !== "mock") throw new HttpError(403, "Fault injection is only available with the mock provider");
  const f = Body.parse(await body(req));
  setFaults(f);
  return { faults: f };
});
