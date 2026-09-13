"use client";

import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Label({ className, ...props }: ComponentPropsWithRef<"label">) {
  return <label className={cn("text-sm font-medium text-text", className)} {...props} />;
}

export function Select({ className, ...props }: ComponentPropsWithRef<"select">) {
  return (
    <select
      className={cn(
        "min-h-11 w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:text-text-muted aria-invalid:border-danger md:min-h-9 md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

interface ChoiceProps extends Omit<ComponentPropsWithRef<"input">, "type"> {
  label: ReactNode;
  description?: string;
}

function Choice({
  type,
  label,
  description,
  className,
  ...props
}: ChoiceProps & { type: "checkbox" | "radio" }) {
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer items-start gap-2.5 py-2 text-sm text-text has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50",
        className,
      )}
    >
      <input
        {...props}
        type={type}
        className="mt-0.5 size-4 shrink-0 accent-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      />
      <span>
        <span className="block font-medium">{label}</span>
        {description && (
          <span className="mt-0.5 block text-xs leading-5 text-text-muted">{description}</span>
        )}
      </span>
    </label>
  );
}

export function Checkbox(props: ChoiceProps) {
  return <Choice {...props} type="checkbox" />;
}
export function Radio(props: ChoiceProps) {
  return <Choice {...props} type="radio" />;
}
