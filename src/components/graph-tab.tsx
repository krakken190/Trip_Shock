"use client";

import { ArrowRight, GitBranch, Lock, MousePointerClick } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Conflict } from "@/domain/constraints";
import { signedDays } from "@/domain/dates";
import type { NodeDiff } from "@/domain/diff";
import { isSpine, nodeTitle, sortNodes } from "@/domain/graph";
import type { Edge, TripNode } from "@/domain/types";
import { api, type BaselineView, type ScenarioView } from "@/lib/api";
import { KindIcon } from "./kind";
import { nodeDates, nodeHeading } from "./node-card";
import { Badge, Card, cx, SectionLabel, Select, Skeleton } from "./ui";

const EDGE_LABEL: Record<Edge["kind"], string> = {
  arrival_checkin: "arrival → check-in",
  checkout_departure: "check-out → departure",
  sequence: "sequence",
  activity_in_stay: "during stay",
  transfer_after_arrival: "after arrival",
  transfer_before_departure: "before departure",
};

const W = 264;
const H = 66;
const GAP_Y = 46;
const SPINE_X = 24;
const ATT_X = SPINE_X + W + 96;
const ATT_GAP = 10;

export function GraphTab({ view, scenarioId, onSelect }: { view: BaselineView; scenarioId: string | null; onSelect: (id: string | null) => void }) {
  const [sv, setSv] = useState<ScenarioView | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!scenarioId) {
      setSv(null);
      return;
    }
    setLoading(true);
    api
      .scenario(scenarioId)
      .then(setSv)
      .catch(() => onSelectRef.current(null))
      .finally(() => setLoading(false));
  }, [scenarioId, view.trip.revision]);

  const trip = view.trip;
  const nodes = sv?.nodes ?? trip.nodes;
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const diffById = useMemo(() => new Map((sv?.diff.nodes ?? []).map((d) => [d.nodeId, d])), [sv]);
  const conflicts = useMemo(() => (sv ? sv.conflicts.filter((c) => !c.preexisting) : view.conflicts), [sv, view.conflicts]);

  // Edges the propagation actually traversed
  const tracedEdges = useMemo(() => new Set(sv?.trace.flatMap((t) => (t.via.type === "edge" ? [t.via.edgeId] : [])) ?? []), [sv]);
  const brokenEdges = useMemo(() => {
    const m = new Map<string, Conflict>();
    for (const c of conflicts) {
      const edgeId = c.id.replace(/^(gap|overlap):/, "");
      if (edgeId !== c.id) m.set(edgeId, c);
    }
    return m;
  }, [conflicts]);

  // Layout: spine down the left, attachments to the right of their host
  const layout = useMemo(() => {
    const spine = sortNodes(trip.nodes).filter(isSpine);
    const attachments = new Map<string, string[]>();
    for (const e of trip.edges) if (e.mode === "follow") attachments.set(e.from.node, [...(attachments.get(e.from.node) ?? []), e.to.node]);
    const pos = new Map<string, { x: number; y: number }>();
    let y = 20;
    for (const s of spine) {
      pos.set(s.id, { x: SPINE_X, y });
      const att = attachments.get(s.id) ?? [];
      att.forEach((id, i) => pos.set(id, { x: ATT_X, y: y + i * (H + ATT_GAP) }));
      y += Math.max(H, att.length * (H + ATT_GAP) - ATT_GAP) + GAP_Y;
    }
    // Orphans (no host)
    for (const n of sortNodes(trip.nodes)) if (!pos.has(n.id)) {
      pos.set(n.id, { x: ATT_X, y });
      y += H + GAP_Y;
    }
    return { pos, height: y - GAP_Y + 20, width: ATT_X + W + 24 };
  }, [trip.nodes, trip.edges]);

  const sel = selected ? byId.get(selected) : null;

  if (!trip.nodes.length) return <p className="py-16 text-center text-[13.5px] text-muted">Add items to the baseline to see its dependency graph.</p>;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card className="min-w-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <div className="flex items-center gap-2">
            <GitBranch className="size-3.5 text-muted" />
            <Select value={scenarioId ?? ""} onChange={(e) => onSelect(e.target.value || null)} className="h-8 w-64 text-[12.5px]" aria-label="Graph for">
              <option value="">Baseline (rev {trip.revision})</option>
              {view.scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  Scenario: {s.name}
                </option>
              ))}
            </Select>
          </div>
          <Legend scenario={!!sv} />
        </div>
        <div className="overflow-auto bg-dots">
          {loading ? (
            <div className="space-y-4 p-6">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-64" />)}
            </div>
          ) : (
            <div className="relative" style={{ width: layout.width, height: layout.height }}>
              <svg className="absolute inset-0" width={layout.width} height={layout.height} aria-hidden>
                <defs>
                  <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M0 1 9 5 0 9z" fill="context-stroke" />
                  </marker>
                </defs>
                {trip.edges.map((e) => {
                  const a = layout.pos.get(e.from.node);
                  const b = layout.pos.get(e.to.node);
                  if (!a || !b) return null;
                  const traced = tracedEdges.has(e.id);
                  const broken = brokenEdges.get(e.id);
                  const stroke = broken ? (broken.severity === "error" ? "var(--color-error)" : "var(--color-warn)") : traced ? "var(--color-moved)" : "var(--color-line-strong)";
                  let d: string;
                  if (e.mode === "couple") {
                    const x = a.x + W / 2;
                    d = `M${x} ${a.y + H} L${x} ${b.y - 2}`;
                  } else {
                    const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x - 2, y2 = b.y + H / 2;
                    d = `M${x1} ${y1} C${x1 + 48} ${y1}, ${x2 - 48} ${y2}, ${x2} ${y2}`;
                  }
                  return (
                    <path
                      key={e.id}
                      d={d}
                      fill="none"
                      stroke={stroke}
                      strokeWidth={traced || broken ? 2 : 1.5}
                      strokeDasharray={broken ? "5 4" : traced ? "6 4" : e.mode === "follow" ? "3 3" : undefined}
                      className={traced && !broken ? "animate-flow" : undefined}
                      markerEnd="url(#arr)"
                    />
                  );
                })}
              </svg>
              {/* Spine edge labels */}
              {trip.edges.filter((e) => e.mode === "couple").map((e) => {
                const a = layout.pos.get(e.from.node);
                const b = layout.pos.get(e.to.node);
                if (!a || !b) return null;
                const broken = brokenEdges.get(e.id);
                const traced = tracedEdges.has(e.id);
                return (
                  <div
                    key={e.id}
                    className={cx(
                      "absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border bg-surface px-2 py-0.5 text-[10.5px] shadow-card",
                      broken ? (broken.severity === "error" ? "border-error/30 text-error" : "border-warn/30 text-warn") : traced ? "border-moved/30 text-moved" : "border-line text-muted",
                    )}
                    style={{ left: a.x + W / 2, top: (a.y + H + b.y) / 2 }}
                    title={broken?.message}
                  >
                    {EDGE_LABEL[e.kind]}
                    {e.lag !== 0 && ` · ${e.lag > 0 ? "+" : ""}${e.lag}d`}
                    {broken && " · broken"}
                  </div>
                );
              })}
              {trip.nodes.map((base) => {
                const p = layout.pos.get(base.id);
                const n = byId.get(base.id);
                if (!p || !n) return null;
                return (
                  <GraphNode
                    key={n.id}
                    node={n}
                    d={diffById.get(n.id)}
                    conflict={conflicts.find((c) => c.nodeIds.includes(n.id))}
                    selected={selected === n.id}
                    onClick={() => setSelected(n.id === selected ? null : n.id)}
                    style={{ left: p.x, top: p.y }}
                  />
                );
              })}
            </div>
          )}
        </div>
      </Card>

      <aside className="lg:sticky lg:top-20 lg:self-start">
        {sel ? (
          <NodeInspector node={sel} base={trip.nodes.find((n) => n.id === sel.id)!} d={diffById.get(sel.id)} sv={sv} trip={trip} conflicts={conflicts.filter((c) => c.nodeIds.includes(sel.id))} onPick={setSelected} />
        ) : (
          <Card className="p-5">
            <div className="flex items-center gap-2 text-[13.5px] font-semibold">
              <MousePointerClick className="size-4 text-muted" /> Inspect a node
            </div>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
              Solid lines couple the trip spine: moving a flight moves the adjacent check-in or check-out. Dotted lines are one-way — activities and transfers follow their host.
              {sv && " Animated edges show the path the change propagated along."}
            </p>
            {sv && (
              <div className="mt-4 space-y-1.5 border-t border-line pt-3 text-[12.5px]">
                <div className="flex justify-between"><span className="text-muted">Items moved</span><span className="font-mono">{sv.diff.nodes.filter((d) => d.structural === "moved" || d.structural === "resized").length}</span></div>
                <div className="flex justify-between"><span className="text-muted">Held (fixed)</span><span className="font-mono">{sv.diff.nodes.filter((d) => d.structural === "held").length}</span></div>
                <div className="flex justify-between"><span className="text-muted">Edges traversed</span><span className="font-mono">{tracedEdges.size}</span></div>
                <div className="flex justify-between"><span className="text-muted">Broken dependencies</span><span className="font-mono">{brokenEdges.size}</span></div>
              </div>
            )}
          </Card>
        )}
      </aside>
    </div>
  );
}

function Legend({ scenario }: { scenario: boolean }) {
  const item = (cls: string, label: string) => (
    <span className="flex items-center gap-1.5">
      <span className={cx("size-2.5 rounded-[3px] border-2", cls)} />
      {label}
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11.5px] text-muted">
      {scenario && item("border-moved bg-moved-soft", "changed")}
      {item("border-error bg-error-soft", "conflict")}
      {item("border-ink-2 bg-sunken", "fixed")}
      {item("border-line-strong bg-surface", scenario ? "unchanged" : "flexible")}
    </div>
  );
}

function GraphNode({ node, d, conflict, selected, onClick, style }: { node: TripNode; d?: NodeDiff; conflict?: Conflict; selected: boolean; onClick: () => void; style: React.CSSProperties }) {
  const changed = d && (d.structural === "moved" || d.structural === "resized");
  const h = nodeHeading(node);
  return (
    <button
      onClick={onClick}
      data-testid={`graph-node-${node.id}`}
      style={{ ...style, width: W, height: H }}
      className={cx(
        "absolute flex items-center gap-2.5 rounded-xl border-2 bg-surface px-3 text-left shadow-card transition-shadow hover:shadow-pop",
        conflict ? (conflict.severity === "error" ? "border-error bg-error-soft/40" : "border-warn bg-warn-soft/40") : changed ? "border-moved bg-moved-soft/40" : node.fixed ? "border-ink-2" : "border-line",
        selected && "ring-4 ring-brand/20",
      )}
    >
      <KindIcon kind={node.kind} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span className="truncate text-[12.5px] font-semibold">{h.title}</span>
          {node.fixed && <Lock className="size-3 shrink-0 text-ink-2" />}
        </div>
        <div className={cx("truncate text-[11.5px]", changed ? "font-medium text-moved" : "text-muted")}>{nodeDates(node)}</div>
        <div className="mt-0.5 flex items-center gap-1">
          {d?.structural === "moved" && <Badge tone="moved" className="h-4 px-1 text-[10px]">{signedDays(d.startDelta)}</Badge>}
          {d?.structural === "resized" && <Badge tone="moved" className="h-4 px-1 text-[10px]">resized</Badge>}
          {d?.structural === "held" && <Badge tone="dark" className="h-4 px-1 text-[10px]">held</Badge>}
          {conflict && <Badge tone={conflict.severity === "error" ? "error" : "warn"} className="h-4 px-1 text-[10px]">conflict</Badge>}
          {d?.search === "refetch" && <Badge tone="outline" className="h-4 px-1 text-[10px]">re-searched</Badge>}
          {d?.search === "reuse" && <span className="text-[10px] text-faint">reused</span>}
        </div>
      </div>
    </button>
  );
}

function NodeInspector({
  node,
  base,
  d,
  sv,
  trip,
  conflicts,
  onPick,
}: {
  node: TripNode;
  base: TripNode;
  d?: NodeDiff;
  sv: ScenarioView | null;
  trip: BaselineView["trip"];
  conflicts: Conflict[];
  onPick: (id: string) => void;
}) {
  const h = nodeHeading(node);
  const deps = trip.edges.filter((e) => e.from.node === node.id || e.to.node === node.id);
  const title = (id: string) => {
    const n = trip.nodes.find((x) => x.id === id);
    return n ? nodeTitle(n) : id;
  };
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
        <KindIcon kind={node.kind} />
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold">{h.title}</div>
          <div className="text-[12px] text-muted">{h.sub}</div>
        </div>
      </div>
      <div className="space-y-4 p-4 text-[12.5px]">
        <div>
          <SectionLabel>Dates</SectionLabel>
          <div className="mt-1.5 space-y-1">
            <div className="flex justify-between"><span className="text-muted">Baseline</span><span>{nodeDates(base)}</span></div>
            {sv && (
              <div className="flex justify-between"><span className="text-muted">Scenario</span><span className={d && d.structural !== "unchanged" && d.structural !== "held" ? "font-medium text-moved" : ""}>{nodeDates(node)}</span></div>
            )}
          </div>
        </div>
        {sv && d && d.reasons.length > 0 && (
          <div>
            <SectionLabel>Why</SectionLabel>
            <ul className="mt-1.5 space-y-1">
              {d.reasons.map((r) => (
                <li key={r} className="flex gap-1.5 text-ink-2"><ArrowRight className="mt-0.5 size-3 shrink-0 text-faint" />{r}</li>
              ))}
            </ul>
          </div>
        )}
        {sv && d && (
          <div>
            <SectionLabel>Search</SectionLabel>
            <p className="mt-1.5 text-ink-2">
              {d.search === "refetch" ? "Parameters changed — re-searched for the new dates." : d.search === "reuse" ? "Same search as the baseline — evidence reused, no new query." : "No live data source for this item."}
            </p>
          </div>
        )}
        {conflicts.length > 0 && (
          <div>
            <SectionLabel>Conflicts</SectionLabel>
            <ul className="mt-1.5 space-y-1.5">
              {conflicts.map((c) => (
                <li key={c.id} className={c.severity === "error" ? "text-error" : "text-warn"}>{c.message}</li>
              ))}
            </ul>
          </div>
        )}
        <div>
          <SectionLabel>Dependencies</SectionLabel>
          <ul className="mt-1.5 space-y-1">
            {deps.length === 0 && <li className="text-muted">None</li>}
            {deps.map((e) => {
              const other = e.from.node === node.id ? e.to.node : e.from.node;
              const outgoing = e.from.node === node.id;
              return (
                <li key={e.id}>
                  <button onClick={() => onPick(other)} className="flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-1 text-left hover:bg-sunken">
                    <span className="truncate">
                      <span className="text-faint">{outgoing ? "→" : "←"}</span> {title(other)}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted">
                      {EDGE_LABEL[e.kind]}
                      {e.mode === "follow" ? " · one-way" : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </Card>
  );
}
