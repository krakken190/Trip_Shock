"use client";

import { CircleAlert, GitBranch, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { planRefresh } from "@/domain/affected";
import { applyOperations } from "@/domain/propagate";
import type { Operation, Policy } from "@/domain/types";
import { api, type BaselineView, type ScenarioView } from "@/lib/api";
import { relative, signedInr } from "@/lib/format";
import { RunProgress, ScenarioComposer } from "./scenario-composer";
import { ScenarioResult } from "./scenario-result";
import { Button, cx, Dialog, Select, Skeleton, useToast } from "./ui";

export function ScenarioTab({
  view,
  scenarioId,
  onSelect,
  onChanged,
  draftPrompt,
  onDraftConsumed,
  onGoGraph,
}: {
  view: BaselineView;
  scenarioId: string | null;
  onSelect: (id: string | null) => void;
  onChanged: () => Promise<void>;
  draftPrompt: string | null;
  onDraftConsumed: () => void;
  onGoGraph: (id: string) => void;
}) {
  const toast = useToast();
  const [cache, setCache] = useState<Record<string, ScenarioView>>({});
  const [running, setRunning] = useState<{ searches: number } | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [initialPrompt] = useState(draftPrompt);

  useEffect(() => {
    if (draftPrompt) onDraftConsumed();
  }, [draftPrompt, onDraftConsumed]);

  const current = scenarioId ? cache[scenarioId] : null;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Load the selected scenario; re-load when the baseline revision changes.
  useEffect(() => {
    if (!scenarioId) return;
    let cancelled = false;
    api
      .scenario(scenarioId)
      .then((v) => !cancelled && setCache((c) => ({ ...c, [v.scenario.id]: v })))
      .catch((e) => {
        if (cancelled) return;
        toast({ tone: "error", message: e.message });
        if (e.status === 404) onSelectRef.current(null);
      });
    return () => {
      cancelled = true;
    };
  }, [scenarioId, view.trip.revision, view.trip.updatedAt, toast]);

  const run = useCallback(
    async (input: { ops: Operation[]; policy: Policy; prompt?: string }) => {
      const r = applyOperations(view.trip.nodes, view.trip.edges, input.ops, input.policy);
      setRunning({ searches: planRefresh(view.trip.nodes, r.nodes, view.trip.travelers).refetch.length });
      try {
        const v = await api.createScenario(view.trip.id, input);
        setCache((c) => ({ ...c, [v.scenario.id]: v }));
        onSelect(v.scenario.id);
        await onChanged();
      } catch (e) {
        toast({ tone: "error", message: (e as Error).message });
      } finally {
        setRunning(null);
      }
    },
    [view.trip, onSelect, onChanged, toast],
  );

  const rerun = async (id: string) => {
    setRefreshingId(id);
    try {
      const v = await api.refreshScenario(id, true);
      setCache((c) => ({ ...c, [id]: v }));
      await onChanged();
    } catch (e) {
      toast({ tone: "error", message: (e as Error).message });
    } finally {
      setRefreshingId(null);
    }
  };

  const remove = async (id: string) => {
    try {
      await api.deleteScenario(id);
      setCache(({ [id]: _, ...rest }) => rest);
      if (scenarioId === id) onSelect(null);
      await onChanged();
      toast({ tone: "success", message: "Scenario deleted — baseline unchanged" });
    } catch (e) {
      toast({ tone: "error", message: (e as Error).message });
    }
  };

  if (!view.trip.nodes.length) {
    return <p className="py-16 text-center text-[13.5px] text-muted">Add flights and stays to the baseline first.</p>;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[248px_minmax(0,1fr)]">
      {scenarioId && (
        <div className="flex gap-2 lg:hidden">
          <Select value={scenarioId} onChange={(e) => onSelect(e.target.value)} aria-label="Scenario" className="min-w-0 flex-1">
            {view.scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Button icon={<Plus className="size-3.5" />} onClick={() => onSelect(null)}>
            New
          </Button>
        </div>
      )}
      <aside className={cx("lg:sticky lg:top-20 lg:block lg:self-start", scenarioId && "hidden")}>
        <Button variant={scenarioId ? "secondary" : "primary"} className="w-full" icon={<Plus className="size-3.5" />} onClick={() => onSelect(null)}>
          New scenario
        </Button>
        <div className="mt-4 flex items-center justify-between px-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Scenarios</span>
          <span className="text-[11px] text-faint">branches of rev {view.trip.revision}</span>
        </div>
        {view.scenarios.length === 0 ? (
          <p className="mt-2 rounded-lg border border-dashed border-line-strong px-3 py-4 text-center text-[12.5px] text-muted">None yet. Each run is saved as a branch you can reopen.</p>
        ) : (
          <ul className="mt-2 space-y-1" data-testid="scenario-list">
            {view.scenarios.map((s) => (
              <li key={s.id} className="group relative">
                <button
                  onClick={() => onSelect(s.id)}
                  className={cx(
                    "w-full rounded-lg border px-3 py-2.5 text-left transition-colors",
                    s.id === scenarioId ? "border-line-strong bg-surface shadow-card" : "border-transparent hover:bg-surface/70",
                  )}
                >
                  <div className="flex items-center gap-1.5 pr-5">
                    <GitBranch className="size-3 shrink-0 text-faint" />
                    <span className="truncate text-[13px] font-medium">{s.name}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 pl-4.5 text-[11.5px]">
                    <span className={cx("font-mono tabular", s.delta == null ? "text-faint" : s.delta > 0 ? "text-up" : s.delta < 0 ? "text-down" : "text-muted")}>
                      {s.delta == null ? "unpriced" : signedInr(s.delta)}
                      {s.delta != null && !s.complete && "*"}
                    </span>
                    {s.conflicts > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-warn">
                        <CircleAlert className="size-3" />
                        {s.conflicts}
                      </span>
                    )}
                    <span className="ml-auto text-faint">{relative(s.lastRefreshedAt ?? s.createdAt)}</span>
                  </div>
                </button>
                <button
                  aria-label={`Delete ${s.name}`}
                  onClick={() => setConfirmDelete(s.id)}
                  className="absolute right-2 top-2.5 rounded p-0.5 text-faint opacity-0 transition-opacity hover:bg-error-soft hover:text-error group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="min-w-0">
        {running ? (
          <RunProgress searches={running.searches} />
        ) : !scenarioId ? (
          <ScenarioComposer trip={view.trip} initialPrompt={initialPrompt} running={!!running} onRun={run} />
        ) : !current ? (
          <div className="space-y-3">
            <Skeleton className="h-16 rounded-xl" />
            <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
              <Skeleton className="h-96 rounded-xl" />
              <Skeleton className="h-80 rounded-xl" />
            </div>
          </div>
        ) : (
          <ScenarioResult
            v={current}
            refreshing={refreshingId === current.scenario.id}
            onRerun={() => rerun(current.scenario.id)}
            onDelete={() => setConfirmDelete(current.scenario.id)}
            onGraph={() => onGoGraph(current.scenario.id)}
          />
        )}
      </section>

      <Dialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Delete this scenario?"
        description="Scenarios are branches — deleting one never changes the baseline."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              data-testid="confirm-delete-scenario"
              onClick={() => {
                const id = confirmDelete!;
                setConfirmDelete(null);
                void remove(id);
              }}
            >
              Delete scenario
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-ink-2">Its saved searches remain in the evidence log.</p>
      </Dialog>
    </div>
  );
}
