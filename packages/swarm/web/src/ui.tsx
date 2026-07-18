import * as React from "react";
import { toast as sonnerToast } from "sonner";
import { Label } from "@/components/ui/label";

export function fmtTokens(n: number | undefined): string {
  const v = Number(n) || 0;
  if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + "k";
  return String(v);
}

export function fmtDuration(ms: number | undefined): string {
  if (!ms) return "-";
  return (ms / 60000).toFixed(1) + "min";
}

export interface ToastState { msg: string; ok: boolean }

// Backed by sonner. `show(msg, ok)` fires a toast; `toast` is kept for
// backward-compatible call sites during the migration.
export function useToast() {
  const show = React.useCallback((msg: string, ok: boolean) => {
    if (ok) sonnerToast.success(msg);
    else sonnerToast.error(msg);
  }, []);
  return { toast: null as ToastState | null, show };
}

// No-op: toasts render globally via <Toaster/> in App. Kept so existing
// `<Toast toast={...} />` call sites keep compiling.
export function Toast(_props: { toast: ToastState | null }) {
  return null;
}

export function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-col gap-1.5">
      {label && <Label>{label}</Label>}
      {children}
      {hint && <div className="text-[11px] leading-snug text-muted-foreground">{hint}</div>}
    </div>
  );
}
