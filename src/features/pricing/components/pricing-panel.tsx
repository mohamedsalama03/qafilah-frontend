"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError, FormField, Input } from "@/components/ui/field";
import type { MerchantProduct } from "@/features/products/contracts";
import type { MerchantVariant } from "@/features/variants/contracts";
import { catalogCurrencyExponents, minorUnitsToDecimal } from "@/features/products/model";
import { useStores } from "@/features/stores/components/store-provider";
import { normalizeUnexpectedError } from "@/lib/api/errors";
import { parsePriceAmount } from "../model";
import { usePricingMutation } from "../mutations";
import { usePricing } from "../queries";

type Props = {
  product: MerchantProduct;
  variant?: MerchantVariant;
  productReadPending?: boolean;
  productReadFailed?: boolean;
};

function PriceForm({
  mutation,
  disabled,
  configured,
}: {
  mutation: ReturnType<typeof usePricingMutation>;
  disabled: boolean;
  configured: boolean;
}) {
  const { state } = useStores();
  const currency = state.context?.store.currency;
  // Each reviewed interaction starts blank. Never resubmit a previous amount implicitly.
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const serverError =
    mutation.state.status === "error" ? mutation.state.error?.fieldErrors.amount?.[0] : undefined;
  useEffect(() => {
    if (serverError) input.current?.focus();
  }, [serverError, mutation.state.status]);
  if (currency == null) return null;
  return (
    <form
      aria-label="Set price"
      noValidate
      className="flex flex-col items-start gap-3 sm:flex-row"
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled || mutation.isBlocked) return;
        try {
          const parsed = parsePriceAmount(amount, currency);
          setError(undefined);
          void mutation.execute(parsed);
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : "Enter a valid price.");
          input.current?.focus();
        }
      }}
    >
      <FormField
        id="pricing-amount"
        label={`Price (${currency})`}
        required
        description={`Up to ${catalogCurrencyExponents[currency]} decimal places. Replaces the current price.`}
        error={error ?? serverError}
        className="w-full sm:max-w-xs"
      >
        <Input
          ref={input}
          name="amount"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={amount}
          disabled={disabled || mutation.isBlocked}
          className="tabular-nums"
          onChange={(event) => {
            setAmount(event.target.value);
            setError(undefined);
          }}
        />
      </FormField>
      <Button
        type="submit"
        variant="primary"
        disabled={disabled || mutation.isBlocked}
        pending={mutation.state.status === "pending"}
        pendingLabel="Saving price…"
        className="sm:mt-[1.625rem]"
      >
        {configured ? "Change price" : "Set price"}
      </Button>
    </form>
  );
}

function ScopedPricingPanel({
  product,
  variant,
  productReadPending = false,
  productReadFailed = false,
}: Props) {
  const { state: stores } = useStores();
  const currency = stores.context?.store.currency;
  const query = usePricing(product.id, variant?.id);
  const mutation = usePricingMutation(product, variant);
  const { state } = mutation;
  const pricing = state.pricing ?? (query.error ? undefined : query.data);
  const currentProduct = product.status === "archived" ? product : (state.product ?? product);
  const canWrite = stores.context?.permissions.includes(
    variant ? "products.variants.price.update" : "products.price.update",
  );
  const canEdit = canWrite && currentProduct.status !== "archived" && currency != null;
  const unknown = state.status === "unknown" || state.status === "reconciling";
  const confirmed = state.status === "success" || state.status === "reviewing";
  const feedback = useRef<HTMLDivElement>(null);
  const amountError = state.status === "error" && state.error?.fieldErrors.amount?.[0];
  const Heading = variant ? "h3" : "h2";
  useEffect(() => {
    if (amountError && canEdit) return;
    if (["success", "unknown", "error"].includes(state.status) || state.guidance)
      feedback.current?.focus();
  }, [amountError, canEdit, state.status, state.guidance, state.slot]);
  return (
    <section
      aria-labelledby="pricing-heading"
      className={
        variant
          ? "mt-6 space-y-4 border-t border-border pt-5"
          : "mb-5 space-y-4 rounded-lg border border-border bg-surface p-5 sm:p-6"
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Heading id="pricing-heading" className="text-base font-semibold">
            Pricing
          </Heading>
          <p className="mt-1 max-w-prose text-xs leading-5 text-text-muted">
            A price change replaces the current amount. Other price changes may happen while you
            work.
          </p>
        </div>
        {pricing && (
          <dl className="text-sm">
            <dt className="text-xs text-text-muted">
              {unknown ? "Last known price" : "Current price"}
            </dt>
            <dd className="mt-1 font-medium tabular-nums">
              {pricing.price === null
                ? "Not configured"
                : currency == null
                  ? "Store currency unavailable"
                  : `${minorUnitsToDecimal(pricing.price.amount, currency)} ${currency}`}
            </dd>
          </dl>
        )}
      </div>
      {!pricing && !query.error && <p role="status">Loading price…</p>}
      {query.error && !confirmed && !unknown && (
        <div className="space-y-3">
          <FormError message={normalizeUnexpectedError(query.error).message} />
          <Button onClick={() => void query.refetch()} pending={query.isFetching}>
            Refresh price
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
            <p className="font-medium">We couldn’t confirm whether the price was saved.</p>
            <p className="max-w-prose text-text-muted">
              It may already have changed. Review the current price before making a new change. Your
              earlier request will not be repeated.
            </p>
            {state.error && <p className="text-text-muted">{state.error.message}</p>}
            <Button
              onClick={() => void mutation.reconcile()}
              pending={state.status === "reconciling"}
              pendingLabel="Reviewing price…"
            >
              Review current price
            </Button>
          </div>
        )}
        {confirmed && (
          <div className="space-y-3 text-sm">
            <p role="status" className="font-medium">
              Price saved.
            </p>
            {(state.refreshError || productReadFailed) && (
              <p className="max-w-prose text-text-muted">
                The price was saved, but the latest product details could not be confirmed. Review
                current price before another change.
              </p>
            )}
            {canEdit && (
              <Button
                onClick={() => void mutation.reviewSuccess()}
                pending={state.status === "reviewing"}
                pendingLabel="Reviewing price…"
              >
                Review current price
              </Button>
            )}
          </div>
        )}
        {state.guidance && state.status === "idle" && (
          <p role="status" className="max-w-prose text-sm leading-6 text-text-muted">
            Current price was loaded.{" "}
            {state.reviewedUnknown &&
              "This does not confirm whether the earlier change was saved. "}
            Enter a new amount to make another change. No earlier request has been repeated.
          </p>
        )}
        {state.status === "error" && state.error && (
          <FormError
            message={
              state.error.fieldErrors.product?.[0] ??
              state.error.fieldErrors.currency?.[0] ??
              state.error.message
            }
          />
        )}
      </div>
      {pricing && !unknown && !confirmed && canEdit && (
        <PriceForm
          key={state.slot}
          mutation={mutation}
          configured={pricing.price !== null}
          disabled={productReadPending || productReadFailed || query.isFetching || !!query.error}
        />
      )}
      {currency == null ? (
        <p role="status" className="text-sm text-text-muted">
          Store currency is not configured or unavailable. Price setup is unavailable until an
          authorized Store administrator configures currency.
        </p>
      ) : currentProduct.status === "archived" ? (
        <p className="text-xs text-text-muted">Archived product prices cannot be changed.</p>
      ) : !canWrite ? (
        <p className="text-xs text-text-muted">Your current access allows viewing prices only.</p>
      ) : null}
    </section>
  );
}

export function PricingPanel(props: Props) {
  const { state } = useStores();
  if (props.variant ? props.product.type !== "variant" : props.product.type !== "simple")
    return null;
  if (
    !state.context?.permissions.includes("products.view") ||
    (props.variant && !state.context.permissions.includes("products.variants.view"))
  )
    return (
      <p className="text-sm text-text-muted">
        Price read access is required to view or change pricing.
      </p>
    );
  return (
    <ScopedPricingPanel
      key={JSON.stringify([state.scope, props.product.id, props.variant?.id])}
      {...props}
    />
  );
}
