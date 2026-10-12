"use client";

import { CircleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { TripNode } from "@/domain/types";
import { api, type DescribeResult } from "@/lib/api";
import { DescribeBox, ExampleChips, ReadingIndicator } from "./describe-box";
import { DraftReview } from "./draft-review";
import { useMeta } from "./providers";
import { useToast } from "./ui";

export type FlowPhase = "input" | "reading" | "review";

/** The traveller's local calendar date, so "next Friday" is resolved in their time zone. */
export const localToday = () => new Date().toLocaleDateString("en-CA");

export function PlanFlow({
  mode,
  tripId,
  onPhase,
  onAppend,
  autoFocus,
}: {
  mode: "create" | "append";
  tripId?: string;
  onPhase?: (p: FlowPhase) => void;
  onAppend?: (nodes: TripNode[]) => Promise<void>;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const meta = useMeta();
  const [text, setText] = useState("");
  const [phase, setPhaseState] = useState<FlowPhase>("input");
  const [result, setResult] = useState<DescribeResult | null>(null);
  const [error, setError] = useState<{ message: string; details?: unknown } | null>(null);
  const [saving, setSaving] = useState(false);
  const today = localToday();

  const setPhase = (p: FlowPhase) => {
    setPhaseState(p);
    onPhase?.(p);
  };

  const submit = async () => {
    setError(null);
    setPhase("reading");
    try {
      const r = await api.describe(text, { today, tripId });
      setResult(r);
      setPhase("review");
    } catch (e) {
      const err = e as Error & { details?: unknown };
      setError({ message: err.message, details: err.details });
      setPhase("input");
    }
  };

  if (phase === "review" && result) {
    return (
      <DraftReview
        plan={result.plan}
        today={today}
        model={result.model}
        mode={mode}
        busy={saving}
        onBack={() => setPhase("input")}
        onConfirm={async ({ name, travelers, nodes }) => {
          setSaving(true);
          try {
            if (mode === "create") {
              const t = await api.createTrip({ name, travelers, nodes });
              router.push(`/trips/${t.id}?refresh=1`);
            } else {
              await onAppend?.(nodes);
              setText("");
              setResult(null);
              setPhase("input");
              setSaving(false);
            }
          } catch (e) {
            toast({ tone: "error", message: (e as Error).message });
            setSaving(false);
          }
        }}
      />
    );
  }

  const attempts = Array.isArray(error?.details) ? (error!.details as { model: string; error: string }[]) : [];
  return (
    <div className="space-y-3">
      <DescribeBox value={text} onChange={setText} onSubmit={submit} busy={phase === "reading"} mode={mode} autoFocus={autoFocus} />
      {phase === "reading" ? (
        <ReadingIndicator model={meta?.nlp.model} />
      ) : error ? (
        <div className="rounded-xl border border-error/20 bg-error-soft px-3.5 py-2.5 text-[12.5px] text-error" data-testid="describe-error">
          <div className="flex items-start gap-2">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {error.message}
              {attempts.some((a) => /rate-limit|429/i.test(a.error)) && " — free models are rate-limited right now; try again in a minute."}
            </span>
          </div>
          {attempts.length > 0 && (
            <details className="mt-1.5 pl-5.5 text-[11.5px] text-error/80">
              <summary className="cursor-pointer">What we tried</summary>
              <ul className="mt-1 space-y-0.5 font-mono">
                {attempts.map((a, i) => (
                  <li key={i}>
                    {a.model}: {a.error}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      ) : (
        !text && mode === "create" && <ExampleChips onPick={setText} />
      )}
    </div>
  );
}
