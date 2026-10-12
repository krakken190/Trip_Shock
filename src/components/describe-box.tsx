"use client";

import { ArrowRight, Mic, Square, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSpeech } from "@/lib/use-speech";
import { useMeta } from "./providers";
import { Button, Card, cx, Kbd } from "./ui";

export const EXAMPLES = [
  "Pune to Goa with my wife on 12 Nov, arrive before 2 pm, business class. Budget hotel 12–16 Nov. Something adventurous near Baga beach on the 14th, top 3 places. Taxi to the airport. Fly back on the 16th in the evening.",
  "Family of four with two kids, Mumbai to Bangkok on 20 Dec, 4 nights in a mid-range hotel, then Phuket for 3 nights under ₹6,000 a night, back to Mumbai on the 27th.",
  "Delhi to Dubai next Friday morning, 3 nights at a luxury hotel, visit the Burj Khalifa on Saturday, return Monday night.",
];

export function DescribeBox({
  value,
  onChange,
  onSubmit,
  busy,
  mode = "create",
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
  mode?: "create" | "append";
  autoFocus?: boolean;
}) {
  const meta = useMeta();
  const ref = useRef<HTMLTextAreaElement>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const speech = useSpeech((phrase) => {
    const cur = valueRef.current.trimEnd();
    onChange(cur ? `${cur} ${phrase}` : phrase);
  });

  // Auto-grow
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(320, Math.max(112, el.scrollHeight))}px`;
  }, [value, speech.interim]);

  const disabled = meta ? !meta.nlp.enabled : false;
  const canSubmit = value.trim().length >= 8 && !busy && !disabled;

  return (
    <Card className={cx("overflow-hidden shadow-pop transition-shadow", speech.listening && "ring-2 ring-up/40")}>
      <div className="relative">
        <textarea
          ref={ref}
          data-testid="describe-input"
          autoFocus={autoFocus}
          value={speech.listening && speech.interim ? `${value}${value ? " " : ""}${speech.interim}` : value}
          onChange={(e) => !speech.listening && onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSubmit) onSubmit();
          }}
          readOnly={speech.listening || busy}
          placeholder={
            mode === "create"
              ? "Describe your trip — where from and to, dates, cabin, the kind of hotel, things you want to do…"
              : "Describe what to add — e.g. “2 more nights in Bangkok at a budget hotel, then fly to Phuket on the 14th”"
          }
          className="block w-full resize-none bg-transparent px-4 pb-2 pt-3.5 text-[15px] leading-relaxed outline-none placeholder:text-faint"
        />
        {speech.listening && (
          <span className="pointer-events-none absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-up px-2 py-0.5 text-[11px] font-medium text-white">
            <span className="size-1.5 animate-pulse rounded-full bg-white" /> Listening
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-canvas/70 px-3 py-2">
        <div className="flex items-center gap-2">
          {speech.supported ? (
            <Button
              type="button"
              size="sm"
              variant={speech.listening ? "primary" : "secondary"}
              className={speech.listening ? "!bg-up hover:!bg-up/90" : ""}
              icon={speech.listening ? <Square className="size-3 fill-current" /> : <Mic className="size-3.5" />}
              onClick={() => (speech.listening ? speech.stop() : speech.start())}
              disabled={busy || disabled}
              data-testid="mic-button"
            >
              {speech.listening ? "Stop" : "Speak"}
            </Button>
          ) : (
            <span className="text-[11.5px] text-faint" title="Voice input uses the browser's speech recognition (Chrome, Edge, Safari)">
              Voice input needs Chrome or Edge
            </span>
          )}
          {speech.error ? (
            <span className="text-[11.5px] text-error">{speech.error}</span>
          ) : speech.listening ? (
            <span className="text-[11.5px] text-muted">Speak naturally — dates, cities, cabin, hotel, activities.</span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1 text-[11px] text-faint sm:flex">
            <Kbd>Ctrl</Kbd>
            <Kbd>↵</Kbd>
          </span>
          <Button variant="primary" size="sm" onClick={onSubmit} disabled={!canSubmit} loading={busy} data-testid="describe-submit">
            {busy ? "Reading…" : mode === "create" ? "Plan it" : "Understand"}
            {!busy && <ArrowRight className="size-3.5" />}
          </Button>
        </div>
      </div>
      {disabled && (
        <div className="border-t border-line bg-warn-soft px-4 py-2 text-[12px] text-warn">
          Add <code className="font-mono">OPENROUTER_API_KEY</code> to <code className="font-mono">.env.local</code> and restart to enable trip descriptions.
        </div>
      )}
    </Card>
  );
}

export function ExampleChips({ onPick }: { onPick: (s: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {EXAMPLES.map((e, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onPick(e)}
          className="max-w-full truncate rounded-full border border-line bg-surface px-2.5 py-1 text-left text-[12px] text-ink-2 transition-colors hover:border-line-strong hover:bg-sunken"
          title={e}
        >
          <Sparkles className="mb-0.5 mr-1 inline size-3 text-brand" />
          {["Pune → Goa, business, adventure", "Family: Mumbai → Bangkok → Phuket", "Delhi → Dubai, luxury"][i]}
        </button>
      ))}
    </div>
  );
}

/** Elapsed-time indicator while the model works (free models can be slow). */
export function ReadingIndicator({ model }: { model: string | null | undefined }) {
  const [s, setS] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setS((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex items-center gap-2 text-[12.5px] text-muted" data-testid="reading">
      <span className="flex gap-0.5">
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-1.5 animate-bounce rounded-full bg-brand" style={{ animationDelay: `${i * 120}ms` }} />
        ))}
      </span>
      Reading your trip{model ? <> with <span className="font-mono text-[11.5px]">{model}</span></> : null} · {s}s
      {s > 12 && <span className="text-faint">— free models can take up to a minute</span>}
    </div>
  );
}
