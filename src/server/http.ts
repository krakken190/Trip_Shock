import { ZodError } from "zod";
import { HttpError } from "./service";

export type Ctx<P extends Record<string, string> = { id: string }> = { params: Promise<P> };

/** Wraps a route handler: JSON responses, typed errors, no stack traces leaked to clients. */
export function handle<P extends Record<string, string>>(fn: (req: Request, params: P) => unknown | Promise<unknown>) {
  return async (req: Request, ctx: Ctx<P>) => {
    try {
      const params = ctx?.params ? await ctx.params : ({} as P);
      const out = await fn(req, params);
      return out instanceof Response ? out : Response.json(out ?? { ok: true });
    } catch (e) {
      if (e instanceof HttpError) return Response.json({ error: e.message, details: e.details }, { status: e.status });
      if (e instanceof ZodError) return Response.json({ error: "Invalid request", details: e.issues }, { status: 422 });
      if (e instanceof SyntaxError) return Response.json({ error: "Malformed JSON" }, { status: 400 });
      console.error(e);
      return Response.json({ error: "Internal error" }, { status: 500 });
    }
  };
}

export async function body(req: Request): Promise<unknown> {
  const text = await req.text();
  return text ? JSON.parse(text) : {};
}
