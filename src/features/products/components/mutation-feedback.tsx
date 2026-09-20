"use client";

import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import type { useProductMutation } from "../mutations";

export function MutationFeedback({
  mutation,
  create = false,
  reconcile,
  startSeparateCreate,
  canReview = true,
}: {
  mutation: ReturnType<typeof useProductMutation>;
  create?: boolean;
  reconcile?: () => void;
  startSeparateCreate?: () => void;
  canReview?: boolean;
}) {
  const { state } = mutation;
  if (state.status === "idle" && state.guidance)
    return (
      <p role="status" aria-live="polite" aria-atomic="true" className="text-sm text-text-muted">
        {state.guidance === "product-loaded"
          ? "The latest product was loaded from the server. Review it before making another change."
          : "A new blank product form is ready. No earlier request has been repeated."}
      </p>
    );
  if (state.status === "unknown" || state.status === "reconciling")
    return (
      <div
        role="alert"
        className="space-y-3 rounded-lg border border-border bg-surface-subtle p-4 text-sm leading-6"
      >
        <p className="font-medium">We couldn’t confirm whether the change was completed.</p>
        <p className="text-text-muted">
          {create
            ? "The product may already exist. Review your products before starting another creation to avoid a duplicate. A product missing from the current list does not prove it was not created."
            : "Refresh the product before trying again. Your change may already have been saved. Refreshing loads the latest saved version."}
        </p>
        {!canReview && (
          <p className="text-text-muted">
            Your access does not include viewing products. Ask someone with product viewing access
            to check the result before creating another product.
          </p>
        )}
        {canReview &&
          state.error &&
          ["forbidden", "not-found", "rate-limited"].includes(state.error.kind) && (
            <p className="text-text-muted">
              {state.error.message} The earlier change is still unconfirmed.
            </p>
          )}
        {canReview && (
          <Button
            onClick={
              reconcile ??
              (() => {
                void mutation.reconcile();
              })
            }
            pending={state.status === "reconciling"}
            pendingLabel="Refreshing…"
          >
            {create ? "Review products" : "Refresh product"}
          </Button>
        )}
        {create && mutation.canStartSeparateCreate && startSeparateCreate && (
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-text-muted">
              After reviewing the list, you can start a separate blank product. The earlier product
              may still have been created.
            </p>
            <Button onClick={startSeparateCreate}>Start a separate product</Button>
          </div>
        )}
      </div>
    );
  if (state.status !== "error" || !state.error) return null;
  const error = state.error;
  const detail =
    error.formErrors[0] ?? error.fieldErrors.product?.[0] ?? error.fieldErrors.status?.[0];
  return (
    <FormError
      message={
        error.kind === "not-found"
          ? "This product is unavailable in the current store. Return to Products to continue."
          : (detail ?? error.message)
      }
    />
  );
}
