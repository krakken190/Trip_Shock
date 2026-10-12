"use client";

import { ArrowLeft, Check, CircleAlert, Info, Plus, Quote, RefreshCw, Sparkles, Star, Users, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { airportCity } from "@/domain/airports";
import { diffDays, shortDate } from "@/domain/dates";
import {
  activityFromPlace,
  itemIssues,
  itemWarnings,
  needsPlaces,
  orderItems,
  placesQuery,
  planSuggestions,
  planToNodes,
  type DraftItem,
  type DraftPlan,
} from "@/domain/trip-draft";
import type { NodeKind, PlaceCandidate, TripNode } from "@/domain/types";
import { api } from "@/lib/api";
import { plural } from "@/lib/format";
import { ProviderBadge } from "./evidence";
import { KIND_META, KindIcon } from "./kind";
import { Badge, Button, Card, cx, Input, Segmented, Select, Skeleton } from "./ui";

type PlacesState = { status: "loading" | "ready" | "error"; candidates: PlaceCandidate[]; selected: string[]; error?: string; provider?: "serpapi" | "mock" };

const newId = (kind: NodeKind) => `${kind.slice(0, 2)}_${Math.random().toString(36).slice(2, 8)}`;

export function DraftReview({
  plan,
  today,
  model,
  mode,
  busy,
  onBack,
  onConfirm,
}: {
  plan: DraftPlan;
  today: string;
  model: string;
  mode: "create" | "append";
  busy: boolean;
  onBack: () => void;
  onConfirm: (r: { name: string; travelers: { adults: number; children: number }; nodes: TripNode[] }) => void;
}) {
  const [items, setItems] = useState<DraftItem[]>(plan.items);
  const [name, setName] = useState(plan.name);
  const [adults, setAdults] = useState(plan.travelers.adults);
  const [children, setChildren] = useState(plan.travelers.children);
  const [travelersTouched, setTravelersTouched] = useState(false);
  const [places, setPlaces] = useState<Record<string, PlacesState>>({});

  const update = (key: string, patch: Partial<DraftItem>) =>
    setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch, defaulted: patch.defaulted ?? x.defaulted.filter((d) => !(d in patch)) } : x)));
  const remove = (key: string) => setItems((xs) => xs.filter((x) => x.key !== key));

  const loadPlaces = (it: DraftItem) => {
    setPlaces((p) => ({ ...p, [it.key]: { status: "loading", candidates: [], selected: [] } }));
    api
      .suggestPlaces(placesQuery(it))
      .then((r) => {
        const want = it.count ?? 2;
        setPlaces((p) => ({
          ...p,
          [it.key]: { status: "ready", candidates: r.candidates, provider: r.provider, selected: r.candidates.slice(0, want).map((c) => c.name) },
        }));
      })
      .catch((e) => setPlaces((p) => ({ ...p, [it.key]: { status: "error", candidates: [], selected: [], error: e.message } })));
  };

  // Fetch real places for every "something adventurous near X" request
  useEffect(() => {
    for (const it of items) if (needsPlaces(it) && it.city && !places[it.key]) loadPlaces(it);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const suggestions = useMemo(() => planSuggestions(items), [items]);
  const ordered = useMemo(() => orderItems(items), [items]);

  const issuesFor = (it: DraftItem) => {
    const base = itemIssues(it);
    if (!needsPlaces(it)) return base;
    const picked = places[it.key]?.selected.length ?? 0;
    return picked ? base.filter((x) => x !== "Pick places") : base;
  };
  const blocking = ordered.filter((it) => issuesFor(it).length > 0);

  const confirm = () => {
    // Expand interest items into the places the traveller picked
    const expanded = items.flatMap((it) => {
      if (!needsPlaces(it)) return [it];
      const st = places[it.key];
      return (st?.candidates ?? []).filter((c) => st!.selected.includes(c.name)).map((c) => activityFromPlace(it, c));
    });
    onConfirm({ name: name.trim() || plan.name, travelers: { adults, children }, nodes: planToNodes(expanded, newId) });
  };

  const expandedCount = items.reduce((n, it) => n + (needsPlaces(it) ? (places[it.key]?.selected.length ?? 0) : 1), 0);

  return (
    <div className="space-y-4" data-testid="draft-review">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[12px] text-muted">
            <Sparkles className="size-3.5 text-brand" /> Understood by <span className="font-mono text-[11.5px]">{model}</span>
          </div>
          <h2 className="mt-1 text-[20px] font-semibold tracking-[-0.01em]">Here&apos;s what we understood</h2>
          <p className="text-[13px] text-muted">Check each item. Nothing is saved until you confirm — amber fields are missing.</p>
        </div>
        <Button variant="ghost" size="sm" icon={<ArrowLeft className="size-3.5" />} onClick={onBack}>
          Edit description
        </Button>
      </div>

      {mode === "create" && (
        <Card className="flex flex-wrap items-end gap-4 p-4">
          <label className="min-w-56 flex-1">
            <span className="text-[12px] font-medium text-muted">Trip name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 h-9" />
          </label>
          <div>
            <span className="flex items-center gap-1 text-[12px] font-medium text-muted">
              <Users className="size-3" /> Travellers
              {plan.travelersDefaulted && !travelersTouched && <Badge tone="warn" className="ml-1">not stated · 1 adult assumed</Badge>}
            </span>
            <div className="mt-1 flex gap-2">
              <NumberField label="Adults" value={adults} min={1} max={9} onChange={(v) => (setAdults(v), setTravelersTouched(true))} />
              <NumberField label="Children" value={children} min={0} max={8} onChange={(v) => (setChildren(v), setTravelersTouched(true))} />
            </div>
          </div>
        </Card>
      )}

      {suggestions.some((s) => s.add) && (
        <div className="flex flex-wrap gap-2">
          {suggestions
            .filter((s) => s.add)
            .map((s) => (
              <button
                key={s.id}
                onClick={() => setItems((xs) => [...xs, s.add!])}
                className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-brand/40 bg-brand-soft/60 px-3 py-1.5 text-[12.5px] text-brand-ink hover:bg-brand-soft"
              >
                <Plus className="size-3.5" /> {s.label}
              </button>
            ))}
        </div>
      )}

      <div className="space-y-2.5">
        {ordered.map((it) => (
          <ItemCard
            key={it.key}
            it={it}
            issues={issuesFor(it)}
            warnings={itemWarnings(it, today)}
            suggestions={suggestions.filter((s) => s.itemKey === it.key)}
            places={places[it.key]}
            onPatch={(p) => update(it.key, p)}
            onRemove={() => remove(it.key)}
            onTogglePlace={(nameP) =>
              setPlaces((p) => {
                const st = p[it.key];
                const sel = st.selected.includes(nameP) ? st.selected.filter((x) => x !== nameP) : [...st.selected, nameP];
                return { ...p, [it.key]: { ...st, selected: sel } };
              })
            }
            onRetryPlaces={() => loadPlaces(it)}
          />
        ))}
        {ordered.length === 0 && (
          <Card className="border-dashed p-8 text-center text-[13px] text-muted shadow-none">
            Nothing to add yet — go back and describe at least one flight, stay or activity.
          </Card>
        )}
      </div>

      {plan.unmapped.length > 0 && (
        <Card className="flex gap-2.5 border-dashed bg-canvas p-3.5 shadow-none" data-testid="unmapped">
          <Info className="mt-0.5 size-4 shrink-0 text-muted" />
          <div className="text-[12.5px] text-ink-2">
            <div className="font-medium">Heard, but not something TripShock can plan yet</div>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted">
              {plan.unmapped.map((u) => (
                <li key={u}>
                  {u}
                  {/cost|price|estimate|budget/i.test(u) && " — we only show prices from live searches; add your own estimate on activities and transfers."}
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      <div className="sticky bottom-3 z-20">
        <Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 shadow-pop">
          <div className="text-[12.5px]">
            {blocking.length ? (
              <span className="flex items-center gap-1.5 text-warn">
                <CircleAlert className="size-3.5" /> {plural(blocking.length, "item")} need{blocking.length === 1 ? "s" : ""} attention
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-down">
                <Check className="size-3.5" /> {plural(expandedCount, "item")} ready
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onBack}>
              Back
            </Button>
            <Button variant="primary" onClick={confirm} disabled={!!blocking.length || !expandedCount} loading={busy} data-testid="confirm-draft">
              {mode === "create" ? "Create trip & search prices" : `Add ${plural(expandedCount, "item")} to plan`}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-surface px-2.5 text-[12.5px] shadow-card">
      <span className="text-muted">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))}
        className="w-9 bg-transparent text-right font-mono tabular outline-none"
      />
    </label>
  );
}

// ---------------------------------------------------------------------------- item card

function ItemCard({
  it,
  issues,
  warnings,
  suggestions,
  places,
  onPatch,
  onRemove,
  onTogglePlace,
  onRetryPlaces,
}: {
  it: DraftItem;
  issues: string[];
  warnings: string[];
  suggestions: ReturnType<typeof planSuggestions>;
  places?: PlacesState;
  onPatch: (p: Partial<DraftItem>) => void;
  onRemove: () => void;
  onTogglePlace: (name: string) => void;
  onRetryPlaces: () => void;
}) {
  const missing = (v: unknown) => (v == null || v === "" ? "!border-warn/60 !bg-warn-soft/40" : "");
  const date = (field: "start" | "end", label: string) => (
    <Field label={label}>
      <Input type="date" value={it[field] ?? ""} onChange={(e) => onPatch({ [field]: e.target.value || null, ...(field === "start" && it.kind !== "stay" ? { end: e.target.value || null } : {}) })} className={cx("h-8 text-[13px]", missing(it[field]))} />
    </Field>
  );
  const time = (field: "departAfter" | "departBefore" | "arriveBefore", label: string) => (
    <Field label={label}>
      <Input type="time" value={it[field] ?? ""} onChange={(e) => onPatch({ [field]: e.target.value || null })} className="h-8 w-[108px] text-[13px]" />
    </Field>
  );

  const title =
    it.kind === "flight"
      ? `${it.fromCity || airportCity(it.from ?? "") || "?"} → ${it.toCity || airportCity(it.to ?? "") || "?"}`
      : it.kind === "stay"
        ? it.hotelName || `Stay in ${it.city || "?"}`
        : it.kind === "activity"
          ? needsPlaces(it)
            ? `${cap(it.interest!)}${it.near ? ` near ${it.near}` : ""}`
            : it.name || "Activity"
          : `${it.from || "?"} → ${it.to || "?"}`;

  const nights = it.kind === "stay" && it.start && it.end ? diffDays(it.start, it.end) : null;

  return (
    <Card className={cx("relative p-4", issues.length ? "border-warn/40" : "")} data-testid={`draft-${it.kind}`}>
      <div className="flex items-start gap-3">
        <KindIcon kind={it.kind} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{KIND_META[it.kind].label}</span>
            <span className="truncate text-[14.5px] font-semibold tracking-tight">{title}</span>
            {nights != null && nights > 0 && <Badge tone="outline">{plural(nights, "night")}</Badge>}
          </div>
          {it.source && (
            <p className="mt-1 flex gap-1.5 text-[12px] italic text-muted">
              <Quote className="mt-0.5 size-3 shrink-0 text-faint" />“{it.source}”
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-end gap-2.5">
            {it.kind === "flight" && (
              <>
                <Field label={`From${it.fromCity ? ` · ${it.fromCity}` : ""}`}>
                  <Input value={it.from ?? ""} maxLength={3} onChange={(e) => onPatch({ from: e.target.value.toUpperCase() })} className={cx("h-8 w-20 font-mono uppercase", missing(it.from))} placeholder="PNQ" />
                </Field>
                <Field label={`To${it.toCity ? ` · ${it.toCity}` : ""}`}>
                  <Input value={it.to ?? ""} maxLength={3} onChange={(e) => onPatch({ to: e.target.value.toUpperCase() })} className={cx("h-8 w-20 font-mono uppercase", missing(it.to))} placeholder="GOI" />
                </Field>
                {date("start", "Date")}
                <Field label={`Cabin${it.defaulted.includes("cabin") ? " · default" : ""}`}>
                  <Select value={it.cabin ?? "economy"} onChange={(e) => onPatch({ cabin: e.target.value as DraftItem["cabin"] })} className="h-8 w-40 text-[13px]">
                    <option value="economy">Economy</option>
                    <option value="premium_economy">Premium economy</option>
                    <option value="business">Business</option>
                    <option value="first">First</option>
                  </Select>
                </Field>
                {time("departAfter", "Depart after")}
                {time("departBefore", "Depart before")}
                {time("arriveBefore", "Arrive by")}
              </>
            )}
            {it.kind === "stay" && (
              <>
                <Field label="City">
                  <Input value={it.city ?? ""} onChange={(e) => onPatch({ city: e.target.value })} className={cx("h-8 w-36", missing(it.city))} />
                </Field>
                {date("start", "Check-in")}
                {date("end", "Check-out")}
                <Field label="Hotel (optional)">
                  <Input value={it.hotelName ?? ""} onChange={(e) => onPatch({ hotelName: e.target.value || null })} placeholder="Any hotel" className="h-8 w-44" />
                </Field>
                {!it.hotelName && (
                  <>
                    <Field label="Kind of hotel">
                      <Segmented
                        size="sm"
                        value={it.tier ?? "mid"}
                        onChange={(v) => onPatch({ tier: v })}
                        options={[
                          { value: "budget", label: "Budget" },
                          { value: "mid", label: "Mid" },
                          { value: "luxury", label: "Luxury" },
                        ]}
                      />
                    </Field>
                    <Field label="Max ₹ / night">
                      <Input type="number" min={0} value={it.maxPerNight ?? ""} onChange={(e) => onPatch({ maxPerNight: e.target.value ? Number(e.target.value) : null })} placeholder="No limit" className="h-8 w-28" />
                    </Field>
                  </>
                )}
              </>
            )}
            {it.kind === "activity" && !needsPlaces(it) && (
              <>
                <Field label="Place">
                  <Input value={it.name ?? ""} onChange={(e) => onPatch({ name: e.target.value, placeQuery: `${e.target.value} ${it.city ?? ""}`.trim() })} className={cx("h-8 w-52", missing(it.name))} />
                </Field>
                <Field label="City">
                  <Input value={it.city ?? ""} onChange={(e) => onPatch({ city: e.target.value })} className={cx("h-8 w-32", missing(it.city))} />
                </Field>
                {date("start", "Date")}
                <Field label="Your cost estimate ₹">
                  <Input type="number" min={0} value={it.estimatedCost ?? ""} onChange={(e) => onPatch({ estimatedCost: e.target.value ? Number(e.target.value) : null })} placeholder="Optional" className="h-8 w-28" />
                </Field>
              </>
            )}
            {it.kind === "activity" && needsPlaces(it) && (
              <>
                <Field label="City">
                  <Input value={it.city ?? ""} onChange={(e) => onPatch({ city: e.target.value })} className={cx("h-8 w-32", missing(it.city))} />
                </Field>
                {date("start", "Date")}
              </>
            )}
            {it.kind === "transfer" && (
              <>
                <Field label="From">
                  <Input value={it.from ?? ""} onChange={(e) => onPatch({ from: e.target.value })} className={cx("h-8 w-32", missing(it.from))} />
                </Field>
                <Field label="To">
                  <Input value={it.to ?? ""} onChange={(e) => onPatch({ to: e.target.value })} className={cx("h-8 w-36", missing(it.to))} />
                </Field>
                <Field label={`Mode${it.defaulted.includes("mode") ? " · default" : ""}`}>
                  <Select value={it.mode ?? "taxi"} onChange={(e) => onPatch({ mode: e.target.value as DraftItem["mode"] })} className="h-8 w-28 text-[13px]">
                    {["taxi", "train", "shuttle", "ferry", "other"].map((m) => (
                      <option key={m} value={m}>
                        {cap(m)}
                      </option>
                    ))}
                  </Select>
                </Field>
                {date("start", "Date")}
                <Field label="Your cost estimate ₹">
                  <Input type="number" min={0} value={it.estimatedCost ?? ""} onChange={(e) => onPatch({ estimatedCost: e.target.value ? Number(e.target.value) : null })} placeholder="Optional" className="h-8 w-28" />
                </Field>
              </>
            )}
          </div>

          {it.kind === "activity" && needsPlaces(it) && (
            <PlacesPicker it={it} st={places} onToggle={onTogglePlace} onRetry={onRetryPlaces} />
          )}

          {(issues.length > 0 || warnings.length > 0 || suggestions.length > 0) && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {issues.map((x) => (
                <Badge key={x} tone="warn" icon={<CircleAlert className="size-3" />}>
                  {x === "Pick places" ? "Pick at least one place" : `Needs: ${x}`}
                </Badge>
              ))}
              {warnings.map((x) => (
                <Badge key={x} tone="outline">
                  {x}
                </Badge>
              ))}
              {suggestions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => onPatch(s.patch!)}
                  className="inline-flex h-6 items-center gap-1 rounded-md bg-brand-soft px-2 text-[11.5px] font-medium text-brand-ink hover:bg-brand-soft/70"
                >
                  <Sparkles className="size-3" /> {s.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button onClick={onRemove} aria-label="Remove item" className="absolute right-3 top-3 rounded-md p-1 text-faint hover:bg-sunken hover:text-ink">
          <X className="size-4" />
        </button>
      </div>
    </Card>
  );
}

function PlacesPicker({ it, st, onToggle, onRetry }: { it: DraftItem; st?: PlacesState; onToggle: (n: string) => void; onRetry: () => void }) {
  const want = it.count ?? 2;
  return (
    <div className="mt-3 rounded-xl border border-line bg-canvas p-3" data-testid="places-picker">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12.5px] font-medium">
          Pick places · {it.count ? `you asked for ${want}` : "choose any"}
          {st?.status === "ready" && <span className="font-normal text-muted"> · {st.selected.length} selected</span>}
        </span>
        <span className="flex items-center gap-2">
          {st?.provider && <ProviderBadge provider={st.provider} />}
          <span className="text-[11px] text-faint">Google Maps: “{placesQuery(it)}”</span>
        </span>
      </div>
      {(!st || st.status === "loading") && (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      )}
      {st?.status === "error" && (
        <div className="flex items-center gap-2 text-[12.5px] text-error">
          {st.error}
          <Button size="xs" icon={<RefreshCw className="size-3" />} onClick={onRetry}>
            Retry
          </Button>
        </div>
      )}
      {st?.status === "ready" && st.candidates.length === 0 && <p className="text-[12.5px] text-muted">No places found — edit the city or remove this item.</p>}
      {st?.status === "ready" && st.candidates.length > 0 && (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {st.candidates.map((c) => {
            const on = st.selected.includes(c.name);
            return (
              <button
                key={c.name}
                onClick={() => onToggle(c.name)}
                className={cx(
                  "flex items-start gap-2.5 rounded-lg border bg-surface px-3 py-2 text-left transition-colors",
                  on ? "border-brand/40 ring-1 ring-brand/20" : "border-line hover:border-line-strong",
                )}
              >
                <span className={cx("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border", on ? "border-brand bg-brand text-white" : "border-line-strong")}>
                  {on && <Check className="size-3" strokeWidth={3} />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium">{c.name}</span>
                  <span className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-muted">
                    {c.rating != null && (
                      <span className="inline-flex items-center gap-0.5">
                        <Star className="size-3 fill-current text-[#d4a017]" /> {c.rating}
                        {c.reviews != null && <span className="text-faint">({c.reviews.toLocaleString("en-IN")})</span>}
                      </span>
                    )}
                    {c.category && <span>{c.category}</span>}
                  </span>
                  {c.address && <span className="block truncate text-[11px] text-faint">{c.address}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {it.start && st?.status === "ready" && st.selected.length > 0 && (
        <p className="mt-2 text-[11.5px] text-muted">Each picked place becomes an activity on {shortDate(it.start)}; opening hours are checked after you create the trip.</p>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
