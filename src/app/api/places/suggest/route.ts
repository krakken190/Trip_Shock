import { z } from "zod";
import { body, handle } from "@/server/http";
import { getProvider } from "@/server/provider";
import { HttpError } from "@/server/service";

export const dynamic = "force-dynamic";

const Body = z.object({ query: z.string().trim().min(3).max(200) });

/** Real places for an interest ("adventure activities near Baga, Goa") — the traveller picks from these. */
export const POST = handle(async (req) => {
  const { query } = Body.parse(await body(req));
  const provider = getProvider();
  try {
    const r = await provider.suggestPlaces(query);
    return { query, provider: provider.id, observedAt: new Date().toISOString(), candidates: r.candidates.slice(0, 8) };
  } catch (e) {
    throw new HttpError(502, `Places search failed: ${(e as Error).message}`);
  }
});
