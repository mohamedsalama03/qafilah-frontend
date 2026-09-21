"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError, FormField, Input } from "@/components/ui/field";
import type { MerchantProduct } from "@/features/products/contracts";
import { useStores } from "@/features/stores/components/store-provider";
import { normalizeUnexpectedError } from "@/lib/api/errors";
import type { ProductInventory } from "../contracts";
import {
  inventoryAvailabilityLabels,
  inventoryQuantityLabel,
  parseInventoryQuantity,
} from "../model";
import { useInventoryMutation } from "../mutations";
import { useProductInventory } from "../queries";

function QuantityForm({
  inventory,
  mutation,
  disabled,
}: {
  inventory: ProductInventory;
  mutation: ReturnType<typeof useInventoryMutation>;
  disabled: boolean;
}) {
  const [quantity, setQuantity] = useState(() =>
    inventory.quantity === null ? "" : String(inventory.quantity),
  );
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const serverError =
    mutation.state.status === "error" ? mutation.state.error?.fieldErrors.quantity?.[0] : undefined;
  useEffect(() => {
    if (serverError) input.current?.focus();
  }, [serverError]);
  return (
    <form
      aria-label="Set inventory quantity"
      noValidate
      className="flex flex-col items-start gap-3 sm:flex-row sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled || mutation.isBlocked) return;
        let parsed: number;
        try {
          parsed = parseInventoryQuantity(quantity);
        } catch {
          setError("Enter a whole number from 0 to 2,000,000,000.");
          input.current?.focus();
          return;
        }
        setError(undefined);
        void mutation.execute(parsed);
      }}
    >
      <FormField
        id="inventory-quantity"
        label="Quantity"
        description="Whole units, from 0 to 2,000,000,000."
        error={error ?? serverError}
        required
        className="w-full sm:max-w-xs"
      >
        <Input
          ref={input}
          name="quantity"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={quantity}
          disabled={disabled || mutation.isBlocked}
          className="tabular-nums"
          onChange={(event) => {
            setQuantity(event.target.value);
            setError(undefined);
          }}
        />
      </FormField>
      <Button
        type="submit"
        variant="primary"
        disabled={disabled || mutation.isBlocked}
        pending={mutation.state.status === "pending"}
        pendingLabel="Setting quantity…"
        className="sm:mb-6"
      >
        Set quantity
      </Button>
    </form>
  );
}

function SimpleProductInventoryPanel({
  product,
  productReadUnavailable,
}: {
  product: MerchantProduct;
  productReadUnavailable: boolean;
}) {
  const { state: stores } = useStores();
  const query = useProductInventory(product.id);
  const mutation = useInventoryMutation(product);
  const { state } = mutation;
  const feedback = useRef<HTMLDivElement>(null);
  const inventory = state.inventory ?? (query.error ? undefined : query.data);
  const currentProduct = product.status === "archived" ? product : (state.product ?? product);
  const canEdit =
    stores.context?.permissions.includes("products.view") &&
    stores.context.permissions.includes("products.inventory.update") &&
    currentProduct.status !== "archived";
  const unknown = state.status === "unknown" || state.status === "reconciling";
  const confirmed = state.status === "success" || state.status === "reviewing";
  useEffect(() => {
    if (state.status === "success" || state.status === "unknown" || state.guidance)
      feedback.current?.focus();
  }, [state.status, state.guidance, state.slot]);
  return (
    <section
      aria-labelledby="product-inventory-heading"
      className="mb-5 space-y-4 rounded-lg border border-border bg-surface p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="product-inventory-heading" className="text-base font-semibold">
            Inventory
          </h2>
          <p className="mt-1 max-w-prose text-xs leading-5 text-text-muted">
            Set quantity replaces the current stock count. Other stock changes may happen while you
            work.
          </p>
        </div>
        {inventory && (
          <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <div>
              <dt className="text-xs text-text-muted">Current quantity</dt>
              <dd className="mt-1 font-medium tabular-nums">
                {inventoryQuantityLabel(inventory.quantity)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">Availability</dt>
              <dd className="mt-1">{inventoryAvailabilityLabels[inventory.availability]}</dd>
            </div>
          </dl>
        )}
      </div>
      {!inventory && !query.error && <p role="status">Loading inventory…</p>}
      {query.error && !confirmed && !unknown && (
        <div className="space-y-3">
          <FormError message={normalizeUnexpectedError(query.error).message} />
          <Button onClick={() => void query.refetch()} pending={query.isFetching}>
            Refresh inventory
          </Button>
        </div>
      )}
      <div
        ref={feedback}
        tabIndex={-1}
        className="space-y-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        {unknown && (
          <div role="alert" className="space-y-3 text-sm leading-6">
            <p className="font-medium">We couldn’t confirm whether the quantity was saved.</p>
            <p className="max-w-prose text-text-muted">
              It may already have changed. Review the current inventory before making a new change.
              Your earlier request will not be repeated.
            </p>
            {state.error && state.status === "unknown" && (
              <p className="text-text-muted">{state.error.message}</p>
            )}
            <Button
              onClick={() => void mutation.reconcile()}
              pending={state.status === "reconciling"}
              pendingLabel="Reviewing inventory…"
            >
              Review current inventory
            </Button>
          </div>
        )}
        {confirmed && (
          <div className="space-y-3 text-sm">
            <p role="status" className="font-medium">
              Quantity saved.
            </p>
            {(state.refreshError || productReadUnavailable) && (
              <p className="max-w-prose text-text-muted">
                The quantity was saved, but the latest product details could not be confirmed yet.
                Review current inventory before making another change.
              </p>
            )}
            {canEdit && (
              <Button
                onClick={() => void mutation.reviewSuccess()}
                pending={state.status === "reviewing"}
                pendingLabel="Reviewing inventory…"
              >
                Change quantity
              </Button>
            )}
          </div>
        )}
        {state.guidance && state.status === "idle" && (
          <p role="status" className="max-w-prose text-sm leading-6 text-text-muted">
            Current inventory was loaded.{" "}
            {state.reviewedUnknown &&
              "This does not confirm whether the earlier change was saved. "}
            Review the quantity before making a new change. No earlier request has been repeated.
          </p>
        )}
        {state.status === "error" && state.error && (
          <FormError message={state.error.fieldErrors.product?.[0] ?? state.error.message} />
        )}
      </div>
      {inventory && !unknown && !confirmed && canEdit && (
        <QuantityForm
          key={state.slot}
          inventory={inventory}
          mutation={mutation}
          disabled={productReadUnavailable || query.isFetching || !!query.error}
        />
      )}
      {currentProduct.status === "archived" ? (
        <p className="text-xs text-text-muted">Archived product inventory cannot be changed.</p>
      ) : !canEdit ? (
        <p className="text-xs text-text-muted">
          Your current access allows viewing inventory only.
        </p>
      ) : null}
    </section>
  );
}

export function ProductInventoryPanel({
  product,
  productReadUnavailable = false,
}: {
  product: MerchantProduct;
  productReadUnavailable?: boolean;
}) {
  const { state } = useStores();
  if (product.type !== "simple" || !state.context?.permissions.includes("products.view"))
    return null;
  return (
    <SimpleProductInventoryPanel
      product={product}
      productReadUnavailable={productReadUnavailable}
    />
  );
}
