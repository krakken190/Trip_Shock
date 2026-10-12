"use client";

import clsx from "clsx";
import { LoaderCircle, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

export const cx = clsx;

// ---------------------------------------------------------------------------- Button

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
type ButtonSize = "xs" | "sm" | "md" | "lg";

const BTN_BASE =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-[background,box-shadow,color,opacity] disabled:pointer-events-none disabled:opacity-50 select-none";
const BTN_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-ink text-white shadow-[0_1px_0_rgb(255_255_255/0.12)_inset,0_1px_2px_rgb(0_0_0/0.2)] hover:bg-[#2a2a31] active:bg-black",
  secondary: "bg-surface text-ink ring-1 ring-line-strong shadow-card hover:bg-sunken active:bg-line",
  ghost: "text-ink-2 hover:bg-sunken hover:text-ink",
  subtle: "bg-sunken text-ink-2 hover:bg-line hover:text-ink",
  danger: "bg-surface text-error ring-1 ring-line-strong hover:bg-error-soft hover:ring-error/30",
};
const BTN_SIZE: Record<ButtonSize, string> = {
  xs: "h-6 px-2 text-[11.5px] rounded-md",
  sm: "h-7.5 px-2.5 text-[12.5px] rounded-md",
  md: "h-9 px-3.5 text-[13.5px] rounded-lg",
  lg: "h-11 px-5 text-[14.5px] rounded-xl",
};

export function Button({
  variant = "secondary",
  size = "md",
  loading,
  icon,
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <button className={cx(BTN_BASE, BTN_VARIANT[variant], BTN_SIZE[size], className)} disabled={loading || rest.disabled} {...rest}>
      {loading ? <LoaderCircle className="size-3.5 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  className,
  children,
  size = "md",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: "sm" | "md" }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-sunken hover:text-ink disabled:opacity-40",
        size === "sm" ? "size-6" : "size-8",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------- Badge

export type Tone = "neutral" | "brand" | "up" | "down" | "moved" | "warn" | "error" | "outline" | "dark";
const TONE: Record<Tone, string> = {
  neutral: "bg-sunken text-ink-2",
  brand: "bg-brand-soft text-brand-ink",
  up: "bg-up-soft text-up",
  down: "bg-down-soft text-down",
  moved: "bg-moved-soft text-moved",
  warn: "bg-warn-soft text-warn",
  error: "bg-error-soft text-error",
  outline: "ring-1 ring-inset ring-line-strong text-ink-2",
  dark: "bg-ink text-white",
};

export function Badge({ tone = "neutral", className, children, icon, ...rest }: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone; icon?: React.ReactNode }) {
  return (
    <span
      className={cx("inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-md px-1.5 text-[11px] font-medium leading-none", TONE[tone], className)}
      {...rest}
    >
      {icon}
      {children}
    </span>
  );
}

export function Dot({ className }: { className?: string }) {
  return <span className={cx("inline-block size-1.5 shrink-0 rounded-full", className)} />;
}

// ---------------------------------------------------------------------------- Card

export function Card({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("rounded-xl border border-line bg-surface shadow-card", className)} {...rest} />;
}

export function SectionLabel({ children, className, right }: { children: React.ReactNode; className?: string; right?: React.ReactNode }) {
  return (
    <div className={cx("flex items-center justify-between gap-2", className)}>
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{children}</h3>
      {right}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cx("size-4 animate-spin text-muted", className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-md bg-sunken", className)} />;
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-strong bg-surface px-1 font-sans text-[10.5px] font-medium text-muted shadow-[0_1px_0_var(--color-line-strong)]">
      {children}
    </kbd>
  );
}

// ---------------------------------------------------------------------------- Form controls

export function Field({ label, hint, error, children, className }: { label: string; hint?: string; error?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cx("flex flex-col gap-1.5", className)}>
      <span className="text-[12.5px] font-medium text-ink-2">{label}</span>
      {children}
      {error ? <span className="text-[12px] text-error">{error}</span> : hint ? <span className="text-[12px] text-muted">{hint}</span> : null}
    </label>
  );
}

const INPUT =
  "h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-[13.5px] text-ink shadow-card outline-none transition-[border,box-shadow] placeholder:text-faint focus:border-brand focus:ring-3 focus:ring-brand/15";

export function Input({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(INPUT, className)} {...rest} />;
}

export function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx(
        INPUT,
        "appearance-none bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='none' stroke='%2375757e' stroke-width='1.6'%3E%3Cpath d='m3 4.5 3 3 3-3'/%3E%3C/svg%3E\")] bg-[length:12px] bg-[right_10px_center] bg-no-repeat pr-8",
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "md",
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode; icon?: React.ReactNode; title?: string }[];
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div role="radiogroup" className={cx("inline-flex rounded-lg bg-sunken p-0.5 ring-1 ring-inset ring-line", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            "inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-all",
            size === "sm" ? "h-6 px-2 text-[11.5px]" : "h-8 px-3 text-[12.5px]",
            value === o.value ? "bg-surface text-ink shadow-card ring-1 ring-line" : "text-muted hover:text-ink",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx("relative inline-flex h-5 w-8.5 shrink-0 items-center rounded-full transition-colors", checked ? "bg-ink" : "bg-line-strong")}
    >
      <span className={cx("absolute size-4 rounded-full bg-white shadow transition-transform", checked ? "translate-x-4" : "translate-x-0.5")} />
    </button>
  );
}

// ---------------------------------------------------------------------------- Overlays

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
}

function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? createPortal(children, document.body) : null;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = "max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
}) {
  useEscape(open, onClose);
  const id = useId();
  if (!open) return null;
  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 p-4 pt-[10vh] backdrop-blur-[2px] animate-fade-in" onMouseDown={onClose}>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={id}
          className={cx("w-full rounded-2xl border border-line bg-surface shadow-pop animate-rise", width)}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <h2 id={id} className="text-[15px] font-semibold tracking-tight">
                {title}
              </h2>
              {description && <p className="mt-0.5 text-[12.5px] text-muted">{description}</p>}
            </div>
            <IconButton label="Close" onClick={onClose} className="-mr-1.5 -mt-1">
              <X className="size-4" />
            </IconButton>
          </div>
          <div className="px-5 py-4">{children}</div>
          {footer && <div className="flex items-center justify-end gap-2 border-t border-line bg-canvas/60 px-5 py-3 rounded-b-2xl">{footer}</div>}
        </div>
      </div>
    </Portal>
  );
}

export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <Portal>
      <div className="fixed inset-0 z-50 bg-ink/20 animate-fade-in" onMouseDown={onClose}>
        <aside
          role="dialog"
          aria-modal="true"
          className="absolute inset-y-0 right-0 flex w-full max-w-[520px] flex-col border-l border-line bg-surface shadow-pop animate-slide-in"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <div className="text-[15px] font-semibold tracking-tight">{title}</div>
              {subtitle && <div className="mt-0.5 text-[12.5px] text-muted">{subtitle}</div>}
            </div>
            <IconButton label="Close" onClick={onClose} className="-mr-1.5">
              <X className="size-4" />
            </IconButton>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </aside>
      </div>
    </Portal>
  );
}

/** Small anchored menu */
export function Menu({ trigger, children, align = "right" }: { trigger: (toggle: () => void) => React.ReactNode; children: (close: () => void) => React.ReactNode; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    return () => {
      document.removeEventListener("mousedown", h);
      document.removeEventListener("keydown", k);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      {trigger(() => setOpen((o) => !o))}
      {open && (
        <div
          role="menu"
          className={cx("absolute top-full z-40 mt-1 min-w-48 rounded-xl border border-line bg-surface p-1 shadow-pop animate-rise", align === "right" ? "right-0" : "left-0")}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ icon, children, danger, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode; danger?: boolean }) {
  return (
    <button
      role="menuitem"
      className={cx(
        "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors disabled:opacity-40",
        danger ? "text-error hover:bg-error-soft" : "text-ink-2 hover:bg-sunken hover:text-ink",
      )}
      {...rest}
    >
      <span className="flex size-4 items-center justify-center [&>svg]:size-3.5">{icon}</span>
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------- Toasts

type Toast = { id: number; tone: "error" | "success" | "info"; message: string };
const ToastCtx = createContext<(t: Omit<Toast, "id">) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((xs) => [...xs, { ...t, id }]);
    setTimeout(() => setToasts((xs) => xs.filter((x) => x.id !== id)), t.tone === "error" ? 6000 : 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <Portal>
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={cx(
                "pointer-events-auto flex max-w-md items-center gap-2 rounded-xl px-3.5 py-2.5 text-[13px] shadow-pop animate-rise",
                t.tone === "error" ? "bg-error text-white" : "bg-ink text-white",
              )}
            >
              {t.message}
            </div>
          ))}
        </div>
      </Portal>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

// ---------------------------------------------------------------------------- Misc

export function EmptyState({ icon, title, children, action }: { icon: React.ReactNode; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-4 flex size-11 items-center justify-center rounded-xl bg-surface text-muted shadow-card ring-1 ring-line [&>svg]:size-5">{icon}</div>
      <h3 className="text-[14.5px] font-semibold">{title}</h3>
      {children && <p className="mt-1 max-w-sm text-[13px] text-muted">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
