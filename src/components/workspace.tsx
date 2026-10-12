"use client";

import { CalendarDays, GitCompareArrows, Network, RefreshCw, Settings2, Trash2, Users } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { airportCity } from "@/domain/airports";
import { rangeLabel } from "@/domain/dates";
import { tripSummary } from "@/domain/graph";
import type { TripNode } from "@/domain/types";
import { api, type BaselineView } from "@/lib/api";
import { plural } from "@/lib/format";
import { AppHeader } from "./app-header";
import { BaselineTab } from "./baseline-tab";
import { GraphTab } from "./graph-tab";
import { ScenarioTab } from "./scenario-tab";
import { Button, cx, Dialog, EmptyState, Field, Input, Skeleton, useToast } from "./ui";

export type Tab = "baseline" | "whatif" | "graph";

export function Workspace({ id }: { id: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const toast = useToast();
  const [view, setView] = useState<BaselineView | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState<string | null>(null);

  const tab = (search.get("tab") as Tab) || "baseline";
  const scenarioId = search.get("s");

  const navigate = useCallback(
    (next: { tab?: Tab; s?: string | null }) => {
      const p = new URLSearchParams(search.toString());
      p.delete("refresh");
      if (next.tab) p.set("tab", next.tab);
      if (next.s !== undefined) {
        if (next.s) p.set("s", next.s);
        else p.delete("s");
      }
      router.replace(`${pathname}?${p.toString()}`, { scroll: false });
    },
    [pathname, router, search],
  );

  const refresh = useCallback(
    async (nodeIds?: string[]) => {
      if (!view && !nodeIds) return;
      const ids = nodeIds ?? view!.trip.nodes.filter((n) => n.kind !== "transfer").map((n) => n.id);
      setRefreshing((s) => new Set([...s, ...ids]));
      try {
        const v = await api.refreshTrip(id, nodeIds);
        setView(v);
        const failed = Object.values(v.observations).filter((o) => o.status === "error").length;
        if (failed) toast({ tone: "error", message: `${plural(failed, "search")} failed — those prices are marked unavailable.` });
      } catch (e) {
        toast({ tone: "error", message: (e as Error).message });
      } finally {
        setRefreshing((s) => new Set([...s].filter((x) => !ids.includes(x))));
      }
    },
    [id, toast, view],
  );

  // Initial load (+ first refresh when arriving from "load sample")
  const autoRefreshed = useRef(false);
  useEffect(() => {
    api
      .trip(id)
      .then((v) => {
        setView(v);
        if (search.get("refresh") === "1" && !autoRefreshed.current) {
          autoRefreshed.current = true;
          const ids = v.trip.nodes.filter((n) => n.kind !== "transfer").map((n) => n.id);
          setRefreshing(new Set(ids));
          api
            .refreshTrip(id)
            .then(setView)
            .catch((e) => toast({ tone: "error", message: e.message }))
            .finally(() => {
              setRefreshing(new Set());
              navigate({});
            });
        }
      })
      .catch((e) => (e.status === 404 ? setNotFound(true) : toast({ tone: "error", message: e.message })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const saveNodes = useCallback(
    async (nodes: TripNode[]) => {
      if (!view) return;
      const v = await api.updateTrip(id, { name: view.trip.name, travelers: view.trip.travelers, nodes });
      setView(v);
      return v;
    },
    [id, view],
  );

  const reloadSummary = useCallback(async () => setView(await api.trip(id)), [id]);

  if (notFound) {
    return (
      <div className="min-h-dvh">
        <AppHeader />
        <EmptyState icon={<Network />} title="Trip not found" action={<Button onClick={() => router.push("/")}>Back to trips</Button>}>
          It may have been deleted.
        </EmptyState>
      </div>
    );
  }

  const trip = view?.trip;
  const summary = trip ? tripSummary(trip.nodes) : null;
  const pricing = refreshing.size > 0;

  return (
    <div className="min-h-dvh">
      <AppHeader crumbs={[{ label: "Trips", href: "/" }, { label: trip?.name ?? "…" }]} />

      <div className="border-b border-line bg-surface">
        <div className="mx-auto max-w-[1440px] px-4 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-4 pb-4 pt-6">
            <div className="min-w-0">
              {trip ? (
                <>
                  <h1 className="truncate text-[24px] font-semibold tracking-[-0.015em]">{trip.name}</h1>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-muted">
                    {summary!.route.length > 0 && (
                      <span className="flex items-center gap-1 font-mono text-[12.5px] text-ink-2">
                        {summary!.route.map((c, i) => (
                          <span key={i} className="flex items-center gap-1">
                            {i > 0 && <span className="text-faint">→</span>}
                            <span title={airportCity(c)} className="rounded bg-sunken px-1.5 py-0.5">
                              {c}
                            </span>
                          </span>
                        ))}
                      </span>
                    )}
                    {summary!.start && (
                      <span className="flex items-center gap-1.5">
                        <CalendarDays className="size-3.5" />
                        {rangeLabel(summary!.start, summary!.end!)} · {plural(summary!.days, "night")}
                      </span>
                    )}
                    <span className="flex items-center gap-1.5">
                      <Users className="size-3.5" />
                      {plural(trip.travelers.adults, "adult")}
                      {trip.travelers.children ? `, ${plural(trip.travelers.children, "child", "children")}` : ""}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <Skeleton className="h-8 w-64" />
                  <Skeleton className="mt-3 h-4 w-96" />
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" icon={<Settings2 className="size-3.5" />} onClick={() => setSettingsOpen(true)} disabled={!trip}>
                Trip settings
              </Button>
              <Button size="sm" icon={<RefreshCw className={cx("size-3.5", pricing && "animate-spin")} />} onClick={() => refresh()} disabled={!trip || pricing || !trip.nodes.length}>
                {pricing ? "Searching…" : "Refresh baseline prices"}
              </Button>
            </div>
          </div>
          <nav className="-mb-px flex gap-1 overflow-x-auto [scrollbar-width:none]" role="tablist">
            {(
              [
                ["baseline", "Baseline", <CalendarDays key="b" className="size-3.5" />],
                ["whatif", "What if…", <GitCompareArrows key="w" className="size-3.5" />],
                ["graph", "Dependencies", <Network key="g" className="size-3.5" />],
              ] as const
            ).map(([k, label, icon]) => (
              <button
                key={k}
                role="tab"
                aria-selected={tab === k}
                onClick={() => navigate({ tab: k })}
                className={cx(
                  "flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 pb-2.5 pt-1.5 text-[13.5px] font-medium transition-colors",
                  tab === k ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink",
                )}
              >
                {icon}
                {label}
                {k === "whatif" && view && view.scenarios.length > 0 && (
                  <span className="ml-0.5 rounded-full bg-sunken px-1.5 text-[11px] tabular text-muted">{view.scenarios.length}</span>
                )}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
        {!view ? (
          <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
            <div className="space-y-3">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-20 rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-64 rounded-xl" />
          </div>
        ) : tab === "baseline" ? (
          <BaselineTab
            view={view}
            refreshing={refreshing}
            onRefresh={refresh}
            onSaveNodes={saveNodes}
            onOpenScenario={(s) => navigate({ tab: "whatif", s })}
            onAsk={(p) => {
              setDraftPrompt(p);
              navigate({ tab: "whatif", s: null });
            }}
          />
        ) : tab === "whatif" ? (
          <ScenarioTab
            view={view}
            scenarioId={scenarioId}
            onSelect={(s) => navigate({ s })}
            onChanged={reloadSummary}
            draftPrompt={draftPrompt}
            onDraftConsumed={() => setDraftPrompt(null)}
            onGoGraph={(s) => navigate({ tab: "graph", s })}
          />
        ) : (
          <GraphTab view={view} scenarioId={scenarioId} onSelect={(s) => navigate({ s })} />
        )}
      </main>

      {trip && (
        <TripSettings
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          name={trip.name}
          travelers={trip.travelers}
          onSave={async (name, travelers) => {
            setView(await api.updateTrip(id, { name, travelers, nodes: trip.nodes }));
          }}
          onDelete={async () => {
            await api.deleteTrip(id);
            router.push("/");
          }}
        />
      )}
    </div>
  );
}

function TripSettings({
  open,
  onClose,
  name,
  travelers,
  onSave,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  name: string;
  travelers: { adults: number; children: number };
  onSave: (name: string, t: { adults: number; children: number }) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [n, setN] = useState(name);
  const [a, setA] = useState(travelers.adults);
  const [c, setC] = useState(travelers.children);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (open) {
      setN(name);
      setA(travelers.adults);
      setC(travelers.children);
      setConfirmDelete(false);
    }
  }, [open, name, travelers]);

  return (
    <Dialog open={open} onClose={onClose} title="Trip settings" description="Changing travellers changes every search, so prices will need a refresh.">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSave(n.trim() || name, { adults: a, children: c });
            onClose();
          } catch (err) {
            toast({ tone: "error", message: (err as Error).message });
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Trip name">
          <Input value={n} onChange={(e) => setN(e.target.value)} maxLength={120} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Adults">
            <Input type="number" min={1} max={9} value={a} onChange={(e) => setA(Math.max(1, Math.min(9, Number(e.target.value) || 1)))} />
          </Field>
          <Field label="Children">
            <Input type="number" min={0} max={8} value={c} onChange={(e) => setC(Math.max(0, Math.min(8, Number(e.target.value) || 0)))} />
          </Field>
        </div>
        <div className="flex items-center justify-between pt-1">
          {confirmDelete ? (
            <Button type="button" variant="danger" size="sm" icon={<Trash2 className="size-3.5" />} onClick={onDelete}>
              Confirm — delete trip & scenarios
            </Button>
          ) : (
            <Button type="button" variant="ghost" size="sm" className="text-error" onClick={() => setConfirmDelete(true)}>
              Delete trip…
            </Button>
          )}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy}>
              Save
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
