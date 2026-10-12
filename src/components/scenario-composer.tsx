"use client";

import { ArrowRight, Check, CornerDownLeft, Minus, Plus, SlidersHorizontal, Sparkles, Type } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { planRefresh } from "@/domain/affected";
import { signedDays } from "@/domain/dates";
import { nodeTitle, sortNodes } from "@/domain/graph";
import { parseScenario } from "@/domain/parse";
import { applyOperations, describeOperation } from "@/domain/propagate";
import type { Operation, Policy, Trip } from "@/domain/types";
import { plural } from "@/lib/format";
import { suggestPrompts } from "./baseline-tab";
import { Badge, Button, Card, cx, Field, Input, Segmented, Select, Spinner } from "./ui";

type Mode = "text" | "structured";
type OpKind = Operation["op"];

export function ScenarioComposer({
  trip,
  initialPrompt,
  running,
  onRun,
}: {
  trip: Trip;
  initialPrompt?: string | null;
  running: boolean;
  onRun: (input: { ops: Operation[]; policy: Policy; prompt?: string }) => void;
}) {
  const [mode, setMode] = useState<Mode>("text");
  const [text, setText] = useState(initialPrompt ?? "");
  const [policy, setPolicy] = useState<Policy["downstream"]>("shift");
  const [policyTouched, setPolicyTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const stays = useMemo(() => sortNodes(trip.nodes).filter((n) => n.kind === "stay"), [trip.nodes]);
  const flights = useMemo(() => sortNodes(trip.nodes).filter((n) => n.kind === "flight"), [trip.nodes]);

  // Structured state
  const [opKind, setOpKind] = useState<OpKind>("shift_trip");
  const [days, setDays] = useState(1);
  const [stayId, setStayId] = useState(stays[0]?.id ?? "");
  const [nights, setNights] = useState(1);
  const [flightId, setFlightId] = useState(flights[0]?.id ?? "");
  const [flightDate, setFlightDate] = useState(flights[0]?.start ?? "");

  useEffect(() => {
    if (initialPrompt) {
      setText(initialPrompt);
      setMode("text");
    }
    inputRef.current?.focus();
  }, [initialPrompt]);

  const parsed = useMemo(() => (text.trim() ? parseScenario(text, trip.nodes) : null), [text, trip.nodes]);
  useEffect(() => {
    if (parsed?.ok && parsed.policy && !policyTouched) setPolicy(parsed.policy);
  }, [parsed, policyTouched]);

  const structuredOps: Operation[] | null = useMemo(() => {
    if (opKind === "shift_trip") return days ? [{ op: "shift_trip", days }] : null;
    if (opKind === "resize_stay") return stayId && nights ? [{ op: "resize_stay", nodeId: stayId, nights }] : null;
    const f = flights.find((x) => x.id === flightId);
    return f && flightDate && flightDate !== f.start ? [{ op: "move_flight", nodeId: flightId, date: flightDate }] : null;
  }, [opKind, days, stayId, nights, flightId, flightDate, flights]);

  const ops = mode === "text" ? (parsed?.ok ? parsed.ops : null) : structuredOps;
  const usesPolicy = !!ops?.some((o) => o.op !== "shift_trip");

  // Live, client-side preview — the propagation engine is pure, so we can run it on every keystroke.
  const preview = useMemo(() => {
    if (!ops) return null;
    const r = applyOperations(trip.nodes, trip.edges, ops, { downstream: policy });
    if (r.errors.length) return { error: r.errors.join("; ") };
    const plan = planRefresh(trip.nodes, r.nodes, trip.travelers);
    const moved = r.nodes.filter((n) => {
      const b = trip.nodes.find((x) => x.id === n.id)!;
      return b.start !== n.start || b.end !== n.end;
    });
    return { moved, plan, held: [...new Set(r.blocked.map((b) => b.nodeId))] };
  }, [ops, policy, trip]);

  const submit = () => {
    if (!ops || running || (preview && "error" in preview)) return;
    onRun({ ops, policy: { downstream: policy }, prompt: mode === "text" ? text.trim() : undefined });
  };

  const suggestions = suggestPrompts(trip.nodes);

  return (
    <div className="mx-auto max-w-[760px] py-4">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-xl bg-ink text-[#facc15] shadow-pop">
          <Sparkles className="size-5" />
        </div>
        <h2 className="text-[22px] font-semibold tracking-[-0.015em]">What if you change one thing?</h2>
        <p className="mt-1 text-[13.5px] text-muted">The baseline stays untouched. TripShock branches it, propagates dependencies and re-searches only what changed.</p>
      </div>

      <Card className="overflow-hidden shadow-pop">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <Segmented
            size="sm"
            value={mode}
            onChange={setMode}
            options={[
              { value: "text", label: "Describe it", icon: <Type className="size-3" /> },
              { value: "structured", label: "Structured", icon: <SlidersHorizontal className="size-3" /> },
            ]}
          />
          <span className="text-[11.5px] text-faint">{mode === "text" ? "Parsed locally into a structured change" : "Pick an operation"}</span>
        </div>

        {mode === "text" ? (
          <div className="p-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
              className="flex items-center gap-3 rounded-xl border border-line-strong bg-surface px-4 shadow-card focus-within:border-brand focus-within:ring-3 focus-within:ring-brand/15"
            >
              <span className="shrink-0 text-[16px] font-medium text-muted">What if…</span>
              <input
                ref={inputRef}
                data-testid="whatif-input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="we leave one day later"
                className="h-13 min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-faint"
              />
              <CornerDownLeft className="size-4 shrink-0 text-faint" />
            </form>
            <div className="mt-3 flex min-h-6 flex-wrap items-center gap-1.5">
              {parsed == null ? (
                suggestions.map((s) => (
                  <button key={s} onClick={() => setText(s)} className="rounded-full border border-line bg-surface px-2.5 py-1 text-[12.5px] text-ink-2 transition-colors hover:border-line-strong hover:bg-sunken">
                    {s}
                  </button>
                ))
              ) : parsed.ok ? (
                <span className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-ink-2">
                  <Check className="size-3.5 text-down" /> Understood as
                  {parsed.ops.map((o, i) => (
                    <Badge key={i} tone="dark" className="font-mono">
                      {describeOperation(o, trip.nodes)}
                    </Badge>
                  ))}
                </span>
              ) : (
                <span className="text-[12.5px] text-warn">{parsed.error}</span>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4 p-4">
            <Segmented
              className="w-full"
              value={opKind}
              onChange={setOpKind}
              options={[
                { value: "shift_trip", label: "Shift whole trip" },
                { value: "resize_stay", label: "Change a stay's length" },
                { value: "move_flight", label: "Move one flight" },
              ]}
            />
            {opKind === "shift_trip" && (
              <Field label="Shift every item by">
                <Stepper value={days} onChange={setDays} min={-14} max={14} format={(v) => signedDays(v)} />
              </Field>
            )}
            {opKind === "resize_stay" && (
              <div className="grid grid-cols-[1fr_auto] gap-3">
                <Field label="Stay">
                  <Select value={stayId} onChange={(e) => setStayId(e.target.value)}>
                    {stays.map((s) => (
                      <option key={s.id} value={s.id}>
                        {nodeTitle(s)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Nights">
                  <Stepper value={nights} onChange={setNights} min={-10} max={10} format={(v) => signedDays(v, "night")} />
                </Field>
              </div>
            )}
            {opKind === "move_flight" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Flight">
                  <Select
                    value={flightId}
                    onChange={(e) => {
                      setFlightId(e.target.value);
                      setFlightDate(flights.find((f) => f.id === e.target.value)?.start ?? "");
                    }}
                  >
                    {flights.map((f) => (
                      <option key={f.id} value={f.id}>
                        {nodeTitle(f)} · {f.start}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="New departure date">
                  <Input type="date" value={flightDate} onChange={(e) => setFlightDate(e.target.value)} />
                </Field>
              </div>
            )}
          </div>
        )}

        <div className="border-t border-line bg-canvas/70 px-4 py-3">
          <div className={cx("flex flex-wrap items-center justify-between gap-3", !usesPolicy && "opacity-50")}>
            <div>
              <div className="text-[12.5px] font-medium">When dates shift, later items…</div>
              <div className="text-[11.5px] text-muted">{usesPolicy ? (policy === "shift" ? "move with the change — trip gets longer or shorter" : "keep their dates — the next stay stretches or shrinks") : "Not used when shifting the whole trip"}</div>
            </div>
            <Segmented
              size="sm"
              value={policy}
              onChange={(v) => {
                setPolicy(v);
                setPolicyTouched(true);
              }}
              options={[
                { value: "shift", label: "Push later items" },
                { value: "absorb", label: "Keep later dates" },
              ]}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
          <div className="min-w-0 text-[12.5px] text-muted" data-testid="composer-preview">
            {!preview ? (
              "Describe a change to preview its impact."
            ) : "error" in preview ? (
              <span className="text-error">{preview.error}</span>
            ) : (
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>
                  <b className="font-semibold text-ink">{plural(preview.moved.length, "item")}</b> move
                </span>
                <span>
                  <b className="font-semibold text-ink">{plural(preview.plan.refetch.length, "search", "searches")}</b> to run
                </span>
                <span>{preview.plan.reuse.length} reused</span>
                {preview.held.length > 0 && <span className="text-warn">{preview.held.length} fixed item{preview.held.length === 1 ? "" : "s"} held</span>}
              </span>
            )}
          </div>
          <Button variant="primary" onClick={submit} disabled={!ops || running || !!(preview && "error" in preview)} loading={running} data-testid="run-scenario">
            Run scenario <ArrowRight className="size-3.5" />
          </Button>
        </div>
      </Card>
    </div>
  );
}

function Stepper({ value, onChange, min, max, format }: { value: number; onChange: (v: number) => void; min: number; max: number; format: (v: number) => string }) {
  return (
    <div className="inline-flex h-9 items-center rounded-lg border border-line-strong bg-surface shadow-card">
      <button type="button" className="flex h-full w-9 items-center justify-center text-muted hover:text-ink disabled:opacity-30" onClick={() => onChange(Math.max(min, value - 1 || -1))} disabled={value <= min} aria-label="Decrease">
        <Minus className="size-3.5" />
      </button>
      <span className="min-w-24 text-center font-mono text-[13px] tabular">{format(value)}</span>
      <button type="button" className="flex h-full w-9 items-center justify-center text-muted hover:text-ink disabled:opacity-30" onClick={() => onChange(Math.min(max, value + 1 || 1))} disabled={value >= max} aria-label="Increase">
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}

const STEPS = ["Clone baseline", "Propagate dependencies", "Detect affected searches", "Search current prices", "Compute trip diff"];

/** Visual progress while the server runs the scenario. Early steps are pure computation (instant); the search step waits on the provider. */
export function RunProgress({ searches }: { searches: number }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timers = [180, 380, 560].map((ms, i) => setTimeout(() => setStep((s) => Math.max(s, i + 1)), ms));
    return () => timers.forEach(clearTimeout);
  }, []);
  return (
    <div className="mx-auto max-w-sm py-16">
      <Card className="p-5 shadow-pop">
        <div className="mb-4 text-[14px] font-semibold">Running scenario</div>
        <ol className="space-y-2.5">
          {STEPS.map((s, i) => (
            <li key={s} className={cx("flex items-center gap-2.5 text-[13px] transition-colors", i > step ? "text-faint" : "text-ink")}>
              <span className="flex size-4 items-center justify-center">
                {i < step ? <Check className="size-3.5 text-down" /> : i === step ? <Spinner className="size-3.5 text-ink" /> : <span className="size-1.5 rounded-full bg-line-strong" />}
              </span>
              {i === 3 ? `Search current prices (${plural(searches, "affected item")})` : s}
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
