"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, buttonStyles } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { useStores } from "@/features/stores/components/store-provider";
import type { MerchantProduct } from "@/features/products/contracts";
import { catalogUuidSchema, formatProductPrice } from "@/features/products/model";
import { useProduct } from "@/features/products/queries";
import {
  CatalogError,
  ProductAccess,
  ProductLoading,
  RefreshAccess,
  availabilityLabel,
} from "@/features/products/components/product-shared";
import { ApiError, normalizeUnexpectedError } from "@/lib/api/errors";
import type { MerchantProductOption, MerchantVariant } from "../contracts";
import { useVariantMutation } from "../mutations";
import { useProductOptions, useProductVariants, useProductVariant } from "../queries";
import { StructuralForm, matchesEditor, type Editor, type VariantMutation } from "./variant-forms";

function Region({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="min-w-0 rounded-lg border border-border bg-surface p-5 sm:p-6"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function variantLabel(variant: MerchantVariant, options: readonly MerchantProductOption[]) {
  return (
    options
      .map(
        (option) =>
          option.values.find((value) => variant.value_ids.includes(value.id))?.value ??
          "Selection unavailable",
      )
      .join(" / ") || "Variant"
  );
}

function Feedback({ mutation, editor }: { mutation: VariantMutation; editor: Editor | null }) {
  const { state } = mutation;
  const feedback = useRef<HTMLDivElement>(null);
  const fields = editor?.kind.startsWith("option.")
    ? ["name", "position"]
    : editor?.kind.startsWith("value.")
      ? ["value", "position"]
      : ["value_ids", "sku", "status"];
  const fieldError =
    !!editor &&
    matchesEditor(editor, state.operation) &&
    state.status === "error" &&
    fields.some((field) => state.error?.fieldErrors[field]?.length);
  useEffect(() => {
    if (!fieldError && ["success", "unknown", "error", "idle"].includes(state.status))
      feedback.current?.focus();
  }, [fieldError, state.status, state.slot]);
  const confirmed = state.status === "success" || state.status === "reviewing";
  const unknown = state.status === "unknown" || state.status === "reconciling";
  const error =
    state.error && (!editor || matchesEditor(editor, state.operation))
      ? normalizeUnexpectedError(state.error)
      : null;
  if (!confirmed && !unknown && !error && !state.guidance) return null;
  return (
    <div
      ref={feedback}
      tabIndex={-1}
      className="space-y-3 rounded-lg border border-border bg-surface p-5"
    >
      {confirmed && (
        <p role="status" className="font-medium">
          Changes saved.
        </p>
      )}
      {unknown && (
        <>
          <p role="alert" className="font-medium">
            The result of this change is unknown.
          </p>
          <p className="max-w-prose text-sm text-text-muted">
            It may have been saved. Review the current configuration before making another change.
            Previously saved options, values and variants are kept.
          </p>
        </>
      )}
      {confirmed && state.refreshError && (
        <p className="max-w-prose text-sm text-text-muted">
          The change was saved, but the latest configuration could not be refreshed. Review the
          current configuration before continuing.
        </p>
      )}
      {error && (
        <FormError
          message={[
            error.message,
            ...error.formErrors,
            ...Object.entries(error.fieldErrors)
              .filter(([field]) => !fields.includes(field))
              .flatMap(([, messages]) => messages),
          ].join(" ")}
        />
      )}
      {state.guidance && !confirmed && !unknown && (
        <p role="status" className="max-w-prose text-sm text-text-muted">
          Current configuration reviewed. Review the values before starting a new change.
          {state.reviewedUnknown
            ? " This shows current state; it does not confirm whether the earlier change caused it."
            : ""}
        </p>
      )}
      {(confirmed || unknown) && (
        <Button
          onClick={() => void mutation.review()}
          pending={mutation.isPending}
          pendingLabel="Reviewing configuration…"
        >
          Review current configuration
        </Button>
      )}
    </div>
  );
}

function ConfigurationContent({
  product,
  options,
  variants,
  mutation,
  busy,
  readError,
  retry,
  variantUuid,
}: {
  product: MerchantProduct;
  options: readonly MerchantProductOption[];
  variants: readonly MerchantVariant[];
  mutation: VariantMutation;
  busy: boolean;
  readError: unknown;
  retry: () => void;
  variantUuid?: string;
}) {
  const { state } = useStores();
  const [editor, setEditor] = useState<Editor | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const permissions = state.context?.permissions ?? [];
  const canCreate = permissions.includes("products.variants.create");
  const canUpdate = permissions.includes("products.variants.update");
  const disabled = busy || !!readError || product.status === "archived";
  const blocked = disabled || mutation.isBlocked;
  const href = `/stores/${state.scope!.storeUuid}/products/${product.id}/variants`;
  const formVisible = editor && ["idle", "error", "pending"].includes(mutation.state.status);
  const editorAllowed = editor?.kind.endsWith(".create") ? canCreate : canUpdate;
  useEffect(() => {
    if (editor) editorRef.current?.querySelector<HTMLElement>("input, select")?.focus();
  }, [editor]);
  return (
    <div className="space-y-5">
      <Feedback mutation={mutation} editor={formVisible ? editor : null} />
      {product.status === "archived" && (
        <p
          role="status"
          className="rounded-lg border border-border bg-surface p-4 text-sm text-text-muted"
        >
          This product is archived. Its configuration is available to view, but cannot be changed.
        </p>
      )}
      {readError ? <CatalogError error={readError} detail retry={retry} /> : null}
      {formVisible && editorAllowed && (
        <div ref={editorRef} className="rounded-lg border border-border bg-surface p-5 sm:p-6">
          <StructuralForm
            key={`${mutation.state.slot}:${editor.kind}:${"option" in editor ? editor.option.id : "variant" in editor ? editor.variant.id : "new"}:${"value" in editor ? editor.value.id : ""}`}
            editor={editor}
            options={options}
            mutation={mutation}
            disabled={disabled}
            onCancel={() => setEditor(null)}
          />
        </div>
      )}
      {variantUuid ? (
        <VariantDetails
          product={product}
          variantUuid={variantUuid}
          options={options}
          canUpdate={canUpdate}
          blocked={blocked}
          onEdit={(variant) => setEditor({ kind: "variant.update", variant })}
        />
      ) : (
        <>
          <Region
            title="Options"
            action={
              canCreate && (
                <Button
                  onClick={() => setEditor({ kind: "option.create" })}
                  disabled={blocked || options.length >= 3 || variants.length > 0}
                >
                  Add option
                </Button>
              )
            }
          >
            <p className="mb-4 max-w-prose text-sm text-text-muted">
              Define up to 3 options, then add values to describe your variants. Each option
              supports up to 20 values.
            </p>
            {!variants.length ? (
              <p className="mb-4 rounded-md bg-warning-subtle px-3 py-2 text-sm leading-6 text-warning">
                Finish adding options before creating your first variant. Once a variant exists, no
                more options can be added.
              </p>
            ) : (
              <p className="mb-4 text-sm text-text-muted">
                Options are fixed because variants exist. You can still edit labels and positions,
                or add values.
              </p>
            )}
            {!options.length ? (
              <p className="py-5 text-sm text-text-muted">
                No options yet. Add an option such as Size to begin.
              </p>
            ) : (
              <div className="divide-y divide-border">
                {options.map((option) => (
                  <article
                    key={option.id}
                    aria-label={option.name}
                    className="py-5 first:pt-0 last:pb-0"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-medium [overflow-wrap:anywhere]">{option.name}</h3>
                        <p className="mt-1 text-xs tabular-nums text-text-muted">
                          Position {option.position} · {option.values.length} / 20 values
                        </p>
                      </div>
                      {canUpdate && (
                        <Button
                          size="sm"
                          onClick={() => setEditor({ kind: "option.update", option })}
                          disabled={blocked}
                        >
                          Edit option
                        </Button>
                      )}
                    </div>
                    {option.values.length ? (
                      <ul className="mt-3 divide-y divide-border">
                        {option.values.map((value) => (
                          <li
                            key={value.id}
                            className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-2"
                          >
                            <div className="min-w-0">
                              <span className="text-sm [overflow-wrap:anywhere]">
                                {value.value}
                              </span>
                              <span className="ms-3 text-xs tabular-nums text-text-muted">
                                Position {value.position}
                              </span>
                            </div>
                            {canUpdate && (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={blocked}
                                onClick={() => setEditor({ kind: "value.update", option, value })}
                              >
                                Edit value
                              </Button>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-3 text-sm text-text-muted">
                        No values yet. Add at least one before creating a variant.
                      </p>
                    )}
                    {canCreate && (
                      <Button
                        className="mt-3"
                        size="sm"
                        disabled={blocked || option.values.length >= 20}
                        onClick={() => setEditor({ kind: "value.create", option })}
                      >
                        Add value
                      </Button>
                    )}
                  </article>
                ))}
              </div>
            )}
          </Region>
          <Region
            title="Variants"
            action={
              canCreate && (
                <Button
                  variant="primary"
                  onClick={() => setEditor({ kind: "variant.create" })}
                  disabled={
                    blocked ||
                    !options.length ||
                    options.some((option) => !option.values.length) ||
                    variants.length >= 100
                  }
                >
                  Create variant
                </Button>
              )
            }
          >
            <p className="mb-4 max-w-prose text-sm text-text-muted">
              {variants.length} / 100 variants, including inactive. Each variant has one value from
              every option. Combinations cannot be changed after creation.
            </p>
            <p className="mb-4 max-w-prose text-xs leading-5 text-text-muted">
              Active variants still need their own commercial configuration. Creating a variant does
              not make it ready to purchase.
            </p>
            {!variants.length ? (
              <p className="py-5 text-sm text-text-muted">
                No variants yet. Prepare your options and values, then create a combination.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {variants.map((variant) => (
                  <li
                    key={variant.id}
                    className="grid min-w-0 gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center"
                  >
                    <Link
                      prefetch={false}
                      href={`${href}/${variant.id}`}
                      className="w-fit max-w-full rounded font-medium text-brand underline underline-offset-4 [overflow-wrap:anywhere]"
                    >
                      {variantLabel(variant, options)}
                    </Link>
                    <span className="min-w-0 text-sm text-text-muted [overflow-wrap:anywhere]">
                      SKU: {variant.sku ?? "Not set"}
                    </span>
                    <div>
                      <StatusBadge tone={variant.status === "active" ? "success" : "neutral"}>
                        {variant.status === "active" ? "Active" : "Inactive"}
                      </StatusBadge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Region>
        </>
      )}
    </div>
  );
}

function VariantDetails({
  product,
  variantUuid,
  options,
  canUpdate,
  blocked,
  onEdit,
}: {
  product: MerchantProduct;
  variantUuid: string;
  options: readonly MerchantProductOption[];
  canUpdate: boolean;
  blocked: boolean;
  onEdit: (variant: MerchantVariant) => void;
}) {
  const query = useProductVariant(product.id, variantUuid);
  if (query.error)
    return <CatalogError error={query.error} detail retry={() => void query.refetch()} />;
  if (!query.data) return <ProductLoading detail />;
  const variant = query.data;
  return (
    <Region
      title="Variant details"
      action={
        canUpdate && (
          <Button onClick={() => onEdit(variant)} disabled={blocked || query.isFetching}>
            Edit variant
          </Button>
        )
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="min-w-0 text-lg font-semibold [overflow-wrap:anywhere]">
          {variantLabel(variant, options)}
        </h3>
        <StatusBadge tone={variant.status === "active" ? "success" : "neutral"}>
          {variant.status === "active" ? "Active" : "Inactive"}
        </StatusBadge>
      </div>
      <p className="mt-3 text-sm text-text-muted">
        This combination is fixed. You can update its SKU or activate/deactivate it.
      </p>
      <dl className="mt-5 grid gap-5 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-text-muted">SKU</dt>
          <dd className="mt-1 [overflow-wrap:anywhere]">{variant.sku ?? "Not set"}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Variant ID</dt>
          <dd className="mt-1 text-xs [overflow-wrap:anywhere]">{variant.id}</dd>
        </div>
      </dl>
      <div className="mt-6 border-t border-border pt-5">
        <h3 className="font-medium">Commercial summary</h3>
        <p className="mt-1 max-w-prose text-xs leading-5 text-text-muted">
          Read-only information. Active status alone does not mean this variant is ready to
          purchase.
        </p>
        <dl className="mt-4 grid gap-5 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-text-muted">Price</dt>
            <dd className="mt-1 tabular-nums">
              {formatProductPrice({ type: "simple", price: variant.price })}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">Quantity</dt>
            <dd className="mt-1 tabular-nums">
              {variant.quantity === null ? "Not configured" : variant.quantity}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">Availability</dt>
            <dd className="mt-1">{availabilityLabel(variant.availability)}</dd>
          </div>
        </dl>
      </div>
    </Region>
  );
}

function Configuration({
  product,
  productReadPending,
  productReadError,
  retryProduct,
  variantUuid,
}: {
  product: MerchantProduct;
  productReadPending: boolean;
  productReadError: unknown;
  retryProduct: () => void;
  variantUuid?: string;
}) {
  const options = useProductOptions(product.id);
  const variants = useProductVariants(product.id);
  const mutation = useVariantMutation(product);
  const error = productReadError || options.error || variants.error;
  const pending = productReadPending || options.isFetching || variants.isFetching;
  return (
    <>
      {(!options.data || !variants.data) && !error && <ProductLoading detail />}
      <ConfigurationContent
        key={`${mutation.state.slot}:${variantUuid ?? "list"}`}
        product={product}
        options={options.data ?? []}
        variants={variants.data ?? []}
        mutation={mutation}
        busy={pending || !options.data || !variants.data}
        readError={error}
        retry={() => {
          retryProduct();
          void options.refetch();
          void variants.refetch();
        }}
        variantUuid={variantUuid}
      />
    </>
  );
}

function VariantsProduct({
  productUuid,
  variantUuid,
}: {
  productUuid: string;
  variantUuid?: string;
}) {
  const { state } = useStores();
  const query = useProduct(productUuid);
  const href = `/stores/${state.scope!.storeUuid}/products/${productUuid}`;
  const product =
    !query.error ||
    (query.error instanceof ApiError &&
      ["network", "timeout", "server", "rate-limited"].includes(query.error.kind))
      ? query.data
      : undefined;
  return (
    <>
      <PageHeader
        title={variantUuid ? "Variant details" : "Variants & options"}
        description={product?.name}
        breadcrumbs={[
          { label: "Products", href: `/stores/${state.scope!.storeUuid}/products` },
          { label: product?.name ?? "Product details", href },
          ...(variantUuid ? [{ label: "Variants & options", href: `${href}/variants` }] : []),
          { label: variantUuid ? "Variant details" : "Variants & options" },
        ]}
        secondaryActions={
          <>
            <RefreshAccess />
            <Button
              onClick={() => void query.refetch()}
              pending={query.isFetching}
              pendingLabel="Refreshing…"
            >
              Refresh product
            </Button>
          </>
        }
      />
      {product?.type === "variant" ? (
        <Configuration
          product={product}
          productReadPending={query.isFetching}
          productReadError={query.error}
          retryProduct={() => void query.refetch()}
          variantUuid={variantUuid}
        />
      ) : query.error ? (
        <CatalogError error={query.error} detail retry={() => void query.refetch()} />
      ) : !product ? (
        <ProductLoading detail />
      ) : (
        <p className="rounded-lg border border-border bg-surface p-5 text-sm">
          Options and variants are available only for variant products. This product’s type cannot
          be changed.
        </p>
      )}
      <Link
        className={buttonStyles({ className: "mt-5" })}
        prefetch={false}
        href={variantUuid ? `${href}/variants` : href}
      >
        {variantUuid ? "Back to variants" : "Back to product"}
      </Link>
    </>
  );
}

export function VariantsScreen({
  productUuid,
  variantUuid,
}: {
  productUuid: string;
  variantUuid?: string;
}) {
  const { state } = useStores();
  const product = catalogUuidSchema.safeParse(productUuid);
  const variant = variantUuid === undefined ? undefined : catalogUuidSchema.safeParse(variantUuid);
  return (
    <ProductAccess>
      {!state.context?.permissions.includes("products.variants.view") ? (
        <>
          <PageHeader title="Variants & options" />
          <p className="mb-4 text-sm text-text-muted">
            Your current store access does not include viewing variants and options.
          </p>
          <RefreshAccess />
        </>
      ) : !product.success || (variant && !variant.success) ? (
        <>
          <PageHeader title="Variants & options" />
          <CatalogError error={new ApiError("not-found")} detail retry={() => {}} />
        </>
      ) : (
        <VariantsProduct
          key={product.data}
          productUuid={product.data}
          variantUuid={variant?.data}
        />
      )}
    </ProductAccess>
  );
}
