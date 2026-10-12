import { getFaults, providerMode } from "@/server/provider";
import { handle } from "@/server/http";
import { llmConfig } from "@/server/llm";

export const dynamic = "force-dynamic";

export const GET = handle(() => ({
  provider: providerMode(),
  faults: getFaults(),
  cacheTtlMin: Number(process.env.TRIPSHOCK_CACHE_TTL_MIN ?? 30),
  nlp: (() => {
    const c = llmConfig();
    return { enabled: c.enabled, model: c.enabled ? c.models[0] : null };
  })(),
}));
