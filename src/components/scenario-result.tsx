"use client";

import {
  ArrowRight,
  CircleAlert,
  CircleDashed,
  CircleHelp,
  Copy,
  Equal,
  Info,
  Lock,
  Network,
  RefreshCw,
  Search,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { Conflict } from "@/domain/constraints";
import { signedDays } from "@/domain/dates";
import type { CategorySummary, NodeDiff } from "@/domain/diff";
import { sortNodes } from "@/domain/graph";
import type { Observation, TripNode } from "@/domain/types";
import type { ScenarioView } from "@/lib/api";
import { freshness, inr, plural, relative, signedInr, timestamp } from "@/lib/format";
import { EvidenceLink, FreshnessStamp, ProviderBadge } from "./evidence";
import { KindIcon } from "./kind";
import { EvidenceSummary, nodeDates, nodeHeading } from "./node-card";
import { useNow } from "./providers";
import { Badge, Button, Card, cx, SectionLabel, Switch, useToast } from "./ui";

export function ScenarioResult({
  v,
  refreshing,
  onRerun,
  onDelete,
  onGraph,
}: {
  v: ScenarioView;
  refreshing: boolean;
  onRerun: () => void;
  onDelete: () => void;
  onGraph: () => void;
}) {
  const [hideUnchanged, setHideUnchanged] = useState(false);
  const [view, setView] = useState<"timeline" | "log">("timeline");
  const agg = v.diff.aggregate;

  return (
    <div className="space-y-4" data-testid="scenario-result">
      <Card className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-ink px-2 py-0.5 font-mono text-[12px] font-semibold tracking-wide text-white" data-testid="headline">
              {agg.headline}
            </span>
            <h2 className="truncate text-[16px] font-semibold tracking-tight">{v.scenario.name}</h2>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
            {v.scenario.prompt && <span className="italic">“{v.scenario.prompt}”</span>}
            {v.scenario.ops.some((o) => o.op !== "shift_trip") && (
              <span>Later items: {v.scenario.policy.downstream === "shift" ? "pushed" : "kept in place"}</span>
            )}
            <span>Searched {relative(v.scenario.lastRefreshedAt)}</span>
            <ProviderBadge provider={v.provider} />
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" icon={<Network className="size-3.5" />} onClick={onGraph}>
            Dependencies
          </Button>
          <Button size="sm" icon={<RefreshCw className={cx("size-3.5", refreshing && "animate-spin")} />} onClick={onRerun} disabled={refreshing}>
            {refreshing ? "Searching…" : "Re-run searches"}
          </Button>
          <Button size="sm" variant="ghost" className="text-muted hover:text-error" icon={<Trash2 className="size-3.5" />} onClick={onDelete} aria-label="Delete scenario" />
        </div>
      </Card>

      {v.baseChanged && (
        <Banner tone="info" icon={<Info />}>
          The baseline was edited after this scenario was created. Results are recomputed against the current baseline (rev {v.trip.revision}).
        </Banner>
      )}
      {v.errors.length > 0 && (
        <Banner tone="error" icon={<CircleAlert />}>
          {v.errors.join(" · ")} — this part of the scenario couldn&apos;t be applied.
        </Banner>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex rounded-lg bg-sunken p-0.5 ring-1 ring-inset ring-line">
              {(["timeline", "log"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setView(k)}
                  className={cx("h-7 whitespace-nowrap rounded-md px-3 text-[12.5px] font-medium", view === k ? "bg-surface shadow-card ring-1 ring-line" : "text-muted hover:text-ink")}
                >
                  {k === "timeline" ? "Side by side" : `Change log (${v.diff.fields.length})`}
                </button>
              ))}
            </div>
            {view === "timeline" && (
              <label className="flex items-center gap-2 whitespace-nowrap text-[12.5px] text-muted">
                Hide unchanged <Switch checked={hideUnchanged} onChange={setHideUnchanged} label="Hide unchanged" />
              </label>
            )}
          </div>
          {view === "timeline" ? <DiffTimeline v={v} hideUnchanged={hideUnchanged} /> : <ChangeLog v={v} />}
        </div>
        <ImpactPanel v={v} />
      </div>
    </div>
  );
}

function Banner({ tone, icon, children }: { tone: "info" | "error"; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={cx("flex items-start gap-2.5 rounded-xl border px-4 py-3 text-[13px] [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0", tone === "info" ? "border-moved/20 bg-moved-soft text-[#1e3a8a]" : "border-error/20 bg-error-soft text-error")}>
      {icon}
      <div>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------- Side-by-side timelines

function DiffTimeline({ v, hideUnchanged }: { v: ScenarioView; hideUnchanged: boolean }) {
  const order = useMemo(() => sortNodes(v.trip.nodes).map((n) => n.id), [v.trip.nodes]);
  const byId = useMemo(() => new Map(v.diff.nodes.map((d) => [d.nodeId, d])), [v.diff.nodes]);
  const baseById = useMemo(() => new Map(v.trip.nodes.map((n) => [n.id, n])), [v.trip.nodes]);
  const scById = useMemo(() => new Map(v.nodes.map((n) => [n.id, n])), [v.nodes]);
  const conflictsById = useMemo(() => {
    const m = new Map<string, Conflict[]>();
    for (const c of v.conflicts) for (const id of c.nodeIds.slice(0, 1)) m.set(id, [...(m.get(id) ?? []), c]);
    return m;
  }, [v.conflicts]);

  const rows = order
    .map((id) => byId.get(id)!)
    .filter(Boolean)
    .filter((d) => !hideUnchanged || d.structural !== "unchanged" || (d.price.delta ?? 0) !== 0 || conflictsById.has(d.nodeId));

  return (
    <Card className="overflow-hidden">
      <div className="hidden grid-cols-[minmax(0,1fr)_28px_minmax(0,1fr)] border-b border-line bg-canvas px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted md:grid">
        <span className="pl-2">Baseline · rev {v.trip.revision}</span>
        <span />
        <span className="pl-2">Scenario</span>
      </div>
      <div className="divide-y divide-line">
        {rows.map((d) => (
          <DiffRow
            key={d.nodeId}
            d={d}
            base={baseById.get(d.nodeId)!}
            sc={scById.get(d.nodeId)!}
            baseObs={v.baseObservations[d.nodeId]}
            scObs={v.scenarioObservations[d.nodeId]}
            conflicts={conflictsById.get(d.nodeId) ?? []}
          />
        ))}
        {rows.length === 0 && <p className="px-4 py-10 text-center text-[13px] text-muted">Nothing changed.</p>}
      </div>
    </Card>
  );
}

const RAIL: Record<NodeDiff["structural"], string> = {
  unchanged: "bg-transparent",
  moved: "bg-moved",
  resized: "bg-moved",
  held: "bg-ink-2",
};

function DiffRow({
  d,
  base,
  sc,
  baseObs,
  scObs,
  conflicts,
}: {
  d: NodeDiff;
  base: TripNode;
  sc: TripNode;
  baseObs?: Observation;
  scObs?: Observation;
  conflicts: Conflict[];
}) {
  const changed = d.structural !== "unchanged";
  const newConflicts = conflicts.filter((c) => !c.preexisting);
  const rail = newConflicts.some((c) => c.severity === "error") ? "bg-error" : newConflicts.length ? "bg-warn" : RAIL[d.structural];
  return (
    <div className={cx("relative grid grid-cols-1 gap-1 px-3 py-2.5 md:grid-cols-[minmax(0,1fr)_28px_minmax(0,1fr)] md:items-stretch md:gap-0", !changed && !newConflicts.length && d.price.delta === 0 && "opacity-70")} data-testid={`diff-${d.nodeId}`}>
      <span className={cx("absolute inset-y-0 left-0 w-[3px]", rail)} />
      <MiniCard node={base} obs={baseObs} side="base" d={d} />
      <div className="hidden items-center justify-center text-faint md:flex">
        {d.structural === "held" ? <Lock className="size-3.5 text-ink-2" /> : changed ? <ArrowRight className="size-3.5 text-moved" /> : <Equal className="size-3.5" />}
      </div>
      <div className="min-w-0">
        <MiniCard node={sc} obs={scObs} side="scenario" d={d} />
        {conflicts.length > 0 && (
          <div className="mt-1.5 space-y-1 pl-2">
            {conflicts.map((c) => (
              <div key={c.id} className={cx("flex items-start gap-1.5 text-[12px]", c.preexisting ? "text-muted" : c.severity === "error" ? "text-error" : "text-warn")}>
                <TriangleAlert className="mt-0.5 size-3 shrink-0" />
                <span>
                  {c.preexisting && <span className="font-medium">Already in baseline: </span>}
                  {c.message}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MiniCard({ node, obs, side, d }: { node: TripNode; obs?: Observation; side: "base" | "scenario"; d: NodeDiff }) {
  const h = nodeHeading(node);
  const isSc = side === "scenario";
  const datesChanged = isSc && (d.startDelta !== 0 || d.endDelta !== 0);
  const p = isSc ? d.price.after : d.price.before;
  return (
    <div className={cx("flex min-w-0 gap-2.5 rounded-lg px-2 py-1.5", isSc && datesChanged && "bg-moved-soft/60", !isSc && "max-md:opacity-60")}>
      <KindIcon kind={node.kind} size="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-faint md:hidden">{isSc ? "After" : "Before"}</span>
          <span className="truncate text-[13px] font-medium">{h.title}</span>
          {node.fixed && <Lock className="size-3 shrink-0 text-muted" aria-label="Fixed" />}
        </div>
        <div className={cx("flex flex-wrap items-center gap-1.5 text-[12px]", datesChanged ? "font-medium text-moved" : "text-muted")}>
          {nodeDates(node)}
          {isSc && d.structural === "moved" && <Badge tone="moved" className="h-4 px-1 text-[10.5px]">{signedDays(d.startDelta)}</Badge>}
          {isSc && d.structural === "resized" && (
            <Badge tone="moved" className="h-4 px-1 text-[10.5px]">
              {d.startDelta ? `in ${signedDays(d.startDelta)} ` : ""}
              {d.endDelta ? `out ${signedDays(d.endDelta)}` : ""}
            </Badge>
          )}
          {isSc && d.structural === "held" && <Badge tone="neutral" className="h-4 px-1 text-[10.5px]">held · fixed</Badge>}
        </div>
        <div className="mt-0.5 truncate text-[11.5px] text-muted">
          <EvidenceSummary node={node} obs={obs} />
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
        <PriceCell p={p} />
        {isSc && d.price.state === "observed" && d.price.delta != null && d.price.delta !== 0 && (
          <span className={cx("rounded px-1 font-mono text-[11px] font-medium tabular", d.price.delta > 0 ? "bg-up-soft text-up" : "bg-down-soft text-down")} data-testid={`delta-${d.nodeId}`}>
            {signedInr(d.price.delta)}
          </span>
        )}
        {isSc && <SearchTag d={d} obs={obs} />}
      </div>
    </div>
  );
}

function PriceCell({ p }: { p: NodeDiff["price"]["before"] }) {
  if (p.status === "no_source") return <span className="font-mono text-[12.5px] text-faint">—</span>;
  if (p.status === "estimate") return <span className="font-mono text-[12.5px] text-muted tabular" title="Your estimate — not refreshed">{inr(p.amount)}</span>;
  if (p.amount == null) {
    return (
      <span className={cx("inline-flex items-center gap-1 text-[12px] font-medium", p.status === "error" ? "text-error" : p.status === "no_results" ? "text-warn" : "text-faint")}>
        {p.status === "not_searched" ? <CircleDashed className="size-3" /> : <CircleHelp className="size-3" />}
        {p.status === "error" ? "Unavailable" : p.status === "no_results" ? "No result" : "Not searched"}
      </span>
    );
  }
  return p.evidenceId ? (
    <EvidenceLink id={p.evidenceId} className="!font-mono !text-[13px] !font-medium !text-ink !no-underline tabular hover:!text-brand">
      {inr(p.amount)}
    </EvidenceLink>
  ) : (
    <span className="font-mono text-[13px] tabular">{inr(p.amount)}</span>
  );
}

function SearchTag({ d, obs }: { d: NodeDiff; obs?: Observation }) {
  if (d.search === "none") return <span className="text-[10.5px] text-faint">no data source</span>;
  if (d.search === "reuse") return <span className="text-[10.5px] text-faint" title="Same search as the baseline — its evidence applies">same search · reused</span>;
  if (!obs) return <span className="text-[10.5px] text-faint">not searched</span>;
  return <FreshnessStamp iso={obs.observedAt} className="!text-[10.5px]" />;
}

// ---------------------------------------------------------------------------- Change log (diff model)

function fmtVal(field: string, v: string | number | null) {
  if (v == null) return "unavailable";
  if (typeof v === "number" && /fare|total|cost|price/.test(field)) return inr(v);
  return String(v);
}

function ChangeLog({ v }: { v: ScenarioView }) {
  const toast = useToast();
  const groups = useMemo(() => {
    const m = new Map<string, typeof v.diff.fields>();
    for (const f of v.diff.fields) m.set(f.node_id, [...(m.get(f.node_id) ?? []), f]);
    return [...m.entries()];
  }, [v.diff.fields]);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-line bg-canvas px-4 py-2">
        <span className="font-mono text-[11.5px] text-muted">baseline@rev{v.trip.revision} → {v.scenario.id}</span>
        <Button
          size="xs"
          variant="ghost"
          icon={<Copy className="size-3" />}
          onClick={() => {
            const payload = v.diff.fields.map(({ node_title: _t, category: _c, ...f }) => f);
            navigator.clipboard.writeText(JSON.stringify(payload, null, 2)).then(() => toast({ tone: "success", message: "Diff copied as JSON" }));
          }}
        >
          Copy JSON
        </Button>
      </div>
      {groups.length === 0 && <p className="px-4 py-10 text-center text-[13px] text-muted">No field changes.</p>}
      <div className="divide-y divide-line font-mono text-[12px]">
        {groups.map(([nodeId, fields]) => (
          <div key={nodeId}>
            <div className="bg-moved-soft/50 px-4 py-1.5 text-[11.5px] text-moved">
              @@ {fields[0].node_title} <span className="text-faint">({nodeId})</span> @@
            </div>
            {fields.map((f, i) => (
              <div key={i} className="px-4 py-1.5">
                <div className="grid grid-cols-[14px_130px_1fr] text-up">
                  <span>−</span>
                  <span className="text-muted">{f.field}</span>
                  <span className="tabular">{fmtVal(f.field, f.before)}</span>
                </div>
                <div className={cx("grid grid-cols-[14px_130px_1fr]", f.category === "unknown" ? "text-warn" : "text-down")}>
                  <span>+</span>
                  <span className="text-muted">{f.field}</span>
                  <span className="flex flex-wrap items-center gap-x-2 tabular">
                    {fmtVal(f.field, f.after)}
                    {f.delta != null && <span className="text-faint">({f.category === "price" ? signedInr(f.delta) : f.field === "nights" ? signedDays(f.delta, "night") : signedDays(f.delta)})</span>}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 pl-[14px] font-sans text-[11.5px] text-muted">
                  <span>{f.reason}</span>
                  {f.evidence_ids.map((id) => (
                    <EvidenceLink key={id} id={id} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------- Impact panel

function CategoryRow({ label, c, testId }: { label: string; c: CategorySummary; testId: string }) {
  let value: React.ReactNode;
  if (c.count === 0) value = <span className="text-faint">none</span>;
  else if (c.state === "unknown") value = <span className="text-warn">unknown</span>;
  else if (c.state === "no_source") value = <span className="text-muted">unchanged / unknown</span>;
  else if (c.delta === 0 && c.changed === 0) value = <span className="text-muted">unchanged</span>;
  else
    value = (
      <span className="inline-flex items-baseline gap-1.5">
        {c.state === "partial" && <span className="font-sans text-[11px] text-warn">{c.unknown} unknown ·</span>}
        <span className={cx(c.delta! > 0 ? "text-up" : c.delta! < 0 ? "text-down" : "text-muted")}>
          {signedInr(c.delta)}
          {c.state === "partial" && <span className="text-warn">*</span>}
        </span>
      </span>
    );
  return (
    <div className="flex items-baseline justify-between gap-2" data-testid={testId}>
      <span className="text-ink-2">
        {label}
        {c.changed > 0 && <span className="ml-1.5 font-sans text-[11px] text-faint">{c.changed} changed</span>}
      </span>
      <span className="font-mono tabular">{value}</span>
    </div>
  );
}

function ImpactPanel({ v }: { v: ScenarioView }) {
  const now = useNow();
  const agg = v.diff.aggregate;
  const t = agg.total;
  const delta = t.delta;

  // Like-for-like check: baseline evidence much older than scenario evidence
  const baseTimes = Object.values(v.baseObservations).map((o) => o.observedAt).sort();
  const oldestBase = baseTimes[0];
  const staleBase = oldestBase && freshness(oldestBase, now) === "stale";

  const newConflicts = v.conflicts.filter((c) => !c.preexisting);
  const oldConflicts = v.conflicts.filter((c) => c.preexisting);
  const s = agg.searches;
  const totalSearch = s.refetched + s.reused + s.noSource || 1;

  return (
    <aside className="space-y-4 xl:sticky xl:top-20 xl:self-start" data-testid="impact-panel">
      <Card className="p-4">
        <SectionLabel>Observed total change</SectionLabel>
        <div
          className={cx("mt-2 font-mono text-[30px] font-semibold tracking-tight tabular", delta == null ? "text-faint" : delta > 0 ? "text-up" : delta < 0 ? "text-down" : "text-ink")}
          data-testid="total-delta"
        >
          {delta == null ? "Unknown" : signedInr(delta)}
        </div>
        <p className="text-[12px] text-muted">
          {t.before != null && t.after != null ? (
            <>
              <span className="font-mono tabular">{inr(t.before)}</span> → <span className="font-mono tabular">{inr(t.after)}</span> ·{" "}
            </>
          ) : null}
          estimated from current search results
        </p>
        {!t.complete && (
          <p className="mt-2 rounded-lg bg-warn-soft px-2.5 py-1.5 text-[12px] text-warn" data-testid="partial-note">
            * Partial — excludes {t.excluded.join(", ")}.
          </p>
        )}
        <div className="mt-4 space-y-1.5 border-t border-dashed border-line-strong pt-3 text-[13px]">
          <CategoryRow label="Flights" c={agg.flights} testId="cat-flights" />
          <CategoryRow label="Hotels" c={agg.hotels} testId="cat-hotels" />
          <CategoryRow label="Transfers" c={agg.transfers} testId="cat-transfers" />
          <div className="flex items-baseline justify-between gap-2" data-testid="cat-activities">
            <span className="text-ink-2">Activities</span>
            <span className={cx("font-mono text-[12.5px]", agg.activities.constraintsAffected ? "text-warn" : "text-muted")}>
              {agg.activities.constraintsAffected ? plural(agg.activities.constraintsAffected, "constraint") + " affected" : agg.activities.count ? "no conflicts" : "none"}
            </span>
          </div>
        </div>
        {staleBase && (
          <p className="mt-3 flex gap-1.5 text-[11.5px] leading-relaxed text-warn">
            <Info className="mt-px size-3.5 shrink-0" />
            Baseline prices were observed {relative(oldestBase, now)} ({timestamp(oldestBase)}). Refresh the baseline for a like-for-like comparison.
          </p>
        )}
      </Card>

      <Card className="p-4" data-testid="conflicts">
        <SectionLabel right={newConflicts.length > 0 && <Badge tone={newConflicts.some((c) => c.severity === "error") ? "error" : "warn"}>{newConflicts.length} new</Badge>}>
          Conflicts
        </SectionLabel>
        {v.conflicts.length === 0 ? (
          <p className="mt-2 text-[12.5px] text-muted">No broken dependencies.</p>
        ) : (
          <ul className="mt-2.5 space-y-2.5">
            {[...newConflicts, ...oldConflicts].map((c) => (
              <li key={c.id} className={cx("rounded-lg border px-3 py-2", c.preexisting ? "border-line bg-canvas" : c.severity === "error" ? "border-error/20 bg-error-soft/60" : "border-warn/20 bg-warn-soft/60")}>
                <div className={cx("flex gap-1.5 text-[12.5px]", c.preexisting ? "text-muted" : c.severity === "error" ? "text-error" : "text-warn")}>
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                  <span className="text-ink-2">{c.message}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 pl-5 text-[11.5px] text-muted">
                  {c.preexisting && <Badge tone="outline">already in baseline</Badge>}
                  {c.suggestion && <span>{c.suggestion}</span>}
                  {c.evidenceIds?.map((id) => <EvidenceLink key={id} id={id} />)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {agg.unknowns.length > 0 && (
        <Card className="p-4" data-testid="unknowns">
          <SectionLabel>Unknowns</SectionLabel>
          <ul className="mt-2 space-y-1.5">
            {agg.unknowns.map((u) => (
              <li key={u} className="flex gap-1.5 text-[12.5px] text-muted">
                <CircleHelp className="mt-0.5 size-3.5 shrink-0 text-faint" />
                {u}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-4" data-testid="searches">
        <SectionLabel right={<Search className="size-3.5 text-faint" />}>Searches</SectionLabel>
        <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-sunken">
          <span className="bg-ink" style={{ width: `${(s.refetched / totalSearch) * 100}%` }} />
          <span className="bg-line-strong" style={{ width: `${(s.reused / totalSearch) * 100}%` }} />
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-y-1 text-[12.5px]">
          <span className="flex items-center gap-1.5 text-ink-2"><span className="size-2 rounded-sm bg-ink" />{s.refetched} re-searched</span>
          <span className="flex items-center gap-1.5 text-ink-2"><span className="size-2 rounded-sm bg-line-strong" />{s.reused} reused</span>
          <span className="text-muted">{s.noSource} no data source</span>
          <span className={s.failed ? "font-medium text-error" : "text-muted"}>{s.failed} failed</span>
        </div>
        <p className="mt-2.5 text-[11.5px] leading-relaxed text-faint">Only items whose search parameters changed were re-searched. Identical searches reuse the baseline&apos;s evidence.</p>
      </Card>
    </aside>
  );
}
