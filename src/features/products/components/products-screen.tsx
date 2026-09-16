"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { useStores } from "@/features/stores/components/store-provider";
import { useProductList } from "../queries";
import { formatProductPrice, normalizeProductCriteria, type ProductCriteria } from "../model";
import type { MerchantProduct } from "../contracts";
import { ProductFilters } from "./product-filters";
import {
  availabilityLabel,
  CatalogError,
  ProductAccess,
  ProductLoading,
  ProductStatus,
  ProductTime,
  RefreshAccess,
} from "./product-shared";

function Categories({ product }: { product: MerchantProduct }) {
  return (
    <span className="[overflow-wrap:anywhere]">
      {product.categories.length
        ? product.categories.map((category) => category.name).join(", ")
        : "Uncategorized"}
    </span>
  );
}

function ProductRows({ products, storeUuid }: { products: MerchantProduct[]; storeUuid: string }) {
  const productLink = (product: MerchantProduct) => (
    <Link
      prefetch={false}
      href={`/stores/${storeUuid}/products/${product.id}`}
      className="inline-block rounded-sm py-1 font-medium text-brand underline-offset-4 hover:underline [overflow-wrap:anywhere]"
    >
      {product.name}
    </Link>
  );
  return (
    <>
      <div
        className="hidden overflow-x-auto md:block"
        tabIndex={0}
        role="region"
        aria-label="Product table"
      >
        <table className="w-full min-w-[850px] table-fixed text-start text-[13px]">
          <caption className="sr-only">Products in the selected creation window</caption>
          <thead className="border-b border-border bg-surface-subtle text-xs text-text-muted">
            <tr>
              {["Product", "Status", "Type", "Price", "Availability", "Categories", "Updated"].map(
                (label, index) => (
                  <th
                    scope="col"
                    key={label}
                    className={`px-4 py-3 text-start font-medium ${index === 0 ? "w-[22%]" : ""}`}
                  >
                    {label}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr
                key={product.id}
                className="border-b border-border last:border-0 hover:bg-surface-subtle/50"
              >
                <th scope="row" className="px-4 py-4 text-start align-top">
                  {productLink(product)}
                  <span className="mt-0.5 block text-xs font-normal text-text-muted [overflow-wrap:anywhere]">
                    {product.slug}
                  </span>
                </th>
                <td className="px-4 py-4 align-top">
                  <ProductStatus status={product.status} />
                </td>
                <td className="px-4 py-4 align-top">
                  {product.type === "simple" ? "Simple" : "Variant"}
                </td>
                <td className="px-4 py-4 align-top tabular-nums [overflow-wrap:anywhere]">
                  {formatProductPrice(product)}
                </td>
                <td className="px-4 py-4 align-top">{availabilityLabel(product.availability)}</td>
                <td className="px-4 py-4 align-top text-text-muted">
                  <Categories product={product} />
                </td>
                <td className="px-4 py-4 align-top text-text-muted">
                  <ProductTime value={product.updated_at} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-border md:hidden" aria-label="Products">
        {products.map((product) => (
          <li key={product.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {productLink(product)}
                <p className="mt-1 text-xs text-text-muted">
                  {product.type === "simple" ? "Simple product" : "Variant product"}
                </p>
              </div>
              <ProductStatus status={product.status} />
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
              <div>
                <dt className="text-text-muted">Price</dt>
                <dd className="mt-1 text-sm tabular-nums [overflow-wrap:anywhere]">
                  {formatProductPrice(product)}
                </dd>
              </div>
              <div>
                <dt className="text-text-muted">Availability</dt>
                <dd className="mt-1">{availabilityLabel(product.availability)}</dd>
              </div>
              <div>
                <dt className="text-text-muted">Categories</dt>
                <dd className="mt-1">
                  <Categories product={product} />
                </dd>
              </div>
              <div>
                <dt className="text-text-muted">Updated</dt>
                <dd className="mt-1">
                  <ProductTime value={product.updated_at} />
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

function AuthorizedProducts() {
  const { state } = useStores();
  const [criteria, setCriteria] = useState<ProductCriteria>(() => normalizeProductCriteria());
  const [cursor, setCursor] = useState<string | null>(null);
  const [formRevision, setFormRevision] = useState(0);
  const results = useRef<HTMLDivElement>(null);
  const query = useProductList(criteria, cursor);
  // A refetch must not resurrect previously cached private data after an authoritative denial.
  const page = query.error || query.isFetching ? undefined : query.data;
  function reset() {
    setCriteria(normalizeProductCriteria());
    setCursor(null);
    setFormRevision((value) => value + 1);
  }
  function navigate(next: string | null) {
    setCursor(next);
    results.current?.focus();
  }
  const filtered = !!(
    criteria.q ||
    criteria.status ||
    criteria.category ||
    criteria.created_from ||
    criteria.updated_from
  );
  return (
    <>
      <PageHeader
        title="Products"
        description="Browse your catalog and inspect product information."
        secondaryActions={
          <>
            <RefreshAccess />
            <Button
              onClick={() => void query.refetch()}
              pending={query.isFetching}
              pendingLabel="Refreshing…"
            >
              Refresh products
            </Button>
          </>
        }
      />
      <section
        className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface"
        aria-label="Product catalog"
      >
        <ProductFilters
          key={formRevision}
          canViewCategories={state.context!.permissions.includes("categories.view")}
          pending={query.isFetching}
          onApply={(next) => {
            setCriteria(next);
            setCursor(null);
          }}
          onReset={reset}
        />
        <div
          className="border-b border-border bg-surface-subtle/50 px-4 py-3 text-xs leading-5 text-text-muted sm:px-5"
          role="status"
        >
          {page ? (
            <>
              Created <ProductTime value={page.effectiveRange.created_from} /> –{" "}
              <ProductTime value={page.effectiveRange.created_to} /> (UTC).{" "}
            </>
          ) : (
            "Creation window: previous 366 days unless you choose dates. "
          )}
          {criteria.created_from
            ? "Historical or custom creation window."
            : "Default: previous 366 days."}{" "}
          Choose dates to find older products.
        </div>
        <div
          ref={results}
          tabIndex={-1}
          className="outline-none"
          aria-label="Product results"
          aria-busy={query.isFetching}
        >
          {query.error ? (
            <CatalogError
              error={query.error}
              retry={() => void query.refetch()}
              restart={() => {
                reset();
                if (
                  !cursor &&
                  JSON.stringify(criteria) === JSON.stringify(normalizeProductCriteria())
                )
                  void query.refetch();
              }}
            />
          ) : query.isPending || query.isFetching ? (
            <ProductLoading />
          ) : page?.products.length ? (
            <ProductRows products={page.products} storeUuid={state.scope!.storeUuid} />
          ) : (
            <EmptyState
              icon={<Package size={28} />}
              title={filtered ? "No matching products" : "No products in this creation window"}
              description={
                filtered
                  ? "Try another name prefix, status, category, or date range."
                  : "There are no products to show for these creation dates. Choose a historical range to look for older products."
              }
              action={<Button onClick={reset}>Reset filters</Button>}
            />
          )}
        </div>
        {page && (
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-5">
            <p className="text-xs text-text-muted">
              {page.products.length} {page.products.length === 1 ? "product" : "products"} shown ·
              up to {page.pagination.per_page} per view
            </p>
            <nav className="flex gap-2" aria-label="Product pagination">
              <Button
                disabled={!page.pagination.previous_cursor || query.isFetching}
                onClick={() => navigate(page.pagination.previous_cursor)}
              >
                Previous
              </Button>
              <Button
                disabled={!page.pagination.next_cursor || query.isFetching}
                onClick={() => navigate(page.pagination.next_cursor)}
              >
                Next
              </Button>
            </nav>
          </footer>
        )}
      </section>
    </>
  );
}

export function ProductsScreen() {
  return (
    <ProductAccess>
      <AuthorizedProducts />
    </ProductAccess>
  );
}
