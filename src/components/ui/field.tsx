"use client";

import { cloneElement, type ComponentPropsWithRef, type ReactElement } from "react";
import { cn } from "@/lib/cn";

const controlStyles =
  "min-h-11 w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-text placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:text-text-muted aria-invalid:border-danger aria-invalid:focus-visible:outline-danger md:min-h-9 md:text-sm";

export function Input({ className, ...props }: ComponentPropsWithRef<"input">) {
  return <input className={cn(controlStyles, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentPropsWithRef<"textarea">) {
  return <textarea className={cn(controlStyles, "min-h-24 resize-y", className)} {...props} />;
}

type FieldControl = {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
  "aria-required"?: boolean;
};

export interface FormFieldProps {
  id: string;
  label: string;
  description?: string;
  error?: string;
  required?: boolean;
  children: ReactElement<FieldControl>;
  className?: string;
}

/** A single labeled control. Pass errors from UX validation or the safe API model. */
export function FormField({
  id,
  label,
  description,
  error,
  required,
  children,
  className,
}: FormFieldProps) {
  const describedBy = [
    children.props["aria-describedby"],
    description ? `${id}-description` : undefined,
    error ? `${id}-error` : undefined,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-medium text-text">
        {label}
        {required && (
          <span className="ms-1 text-text-muted" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {cloneElement(children, {
        id,
        "aria-describedby": describedBy || undefined,
        "aria-invalid": error ? true : children.props["aria-invalid"],
        "aria-required": required || children.props["aria-required"],
      })}
      {description && (
        <p id={`${id}-description`} className="text-xs leading-5 text-text-muted">
          {description}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs leading-5 text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-md border border-danger/25 bg-danger-subtle px-3 py-2 text-sm leading-6 text-danger"
    >
      {message}
    </p>
  );
}
