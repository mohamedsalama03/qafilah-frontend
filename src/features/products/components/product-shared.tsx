"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { normalizeUnexpectedError } from "@/lib/api/errors";
import { useStores } from "@/features/stores/components/store-provider";
import type { MerchantProduct } from "../contracts";

export function ProductAccess({ children }: { children: ReactNode }) {
  const { state, controller } = useStores();
  if (!state.context?.permissions.includes("products.view"))
    return (
      <>
        <PageHeader title="Products" />
        <ErrorState
          title="Product access is unavailable"
          description="Your current store access does not include viewing products."
        />
        <Button onClick={() => void controller.revalidate()}>Refresh access</Button>
      </>
    );
  return children;
}

export function RefreshAccess() {
  const { state, controller } = useStores();
  return (
    <Button
      onClick={() => void controller.revalidate()}
      pending={state.refreshing}
      pendingLabel="Refreshing…"
    >
      Refresh access
    </Button>
  );
}

export function CatalogError({
  error,
  retry,
  restart,
  detail = false,
}: {
  error: unknown;
  retry: () => void;
  restart?: () => void;
  detail?: boolean;
}) {
  const normalized = normalizeUnexpectedError(error);
  const forbidden = normalized.kind === "forbidden";
  const missing = detail && normalized.kind === "not-found";
  const invalid = normalized.kind === "validation";
  return (
    <>
      <ErrorState
        title={
          missing
            ? "Product not found"
            : forbidden
              ? "Product access is unavailable"
              : invalid
                ? "Product discovery needs to restart"
                : "Products couldn’t be loaded"
        }
        description={
          missing
            ? "This product is unavailable in the current store. Return to Products to continue."
            : forbidden
              ? "Your access may have changed. Refresh store access to check your current permissions."
              : invalid
                ? "The filters or navigation cursor could not be accepted. Review your filters or start discovery again."
                : normalized.message
        }
        requestId={normalized.requestId}
        retry={missing || forbidden || invalid ? undefined : retry}
      />
      {invalid && restart && (
        <Button className="mx-5 mb-5" onClick={restart}>
          Restart discovery
        </Button>
      )}
      {forbidden && (
        <div className="mx-5 mb-5">
          <RefreshAccess />
        </div>
      )}
    </>
  );
}

export function ProductLoading({ detail = false }: { detail?: boolean }) {
  return (
    <div aria-busy="true" className="space-y-4 p-5">
      <p role="status" className="text-sm text-text-muted">
        {detail ? "Loading product…" : "Loading products…"}
      </p>
      {[0, 1, 2, 3].map((row) => (
        <Skeleton key={row} className="h-10 w-full" />
      ))}
    </div>
  );
}

export function ProductStatus({ status }: { status: MerchantProduct["status"] }) {
  return (
    <StatusBadge tone={status === "published" ? "success" : "neutral"}>
      {status === "published" ? "Published" : status === "draft" ? "Draft" : "Archived"}
    </StatusBadge>
  );
}

export function availabilityLabel(availability: MerchantProduct["availability"]) {
  return {
    unavailable: "Inventory not configured",
    out_of_stock: "Out of stock",
    in_stock: "In stock",
  }[availability];
}

export function ProductTime({ value }: { value: string }) {
  return (
    <time
      dateTime={value}
      title={new Date(value).toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC"}
    >
      {new Date(value).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })}
    </time>
  );
}
