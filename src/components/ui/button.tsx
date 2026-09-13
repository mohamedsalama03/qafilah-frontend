import { LoaderCircle } from "lucide-react";
import type { ComponentPropsWithRef } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";

const variants: Record<ButtonVariant, string> = {
  primary: "border-brand bg-brand text-white hover:brightness-95",
  secondary: "border-border bg-surface text-text hover:bg-surface-subtle",
  ghost: "border-transparent bg-transparent text-text hover:bg-surface-subtle",
  danger: "border-danger bg-danger text-white hover:brightness-95",
  link: "border-transparent bg-transparent text-brand underline-offset-4 hover:underline",
};

export function buttonStyles({
  variant = "secondary",
  size = "md",
  className,
}: {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "icon";
  className?: string;
} = {}) {
  return cn(
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-md border text-sm font-medium transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:pointer-events-none disabled:opacity-50",
    size === "sm" && "min-h-11 px-3 py-1.5 md:min-h-8 md:text-xs",
    size === "md" && "min-h-11 px-3 py-2 md:min-h-9 md:py-1.5",
    size === "icon" && "size-11 md:size-9",
    variants[variant],
    className,
  );
}

export interface ButtonProps extends ComponentPropsWithRef<"button"> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "icon";
  pending?: boolean;
  pendingLabel?: string;
}

export function Button({
  variant,
  size,
  pending = false,
  pendingLabel,
  disabled,
  className,
  children,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={buttonStyles({ variant, size, className })}
    >
      {pending && (
        <LoaderCircle
          className="size-4 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
      )}
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
