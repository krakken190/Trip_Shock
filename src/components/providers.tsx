"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { api, type Meta } from "@/lib/api";
import { EvidenceProvider } from "./evidence";
import { ToastProvider } from "./ui";

const MetaCtx = createContext<Meta | null>(null);
export const useMeta = () => useContext(MetaCtx);

export function Providers({ children }: { children: React.ReactNode }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  useEffect(() => {
    api.meta().then(setMeta).catch(() => {});
  }, []);
  return (
    <MetaCtx.Provider value={meta}>
      <ToastProvider>
        <EvidenceProvider>{children}</EvidenceProvider>
      </ToastProvider>
    </MetaCtx.Provider>
  );
}

/** Re-render periodically so relative timestamps ("3 min ago") and staleness stay honest. */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
