"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { Button, Dialog, Field, Input, useToast } from "./ui";

export function NewTripDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("");
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const t = await api.createTrip({ name: name.trim() || "Untitled trip", travelers: { adults, children }, nodes: [] });
      router.push(`/trips/${t.id}`);
    } catch (err) {
      toast({ tone: "error", message: (err as Error).message });
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="New trip" description="Name it and set who's travelling. You'll add flights and stays next.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Trip name">
          <Input autoFocus placeholder="e.g. Japan in spring" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Adults">
            <Input type="number" min={1} max={9} value={adults} onChange={(e) => setAdults(Math.max(1, Math.min(9, Number(e.target.value) || 1)))} />
          </Field>
          <Field label="Children">
            <Input type="number" min={0} max={8} value={children} onChange={(e) => setChildren(Math.max(0, Math.min(8, Number(e.target.value) || 0)))} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            Create trip
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
