"use client";

import { CircleAlert, CircleCheck, CircleSlash, ExternalLink, FlaskConical, Radio, Star } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ENGINE_LABEL } from "@/domain/affected";
import { WEEKDAY_NAMES } from "@/domain/dates";
import type { FlightOption, HotelOption, Observation } from "@/domain/types";
import { api } from "@/lib/api";
import { clock, duration, freshness, hhmm, inr, relative, timestamp } from "@/lib/format";
import { useNow } from "./providers";
import { Badge, cx, Dot, SectionLabel, Sheet, Skeleton } from "./ui";

const EvidenceCtx = createContext<(id: string) => void>(() => {});
export const useEvidence = () => useContext(EvidenceCtx);

export function EvidenceProvider({ children }: { children: React.ReactNode }) {
  const [id, setId] = useState<string | null>(null);
  const open = useCallback((x: string) => setId(x), []);
  return (
    <EvidenceCtx.Provider value={open}>
      {children}
      <EvidenceSheet id={id} onClose={() => setId(null)} />
    </EvidenceCtx.Provider>
  );
}

export function EvidenceLink({ id, className, children }: { id: string; className?: string; children?: React.ReactNode }) {
  const open = useEvidence();
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        open(id);
      }}
      className={cx("font-mono text-[11px] text-muted underline decoration-line-strong decoration-dotted underline-offset-2 hover:text-brand hover:decoration-brand", className)}
    >
      {children ?? id}
    </button>
  );
}

const FRESH_DOT = { fresh: "bg-down", aging: "bg-[#d4a017]", stale: "bg-up" } as const;
const FRESH_LABEL = { fresh: "Fresh", aging: "Aging", stale: "Stale" } as const;

/** "● 14:05 · 3 min ago" with a colour that degrades as the observation ages */
export function FreshnessStamp({ iso, className, withLabel }: { iso: string | null | undefined; className?: string; withLabel?: boolean }) {
  const now = useNow();
  if (!iso) return null;
  const f = freshness(iso, now);
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-[11.5px] text-muted tabular", className)} title={`Observed ${timestamp(iso)}`}>
      <Dot className={FRESH_DOT[f]} />
      {withLabel && f !== "fresh" && <span className={f === "stale" ? "font-medium text-up" : "font-medium text-warn"}>{FRESH_LABEL[f]} ·</span>}
      {clock(iso)} · {relative(iso, now)}
    </span>
  );
}

export function ProviderBadge({ provider }: { provider: "serpapi" | "mock" }) {
  return provider === "mock" ? (
    <Badge tone="warn" icon={<FlaskConical className="size-3" />} title="Deterministic simulated data — not real prices">
      Simulated
    </Badge>
  ) : (
    <Badge tone="down" icon={<Radio className="size-3" />} title="Live SerpApi search results">
      Live
    </Badge>
  );
}

function EvidenceSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const [data, setData] = useState<{ observation: Observation; raw: unknown } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setData(null);
    setError(null);
    api.evidence(id).then(setData).catch((e) => setError(e.message));
  }, [id]);

  const o = data?.observation;
  return (
    <Sheet
      open={!!id}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          Evidence <span className="font-mono text-[13px] font-normal text-muted">{id}</span>
        </span>
      }
      subtitle={o ? `${ENGINE_LABEL[o.engine]} search` : "Loading…"}
    >
      {error && <p className="p-5 text-[13px] text-error">{error}</p>}
      {!o && !error && (
        <div className="space-y-3 p-5">
          <Skeleton className="h-16" />
          <Skeleton className="h-32" />
          <Skeleton className="h-24" />
        </div>
      )}
      {o && <EvidenceBody o={o} raw={data!.raw} />}
    </Sheet>
  );
}

function EvidenceBody({ o, raw }: { o: Observation; raw: unknown }) {
  const meta = (raw as { search_metadata?: Record<string, unknown> } | null)?.search_metadata;
  const googleUrl = (meta?.google_flights_url ?? meta?.google_hotels_url ?? meta?.google_maps_url) as string | undefined;
  const r = o.result;
  return (
    <div className="divide-y divide-line">
      <section className="space-y-3 p-5">
        <div className="flex flex-wrap items-center gap-2">
          {o.status === "ok" ? (
            <Badge tone="down" icon={<CircleCheck className="size-3" />}>Observed</Badge>
          ) : o.status === "no_results" ? (
            <Badge tone="warn" icon={<CircleSlash className="size-3" />}>No results</Badge>
          ) : (
            <Badge tone="error" icon={<CircleAlert className="size-3" />}>Search failed</Badge>
          )}
          <ProviderBadge provider={o.provider} />
          <FreshnessStamp iso={o.observedAt} withLabel />
        </div>
        <dl className="grid grid-cols-[120px_1fr] gap-y-1.5 text-[12.5px]">
          <dt className="text-muted">Observed at</dt>
          <dd className="tabular">{timestamp(o.observedAt)}</dd>
          <dt className="text-muted">Engine</dt>
          <dd className="font-mono text-[12px]">{o.engine}</dd>
          <dt className="text-muted">Search key</dt>
          <dd className="break-all font-mono text-[11.5px] text-ink-2">{o.searchKey}</dd>
          <dt className="text-muted">Latency</dt>
          <dd className="tabular">{o.durationMs} ms</dd>
        </dl>
        {o.error && <p className="rounded-lg bg-error-soft px-3 py-2 text-[12.5px] text-error">{o.error}</p>}
        {o.note && o.status !== "ok" && <p className="rounded-lg bg-warn-soft px-3 py-2 text-[12.5px] text-warn">{o.note}</p>}
        <p className="text-[12px] leading-relaxed text-muted">
          A search result observed at this moment — not a booking quote. Fares and rates change; availability is not guaranteed.
          {o.provider === "mock" && " This observation comes from the simulated provider and is not a real price."}
        </p>
      </section>

      {r?.type === "flight" && (
        <section className="space-y-3 p-5">
          <SectionLabel>Selected option</SectionLabel>
          <FlightOptionRow f={r.option} highlight />
          <p className="text-[12.5px] text-ink-2">
            {r.match === "preferred"
              ? "Your pinned flight was found on this date."
              : r.preferredFound === false
                ? `Your pinned flight wasn't in the results for this date — showing the cheapest of ${r.optionsCount} options instead.`
                : r.timeWindowMatched === false
                  ? `None of the ${r.optionsCount} options fit your time window — showing the cheapest overall.`
                  : r.timeWindowMatched
                    ? `Cheapest option inside your time window (${r.optionsCount} returned).`
                    : `Cheapest of ${r.optionsCount} options returned.`}
          </p>
          {r.alternatives.length > 0 && (
            <>
              <SectionLabel className="pt-2">Other options</SectionLabel>
              <div className="space-y-1.5">
                {r.alternatives.map((f, i) => (
                  <FlightOptionRow key={i} f={f} />
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {r?.type === "hotel" && (
        <section className="space-y-3 p-5">
          <SectionLabel>Selected property</SectionLabel>
          <HotelOptionRow h={r.hotel} nights={r.nights} highlight />
          <p className="text-[12.5px] text-ink-2">
            {r.rule ? `${r.rule}.` : r.match === "named" ? "Matched the hotel named in your plan." : `Cheapest property rated 4.0+ of ${r.optionsCount} with prices for these dates.`}
          </p>
          {r.alternatives.length > 0 && (
            <>
              <SectionLabel className="pt-2">Other properties</SectionLabel>
              <div className="space-y-1.5">
                {r.alternatives.map((h, i) => (
                  <HotelOptionRow key={i} h={h} nights={r.nights} />
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {r?.type === "place" && (
        <section className="space-y-3 p-5">
          <SectionLabel>{r.name}</SectionLabel>
          {r.hours ? (
            <div className="overflow-hidden rounded-lg border border-line">
              {WEEKDAY_NAMES.map((d, i) => {
                const v = r.hours?.[d.toLowerCase()];
                const closed = r.closedWeekdays?.includes(i);
                return (
                  <div key={d} className={cx("flex justify-between px-3 py-1.5 text-[12.5px] even:bg-canvas", closed && "text-up")}>
                    <span>{d}</span>
                    <span className="tabular">{v ?? "—"}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="rounded-lg bg-sunken px-3 py-2 text-[12.5px] text-muted stripes-unknown">
              No opening-hours evidence returned — TripShock won&apos;t enforce opening-day constraints for this activity.
            </p>
          )}
        </section>
      )}

      <section className="space-y-2 p-5">
        <SectionLabel right={googleUrl && (
          <a href={googleUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-brand hover:underline">
            Open on Google <ExternalLink className="size-3" />
          </a>
        )}>Exact query</SectionLabel>
        <div className="overflow-hidden rounded-lg border border-line font-mono text-[11.5px]">
          {Object.entries(o.params).map(([k, v]) => (
            <div key={k} className="flex gap-3 px-3 py-1.5 even:bg-canvas">
              <span className="w-32 shrink-0 text-muted">{k}</span>
              <span className="break-all text-ink">{String(v)}</span>
            </div>
          ))}
          {!Object.keys(o.params).length && <div className="px-3 py-2 text-muted">—</div>}
        </div>
        {meta && (
          <details className="group pt-2">
            <summary className="cursor-pointer text-[12px] text-muted hover:text-ink">Provider metadata</summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-ink p-3 text-[11px] leading-relaxed text-[#d5d5dc]">{JSON.stringify(meta, null, 2)}</pre>
          </details>
        )}
      </section>
    </div>
  );
}

function FlightOptionRow({ f, highlight }: { f: FlightOption; highlight?: boolean }) {
  return (
    <div className={cx("flex items-center gap-3 rounded-lg border px-3 py-2", highlight ? "border-brand/30 bg-brand-soft/50" : "border-line")}>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium">{f.airline}</div>
        <div className="font-mono text-[11.5px] text-muted">
          {f.flightNumbers.join(" · ")} · {hhmm(f.departTime)} → {hhmm(f.arriveTime)} · {duration(f.durationMin)} · {f.stops === 0 ? "nonstop" : `${f.stops} stop`}
        </div>
      </div>
      <div className="font-mono text-[13px] font-medium tabular">{inr(f.price)}</div>
    </div>
  );
}

function HotelOptionRow({ h, nights, highlight }: { h: HotelOption; nights: number; highlight?: boolean }) {
  return (
    <div className={cx("flex items-center gap-3 rounded-lg border px-3 py-2", highlight ? "border-brand/30 bg-brand-soft/50" : "border-line")}>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium">{h.name}</div>
        <div className="flex items-center gap-2 text-[11.5px] text-muted">
          {h.rating != null && (
            <span className="inline-flex items-center gap-0.5">
              <Star className="size-3 fill-current text-[#d4a017]" /> {h.rating}
            </span>
          )}
          {h.stars != null && <span>{h.stars}★ hotel</span>}
          <span className="tabular">{inr(h.perNight)}/night</span>
        </div>
      </div>
      <div className="text-right">
        <div className="font-mono text-[13px] font-medium tabular">{inr(h.total)}</div>
        <div className="text-[11px] text-muted">{nights} night{nights === 1 ? "" : "s"}</div>
      </div>
    </div>
  );
}
