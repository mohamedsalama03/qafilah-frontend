"use client";

import * as Dialog from "@radix-ui/react-alert-dialog";
import { useRef, useState, type ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";

export interface ConfirmationDialogProps {
  trigger: ReactElement;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => Promise<void> | void;
  pending?: boolean;
  error?: string;
  destructive?: boolean;
  privateContent?: boolean;
}

export function ConfirmationDialog({
  trigger,
  title,
  description,
  confirmLabel,
  onConfirm,
  pending = false,
  error,
  destructive = false,
  privateContent = false,
}: ConfirmationDialogProps) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const busy = pending || submitting;

  async function confirm() {
    if (inFlight.current || pending) return;
    inFlight.current = true;
    setSubmitting(true);
    setFailed(false);
    try {
      await onConfirm();
      setOpen(false);
    } catch {
      // Never expose a raw exception from a mutation to the merchant.
      setFailed(true);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!busy) {
          setOpen(next);
          setFailed(false);
        }
      }}
    >
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay
          data-merchant-private-overlay={privateContent ? "" : undefined}
          className="fixed inset-0 z-50 bg-text/35"
        />
        <Dialog.Content
          data-merchant-private-overlay={privateContent ? "" : undefined}
          className="fixed start-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg bg-surface p-5 shadow-xl focus:outline-none rtl:translate-x-1/2"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            cancelRef.current?.focus();
          }}
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
          aria-busy={busy || undefined}
        >
          <Dialog.Title className="text-lg font-semibold tracking-tight text-text">
            {title}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-6 text-text-muted">
            {description}
          </Dialog.Description>
          {(error || failed) && (
            <div className="mt-4">
              <FormError message={error || "The action could not be completed. Try again."} />
            </div>
          )}
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <Dialog.Cancel asChild>
              <Button ref={cancelRef} disabled={busy}>
                Cancel
              </Button>
            </Dialog.Cancel>
            <Button
              variant={destructive ? "danger" : "primary"}
              pending={busy}
              pendingLabel="Please wait…"
              onClick={() => {
                void confirm();
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
