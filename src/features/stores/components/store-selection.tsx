"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Brand } from "@/components/layout/brand";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { ErrorState } from "@/components/ui/error-state";
import { UserMenu } from "@/features/auth/components/user-menu";
import { StoreList } from "./store-list";
import { useMerchantPrincipal, useStores } from "./store-provider";

export function StoreSelection() {
  const { controller, state } = useStores();
  const principal = useMerchantPrincipal();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const attemptedSingle = useRef<string | null>(null);

  useEffect(() => {
    controller.leave();
  }, [controller]);

  useEffect(() => {
    if (state.discoveryStatus !== "ready" || state.stores.length !== 1) return;
    const uuid = state.stores[0]!.id;
    if (attemptedSingle.current === uuid) return;
    attemptedSingle.current = uuid;
    // Discovery includes every backend page. Enter the single destination only after context authority.
    void controller.select(uuid).then(() => {
      const current = controller.getSnapshot();
      if (current.contextStatus === "ready" && current.context?.store.id === uuid)
        router.replace(`/stores/${uuid}`);
    });
  }, [controller, router, state.discoveryStatus, state.stores]);

  return (
    <div className="min-h-dvh px-5">
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-5 py-6">
        <Brand />
        <UserMenu />
      </header>
      <main className="mx-auto max-w-2xl pb-16 pt-8 sm:pt-14">
        <PageHeader
          title="Choose a store"
          description={`${principal.displayName ? `${principal.displayName}, choose` : "Choose"} the workspace you want to open.`}
        />
        {state.discoveryStatus === "idle" ||
        (state.discoveryStatus === "loading" && !state.stores.length) ? (
          <p role="status" className="py-8 text-sm text-text-muted">
            Loading your stores…
          </p>
        ) : (
          <>
            {state.discoveryError && (
              <ErrorState
                title="Your stores couldn’t be loaded"
                description={state.discoveryError.message}
                requestId={state.discoveryError.requestId}
                retry={() => void controller.discover()}
              />
            )}
            {state.contextError && (
              <ErrorState
                title="This store can’t be opened"
                description="Store access could not be confirmed. Choose an available store or refresh the list."
                requestId={state.contextError.requestId}
              />
            )}
            {state.contextStatus === "loading" && (
              <p role="status" className="mb-4 text-sm text-text-muted">
                Opening your store…
              </p>
            )}
            {state.discoveryStatus === "ready" && state.stores.length === 0 ? (
              <section className="border-y border-border py-8">
                <h2 className="text-base font-semibold">No stores are available</h2>
                <p className="mt-2 max-w-prose text-sm leading-6 text-text-muted">
                  Your account has no eligible store access right now. Contact your store
                  administrator if you expected a workspace here.
                </p>
                <Button className="mt-5" onClick={() => void controller.discover()}>
                  Refresh stores
                </Button>
              </section>
            ) : state.stores.length > 0 ? (
              <StoreList
                stores={state.stores}
                search={search}
                onSearch={setSearch}
                searchId="store-selection-search"
                onSelect={(uuid) => {
                  void controller.select(uuid);
                  router.push(`/stores/${uuid}`);
                }}
              />
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
