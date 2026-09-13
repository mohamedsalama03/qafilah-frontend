"use client";

import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ErrorStateProps {
  title: string;
  description: string;
  requestId?: string;
  retry?: () => void;
}

/** Only render messages and request IDs already approved by the API error normalizer. */
export function ErrorState({ title, description, requestId, retry }: ErrorStateProps) {
  return (
    <div role="alert" className="px-5 py-8">
      <div className="flex items-start gap-3">
        <CircleAlert className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-text">{title}</h2>
          <p className="mt-1 max-w-prose text-sm leading-6 text-text-muted">{description}</p>
          {requestId && (
            <p className="mt-2 break-all text-xs text-text-muted">Reference ID: {requestId}</p>
          )}
          {retry && (
            <Button className="mt-4" size="sm" onClick={retry}>
              Try again
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
