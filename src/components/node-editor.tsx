"use client";

import { Lock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { airportCity } from "@/domain/airports";
import { addDays, diffDays } from "@/domain/dates";
import { sortNodes, validateNodes } from "@/domain/graph";
import { TripNode as TripNodeSchema, type NodeKind, type TripNode } from "@/domain/types";
import { KIND_META, KindIcon } from "./kind";
import { Button, Dialog, Field, Input, Segmented, Select, Switch } from "./ui";

type Draft = Record<string, string | number | boolean | null>;

const newId = (kind: NodeKind) => `${kind.slice(0, 2)}_${Math.random().toString(36).slice(2, 8)}`;

function defaults(kind: NodeKind, nodes: TripNode[]): Draft {
  const sorted = sortNodes(nodes);
  const last = sorted[sorted.length - 1];
  const lastDate = last?.end ?? addDays(new Date().toISOString().slice(0, 10), 30);
  const lastFlight = [...sorted].reverse().find((n) => n.kind === "flight");
  const lastStay = [...sorted].reverse().find((n) => n.kind === "stay");
  switch (kind) {
    case "flight":
      return { from: lastFlight?.kind === "flight" ? lastFlight.to : "", to: "", start: lastDate, arrival: 0, cabin: "economy", departAfter: "", departBefore: "", arriveBefore: "", fixed: false };
    case "stay":
      return { city: lastFlight?.kind === "flight" ? airportCity(lastFlight.to) : "", hotelName: "", tier: "mid", maxPerNight: "", start: lastDate, end: addDays(lastDate, 3), fixed: false };
    case "activity":
      return { name: "", city: lastStay?.kind === "stay" ? lastStay.city : "", placeQuery: "", start: lastStay?.start ? addDays(lastStay.start, 1) : lastDate, estimatedCost: "", fixed: false };
    case "transfer":
      return { from: "Airport", to: "Hotel", mode: "taxi", start: lastFlight?.end ?? lastDate, estimatedCost: "", fixed: false };
  }
}

function fromNode(n: TripNode): Draft {
  switch (n.kind) {
    case "flight":
      return {
        from: n.from, to: n.to, start: n.start, arrival: diffDays(n.start, n.end), cabin: n.cabin, fixed: n.fixed,
        departAfter: n.timePreference?.departAfter ?? "", departBefore: n.timePreference?.departBefore ?? "", arriveBefore: n.timePreference?.arriveBefore ?? "",
      };
    case "stay":
      return { city: n.city, hotelName: n.hotelName ?? "", tier: n.budget?.tier ?? "mid", maxPerNight: n.budget?.maxPerNight ?? "", start: n.start, end: n.end, fixed: n.fixed };
    case "activity":
      return { name: n.name, city: n.city, placeQuery: n.placeQuery, start: n.start, estimatedCost: n.estimatedCost ?? "", fixed: n.fixed };
    case "transfer":
      return { from: n.from, to: n.to, mode: n.mode, start: n.start, estimatedCost: n.estimatedCost ?? "", fixed: n.fixed };
  }
}

function toNode(kind: NodeKind, id: string, d: Draft, prev?: TripNode): unknown {
  const cost = d.estimatedCost === "" || d.estimatedCost == null ? null : Number(d.estimatedCost);
  const s = (k: string) => String(d[k] ?? "").trim();
  switch (kind) {
    case "flight":
      return {
        id, kind, from: s("from").toUpperCase(), to: s("to").toUpperCase(), start: s("start"), end: addDays(s("start"), Number(d.arrival) || 0),
        cabin: d.cabin, fixed: !!d.fixed,
        timePreference: s("departAfter") || s("departBefore") || s("arriveBefore")
          ? { departAfter: s("departAfter") || null, departBefore: s("departBefore") || null, arriveBefore: s("arriveBefore") || null }
          : null,
        // Changing the route invalidates a pinned flight
        preferredFlight: prev?.kind === "flight" && prev.from === s("from").toUpperCase() && prev.to === s("to").toUpperCase() ? prev.preferredFlight ?? null : null,
      };
    case "stay":
      return {
        id, kind, city: s("city"), hotelName: s("hotelName") || null, start: s("start"), end: s("end"), fixed: !!d.fixed,
        budget: s("hotelName") ? null : { tier: d.tier || "mid", maxPerNight: d.maxPerNight === "" || d.maxPerNight == null ? null : Number(d.maxPerNight) },
      };
    case "activity":
      return { id, kind, name: s("name"), city: s("city"), placeQuery: s("placeQuery") || `${s("name")} ${s("city")}`, start: s("start"), end: s("start"), estimatedCost: cost, fixed: !!d.fixed };
    case "transfer":
      return { id, kind, from: s("from"), to: s("to"), mode: d.mode, start: s("start"), end: s("start"), estimatedCost: cost, fixed: !!d.fixed };
  }
}

export function NodeEditor({
  open,
  onClose,
  nodes,
  editing,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  nodes: TripNode[];
  editing: TripNode | null;
  onSave: (node: TripNode) => Promise<void>;
}) {
  const [kind, setKind] = useState<NodeKind>("flight");
  const [draft, setDraft] = useState<Draft>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setBusy(false);
    if (editing) {
      setKind(editing.kind);
      setDraft(fromNode(editing));
    } else {
      const k = nodes.length === 0 ? "flight" : kind;
      setKind(k);
      setDraft(defaults(k, nodes));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const nights = useMemo(() => {
    try {
      return kind === "stay" && draft.start && draft.end ? diffDays(String(draft.start), String(draft.end)) : null;
    } catch {
      return null;
    }
  }, [kind, draft.start, draft.end]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const candidate = toNode(kind, editing?.id ?? newId(kind), draft, editing ?? undefined);
    const parsed = TripNodeSchema.safeParse(candidate);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(`${issue.path.join(".") || "Field"}: ${issue.message}`);
      return;
    }
    const issues = validateNodes([parsed.data]);
    if (issues.length) {
      setError(issues[0].message);
      return;
    }
    setBusy(true);
    try {
      await onSave(parsed.data);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const fixedRow = (
    <div className="flex items-center justify-between rounded-lg border border-line bg-canvas px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <Lock className="size-3.5 text-muted" />
        <div>
          <div className="text-[13px] font-medium">Fixed</div>
          <div className="text-[12px] text-muted">Never moved automatically — changes that would move it show as conflicts.</div>
        </div>
      </div>
      <Switch checked={!!draft.fixed} onChange={(v) => setDraft((d) => ({ ...d, fixed: v }))} label="Fixed" />
    </div>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${KIND_META[editing.kind].label.toLowerCase()}` : "Add to plan"}
      description={editing ? "Edits create a new baseline revision. Scenarios recompute against it." : "Dependencies are derived automatically from the timeline."}
      width="max-w-xl"
    >
      <form onSubmit={submit} className="space-y-4">
        {!editing && (
          <Segmented
            className="w-full"
            value={kind}
            onChange={(k) => {
              setKind(k);
              setDraft(defaults(k, nodes));
              setError(null);
            }}
            options={(["flight", "stay", "activity", "transfer"] as NodeKind[]).map((k) => ({
              value: k,
              label: KIND_META[k].label,
              icon: <KindIcon kind={k} size="sm" className="!size-4 !bg-transparent !ring-0 [&>svg]:!size-3.5" />,
            }))}
          />
        )}

        {kind === "flight" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="From" hint={draft.from ? airportCity(String(draft.from).toUpperCase()) : "IATA code, e.g. DEL"}>
              <Input value={String(draft.from ?? "")} onChange={set("from")} maxLength={3} placeholder="DEL" className="font-mono uppercase" autoFocus />
            </Field>
            <Field label="To" hint={draft.to ? airportCity(String(draft.to).toUpperCase()) : "IATA code, e.g. SIN"}>
              <Input value={String(draft.to ?? "")} onChange={set("to")} maxLength={3} placeholder="SIN" className="font-mono uppercase" />
            </Field>
            <Field label="Departure date">
              <Input type="date" value={String(draft.start ?? "")} onChange={set("start")} />
            </Field>
            <Field label="Arrives">
              <Select value={String(draft.arrival ?? 0)} onChange={set("arrival")}>
                <option value="0">Same day</option>
                <option value="1">Next day (+1)</option>
                <option value="2">+2 days</option>
              </Select>
            </Field>
            <Field label="Cabin" className="col-span-2">
              <Select value={String(draft.cabin ?? "economy")} onChange={set("cabin")}>
                <option value="economy">Economy</option>
                <option value="premium_economy">Premium economy</option>
                <option value="business">Business</option>
                <option value="first">First</option>
              </Select>
            </Field>
            <div className="col-span-2 grid grid-cols-3 gap-3">
              <Field label="Depart after" hint="Optional">
                <Input type="time" value={String(draft.departAfter ?? "")} onChange={set("departAfter")} />
              </Field>
              <Field label="Depart before" hint="Optional">
                <Input type="time" value={String(draft.departBefore ?? "")} onChange={set("departBefore")} />
              </Field>
              <Field label="Arrive by" hint="Optional">
                <Input type="time" value={String(draft.arriveBefore ?? "")} onChange={set("arriveBefore")} />
              </Field>
            </div>
          </div>
        )}

        {kind === "stay" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="City">
              <Input value={String(draft.city ?? "")} onChange={set("city")} placeholder="Singapore" autoFocus />
            </Field>
            <Field label="Hotel" hint="Optional — blank uses the cheapest 4.0+ rated option">
              <Input value={String(draft.hotelName ?? "")} onChange={set("hotelName")} placeholder="Any hotel" />
            </Field>
            <Field label="Check-in">
              <Input type="date" value={String(draft.start ?? "")} onChange={set("start")} />
            </Field>
            <Field label="Check-out" hint={nights != null ? (nights > 0 ? `${nights} night${nights === 1 ? "" : "s"}` : "Must be after check-in") : undefined}>
              <Input type="date" value={String(draft.end ?? "")} onChange={set("end")} />
            </Field>
            {!String(draft.hotelName ?? "").trim() && (
              <>
                <Field label="Kind of hotel">
                  <Segmented
                    className="w-full"
                    value={String(draft.tier ?? "mid") as "budget" | "mid" | "luxury"}
                    onChange={(v) => setDraft((d) => ({ ...d, tier: v }))}
                    options={[
                      { value: "budget", label: "Budget" },
                      { value: "mid", label: "Mid" },
                      { value: "luxury", label: "Luxury" },
                    ]}
                  />
                </Field>
                <Field label="Max ₹ per night" hint="Optional hard limit">
                  <Input type="number" min={0} value={String(draft.maxPerNight ?? "")} onChange={set("maxPerNight")} placeholder="No limit" />
                </Field>
              </>
            )}
          </div>
        )}

        {kind === "activity" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Activity" className="col-span-2">
              <Input value={String(draft.name ?? "")} onChange={set("name")} placeholder="National Museum" autoFocus />
            </Field>
            <Field label="City">
              <Input value={String(draft.city ?? "")} onChange={set("city")} placeholder="Singapore" />
            </Field>
            <Field label="Date">
              <Input type="date" value={String(draft.start ?? "")} onChange={set("start")} />
            </Field>
            <Field label="Place lookup" hint="Used to find opening hours on Google Maps" className="col-span-2">
              <Input value={String(draft.placeQuery ?? "")} onChange={set("placeQuery")} placeholder={`${draft.name || "Place"} ${draft.city || ""}`.trim()} />
            </Field>
            <Field label="Your cost estimate (₹)" hint="Not refreshed — shown as an estimate" className="col-span-2">
              <Input type="number" min={0} value={String(draft.estimatedCost ?? "")} onChange={set("estimatedCost")} placeholder="Optional" />
            </Field>
          </div>
        )}

        {kind === "transfer" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="From">
              <Input value={String(draft.from ?? "")} onChange={set("from")} autoFocus />
            </Field>
            <Field label="To">
              <Input value={String(draft.to ?? "")} onChange={set("to")} />
            </Field>
            <Field label="Date">
              <Input type="date" value={String(draft.start ?? "")} onChange={set("start")} />
            </Field>
            <Field label="Mode">
              <Select value={String(draft.mode ?? "taxi")} onChange={set("mode")}>
                {["taxi", "train", "shuttle", "ferry", "other"].map((m) => (
                  <option key={m} value={m}>
                    {m[0].toUpperCase() + m.slice(1)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Your cost estimate (₹)" hint="Transfers have no live data source" className="col-span-2">
              <Input type="number" min={0} value={String(draft.estimatedCost ?? "")} onChange={set("estimatedCost")} placeholder="Optional" />
            </Field>
          </div>
        )}

        {fixedRow}

        {error && <p className="rounded-lg bg-error-soft px-3 py-2 text-[12.5px] text-error">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            {editing ? "Save changes" : `Add ${KIND_META[kind].label.toLowerCase()}`}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
