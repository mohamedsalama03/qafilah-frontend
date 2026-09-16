"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { Brand } from "@/components/layout/brand";
import { Button, buttonStyles } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { UserMenu } from "@/features/auth/components/user-menu";
import { StoreSwitcher } from "./store-switcher";
import { useMerchantPrincipal, useStores } from "./store-provider";

function permissionLabel(code: string) {
  return code
    .split(/[._-]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function StoreWorkspace({
  storeUuid,
  children,
  title = "Overview",
}: {
  storeUuid: string;
  children?: React.ReactNode;
  title?: string;
}) {
  const destinationUuid = storeUuid.toLowerCase();
  const { controller, state } = useStores();
  const principal = useMerchantPrincipal();
  useEffect(() => {
    void controller.select(destinationUuid);
  }, [controller, destinationUuid]);
  // A navigation prop is never authority. This render guard also covers browser history and refresh.
  const context =
    state.context?.store.id === destinationUuid &&
    state.selectedUuid === destinationUuid &&
    state.scope?.storeUuid === destinationUuid
      ? state.context
      : null;

  if (!context) {
    const error = state.contextStatus === "error" ? state.contextError : null;
    return (
      <div className="min-h-dvh px-5">
        <header className="mx-auto flex max-w-5xl items-center justify-between gap-5 py-6">
          <Brand />
          <UserMenu />
        </header>
        <main className="mx-auto max-w-xl py-12">
          <h1 className="text-2xl font-semibold">
            {error ? "Store access is unavailable" : "Opening your store"}
          </h1>
          {error ? (
            <>
              <ErrorState
                title={
                  error.kind === "not-found"
                    ? "This store isn’t available"
                    : error.kind === "forbidden"
                      ? "You can’t access this store right now"
                      : "Store access couldn’t be checked"
                }
                description={
                  ["not-found", "forbidden"].includes(error.kind)
                    ? "The store may be unavailable or your access may have changed. Return to your available stores to continue."
                    : error.message
                }
                requestId={error.requestId}
                retry={
                  ["not-found", "forbidden"].includes(error.kind)
                    ? undefined
                    : () => void controller.select(destinationUuid)
                }
              />
              <Link
                href="/"
                prefetch={false}
                onClick={() => controller.leave()}
                className={buttonStyles()}
              >
                Choose another store
              </Link>
            </>
          ) : (
            <p role="status" className="mt-4 text-sm text-text-muted">
              Checking store access…
            </p>
          )}
        </main>
      </div>
    );
  }

  return (
    <AppShell
      privateNavigation
      title={title}
      navigation={[
        { href: `/stores/${context.store.id}`, label: "Overview", icon: "home" },
        ...(context.permissions.includes("products.view")
          ? [
              {
                href: `/stores/${context.store.id}/products`,
                label: "Products",
                icon: "table" as const,
              },
            ]
          : context.permissions.includes("products.create")
            ? [
                {
                  href: `/stores/${context.store.id}/products/new`,
                  label: "Create product",
                  icon: "table" as const,
                },
              ]
            : []),
      ]}
      sidebarStoreContext={<StoreSwitcher />}
      storeContext={
        <span className="block text-xs font-medium [overflow-wrap:anywhere]">
          {context.store.name}
        </span>
      }
      accountActions={<UserMenu />}
    >
      <div
        key={`${context.store.id}:${state.scope!.revision}`}
        role="region"
        aria-label="Current store"
        data-store-uuid={context.store.id}
      >
        {children && state.contextError && (
          <ErrorState
            title="Store access couldn’t be refreshed"
            description="The last confirmed context is still shown. Retry to check your current access."
            requestId={state.contextError.requestId}
            retry={() => void controller.revalidate()}
          />
        )}
        {children ?? (
          <>
            <PageHeader
              title={context.store.name}
              description="Your store workspace and current account access."
              status={<StatusBadge tone="success">{context.store.status}</StatusBadge>}
              secondaryActions={
                <Button
                  onClick={() => void controller.revalidate()}
                  pending={state.refreshing}
                  pendingLabel="Refreshing…"
                >
                  Refresh access
                </Button>
              }
            />
            {state.contextError && (
              <ErrorState
                title="Store access couldn’t be refreshed"
                description="The last confirmed context is still shown. Retry to check your current access."
                requestId={state.contextError.requestId}
                retry={() => void controller.revalidate()}
              />
            )}
            <section
              className="rounded-lg border border-border bg-surface p-5 sm:p-6"
              aria-labelledby="workspace-overview-title"
            >
              <h2 id="workspace-overview-title" className="text-base font-semibold">
                Store overview
              </h2>
              <p className="mt-2 max-w-prose text-sm leading-6 text-text-muted">
                You’re connected to this store. Operational tools will appear here as they become
                available.
              </p>
              <dl className="mt-6 grid gap-5 border-t border-border pt-5 sm:grid-cols-2">
                <div className="min-w-0">
                  <dt className="text-xs text-text-muted">Signed in as</dt>
                  <dd className="mt-1 text-sm font-medium [overflow-wrap:anywhere]">
                    {principal.displayName ?? "Merchant account"}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-text-muted">Your role</dt>
                  <dd className="mt-1 text-sm font-medium [overflow-wrap:anywhere]">
                    {context.role.name}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-text-muted">Membership</dt>
                  <dd className="mt-1 text-sm capitalize">{context.membership.status}</dd>
                </div>
                {principal.emailVerified !== undefined && (
                  <div className="min-w-0">
                    <dt className="text-xs text-text-muted">Email verification</dt>
                    <dd className="mt-1 text-sm">
                      {principal.emailVerified ? "Verified" : "Not verified"}
                    </dd>
                  </div>
                )}
              </dl>
            </section>
            <section className="mt-8" aria-labelledby="workspace-permissions-title">
              <h2 id="workspace-permissions-title" className="text-base font-semibold">
                Your access
              </h2>
              <p className="mt-2 max-w-prose text-sm leading-6 text-text-muted">
                These permissions describe your current access. Available operations are checked by
                Qafilah when you use them.
              </p>
              {context.permissions.length ? (
                <ul
                  className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2"
                  aria-label="Current permissions"
                >
                  {context.permissions.map((permission) => (
                    <li
                      key={permission}
                      className="min-w-0 border-b border-border py-2 text-sm [overflow-wrap:anywhere]"
                    >
                      {permissionLabel(permission)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-text-muted">
                  No operational permissions are assigned to your current role.
                </p>
              )}
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
