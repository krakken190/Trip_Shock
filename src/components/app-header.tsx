"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { ProviderBadge } from "./evidence";
import { useMeta } from "./providers";

export function Logo() {
  return (
    <Link href="/" className="group flex items-center gap-2" aria-label="TripShock home">
      <span className="relative flex size-7 items-center justify-center rounded-lg bg-ink text-white shadow-[0_1px_0_rgb(255_255_255/0.15)_inset]">
        <svg viewBox="0 0 24 24" className="size-4" fill="none">
          <path d="M13.5 2 5 13.2h6.2L10 22l9-12h-6.4L13.5 2Z" fill="#facc15" />
        </svg>
      </span>
      <span className="text-[15px] font-semibold tracking-tight">TripShock</span>
    </Link>
  );
}

export function AppHeader({ crumbs, right }: { crumbs?: { label: string; href?: string }[]; right?: React.ReactNode }) {
  const meta = useMeta();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-3 px-4 sm:px-6">
        <Logo />
        {crumbs?.map((c, i) => (
          <span key={i} className="flex min-w-0 items-center gap-3 text-[13.5px]">
            <ChevronRight className="size-3.5 shrink-0 text-faint" />
            {c.href ? (
              <Link href={c.href} className="truncate text-muted hover:text-ink">
                {c.label}
              </Link>
            ) : (
              <span className="truncate font-medium">{c.label}</span>
            )}
          </span>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {right}
          {meta && (
            <span
              className="hidden items-center gap-2 text-[12px] text-muted sm:flex"
              title={meta.provider === "mock" ? "No SERPAPI_API_KEY configured. Prices are simulated deterministically." : "Searches go to SerpApi (Google Flights / Hotels / Maps)."}
            >
              <ProviderBadge provider={meta.provider} />
              <span>{meta.provider === "mock" ? "Demo data" : "SerpApi"}</span>
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
