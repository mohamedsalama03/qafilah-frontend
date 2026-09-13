import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info";
const tones: Record<StatusTone, string> = {
  neutral: "bg-surface-subtle text-text-muted",
  success: "bg-success-subtle text-success",
  warning: "bg-warning-subtle text-warning",
  danger: "bg-danger-subtle text-danger",
  info: "bg-info-subtle text-info",
};

export function StatusBadge({
  tone = "neutral",
  className,
  children,
  ...props
}: ComponentProps<"span"> & { tone?: StatusTone }) {
  return (
    <span
      {...props}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium leading-5",
        tones[tone],
        className,
      )}
    >
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      {children}
    </span>
  );
}
