"use client";

import { CircleAlert, Ellipsis, Lock, LockOpen, Pencil, Pin, PinOff, RefreshCw, Trash2 } from "lucide-react";
import { airportCity } from "@/domain/airports";
import { dayLabel, diffDays, rangeLabel, shortDate, WEEKDAY_NAMES } from "@/domain/dates";
import { nodeTitle } from "@/domain/graph";
import type { Observation, TripNode } from "@/domain/types";
import { describeTimeWindow } from "@/domain/select";
import { duration, hhmm, inr, plural } from "@/lib/format";
import { EvidenceLink, FreshnessStamp } from "./evidence";
import { KindIcon } from "./kind";
import { Badge, cx, IconButton, Menu, MenuItem, Spinner } from "./ui";

export function nodeHeading(n: TripNode): { title: string; sub: string } {
  switch (n.kind) {
    case "flight": {
      const tw = describeTimeWindow(n.timePreference);
      return { title: `${airportCity(n.from)} → ${airportCity(n.to)}`, sub: `${n.from} → ${n.to}${n.cabin !== "economy" ? ` · ${n.cabin.replace("_", " ")}` : ""}${tw ? ` · ${tw}` : ""}` };
    }
    case "stay": {
      if (n.hotelName?.trim()) return { title: n.hotelName.trim(), sub: n.city };
      const tier = n.budget?.tier ?? "mid";
      const label = tier === "budget" ? "Budget hotel" : tier === "luxury" ? "Luxury (5★)" : "Any hotel · 4.0+";
      const cap = n.budget?.maxPerNight ? ` · ≤ ${inr(n.budget.maxPerNight)}/night` : "";
      return { title: `Stay in ${n.city}`, sub: `${label}${cap}` };
    }
    case "activity":
      return { title: n.name, sub: n.city };
    case "transfer":
      return { title: `${n.from} → ${n.to}`, sub: n.mode[0].toUpperCase() + n.mode.slice(1) };
  }
}

export function nodeDates(n: Pick<TripNode, "kind" | "start" | "end">): string {
  if (n.kind === "stay") {
    const nights = diffDays(n.start, n.end);
    return `${rangeLabel(n.start, n.end)} · ${plural(nights, "night")}`;
  }
  if (n.kind === "flight" && n.end !== n.start) return `${dayLabel(n.start)} → arr. ${shortDate(n.end)}`;
  return dayLabel(n.start);
}

/** One-line summary of what the evidence says about this node */
export function EvidenceSummary({ node, obs }: { node: TripNode; obs?: Observation }) {
  if (!obs) {
    if (node.kind === "transfer") return <span className="text-faint">No live data source</span>;
    return <span className="text-faint">Not searched yet</span>;
  }
  if (obs.status === "error") return <span className="text-error">Search failed</span>;
  if (obs.status === "no_results") return <span className="text-warn">{obs.note ?? "No results"}</span>;
  const r = obs.result;
  if (!r) return null;
  if (r.type === "flight") {
    const o = r.option;
    return (
      <span className="truncate">
        <span className="font-mono text-[11.5px]">{o.flightNumbers.join(" + ")}</span> · {hhmm(o.departTime)} → {hhmm(o.arriveTime)} · {duration(o.durationMin)} ·{" "}
        {o.stops === 0 ? "nonstop" : `${o.stops} stop`}
        {r.match === "preferred" && <Pin className="mb-0.5 ml-1 inline size-3 text-brand" />}
        {r.preferredFound === false && <span className="text-warn"> · pinned flight not found</span>}
        {r.timeWindowMatched === false && <span className="text-warn"> · nothing in your time window</span>}
        {o.arriveTime.slice(0, 10) > node.end && (
          <span className="text-warn" title="The observed option lands later than the plan's arrival date">
            {" "}· lands {shortDate(o.arriveTime.slice(0, 10))}
          </span>
        )}
      </span>
    );
  }
  if (r.type === "hotel") {
    return (
      <span className="truncate">
        {r.match === "cheapest_rated" && <>{r.hotel.name} · </>}
        {r.hotel.rating != null && <>★ {r.hotel.rating} · </>}
        {inr(r.perNight)}/night
      </span>
    );
  }
  if (r.closedWeekdays == null) return <span className="text-faint">Opening hours: insufficient evidence</span>;
  if (r.closedWeekdays.length === 0) return <span>Open daily{r.hours?.monday ? ` · ${r.hours.monday}` : ""}</span>;
  return <span>Closed {r.closedWeekdays.map((d) => WEEKDAY_NAMES[d]).join(", ")}s</span>;
}

export function PriceBlock({
  node,
  obs,
  lastKnown,
  loading,
  align = "right",
}: {
  node: TripNode;
  obs?: Observation;
  lastKnown?: Observation;
  loading?: boolean;
  align?: "left" | "right";
}) {
  const cls = cx("flex flex-col gap-0.5", align === "right" ? "items-end text-right" : "items-start");
  if (node.kind === "transfer" || node.kind === "activity") {
    return (
      <div className={cls}>
        <span className="font-mono text-[14px] text-ink-2 tabular">{node.estimatedCost != null ? inr(node.estimatedCost) : "—"}</span>
        <span className="text-[11px] text-faint">{node.estimatedCost != null ? "your estimate" : "no estimate"}</span>
      </div>
    );
  }
  if (loading) {
    return (
      <div className={cls}>
        <Spinner className="size-3.5" />
        <span className="text-[11px] text-muted">searching…</span>
      </div>
    );
  }
  if (!obs) {
    return (
      <div className={cls}>
        <span className="font-mono text-[14px] text-faint">—</span>
        <span className="text-[11px] text-faint">not observed</span>
      </div>
    );
  }
  const amount = obs.status === "ok" && obs.result ? (obs.result.type === "flight" ? obs.result.price : obs.result.type === "hotel" ? obs.result.total : null) : null;
  if (amount == null) {
    const lk = lastKnown?.result;
    const lkAmount = lk?.type === "flight" ? lk.price : lk?.type === "hotel" ? lk.total : null;
    return (
      <div className={cls}>
        <span className={cx("inline-flex items-center gap-1 text-[13px] font-medium", obs.status === "error" ? "text-error" : "text-warn")}>
          <CircleAlert className="size-3.5" /> Unavailable
        </span>
        <EvidenceLink id={obs.id}>{obs.status === "error" ? "search failed" : "no results"} · {obs.id}</EvidenceLink>
        {lkAmount != null && lastKnown && (
          <span className="text-[11px] text-muted" title="Most recent successful observation — not current">
            last known {inr(lkAmount)} ({shortDate(lastKnown.observedAt.slice(0, 10))})
          </span>
        )}
      </div>
    );
  }
  return (
    <div className={cls}>
      <EvidenceLink id={obs.id} className="!font-mono !text-[15px] !font-medium !text-ink !no-underline tabular hover:!text-brand">
        {inr(amount)}
      </EvidenceLink>
      <FreshnessStamp iso={obs.observedAt} withLabel />
    </div>
  );
}

export function NodeCard({
  node,
  obs,
  lastKnown,
  refreshing,
  conflict,
  onEdit,
  onToggleFixed,
  onDelete,
  onRefresh,
  onPin,
}: {
  node: TripNode;
  obs?: Observation;
  lastKnown?: Observation;
  refreshing?: boolean;
  conflict?: string;
  onEdit: () => void;
  onToggleFixed: () => void;
  onDelete: () => void;
  onRefresh: () => void;
  onPin?: (pin: boolean) => void;
}) {
  const h = nodeHeading(node);
  const pinned = node.kind === "flight" && !!node.preferredFlight;
  const canPin = node.kind === "flight" && obs?.status === "ok" && obs.result?.type === "flight";
  return (
    <div
      data-testid={`node-${node.id}`}
      className={cx(
        "group relative flex items-center gap-3.5 rounded-xl border bg-surface px-4 py-3.5 shadow-card transition-[border,box-shadow] hover:border-line-strong",
        conflict ? "border-warn/40" : "border-line",
      )}
    >
      <KindIcon kind={node.kind} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <button onClick={onEdit} className="truncate text-left text-[14px] font-semibold tracking-tight hover:underline decoration-line-strong underline-offset-2">
            {h.title}
          </button>
          <button
            onClick={onToggleFixed}
            title={node.fixed ? "Fixed — click to make flexible" : "Flexible — click to fix in place"}
            className={cx(
              "inline-flex h-5 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium transition-colors",
              node.fixed ? "bg-ink text-white" : "text-faint opacity-0 ring-1 ring-inset ring-line group-hover:opacity-100 hover:text-ink",
            )}
          >
            {node.fixed ? <Lock className="size-3" /> : <LockOpen className="size-3" />}
            {node.fixed ? "Fixed" : "Flexible"}
          </button>
          {pinned && <Badge tone="brand" icon={<Pin className="size-3" />}>{node.kind === "flight" && node.preferredFlight?.flightNumbers.join(" + ")}</Badge>}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted">
          <span className="shrink-0 font-medium text-ink-2">{nodeDates(node)}</span>
          <span className="text-faint">·</span>
          <span className="shrink-0">{h.sub}</span>
        </div>
        <div className="mt-1 flex min-w-0 items-center text-[12px] text-muted">
          <EvidenceSummary node={node} obs={obs} />
        </div>
        {conflict && (
          <div className="mt-2 flex items-start gap-1.5 text-[12px] text-warn">
            <CircleAlert className="mt-px size-3.5 shrink-0" /> {conflict}
          </div>
        )}
      </div>
      <PriceBlock node={node} obs={obs} lastKnown={lastKnown} loading={refreshing} />
      <Menu
        trigger={(toggle) => (
          <IconButton label={`Actions for ${nodeTitle(node)}`} onClick={toggle} className="-mr-1.5">
            <Ellipsis className="size-4" />
          </IconButton>
        )}
      >
        {(close) => (
          <>
            <MenuItem icon={<Pencil />} onClick={() => (close(), onEdit())}>Edit</MenuItem>
            {node.kind !== "transfer" && <MenuItem icon={<RefreshCw />} onClick={() => (close(), onRefresh())}>Refresh this search</MenuItem>}
            <MenuItem icon={node.fixed ? <LockOpen /> : <Lock />} onClick={() => (close(), onToggleFixed())}>
              {node.fixed ? "Make flexible" : "Fix in place"}
            </MenuItem>
            {node.kind === "flight" && (pinned || canPin) && onPin && (
              <MenuItem icon={pinned ? <PinOff /> : <Pin />} onClick={() => (close(), onPin(!pinned))}>
                {pinned ? "Unpin flight" : "Pin this flight number"}
              </MenuItem>
            )}
            <div className="my-1 h-px bg-line" />
            <MenuItem icon={<Trash2 />} danger onClick={() => (close(), onDelete())}>Remove</MenuItem>
          </>
        )}
      </Menu>
    </div>
  );
}
