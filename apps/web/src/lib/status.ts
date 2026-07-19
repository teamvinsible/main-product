import type { SpecStatus } from "@teamvinsible/shared";

export function formatStatusLabel(status: string) {
  return status.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function specStatusMeta(status: SpecStatus | string) {
  if (status === "ready") return { label: "Approved", cls: "approved", color: "success" as const };
  if (status === "needs-attention") return { label: "Attention", cls: "attention", color: "warning" as const };
  if (status === "cross-review") return { label: "Review", cls: "review", color: "processing" as const };
  return { label: "Editing", cls: "editing", color: "default" as const };
}
