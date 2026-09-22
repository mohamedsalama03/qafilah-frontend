"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError, FormField, Input } from "@/components/ui/field";
import type { MerchantVariant } from "@/features/variants/contracts";
import type { MerchantProduct } from "@/features/products/contracts";
import { useStores } from "@/features/stores/components/store-provider";
import { normalizeUnexpectedError } from "@/lib/api/errors";
import type { VariantInventory } from "../contracts";
import {
  variantInventoryAvailabilityLabels,
  variantInventoryQuantityLabel,
  parseVariantInventoryQuantity,
} from "../model";
import { useVariantInventoryMutation } from "../mutations";
import { useVariantInventory } from "../queries";

function QuantityForm({
  inventory,
  mutation,
  disabled,
}: {
  inventory: VariantInventory;
  mutation: ReturnType<typeof useVariantInventoryMutation>;
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
  }, [serverError, mutation.state.status, mutation.state.slot]);
  return (
    <form
      aria-label="Set inventory quantity"
      noValidate
      className="flex flex-col items-start gap-3 sm:flex-row"
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled || mutation.isBlocked) return;
        let parsed: number;
        try {
          parsed = parseVariantInventoryQuantity(quantity);
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
        id="variant-inventory-quantity"
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
        className="sm:mt-[1.625rem]"
      >
        Set quantity
      </Button>
    </form>
  );
}

function ScopedVariantInventoryPanel({
  product,
  variant,
  productReadPending,
  productReadFailed,
}: {
  product: MerchantProduct;
  variant: MerchantVariant;
  productReadPending: boolean;
  productReadFailed: boolean;
}) {
  const { state: stores } = useStores();
  const query = useVariantInventory(product.id, variant.id);
  const mutation = useVariantInventoryMutation(product, variant);
  const { state } = mutation;
  const feedback = useRef<HTMLDivElement>(null);
  const inventory = state.inventory ?? (query.error ? undefined : query.data);
  const currentProduct = product.status === "archived" ? product : (state.product ?? product);
  const canEdit =
    stores.context?.permissions.includes("products.view") &&
    stores.context.permissions.includes("products.variants.view") &&
    stores.context.permissions.includes("products.variants.inventory.update") &&
    currentProduct.status !== "archived";
  const unknown = state.status === "unknown" || state.status === "reconciling";
  const confirmed = state.status === "success" || state.status === "reviewing";
  const quantityError =
    state.status === "error" ? state.error?.fieldErrors.quantity?.[0] : undefined;
  useEffect(() => {
    // An actionable field error takes priority over general feedback focus.
    if (quantityError && canEdit) return;
    if (
      state.status === "success" ||
      state.status === "unknown" ||
      state.status === "error" ||
      (state.status === "idle" && state.guidance)
    )
      feedback.current?.focus();
  }, [quantityError, canEdit, state.status, state.guidance, state.slot]);
  return (
    <section
      aria-labelledby="variant-inventory-heading"
      className="mt-6 space-y-4 border-t border-border pt-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="variant-inventory-heading" className="text-base font-semibold">
            Inventory
          </h3>
          <p className="mt-1 max-w-prose text-xs leading-5 text-text-muted">
            Set quantity replaces the current stock count for this variant. Other stock changes may
            happen while you work.
          </p>
        </div>
        {inventory && (
          <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <div>
              <dt className="text-xs text-text-muted">
                {unknown ? "Last known quantity" : "Current quantity"}
              </dt>
              <dd className="mt-1 font-medium tabular-nums">
                {variantInventoryQuantityLabel(inventory.quantity)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">
                {unknown ? "Last known availability" : "Availability"}
              </dt>
              <dd className="mt-1">{variantInventoryAvailabilityLabels[inventory.availability]}</dd>
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
            {(state.refreshError || productReadFailed) && (
              <p className="max-w-prose text-text-muted">
                The quantity was saved, but the latest product and variant details could not be
                confirmed yet. Review current inventory before making another change.
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
          disabled={productReadPending || productReadFailed || query.isFetching || !!query.error}
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

export function VariantInventoryPanel({
  product,
  variant,
  productReadPending = false,
  productReadFailed = false,
}: {
  product: MerchantProduct;
  variant: MerchantVariant;
  productReadPending?: boolean;
  productReadFailed?: boolean;
}) {
  const { state } = useStores();
  if (
    product.type !== "variant" ||
    !state.context?.permissions.includes("products.view") ||
    !state.context.permissions.includes("products.variants.view")
  )
    return null;
  return (
    <ScopedVariantInventoryPanel
      product={product}
      variant={variant}
      productReadPending={productReadPending}
      productReadFailed={productReadFailed}
    />
  );
}
