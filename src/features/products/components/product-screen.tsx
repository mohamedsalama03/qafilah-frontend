"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Button, buttonStyles } from "@/components/ui/button";
import { DetailLayout } from "@/components/ui/detail-layout";
import { PageHeader } from "@/components/ui/page-header";
import { useStores } from "@/features/stores/components/store-provider";
import { ProductInventoryPanel } from "@/features/inventory/components/product-inventory-panel";
import { ApiError } from "@/lib/api/errors";
import { useProduct } from "../queries";
import { catalogUuidSchema, formatProductPrice } from "../model";
import { ProductActions } from "./product-actions";
import {
  availabilityLabel,
  CatalogError,
  ProductAccess,
  ProductLoading,
  ProductStatus,
  ProductTime,
  RefreshAccess,
} from "./product-shared";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-5 sm:p-6">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="mt-4 text-sm leading-6">{children}</div>
    </section>
  );
}

function ProductDetail({ productUuid }: { productUuid: string }) {
  const { state } = useStores();
  const query = useProduct(productUuid);
  const product = query.error || query.isFetching ? undefined : query.data;
  // A transient projection refresh must not erase an already-confirmed inventory write.
  // Missing resources and authority/contract failures still remove all private target state.
  const inventoryProduct =
    !query.error ||
    (query.error instanceof ApiError &&
      ["network", "timeout", "server", "rate-limited"].includes(query.error.kind))
      ? query.data
      : undefined;
  const href = `/stores/${state.scope!.storeUuid}/products`;
  return (
    <>
      <PageHeader
        title={product?.name ?? "Product details"}
        status={product ? <ProductStatus status={product.status} /> : undefined}
        breadcrumbs={[{ label: "Products", href }, { label: "Product details" }]}
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
      {inventoryProduct?.type === "simple" && (
        <ProductInventoryPanel
          product={inventoryProduct}
          productReadPending={query.isFetching}
          productReadFailed={!!query.error}
        />
      )}
      {query.error ? (
        <>
          <CatalogError error={query.error} detail retry={() => void query.refetch()} />
          <Link href={href} prefetch={false} className={buttonStyles()}>
            Back to products
          </Link>
        </>
      ) : !product ? (
        <ProductLoading detail />
      ) : (
        <>
          <ProductActions product={product} />
          {product.type === "variant" &&
            state.context?.permissions.includes("products.variants.view") && (
              <div className="mb-5">
                <Link
                  href={`${href}/${product.id}/variants`}
                  prefetch={false}
                  className={buttonStyles()}
                >
                  Manage variants
                </Link>
              </div>
            )}
          <DetailLayout
            sidebar={
              <>
                <Section title="Product information">
                  <dl className="space-y-4">
                    <div>
                      <dt className="text-xs text-text-muted">Type</dt>
                      <dd>{product.type === "simple" ? "Simple product" : "Variant product"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-text-muted">Slug</dt>
                      <dd>{product.slug}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-text-muted">Product ID</dt>
                      <dd className="text-xs">{product.id}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-text-muted">Shipping</dt>
                      <dd>
                        {product.requires_shipping ? "Shipping required" : "Shipping not required"}
                      </dd>
                    </div>
                  </dl>
                </Section>
                <Section title="Timeline">
                  <dl className="space-y-4">
                    {(
                      [
                        ["Created", product.created_at],
                        ["Updated", product.updated_at],
                        ["Published", product.published_at],
                      ] as const
                    ).map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-xs text-text-muted">{label}</dt>
                        <dd>{value ? <ProductTime value={value} /> : "Not published"}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-4 text-xs text-text-muted">Dates shown in UTC.</p>
                </Section>
              </>
            }
          >
            <Section title="Description">
              <p className="max-w-prose whitespace-pre-wrap [overflow-wrap:anywhere]">
                {product.description}
              </p>
            </Section>
            <Section title="Commercial summary">
              <dl className="grid gap-5 sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-text-muted">Price</dt>
                  <dd className="mt-1 font-medium tabular-nums">{formatProductPrice(product)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-text-muted">Availability</dt>
                  <dd className="mt-1">{availabilityLabel(product.availability)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-text-muted">Quantity</dt>
                  <dd className="mt-1 tabular-nums">
                    {product.type === "variant"
                      ? "Managed per variant"
                      : product.quantity === null
                        ? "Not configured"
                        : String(product.quantity)}
                  </dd>
                </div>
              </dl>
              {product.type === "variant" && (
                <p className="mt-5 border-t border-border pt-4 text-xs leading-5 text-text-muted">
                  The starting price and availability summarize active variants independently. The
                  lowest-priced variant may not be in stock.
                </p>
              )}
            </Section>
            <Section title="Categories">
              {product.categories.length ? (
                <ul className="divide-y divide-border">
                  {product.categories.map((category) => (
                    <li
                      key={category.id}
                      className="flex flex-wrap items-start justify-between gap-2 py-2 first:pt-0 last:pb-0"
                    >
                      <span className="min-w-0">{category.name}</span>
                      <span className="text-xs text-text-muted">
                        {category.status === "visible" ? "Visible" : "Hidden"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-text-muted">No categories assigned.</p>
              )}
            </Section>
            <Section title="SEO information">
              <dl className="space-y-4">
                <div>
                  <dt className="text-xs text-text-muted">SEO title</dt>
                  <dd>{product.seo_title ?? "Not configured"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-text-muted">SEO description</dt>
                  <dd>{product.seo_description ?? "Not configured"}</dd>
                </div>
              </dl>
            </Section>
          </DetailLayout>
        </>
      )}
    </>
  );
}

export function ProductScreen({ productUuid }: { productUuid: string }) {
  const parsed = catalogUuidSchema.safeParse(productUuid);
  return (
    <ProductAccess>
      {parsed.success ? (
        <ProductDetail key={parsed.data} productUuid={parsed.data} />
      ) : (
        <>
          <PageHeader title="Product details" />
          <CatalogError error={new ApiError("not-found")} detail retry={() => {}} />
        </>
      )}
    </ProductAccess>
  );
}
