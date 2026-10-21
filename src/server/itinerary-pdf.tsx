import path from "node:path";
import { Circle, Document, Font, Page, Path, Rect, renderToBuffer, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import { dayLabel, diffDays, parseISODate, rangeLabel, shortDate, WEEKDAY_NAMES, weekday } from "@/domain/dates";
import type { NodeKind } from "@/domain/types";
import { inr, signedInr, timestamp } from "@/lib/format";
import { travellerLabel, type DayEventRole, type Itinerary, type ItineraryItem } from "./itinerary";

// ---------------------------------------------------------------------------- fonts & tokens

const FONT_DIR = path.join(process.cwd(), "node_modules", "geist", "dist", "fonts");
let fontsReady = false;
function registerFonts() {
  if (fontsReady) return;
  Font.register({
    family: "Geist",
    fonts: [
      { src: path.join(FONT_DIR, "geist-sans", "Geist-Regular.ttf"), fontWeight: 400 },
      { src: path.join(FONT_DIR, "geist-sans", "Geist-Medium.ttf"), fontWeight: 500 },
      { src: path.join(FONT_DIR, "geist-sans", "Geist-SemiBold.ttf"), fontWeight: 600 },
      { src: path.join(FONT_DIR, "geist-sans", "Geist-Bold.ttf"), fontWeight: 700 },
    ],
  });
  Font.register({ family: "GeistMono", src: path.join(FONT_DIR, "geist-mono", "GeistMono-Regular.ttf") });
  Font.registerHyphenationCallback((word) => [word]);
  fontsReady = true;
}

// Same palette as the app (src/app/globals.css)
const C = {
  ink: "#17171a",
  ink2: "#45454d",
  muted: "#75757e",
  faint: "#a3a3ab",
  line: "#e6e5e1",
  sunken: "#f2f2ef",
  canvas: "#f7f7f5",
  bolt: "#facc15",
  warn: "#b45309",
  warnSoft: "#fff7e8",
  error: "#c2262e",
  errorSoft: "#fef1f1",
  down: "#0b8a5f",
  up: "#d92d4a",
};
const KIND: Record<NodeKind, { color: string; soft: string; label: string }> = {
  flight: { color: "#2563eb", soft: "#eef3ff", label: "Flight" },
  stay: { color: "#7c3aed", soft: "#f4efff", label: "Stay" },
  activity: { color: "#db2777", soft: "#fdf0f6", label: "Activity" },
  transfer: { color: "#0d9488", soft: "#ebf8f6", label: "Transfer" },
};
const COST_COLOR = { flights: KIND.flight.color, hotels: KIND.stay.color, activities: KIND.activity.color, transfers: KIND.transfer.color };

const PAGE_W = 595.28;
const MARGIN = 36;
const CONTENT_W = PAGE_W - MARGIN * 2;

const s = StyleSheet.create({
  page: { fontFamily: "Geist", fontSize: 9, color: C.ink, paddingTop: MARGIN, paddingBottom: 54, paddingHorizontal: MARGIN, backgroundColor: "#ffffff" },
  h2: { fontSize: 12.5, fontWeight: 600, letterSpacing: -0.2, marginBottom: 2 },
  caption: { fontSize: 8, color: C.muted },
  eyebrow: { fontSize: 7, fontWeight: 600, letterSpacing: 1.1, color: C.muted, textTransform: "uppercase" },
  section: { marginTop: 22 },
  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 10 },
  mono: { fontFamily: "GeistMono" },
  footer: { position: "absolute", bottom: 24, left: MARGIN, right: MARGIN, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: C.faint, borderTopWidth: 0.6, borderTopColor: C.line, paddingTop: 7 },
});

// ---------------------------------------------------------------------------- icons (lucide paths)

const ICONS: Record<NodeKind | "alert", string[]> = {
  flight: ["M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"],
  stay: ["M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8", "M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4", "M12 4v6", "M2 18h20"],
  activity: ["M10 18v-7", "M11.119 2.205a2 2 0 0 1 1.762 0l7.84 3.846A.5.5 0 0 1 20.5 7h-17a.5.5 0 0 1-.22-.949z", "M14 18v-7", "M18 18v-7", "M3 22h18", "M6 18v-7"],
  transfer: ["M10 2h4", "m21 8-2 2-1.5-3.7A2 2 0 0 0 15.646 5H8.4a2 2 0 0 0-1.903 1.257L5 10 3 8", "M7 14h.01", "M17 14h.01", "M3 12a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", "M5 18v2", "M19 18v2"],
  alert: ["m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3", "M12 9v4", "M12 17h.01"],
};

function Icon({ name, color, size = 10 }: { name: keyof typeof ICONS; color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {ICONS[name].map((d, i) => (
        <Path key={i} d={d} stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </Svg>
  );
}

function KindChip({ kind, size = 20 }: { kind: NodeKind; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: 5, backgroundColor: KIND[kind].soft, alignItems: "center", justifyContent: "center" }}>
      <Icon name={kind} color={KIND[kind].color} size={size * 0.55} />
    </View>
  );
}

function Logo({ size = 26 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Rect x={0} y={0} width={32} height={32} rx={8} ry={8} fill={C.bolt} />
      <Path d="M18 5 8 18.5h7.4L14 27l10.5-14h-7.6L18 5Z" fill={C.ink} />
    </Svg>
  );
}

// ---------------------------------------------------------------------------- helpers

function fullRange(a: string, b: string) {
  const ya = a.slice(0, 4);
  const yb = b.slice(0, 4);
  return ya === yb ? `${dayLabel(a)} – ${dayLabel(b)}, ${yb}` : `${dayLabel(a)}, ${ya} – ${dayLabel(b)}, ${yb}`;
}

function sourceLabel(it: ItineraryItem, provider: Itinerary["provider"]) {
  if (it.source === "estimate") return "your estimate";
  if (it.source === "unavailable") return it.priceNote.toLowerCase();
  if (it.source === "none") return it.kind === "flight" || it.kind === "stay" ? "not searched" : "no estimate";
  return provider === "mock" ? "simulated" : "observed";
}

const ENGINE_LABEL: Record<string, string> = { google_flights: "Google Flights", google_hotels: "Google Hotels", google_maps: "Google Maps" };

const ROLE_LABEL: Record<DayEventRole, string> = { check_out: "Check-out", depart: "Flight", transfer: "Transfer", check_in: "Check-in", activity: "Activity" };

// ---------------------------------------------------------------------------- sections

function Cover({ it }: { it: Itinerary }) {
  const isScenario = it.version.kind === "scenario";
  return (
    <View style={{ marginTop: -MARGIN, marginHorizontal: -MARGIN, backgroundColor: C.ink, paddingHorizontal: MARGIN, paddingTop: 30, paddingBottom: 26 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Logo size={22} />
          <Text style={{ color: "#fafafa", fontSize: 11, fontWeight: 700, marginLeft: 8, letterSpacing: -0.2 }}>TripShock</Text>
        </View>
        <Text style={{ ...s.eyebrow, color: C.bolt }}>Final itinerary</Text>
      </View>
      <Text style={{ color: "#ffffff", fontSize: 26, fontWeight: 700, letterSpacing: -0.6, marginTop: 22 }}>{it.trip.name}</Text>
      <Text style={{ color: "#c9c9cf", fontSize: 10.5, marginTop: 6 }}>
        {it.start && it.end ? `${fullRange(it.start, it.end)} · ${it.nights} nights` : "No dates yet"} · {travellerLabel(it.trip.travelers)}
      </Text>
      <View style={{ flexDirection: "row", marginTop: 14 }}>
        <View style={{ flexDirection: "row", alignItems: "center", borderRadius: 4, paddingHorizontal: 7, paddingVertical: 3.5, backgroundColor: isScenario ? "#3b300c" : "#2b2b31" }}>
          <Text style={{ fontSize: 8, color: isScenario ? C.bolt : "#d4d4d8", fontWeight: 500 }}>
            {isScenario ? `What-if adopted: ${it.version.name}` : "Baseline plan"}
            {isScenario && it.version.deltaVsBaseline != null ? `  ·  ${signedInr(it.version.deltaVsBaseline)} vs baseline` : ""}
          </Text>
        </View>
        {it.provider === "mock" && (
          <View style={{ marginLeft: 6, borderRadius: 4, paddingHorizontal: 7, paddingVertical: 3.5, backgroundColor: "#3f1d1d" }}>
            <Text style={{ fontSize: 8, color: "#fca5a5", fontWeight: 500 }}>Simulated prices — not live data</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function Stats({ it }: { it: Itinerary }) {
  const count = (k: NodeKind) => it.items.filter((i) => i.kind === k).length;
  const cities = new Set(it.items.filter((i) => i.kind === "stay").map((i) => i.subtitle.split(" · ")[0])).size;
  const tiles: [string, string, string?][] = [
    ["Nights", String(it.nights)],
    ["Cities", String(cities)],
    ["Flights", String(count("flight"))],
    ["Activities", String(count("activity"))],
    ["Estimated total", inr(it.costs.total), it.costs.excluded.length ? `excl. ${it.costs.excluded.length} unpriced` : it.provider === "mock" ? "simulated" : "observed + estimates"],
  ];
  return (
    <View style={{ flexDirection: "row", marginTop: 18, borderWidth: 0.8, borderColor: C.line, borderRadius: 8 }}>
      {tiles.map(([label, value, sub], i) => (
        <View key={label} style={{ flex: i === tiles.length - 1 ? 1.7 : 1, paddingVertical: 10, paddingHorizontal: 12, borderLeftWidth: i ? 0.8 : 0, borderLeftColor: C.line }}>
          <Text style={s.eyebrow}>{label}</Text>
          <Text style={{ fontSize: i === tiles.length - 1 ? 15 : 17, fontWeight: 600, marginTop: 4, letterSpacing: -0.3 }}>{value}</Text>
          {sub && <Text style={{ ...s.caption, marginTop: 2 }}>{sub}</Text>}
        </View>
      ))}
    </View>
  );
}

function RouteGraphic({ it }: { it: Itinerary }) {
  const stops = it.route;
  if (stops.length < 2) return null;
  const H = 96;
  const lineY = 34;
  const pad = 34;
  const step = (CONTENT_W - pad * 2) / (stops.length - 1);
  const x = (i: number) => pad + i * step;
  return (
    <View style={s.section} wrap={false}>
      <View style={s.sectionHead}>
        <View>
          <Text style={s.h2}>Route</Text>
          <Text style={s.caption}>{stops.map((st) => st.code).join(" → ")}</Text>
        </View>
      </View>
      <View style={{ position: "relative", height: H, backgroundColor: C.canvas, borderRadius: 8 }}>
        <Svg width={CONTENT_W} height={H} style={{ position: "absolute", top: 0, left: 0 }}>
          <Path d={`M ${x(0)} ${lineY} L ${x(stops.length - 1)} ${lineY}`} stroke={C.line} strokeWidth={3} />
          {stops.slice(1).map((_, i) => (
            <Path key={i} d={`M ${x(i) + 9} ${lineY} L ${x(i + 1) - 9} ${lineY}`} stroke={KIND.flight.color} strokeWidth={1.4} strokeDasharray="3 3" />
          ))}
          {stops.map((st, i) => {
            const ends = i === 0 || i === stops.length - 1;
            return <Circle key={st.code + i} cx={x(i)} cy={lineY} r={6.5} fill={ends ? C.ink : "#ffffff"} stroke={C.ink} strokeWidth={2} />;
          })}
        </Svg>
        {stops.slice(1).map((st, i) => {
          const mid = (x(i) + x(i + 1)) / 2;
          return (
            <View key={`p${i}`} style={{ position: "absolute", left: mid - 9, top: lineY - 9, width: 18, height: 18, borderRadius: 9, backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center", borderWidth: 0.8, borderColor: C.line }}>
              <Icon name="flight" color={KIND.flight.color} size={10} />
            </View>
          );
        })}
        {stops.map((st, i) => {
          const nights = st.arrive && st.depart ? diffDays(st.arrive, st.depart) : null;
          const day = st.arrive ?? st.depart;
          const when = nights ? `${rangeLabel(st.arrive!, st.depart!)} · ${nights} night${nights === 1 ? "" : "s"}` : day ? shortDate(day) : "";
          return (
            <View key={`l${i}`} style={{ position: "absolute", left: x(i) - 50, width: 100, top: lineY + 12, alignItems: "center" }}>
              <Text style={{ ...s.mono, fontSize: 10, fontWeight: 600 }}>{st.code}</Text>
              <Text style={{ fontSize: 8, color: C.ink2, marginTop: 1 }}>{st.city}</Text>
              <Text style={{ fontSize: 7.5, color: C.muted, marginTop: 1 }}>
                {when}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function Timeline({ it }: { it: Itinerary }) {
  if (!it.start || !it.end || !it.items.length) return null;
  const days = diffDays(it.start, it.end) + 1;
  const labelW = 150;
  const colW = (CONTENT_W - labelW) / days;
  const rowH = 17;
  const headH = 24;
  const H = headH + it.items.length * rowH + 4;
  const cx = (d: string) => labelW + (diffDays(it.start!, d) + 0.5) * colW;
  const dayDates = Array.from({ length: days }, (_, i) => new Date(parseISODate(it.start!) + i * 86_400_000).toISOString().slice(0, 10));

  return (
    <View style={s.section} wrap={false}>
      <View style={s.sectionHead}>
        <View>
          <Text style={s.h2}>Trip at a glance</Text>
          <Text style={s.caption}>Every item on the plan, day by day</Text>
        </View>
        <View style={{ flexDirection: "row" }}>
          {(["flight", "stay", "activity", "transfer"] as const).map((k) => (
            <View key={k} style={{ flexDirection: "row", alignItems: "center", marginLeft: 10 }}>
              <View style={{ width: 7, height: 7, borderRadius: 2, backgroundColor: KIND[k].color, marginRight: 4 }} />
              <Text style={s.caption}>{KIND[k].label}</Text>
            </View>
          ))}
        </View>
      </View>
      <View style={{ position: "relative", height: H }}>
        <Svg width={CONTENT_W} height={H} style={{ position: "absolute", top: 0, left: 0 }}>
          {dayDates.map((d, i) => {
            const wd = weekday(d);
            return (wd === 0 || wd === 6) && <Rect key={d} x={labelW + i * colW} y={0} width={colW} height={H} fill={C.canvas} />;
          })}
          {dayDates.map((d, i) => (
            <Path key={`g${d}`} d={`M ${labelW + i * colW} ${headH - 4} L ${labelW + i * colW} ${H}`} stroke={C.line} strokeWidth={0.5} />
          ))}
          {it.items.map((item, r) => {
            const y = headH + r * rowH + rowH / 2;
            const color = KIND[item.kind].color;
            const warn = item.warnings.length > 0 || item.source === "unavailable";
            if (item.kind === "stay") {
              const x1 = cx(item.start);
              const x2 = cx(item.end);
              return <Rect key={item.id} x={x1} y={y - 4.5} width={Math.max(x2 - x1, 4)} height={9} rx={4.5} ry={4.5} fill={color} stroke={warn ? C.warn : color} strokeWidth={warn ? 1.4 : 0} />;
            }
            if (item.kind === "flight" && item.end !== item.start) {
              return <Rect key={item.id} x={cx(item.start) - 4.5} y={y - 4.5} width={cx(item.end) - cx(item.start) + 9} height={9} rx={4.5} ry={4.5} fill={color} />;
            }
            const r0 = item.kind === "transfer" ? 3.5 : 4.8;
            return <Circle key={item.id} cx={cx(item.start)} cy={y} r={r0} fill={color} stroke={warn ? C.warn : "#ffffff"} strokeWidth={warn ? 1.6 : 1} />;
          })}
          {it.items.map((item, r) => (
            <Path key={`rl${item.id}`} d={`M 0 ${headH + (r + 1) * rowH} L ${CONTENT_W} ${headH + (r + 1) * rowH}`} stroke={C.sunken} strokeWidth={0.5} />
          ))}
        </Svg>
        {dayDates.map((d, i) => (
          <View key={`h${d}`} style={{ position: "absolute", left: labelW + i * colW, width: colW, top: 0, alignItems: "center" }}>
            <Text style={{ fontSize: 6.5, color: C.faint }}>{["S", "M", "T", "W", "T", "F", "S"][weekday(d)]}</Text>
            <Text style={{ fontSize: 8, fontWeight: 600, color: C.ink2, marginTop: 1 }}>{Number(d.slice(8))}</Text>
          </View>
        ))}
        {it.items.map((item, r) => (
          <View key={`t${item.id}`} style={{ position: "absolute", left: 0, width: labelW - 8, top: headH + r * rowH + 3.5, flexDirection: "row", alignItems: "center" }}>
            <Icon name={item.kind} color={KIND[item.kind].color} size={8} />
            <Text style={{ fontSize: 7.8, marginLeft: 4, color: C.ink2 }}>
              {item.title.length > 30 ? `${item.title.slice(0, 29)}…` : item.title}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function Costs({ it }: { it: Itinerary }) {
  const { lines, total, observed, estimates, excluded } = it.costs;
  if (!total) return null;
  const barW = CONTENT_W;
  let acc = 0;
  const top = it.items.filter((i) => i.amount != null && i.amount > 0).sort((a, b) => b.amount! - a.amount!).slice(0, 6);
  const max = top[0]?.amount ?? 1;
  return (
    <View style={s.section} wrap={false}>
      <View style={s.sectionHead}>
        <View>
          <Text style={s.h2}>Where the money goes</Text>
          <Text style={s.caption}>
            {it.provider === "mock" ? "Simulated" : "Observed"} prices {inr(observed)} + your estimates {inr(estimates)}
          </Text>
        </View>
        <Text style={{ fontSize: 15, fontWeight: 700, letterSpacing: -0.3 }}>{inr(total)}</Text>
      </View>
      <Svg width={barW} height={14}>
        {lines.map((l) => {
          const w = (l.amount / total) * barW;
          const x0 = acc;
          acc += w;
          return <Rect key={l.key} x={x0} y={0} width={Math.max(w - 1.5, 1)} height={14} rx={3} ry={3} fill={COST_COLOR[l.key]} />;
        })}
      </Svg>
      <View style={{ flexDirection: "row", marginTop: 14 }}>
        <View style={{ flex: 1, paddingRight: 18 }}>
          {lines.map((l) => (
            <View key={l.key} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 4.5, borderBottomWidth: 0.6, borderBottomColor: C.sunken }}>
              <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: COST_COLOR[l.key], marginRight: 7 }} />
              <Text style={{ flex: 1, fontWeight: 500 }}>
                {l.label} <Text style={{ color: C.faint, fontWeight: 400 }}>· {l.count} · {l.source === "observed" ? (it.provider === "mock" ? "simulated" : "observed") : "estimate"}</Text>
              </Text>
              <Text style={{ width: 34, textAlign: "right", color: C.muted }}>{Math.round((l.amount / total) * 100)}%</Text>
              <Text style={{ width: 70, textAlign: "right", fontWeight: 600 }}>{inr(l.amount)}</Text>
            </View>
          ))}
          {excluded.length > 0 && (
            <Text style={{ ...s.caption, color: C.warn, marginTop: 6 }}>Not included (no current price): {excluded.join(", ")}</Text>
          )}
        </View>
        <View style={{ flex: 1, paddingLeft: 18, borderLeftWidth: 0.6, borderLeftColor: C.line }}>
          <Text style={{ ...s.eyebrow, marginBottom: 6 }}>Biggest items</Text>
          {top.map((item) => (
            <View key={item.id} style={{ marginBottom: 5.5 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ fontSize: 8, color: C.ink2 }}>
                  {item.title.length > 34 ? `${item.title.slice(0, 33)}…` : item.title}
                </Text>
                <Text style={{ fontSize: 8, fontWeight: 600 }}>{inr(item.amount)}</Text>
              </View>
              <View style={{ height: 4, backgroundColor: C.sunken, borderRadius: 2, marginTop: 2.5 }}>
                <View style={{ height: 4, width: `${Math.max(((item.amount ?? 0) / max) * 100, 2)}%`, backgroundColor: KIND[item.kind].color, borderRadius: 2 }} />
              </View>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

function Notes({ it }: { it: Itinerary }) {
  const conflicts = it.conflicts;
  const changes = it.version.changes;
  if (!conflicts.length && !changes.length) return null;
  return (
    <View style={s.section} wrap={false}>
      {changes.length > 0 && (
        <View style={{ backgroundColor: C.canvas, borderRadius: 8, padding: 12, marginBottom: conflicts.length ? 10 : 0 }}>
          <Text style={s.eyebrow}>Changed from the baseline</Text>
          {changes.map((c) => (
            <Text key={c} style={{ marginTop: 4, fontWeight: 500 }}>• {c}</Text>
          ))}
        </View>
      )}
      {conflicts.length > 0 && (
        <View style={{ backgroundColor: C.warnSoft, borderRadius: 8, padding: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Icon name="alert" color={C.warn} size={10} />
            <Text style={{ ...s.eyebrow, color: C.warn, marginLeft: 5 }}>Check before booking · {conflicts.length}</Text>
          </View>
          {conflicts.map((c) => (
            <View key={c.id} style={{ marginTop: 5 }}>
              <Text style={{ color: c.severity === "error" ? C.error : C.ink, fontWeight: 500 }}>• {c.message}</Text>
              {c.suggestion && <Text style={{ ...s.caption, marginLeft: 7, marginTop: 1 }}>{c.suggestion}</Text>}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function DayBlock({ day, it }: { day: Itinerary["days"][number]; it: Itinerary }) {
  return (
    <View wrap={false} style={{ flexDirection: "row", paddingVertical: 12, borderBottomWidth: 0.6, borderBottomColor: C.line }}>
      <View style={{ width: 74 }}>
        <Text style={{ ...s.eyebrow, color: C.faint }}>Day {day.index}</Text>
        <Text style={{ fontSize: 15, fontWeight: 700, marginTop: 2, letterSpacing: -0.4 }}>{shortDate(day.date)}</Text>
        <Text style={{ ...s.caption }}>{WEEKDAY_NAMES[weekday(day.date)]}</Text>
      </View>
      <View style={{ flex: 1 }}>
        {day.events.length === 0 && <Text style={{ color: C.muted, marginTop: 3 }}>Free day</Text>}
        {day.events.map(({ role, item }, i) => (
          <View key={`${role}${item.id}`} style={{ flexDirection: "row", marginTop: i ? 9 : 0 }}>
            <KindChip kind={item.kind} />
            <View style={{ flex: 1, marginLeft: 9 }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={{ ...s.eyebrow, fontSize: 6.5, color: KIND[item.kind].color }}>{ROLE_LABEL[role]}</Text>
                {item.fixed && <Text style={{ ...s.eyebrow, fontSize: 6.5, marginLeft: 6 }}>· Fixed</Text>}
              </View>
              <Text style={{ fontSize: 10, fontWeight: 600, marginTop: 1.5 }}>
                {item.title}
                {role === "depart" && item.times ? <Text style={{ ...s.mono, fontWeight: 400, color: C.ink2 }}>{`   ${item.times.depart} → ${item.times.arrive}`}</Text> : null}
              </Text>
              <Text style={{ ...s.caption, marginTop: 1.5 }}>
                {role === "check_in" ? `${item.subtitle} · check-out ${dayLabel(item.end)}` : role === "check_out" ? `${item.subtitle.split(" · ")[0]} · stayed since ${dayLabel(item.start)}` : item.subtitle}
                {role !== "check_out" && item.details.length ? ` · ${item.details.join(" · ")}` : ""}
              </Text>
              {role !== "check_out" &&
                item.warnings.map((w) => (
                  <View key={w} style={{ flexDirection: "row", alignItems: "center", marginTop: 2.5 }}>
                    <Icon name="alert" color={C.warn} size={7.5} />
                    <Text style={{ fontSize: 7.8, color: C.warn, marginLeft: 3 }}>{w}</Text>
                  </View>
                ))}
            </View>
            {role !== "check_out" && (
              <View style={{ width: 86, alignItems: "flex-end" }}>
                <Text style={{ fontSize: 10, fontWeight: 600, color: item.amount == null ? C.faint : C.ink }}>{item.amount == null ? "—" : inr(item.amount)}</Text>
                <Text style={{ fontSize: 7, color: item.source === "unavailable" ? C.warn : C.faint, marginTop: 1.5, textAlign: "right" }}>{sourceLabel(item, it.provider)}</Text>
              </View>
            )}
          </View>
        ))}
        {day.overnight && !day.events.some((e) => e.role === "check_in") && (
          <View style={{ flexDirection: "row", alignItems: "center", marginTop: day.events.length ? 9 : 4 }}>
            <Icon name="stay" color={C.faint} size={8} />
            <Text style={{ ...s.caption, marginLeft: 5 }}>Overnight · {day.overnight}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function Sources({ it }: { it: Itinerary }) {
  const rows = it.items.filter((i) => i.evidenceId || i.source === "estimate");
  if (!rows.length) return null;
  const col = { item: 170, src: 120, at: 120, amt: CONTENT_W - 170 - 120 - 120 };
  return (
    <View style={s.section}>
      <Text style={s.h2}>Price sources</Text>
      <Text style={{ ...s.caption, marginBottom: 8 }}>
        {it.provider === "mock"
          ? "These prices come from TripShock's simulated provider and are not real fares."
          : "Prices are current search results observed through SerpApi at the times shown — not booking quotes. Fares and room rates can change before you book."}
      </Text>
      <View style={{ flexDirection: "row", paddingVertical: 5, borderBottomWidth: 0.8, borderBottomColor: C.ink }} fixed>
        <Text style={{ ...s.eyebrow, width: col.item }}>Item</Text>
        <Text style={{ ...s.eyebrow, width: col.src }}>Source</Text>
        <Text style={{ ...s.eyebrow, width: col.at }}>Observed</Text>
        <Text style={{ ...s.eyebrow, width: col.amt, textAlign: "right" }}>Amount</Text>
      </View>
      {rows.map((r) => (
        <View key={r.id} wrap={false} style={{ flexDirection: "row", paddingVertical: 5, borderBottomWidth: 0.6, borderBottomColor: C.sunken }}>
          <View style={{ width: col.item, paddingRight: 8 }}>
            <Text style={{ fontWeight: 500 }}>{r.title.length > 34 ? `${r.title.slice(0, 33)}…` : r.title}</Text>
            <Text style={{ fontSize: 7, color: C.faint }}>{r.kind === "stay" ? `${r.start} → ${r.end}` : r.start}</Text>
          </View>
          <View style={{ width: col.src }}>
            <Text>{r.source === "estimate" ? "Your estimate" : `${r.engine ? ENGINE_LABEL[r.engine] ?? r.engine : "—"}${it.provider === "mock" ? " (sim.)" : ""}`}</Text>
            {r.evidenceId && <Text style={{ ...s.mono, fontSize: 6.5, color: C.faint }}>{r.evidenceId}</Text>}
          </View>
          <Text style={{ width: col.at, color: C.ink2 }}>{r.observedAt && r.source !== "estimate" ? timestamp(r.observedAt) : "—"}</Text>
          <Text style={{ width: col.amt, textAlign: "right", fontWeight: 600, color: r.amount == null ? C.warn : C.ink }}>{r.amount == null ? r.priceNote : inr(r.amount)}</Text>
        </View>
      ))}
      <View style={{ flexDirection: "row", justifyContent: "flex-end", paddingTop: 7 }}>
        <Text style={{ fontWeight: 600 }}>Total  </Text>
        <Text style={{ fontWeight: 700, width: col.amt, textAlign: "right" }}>{inr(it.costs.total)}</Text>
      </View>
    </View>
  );
}

function Footer({ it }: { it: Itinerary }) {
  return (
    <View style={s.footer} fixed>
      <Text>
        TripShock · {it.trip.name} · {it.version.kind === "scenario" ? it.version.name : "Baseline plan"} · generated {timestamp(it.generatedAt)}
      </Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  );
}

export function ItineraryDocument({ it }: { it: Itinerary }) {
  return (
    <Document title={`${it.trip.name} — itinerary`} author="TripShock" subject="Final trip itinerary" creator="TripShock">
      <Page size="A4" style={s.page}>
        <Cover it={it} />
        <Stats it={it} />
        <RouteGraphic it={it} />
        <Timeline it={it} />
        <Footer it={it} />
      </Page>
      <Page size="A4" style={s.page}>
        <View style={{ marginTop: -22 }}>
          <Costs it={it} />
        </View>
        <Notes it={it} />
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 26, marginBottom: 6 }} minPresenceAhead={120}>
          <View>
            <Text style={s.eyebrow}>Itinerary</Text>
            <Text style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.4, marginTop: 3 }}>Day by day</Text>
          </View>
          {it.start && it.end && <Text style={s.caption}>{fullRange(it.start, it.end)}</Text>}
        </View>
        {it.days.map((d) => (
          <DayBlock key={d.date} day={d} it={it} />
        ))}
        <Sources it={it} />
        <Footer it={it} />
      </Page>
    </Document>
  );
}

export async function renderItineraryPdf(it: Itinerary): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(<ItineraryDocument it={it} />);
}
