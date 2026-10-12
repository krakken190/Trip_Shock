"use client";

import { ArrowRight, CircleAlert, Mic, Plane, Plus, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { airportCity } from "@/domain/airports";
import { dayLabel, diffDays } from "@/domain/dates";
import { nodeTitle, sortNodes } from "@/domain/graph";
import type { Observation, TripNode } from "@/domain/types";
import type { BaselineView } from "@/lib/api";
import { inr, plural, signedInr } from "@/lib/format";
import { FreshnessStamp } from "./evidence";
import { NodeCard } from "./node-card";
import { NodeEditor } from "./node-editor";
import { PlanFlow } from "./plan-flow";
import { Badge, Button, Card, cx, Dialog, EmptyState, SectionLabel, useToast } from "./ui";

export function BaselineTab({
  view,
  refreshing,
  onRefresh,
  onSaveNodes,
  onOpenScenario,
  onAsk,
}: {
  view: BaselineView;
  refreshing: Set<string>;
  onRefresh: (ids?: string[]) => Promise<void>;
  onSaveNodes: (nodes: TripNode[]) => Promise<unknown>;
  onOpenScenario: (id: string) => void;
  onAsk: (prompt: string) => void;
}) {
  const toast = useToast();
  const { trip, observations, lastKnown, conflicts } = view;
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<TripNode | null>(null);
  const [deleting, setDeleting] = useState<TripNode | null>(null);
  const [describeOpen, setDescribeOpen] = useState(false);

  const sorted = useMemo(() => sortNodes(trip.nodes), [trip.nodes]);
  const days = useMemo(() => {
    const groups: { date: string; nodes: TripNode[] }[] = [];
    for (const n of sorted) {
      const g = groups[groups.length - 1];
      if (g && g.date === n.start) g.nodes.push(n);
      else groups.push({ date: n.start, nodes: [n] });
    }
    return groups;
  }, [sorted]);
  const first = sorted[0]?.start;

  const conflictFor = (id: string) => conflicts.find((c) => c.nodeIds[0] === id)?.message;

  const mutate = async (fn: (nodes: TripNode[]) => TripNode[], msg?: string) => {
    try {
      await onSaveNodes(fn(trip.nodes));
      if (msg) toast({ tone: "success", message: msg });
    } catch (e) {
      toast({ tone: "error", message: (e as Error).message });
    }
  };

  const saveNode = async (node: TripNode) => {
    const exists = trip.nodes.some((n) => n.id === node.id);
    const prev = trip.nodes.find((n) => n.id === node.id);
    await onSaveNodes(exists ? trip.nodes.map((n) => (n.id === node.id ? node : n)) : [...trip.nodes, node]);
    // Price the new/changed item right away if its search changed
    if (node.kind !== "transfer" && (!prev || JSON.stringify({ ...prev, fixed: 0 }) !== JSON.stringify({ ...node, fixed: 0 }))) {
      void onRefresh([node.id]);
    }
  };

  const pin = (node: TripNode, obs: Observation | undefined, on: boolean) => {
    if (node.kind !== "flight") return;
    const opt = obs?.result?.type === "flight" ? obs.result.option : null;
    void mutate(
      (nodes) =>
        nodes.map((n) =>
          n.id === node.id && n.kind === "flight"
            ? { ...n, preferredFlight: on && opt ? { airline: opt.airline, flightNumbers: opt.flightNumbers, departTime: opt.departTime.split(" ")[1] } : null }
            : n,
        ),
      on ? `Pinned ${opt?.flightNumbers.join(" + ")} — scenarios will look for this flight first` : "Flight unpinned",
    );
  };

  const suggestions = useMemo(() => suggestPrompts(trip.nodes), [trip.nodes]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-semibold tracking-tight">Baseline plan</h2>
            <Badge tone="outline" title="Every edit creates a new baseline revision. Scenarios never modify it.">rev {trip.revision}</Badge>
          </div>
          <div className="flex gap-2">
            <Button size="sm" icon={<Mic className="size-3.5" />} onClick={() => setDescribeOpen(true)} data-testid="describe-add">
              Describe to add
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={<Plus className="size-3.5" />}
              onClick={() => {
                setEditing(null);
                setEditorOpen(true);
              }}
            >
              Add item
            </Button>
          </div>
        </div>

        {sorted.length === 0 ? (
          <Card className="border-dashed shadow-none">
            <EmptyState
              icon={<Plane />}
              title="Build your baseline"
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button variant="primary" icon={<Mic className="size-3.5" />} onClick={() => setDescribeOpen(true)}>
                    Describe your trip
                  </Button>
                  <Button icon={<Plus className="size-3.5" />} onClick={() => setEditorOpen(true)}>
                    Add a flight manually
                  </Button>
                </div>
              }
            >
              Say or type the trip and review what we understood, or add flights and stays one by one. Arrivals link to check-ins and check-outs to departures automatically.
            </EmptyState>
          </Card>
        ) : (
          <ol className="relative">
            {days.map((g, gi) => (
              <li key={g.date} className="relative pb-5 pl-8 last:pb-0" style={{ animationDelay: `${gi * 30}ms` }}>
                {gi < days.length - 1 && <span className="absolute left-[7px] top-2 h-full w-px bg-line" />}
                <span className="absolute left-0 top-[5px] flex size-[15px] items-center justify-center rounded-full border border-line-strong bg-surface">
                  <span className="size-[5px] rounded-full bg-ink-2" />
                </span>
                <div className="mb-2 flex items-baseline gap-2">
                  <span className="text-[13px] font-semibold">{dayLabel(g.date)}</span>
                  {first && <span className="text-[12px] text-faint">Day {diffDays(first, g.date) + 1}</span>}
                </div>
                <div className="space-y-2">
                  {g.nodes.map((n) => (
                    <NodeCard
                      key={n.id}
                      node={n}
                      obs={observations[n.id]}
                      lastKnown={lastKnown[n.id]}
                      refreshing={refreshing.has(n.id)}
                      conflict={conflictFor(n.id)}
                      onEdit={() => {
                        setEditing(n);
                        setEditorOpen(true);
                      }}
                      onToggleFixed={() =>
                        mutate((nodes) => nodes.map((x) => (x.id === n.id ? { ...x, fixed: !x.fixed } : x)), `${nodeTitle(n)} is now ${n.fixed ? "flexible" : "fixed"}`)
                      }
                      onDelete={() => setDeleting(n)}
                      onRefresh={() => onRefresh([n.id])}
                      onPin={(on) => pin(n, observations[n.id], on)}
                    />
                  ))}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <BaselineSummary view={view} refreshing={refreshing.size > 0} />

        {conflicts.length > 0 && (
          <Card className="p-4">
            <SectionLabel>Baseline issues</SectionLabel>
            <ul className="mt-2.5 space-y-2">
              {conflicts.map((c) => (
                <li key={c.id} className="flex gap-2 text-[12.5px] text-ink-2">
                  <CircleAlert className={cx("mt-0.5 size-3.5 shrink-0", c.severity === "error" ? "text-error" : "text-warn")} />
                  {c.message}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {sorted.length > 0 && (
          <Card className="overflow-hidden">
            <div className="border-b border-line bg-[linear-gradient(135deg,#eef0ff,#fdf0f6_70%)] px-4 py-3.5">
              <div className="flex items-center gap-1.5 text-[13.5px] font-semibold">
                <Sparkles className="size-3.5 text-brand" /> What if…
              </div>
              <p className="mt-0.5 text-[12.5px] text-ink-2">Branch the plan without touching the baseline.</p>
            </div>
            <div className="flex flex-col p-1.5">
              {suggestions.map((s) => (
                <button key={s} onClick={() => onAsk(s)} className="group flex items-center justify-between rounded-lg px-2.5 py-2 text-left text-[13px] text-ink-2 hover:bg-sunken hover:text-ink">
                  {s}
                  <ArrowRight className="size-3.5 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />
                </button>
              ))}
            </div>
          </Card>
        )}

        {view.scenarios.length > 0 && (
          <Card className="p-4">
            <SectionLabel>Saved scenarios</SectionLabel>
            <ul className="mt-2 space-y-0.5">
              {view.scenarios.slice(0, 6).map((s) => (
                <li key={s.id}>
                  <button onClick={() => onOpenScenario(s.id)} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-sunken">
                    <span className="truncate">{s.name}</span>
                    <span className={cx("shrink-0 font-mono text-[12px] tabular", s.delta == null ? "text-faint" : s.delta > 0 ? "text-up" : s.delta < 0 ? "text-down" : "text-muted")}>
                      {s.delta == null ? "—" : signedInr(s.delta)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </aside>

      <Dialog
        open={describeOpen}
        onClose={() => setDescribeOpen(false)}
        title="Describe what to add"
        description="Speak or type. You'll review everything before it's added to the baseline."
        width="max-w-4xl"
      >
        <PlanFlow
          mode="append"
          tripId={trip.id}
          autoFocus
          onAppend={async (nodes) => {
            const taken = new Set(trip.nodes.map((n) => n.id));
            const fresh = nodes.map((n) => (taken.has(n.id) ? { ...n, id: `${n.id}x` } : n));
            await onSaveNodes([...trip.nodes, ...fresh]);
            setDescribeOpen(false);
            toast({ tone: "success", message: `Added ${fresh.length} item${fresh.length === 1 ? "" : "s"} — searching prices` });
            void onRefresh(fresh.filter((n) => n.kind !== "transfer").map((n) => n.id));
          }}
        />
      </Dialog>
      <NodeEditor open={editorOpen} onClose={() => setEditorOpen(false)} nodes={trip.nodes} editing={editing} onSave={saveNode} />
      <Dialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Remove ${deleting ? nodeTitle(deleting) : ""}?`}
        description="This changes the baseline. Scenarios that reference this item will report an error."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const d = deleting!;
                setDeleting(null);
                void mutate((nodes) => nodes.filter((n) => n.id !== d.id), `Removed ${nodeTitle(d)}`);
              }}
            >
              Remove
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-ink-2">Dependencies are re-derived from the remaining items.</p>
      </Dialog>
    </div>
  );
}

function BaselineSummary({ view, refreshing }: { view: BaselineView; refreshing: boolean }) {
  const { trip, observations, totals } = view;
  let flights = 0, hotels = 0, oldest: string | null = null, failed = 0;
  for (const n of trip.nodes) {
    const o = observations[n.id];
    if (!o) continue;
    if (o.status === "error") failed++;
    if (!oldest || o.observedAt < oldest) oldest = o.observedAt;
    if (o.status !== "ok" || !o.result) continue;
    if (o.result.type === "flight") flights += o.result.price;
    if (o.result.type === "hotel") hotels += o.result.total;
  }
  const hasAny = totals.observed != null;
  return (
    <Card className="p-4" data-testid="baseline-summary">
      <SectionLabel right={oldest && <FreshnessStamp iso={oldest} withLabel />}>Current estimate</SectionLabel>
      <div className="mt-2 flex items-baseline gap-2">
        <span className={cx("font-mono text-[28px] font-semibold tracking-tight tabular", !hasAny && "text-faint")}>{hasAny ? inr(totals.observed) : "₹—"}</span>
      </div>
      <p className="text-[12px] text-muted">
        {refreshing
          ? "Searching current prices…"
          : !hasAny
            ? "Not priced yet — refresh to search current fares and rates."
            : totals.missing
              ? `Observed flights + hotels · excludes ${plural(totals.missing, "unpriced item")}`
              : "Observed flights + hotels, from current search results"}
      </p>
      <div className="mt-4 space-y-1.5 border-t border-dashed border-line-strong pt-3 text-[12.5px]">
        <Row label="Flights" value={inr(flights)} />
        <Row label="Hotels" value={inr(hotels)} />
        <Row label="Your estimates" value={inr(totals.estimates)} muted hint="Activities & transfers — not refreshed" />
        {failed > 0 && <Row label="Failed searches" value={String(failed)} tone="text-error" />}
      </div>
      {trip.nodes.some((n) => n.kind === "stay" || n.kind === "flight") && (
        <p className="mt-3 text-[11.5px] leading-relaxed text-faint">
          Route {[...new Set(trip.nodes.filter((n) => n.kind === "flight").flatMap((n) => (n.kind === "flight" ? [airportCity(n.from), airportCity(n.to)] : [])))].join(" · ")}.
          Prices are observations, not quotes.
        </p>
      )}
    </Card>
  );
}

function Row({ label, value, muted, hint, tone }: { label: string; value: string; muted?: boolean; hint?: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between" title={hint}>
      <span className={muted ? "text-muted" : "text-ink-2"}>{label}</span>
      <span className={cx("font-mono tabular", muted ? "text-muted" : "text-ink", tone)}>{value}</span>
    </div>
  );
}

export function suggestPrompts(nodes: TripNode[]): string[] {
  const out = ["Leave one day later"];
  const stays = sortNodes(nodes).filter((n) => n.kind === "stay");
  const flights = sortNodes(nodes).filter((n) => n.kind === "flight");
  if (stays[0]?.kind === "stay") out.push(`One more night in ${stays[0].city}`);
  if (flights.length > 2 && flights[1].kind === "flight") out.push(`Fly to ${airportCity(flights[1].to)} a day later`);
  if (flights.length > 1) out.push("Come home a day earlier");
  if (stays.length > 1 && stays[stays.length - 1].kind === "stay") out.push(`Shorten ${(stays[stays.length - 1] as { city: string }).city} by 1 night`);
  return out.slice(0, 5);
}
