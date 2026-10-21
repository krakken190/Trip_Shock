"use client";

import { CircleAlert, CircleCheck, Download, FileText, GitBranch, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { rangeLabel } from "@/domain/dates";
import { api, itineraryUrl, type BaselineView, type Itinerary } from "@/lib/api";
import { inr, plural, signedInr } from "@/lib/format";
import { Badge, Button, cx, Dialog, Skeleton, useToast } from "./ui";

/** Filename from `content-disposition`, preferring the UTF-8 form. */
function downloadName(header: string | null, fallback: string) {
  const star = header?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (star) return decodeURIComponent(star);
  return header?.match(/filename="([^"]+)"/i)?.[1] ?? fallback;
}

async function download(url: string, fallback: string) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error((j as { error?: string }).error ?? `Download failed (${res.status})`);
  }
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = downloadName(res.headers.get("content-disposition"), fallback);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function Check({ ok, children, action }: { ok: boolean; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 py-1.5 text-[12.5px]">
      {ok ? <CircleCheck className="mt-px size-4 shrink-0 text-down" /> : <CircleAlert className="mt-px size-4 shrink-0 text-warn" />}
      <span className={cx("flex-1", ok ? "text-ink-2" : "text-ink")}>{children}</span>
      {action}
    </li>
  );
}

export function FinalizeDialog({
  open,
  onClose,
  view,
  initialScenarioId,
  onRefreshBaseline,
}: {
  open: boolean;
  onClose: () => void;
  view: BaselineView;
  initialScenarioId: string | null;
  onRefreshBaseline: () => Promise<void>;
}) {
  const toast = useToast();
  const tripId = view.trip.id;
  const [choice, setChoice] = useState<string | null>(null);
  const [preview, setPreview] = useState<Itinerary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"download" | "refresh" | null>(null);

  useEffect(() => {
    if (open) setChoice(initialScenarioId && view.scenarios.some((s) => s.id === initialScenarioId) ? initialScenarioId : null);
  }, [open, initialScenarioId, view.scenarios]);

  const load = useCallback(async () => {
    setPreview(null);
    setError(null);
    try {
      setPreview(await api.itinerary(tripId, choice));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [tripId, choice]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const refreshPrices = async () => {
    setBusy("refresh");
    try {
      if (choice) await api.refreshScenario(choice, true);
      else await onRefreshBaseline();
      await load();
    } catch (e) {
      toast({ tone: "error", message: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const onDownload = async () => {
    setBusy("download");
    try {
      await download(itineraryUrl(tripId, choice), "itinerary.pdf");
      toast({ tone: "success", message: "Itinerary downloaded" });
      onClose();
    } catch (e) {
      toast({ tone: "error", message: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const versions = [
    { id: null, name: "Baseline plan", sub: "Your plan as it is now", delta: null as number | null, conflicts: view.conflicts.length },
    ...view.scenarios.map((s) => ({ id: s.id as string | null, name: s.name, sub: s.headline, delta: s.complete ? s.delta : null, conflicts: s.conflicts })),
  ];
  const r = preview?.readiness;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width="max-w-xl"
      title="Finalize trip"
      description="Choose the version you're going with. You'll get a PDF with the route, a day-by-day plan, costs and where every price came from."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={<Download className="size-3.5" />} loading={busy === "download"} disabled={!preview || busy !== null} onClick={onDownload} data-testid="download-itinerary">
            Download PDF
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div role="radiogroup" aria-label="Final version" className="space-y-1.5">
          {versions.map((v) => {
            const selected = choice === v.id;
            return (
              <button
                key={v.id ?? "baseline"}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`final-version-${v.id ?? "baseline"}`}
                onClick={() => setChoice(v.id)}
                className={cx(
                  "flex w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-[border,box-shadow,background]",
                  selected ? "border-ink bg-surface shadow-card ring-1 ring-ink" : "border-line hover:border-line-strong hover:bg-canvas",
                )}
              >
                <span className={cx("grid size-4 shrink-0 place-items-center rounded-full border", selected ? "border-ink" : "border-line-strong")}>
                  {selected && <span className="size-2 rounded-full bg-ink" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[13.5px] font-medium">
                    {v.id ? <GitBranch className="size-3.5 text-muted" /> : <FileText className="size-3.5 text-muted" />}
                    <span className="truncate">{v.name}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-[12px] text-muted">{v.sub}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {v.conflicts > 0 && <Badge tone="warn">{plural(v.conflicts, "conflict")}</Badge>}
                  {v.delta != null && <Badge tone={v.delta < 0 ? "down" : v.delta > 0 ? "up" : "neutral"}>{signedInr(v.delta)}</Badge>}
                </span>
              </button>
            );
          })}
        </div>

        <div className="rounded-xl border border-line bg-canvas p-3.5" data-testid="final-preview">
          {error ? (
            <p className="text-[12.5px] text-error">{error}</p>
          ) : !preview ? (
            <div className="space-y-2">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-semibold tracking-tight">{preview.trip.name}</div>
                  <div className="mt-0.5 text-[12px] text-muted">
                    {preview.start && preview.end ? `${rangeLabel(preview.start, preview.end)} · ${plural(preview.nights, "night")}` : "No dates yet"}
                    {preview.route.length > 0 && <span className="font-mono"> · {preview.route.map((s) => s.code).join(" → ")}</span>}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-[16px] font-medium tabular" data-testid="final-total">
                    {inr(preview.costs.total)}
                  </div>
                  <div className="text-[11px] text-muted">{preview.provider === "mock" ? "simulated" : "observed"} + your estimates</div>
                </div>
              </div>
              <ul className="mt-2.5 divide-y divide-line border-t border-line pt-1">
                <Check ok={r!.unpriced === 0}>
                  {r!.unpriced === 0 ? "Every flight and hotel has a current price" : `${plural(r!.unpriced, "flight or hotel", "flights or hotels")} without a current price — left out of the total`}
                </Check>
                <Check ok={r!.conflicts === 0}>{r!.conflicts === 0 ? "No conflicts in the plan" : `${plural(r!.conflicts, "conflict")} to check before booking — listed in the PDF`}</Check>
                <Check
                  ok={r!.stale === 0}
                  action={
                    r!.stale > 0 || r!.unpriced > 0 ? (
                      <Button size="xs" variant="secondary" icon={<RefreshCw className={cx("size-3", busy === "refresh" && "animate-spin")} />} disabled={busy !== null} onClick={refreshPrices}>
                        {busy === "refresh" ? "Searching…" : "Refresh prices"}
                      </Button>
                    ) : undefined
                  }
                >
                  {r!.stale === 0 ? "Prices observed in the last 6 hours" : `${plural(r!.stale, "price")} older than 6 hours`}
                </Check>
              </ul>
              {preview.provider === "mock" && <p className="mt-2 text-[11.5px] text-warn">Simulated prices — the PDF is clearly labelled as not live data.</p>}
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
