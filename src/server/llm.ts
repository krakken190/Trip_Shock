import { WEEKDAY_NAMES, weekday } from "@/domain/dates";
import { TRIP_DRAFT_JSON_SCHEMA, TripDraft } from "@/domain/trip-draft";

// OpenRouter chat-completions client for turning a spoken/typed trip description into a TripDraft.
// Models are configured by env so they can be swapped without code changes:
//   OPENROUTER_API_KEY, OPENROUTER_MODEL, OPENROUTER_FALLBACK_MODELS (comma-separated)

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "qwen/qwen3.8-27b:free";
const TIMEOUT_MS = 45_000;

export function llmConfig() {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  const primary = process.env.OPENROUTER_MODEL?.trim() || DEFAULT_MODEL;
  const fallbacks = (process.env.OPENROUTER_FALLBACK_MODELS ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return { enabled: !!key, key, models: [...new Set([primary, ...fallbacks])] };
}

export class LlmError extends Error {
  constructor(message: string, readonly attempts: { model: string; error: string }[] = []) {
    super(message);
  }
}

function systemPrompt(today: string, context?: string) {
  return `You convert a traveller's description of a trip into structured JSON. The text may be dictated speech, informal, or mix English and Hindi.

Today is ${today} (${WEEKDAY_NAMES[weekday(today)]}). Currency is INR.

Rules:
- Only include what the traveller said or clearly implied. Never invent dates, hotels, places, prices, times or airports. Use null for anything not stated.
- Resolve relative dates ("next Friday", "on the 12th", "in two weeks") to YYYY-MM-DD from today. If the year is omitted, use the next future occurrence.
- Flights: one entry per one-way leg, in travel order. Add a return flight only if the traveller mentions returning, coming back, or a return date. Give the main IATA airport code only when confident (e.g. Pune PNQ, Mumbai BOM, Delhi DEL, Goa GOI, Bangkok BKK).
- Flight times: 24h HH:MM. "leave after 6 pm" → depart_after "18:00". "reach by noon" → arrive_before "12:00". "morning flight" → depart_after "06:00", depart_before "12:00". "evening" → depart_after "17:00", depart_before "22:00". "around 3 pm" → depart_after "14:00", depart_before "16:00".
- Cabin: economy / premium_economy / business / first, or null if not mentioned.
- Stays: check_in / check_out only if stated. budget_tier "budget" for budget/cheap/affordable/hostel, "mid" for mid-range/decent, "luxury" for luxury/5-star/premium. max_per_night_inr only if a nightly amount was stated ("under 3k a night" → 3000).
- Activities: set place_name only if a specific place was named. If only a type of activity was requested ("something adventurous", "beaches"), set interest and leave place_name null. near = area or landmark mentioned. count = number of suggestions wanted, if stated.
- Transfers: "taxi to the airport" with no other context means the trip's first departure: from "Home", to "<origin city> Airport" (a city name, not a code), date = that flight's date. "cab from the airport to the hotel" → from "<city> Airport", to "Hotel", date = the arrival date.
- source_text: copy the short phrase from the traveller's text that each item comes from.
- unmapped: list requests you understood but that fit no field (seat preference, meals, requests for cost estimates, visa help…).
- Adults/children: "me and my wife" = 2 adults; "family of four with two kids" = 2 adults, 2 children. Null if not stated.
${context ? `\nThe traveller is adding to an existing trip:\n${context}\n` : ""}
Respond with JSON only, matching the schema.`;
}

/** Pulls the JSON object out of a model reply that may include fences or reasoning tags. */
export function extractJson(content: string): unknown {
  let s = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1];
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No JSON object in model reply");
  return JSON.parse(s.slice(start, end + 1));
}

async function call(model: string, key: string, messages: unknown[], structured: boolean) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "TripShock",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0,
        max_tokens: 8000,
        // Reasoning models spend tokens thinking before answering; keep that short for extraction.
        reasoning: { effort: "low" },
        ...(structured
          ? {
              response_format: { type: "json_schema", json_schema: { name: "trip_draft", strict: true, schema: TRIP_DRAFT_JSON_SCHEMA } },
              provider: { require_parameters: true },
            }
          : { response_format: { type: "json_object" } }),
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string; code?: number; metadata?: { raw?: unknown } };
      choices?: { message?: { content?: string | null }; finish_reason?: string }[];
      model?: string;
    };
    if (!res.ok || body.error) {
      const raw = body.error?.metadata?.raw;
      const detail = typeof raw === "string" ? raw : raw ? JSON.stringify(raw) : "";
      const status = body.error?.code ?? res.status;
      return { ok: false as const, status, error: `${body.error?.message ?? `HTTP ${res.status}`}${detail ? ` — ${detail.slice(0, 200)}` : ""}` };
    }
    const choice = body.choices?.[0];
    const content = choice?.message?.content ?? "";
    if (!content.trim()) {
      return { ok: false as const, status: 200, error: `Empty reply${choice?.finish_reason ? ` (finish: ${choice.finish_reason})` : ""}` };
    }
    return { ok: true as const, content, model: body.model ?? model };
  } catch (e) {
    return { ok: false as const, status: 0, error: ctrl.signal.aborted ? `Timed out after ${TIMEOUT_MS / 1000}s` : (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tries each configured model in order. For each model: strict JSON-schema output first; if the
 * provider can't do structured output, plain JSON mode with the schema in the prompt. Output is
 * always validated before it's returned.
 */
export async function extractTripDraft(text: string, today: string, context?: string) {
  const cfg = llmConfig();
  if (!cfg.key) throw new LlmError("Trip description is not configured (OPENROUTER_API_KEY missing)");
  const attempts: { model: string; error: string }[] = [];
  const started = Date.now();

  for (const model of cfg.models) {
    for (const structured of [true, false]) {
      const messages = [
        {
          role: "system",
          content: structured ? systemPrompt(today, context) : `${systemPrompt(today, context)}\n\nJSON schema:\n${JSON.stringify(TRIP_DRAFT_JSON_SCHEMA)}`,
        },
        { role: "user", content: text },
      ];
      let r = await call(model, cfg.key, messages, structured);
      // Free models share an upstream pool; one short retry often gets through.
      if (!r.ok && r.status === 429) {
        await new Promise((res) => setTimeout(res, 2500));
        r = await call(model, cfg.key, messages, structured);
      }
      if (!r.ok) {
        attempts.push({ model: `${model}${structured ? "" : " (json mode)"}`, error: r.error });
        if (r.status === 401 || r.status === 402) throw new LlmError(`OpenRouter rejected the request: ${r.error}`, attempts);
        // Structured output unsupported or reply empty → retry this model in JSON mode; rate limits → next model
        if (structured && r.status !== 429) continue;
        break;
      }
      try {
        const draft = TripDraft.parse(extractJson(r.content));
        return { draft, model: r.model, ms: Date.now() - started, attempts };
      } catch (e) {
        attempts.push({ model, error: `Unreadable output: ${(e as Error).message.slice(0, 120)}` });
        if (structured) continue;
        break;
      }
    }
  }
  throw new LlmError("Couldn't understand the description with any configured model", attempts);
}
