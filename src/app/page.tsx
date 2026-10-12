"use client";

import { ArrowRight, GitCompareArrows, Plus, Route, Sparkles, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { airportCity } from "@/domain/airports";
import { rangeLabel } from "@/domain/dates";
import { AppHeader } from "@/components/app-header";
import { NewTripDialog } from "@/components/new-trip-dialog";
import { PlanFlow, type FlowPhase } from "@/components/plan-flow";
import { Badge, Button, Card, Skeleton, useToast } from "@/components/ui";
import { api, type TripListItem } from "@/lib/api";
import { inr, plural, relative } from "@/lib/format";

export default function Home() {
  const router = useRouter();
  const toast = useToast();
  const [trips, setTrips] = useState<TripListItem[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [phase, setPhase] = useState<FlowPhase>("input");
  const reviewing = phase === "review";

  useEffect(() => {
    api.trips().then(setTrips).catch((e) => toast({ tone: "error", message: e.message }));
  }, [toast]);

  const loadSample = async () => {
    setCreating(true);
    try {
      const t = await api.createTrip({ sample: true });
      router.push(`/trips/${t.id}?refresh=1`);
    } catch (e) {
      toast({ tone: "error", message: (e as Error).message });
      setCreating(false);
    }
  };

  return (
    <div className="min-h-dvh">
      <AppHeader />
      <main className="mx-auto max-w-[1120px] px-4 pb-24 sm:px-6">
        {/* One PlanFlow instance: the layout around it changes, its state survives */}
        <section className={reviewing ? "mx-auto max-w-[980px] pb-8 pt-8" : "relative overflow-hidden pb-12 pt-12 sm:pt-16"}>
          {!reviewing && <div className="pointer-events-none absolute inset-0 bg-dots [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_70%)]" />}
          <div className={reviewing ? "" : "relative grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_380px]"}>
            <div className="min-w-0">
              {!reviewing && (
                <>
                  <Badge tone="brand" icon={<Sparkles className="size-3" />}>Dependency-aware trip simulator</Badge>
                  <h1 className="mt-4 text-[34px] font-semibold leading-[1.1] tracking-[-0.02em] sm:text-[44px]">
                    Say your trip.
                    <br />
                    <span className="text-muted">Then change one thing.</span>
                  </h1>
                  <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink-2">
                    Describe the trip out loud or in a sentence — cities, dates, cabin, the kind of hotel, what you want to do.
                    TripShock turns it into a plan, searches current prices, and shows what moves when you ask “what if?”.
                  </p>
                </>
              )}
              <div className={reviewing ? "" : "mt-6"}>
                <PlanFlow mode="create" onPhase={setPhase} />
              </div>
              {!reviewing && (
                <div className="mt-5 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
                  <span>or</span>
                  <Button size="sm" variant="ghost" onClick={() => setNewOpen(true)} icon={<Plus className="size-3.5" />}>
                    Build it manually
                  </Button>
                  <Button size="sm" variant="ghost" onClick={loadSample} loading={creating} icon={<Route className="size-3.5" />}>
                    Load the Delhi → Singapore → Bali demo
                  </Button>
                </div>
              )}
            </div>
            {!reviewing && <DiffTeaser />}
          </div>
        </section>

        {!reviewing && <section>
          <div className="mb-3 flex items-end justify-between">
            <h2 className="text-[15px] font-semibold tracking-tight">Your trips</h2>
            {trips && trips.length > 0 && <span className="text-[12.5px] text-muted">{plural(trips.length, "trip")}</span>}
          </div>
          {!trips && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-36 rounded-xl" />
              ))}
            </div>
          )}
          {trips && trips.length === 0 && (
            <Card className="flex flex-col items-center gap-2 border-dashed px-6 py-12 text-center shadow-none">
              <p className="text-[14px] font-medium">No trips yet</p>
              <p className="max-w-sm text-[13px] text-muted">Load the sample trip to explore a what-if in under a minute, or build your own plan from scratch.</p>
            </Card>
          )}
          {trips && trips.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {trips.map((t) => (
                <Link key={t.id} href={`/trips/${t.id}`} className="group">
                  <Card className="flex h-full flex-col p-4 transition-[box-shadow,border] hover:border-line-strong hover:shadow-pop">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="truncate text-[14.5px] font-semibold tracking-tight">{t.name}</h3>
                      <ArrowRight className="size-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />
                    </div>
                    <div className="mt-1 truncate font-mono text-[12px] text-muted">{t.route.length ? t.route.join(" → ") : "No flights yet"}</div>
                    <div className="mt-0.5 truncate text-[12.5px] text-ink-2">{t.route.length ? [...new Set(t.route.map(airportCity))].join(" · ") : " "}</div>
                    <div className="mt-auto flex items-end justify-between pt-5">
                      <div className="space-y-1 text-[12px] text-muted">
                        <div>{t.start && t.end ? `${rangeLabel(t.start, t.end)} · ${plural(t.days, "night")}` : "No dates"}</div>
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1"><Users className="size-3" />{t.travelers.adults + t.travelers.children}</span>
                          <span className="inline-flex items-center gap-1"><GitCompareArrows className="size-3" />{plural(t.scenarios, "scenario")}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-[14px] font-medium tabular">{inr(t.observedTotal)}</div>
                        <div className="text-[11px] text-muted">{t.observedTotal == null ? "not priced" : t.missing ? "partial · observed" : "observed"} · {relative(t.updatedAt)}</div>
                      </div>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </section>}
      </main>
      <NewTripDialog open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}

/** Static illustration of the product's core output, styled like a code diff. */
function DiffTeaser() {
  const rows: [string, string, string, string][] = [
    ["Flights", "3 changed", "−₹8,400", "text-down"],
    ["Hotels", "2 changed", "+₹2,100", "text-up"],
    ["Transfers", "", "unknown", "text-muted"],
    ["Activities", "", "1 constraint", "text-warn"],
  ];
  return (
    <div className="relative mt-14 hidden rounded-xl border border-line bg-surface p-4 font-mono text-[12.5px] shadow-pop lg:block lg:rotate-[0.6deg]">
      <div className="mb-3 flex items-center justify-between">
        <span className="rounded bg-ink px-1.5 py-0.5 text-[11px] font-semibold text-white">+1 DAY</span>
        <span className="text-[11px] text-faint">illustrative</span>
      </div>
      <div className="space-y-0.5 rounded-lg bg-canvas p-2.5">
        <div className="text-up">− DEL → SIN   Tue, Nov 10</div>
        <div className="text-down">+ DEL → SIN   Wed, Nov 11</div>
        <div className="text-up">− Singapore   Nov 10–13</div>
        <div className="text-down">+ Singapore   Nov 11–14</div>
      </div>
      <div className="mt-3 space-y-1">
        {rows.map(([k, sub, v, c]) => (
          <div key={k} className="flex justify-between">
            <span className="text-ink-2">
              {k} <span className="text-faint">{sub}</span>
            </span>
            <span className={c}>{v}</span>
          </div>
        ))}
        <div className="mt-2 flex justify-between border-t border-dashed border-line-strong pt-2 font-semibold">
          <span>Observed total Δ</span>
          <span className="text-down">−₹6,300</span>
        </div>
      </div>
    </div>
  );
}
