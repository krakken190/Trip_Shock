import { BedDouble, CarTaxiFront, Landmark, Plane } from "lucide-react";
import type { NodeKind } from "@/domain/types";
import { cx } from "./ui";

export const KIND_META: Record<NodeKind, { label: string; Icon: typeof Plane; color: string; soft: string }> = {
  flight: { label: "Flight", Icon: Plane, color: "text-k-flight", soft: "bg-[#eef3ff]" },
  stay: { label: "Stay", Icon: BedDouble, color: "text-k-stay", soft: "bg-[#f4efff]" },
  activity: { label: "Activity", Icon: Landmark, color: "text-k-activity", soft: "bg-[#fdf0f6]" },
  transfer: { label: "Transfer", Icon: CarTaxiFront, color: "text-k-transfer", soft: "bg-[#ebf8f6]" },
};

export function KindIcon({ kind, size = "md", className }: { kind: NodeKind; size?: "sm" | "md" | "lg"; className?: string }) {
  const m = KIND_META[kind];
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ring-black/[0.04]",
        m.soft,
        m.color,
        size === "sm" ? "size-6 rounded-md [&>svg]:size-3.5" : size === "lg" ? "size-10 [&>svg]:size-5" : "size-8 [&>svg]:size-4",
        className,
      )}
    >
      <m.Icon strokeWidth={1.9} />
    </span>
  );
}
