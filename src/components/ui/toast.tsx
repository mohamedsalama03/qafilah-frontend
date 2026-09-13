"use client";

import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Concise confirmed success only; actionable failures belong beside their source. */
export function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md items-center gap-3 rounded-lg bg-text px-4 py-2 text-white shadow-lg">
      <Check className="size-4 shrink-0" aria-hidden="true" />
      <p role="status" className="flex-1 text-sm leading-5">
        {message}
      </p>
      <Button
        variant="ghost"
        size="icon"
        className="text-white hover:bg-white/10"
        aria-label="Dismiss confirmation"
        onClick={onDismiss}
      >
        <X className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
