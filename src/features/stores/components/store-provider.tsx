"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { createStoreController, type StoreController } from "@/lib/stores/controller";
import { useMerchantSession } from "@/features/auth/components/session-boundary";
import { useMerchantApi } from "@/features/auth/components/merchant-api-provider";

const StoreContext = createContext<StoreController | null>(null);

export function useMerchantPrincipal() {
  const { auth } = useMerchantSession();
  const state = useSyncExternalStore(auth.subscribe, auth.getSnapshot, auth.getSnapshot);
  if (state.status !== "authenticated") throw new Error("Merchant identity is not available.");
  return state.principal;
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const api = useMerchantApi();
  const session = useMerchantSession();
  const principal = useMerchantPrincipal();
  if (!api) throw new Error("Merchant connection is not configured.");
  const controller = useMemo(
    () =>
      createStoreController({
        principalId: principal.principalId,
        api,
        queryClient: session.queryClient,
        scope: session.scope,
        onSessionError: session.auth.handleApiError,
      }),
    [api, principal.principalId, session],
  );
  const lifetime = useRef<{ revision: number; controller: StoreController | null }>({
    revision: 0,
    controller: null,
  });

  useEffect(() => {
    const lease = lifetime.current;
    const ticket = ++lease.revision;
    lease.controller = controller;
    let active = true;
    // Session authority loss is synchronous; ordinary StrictMode effect replay is not loss.
    const removeAuthorityListener = session.onAuthorityLost(() => controller.dispose());
    let previous = session.auth.getSnapshot();
    const unsubscribe = session.auth.subscribe(() => {
      const next = session.auth.getSnapshot();
      if (
        previous.status === "authenticated" &&
        previous.revalidation?.status === "pending" &&
        next.status === "authenticated" &&
        !next.revalidation
      )
        void controller.revalidate();
      previous = next;
    });
    queueMicrotask(() => {
      if (active) void controller.discover();
    });
    return () => {
      active = false;
      unsubscribe();
      removeAuthorityListener();
      queueMicrotask(() => {
        if (lease.controller !== controller || ticket === lease.revision) controller.dispose();
      });
    };
  }, [controller, session]);

  return <StoreContext.Provider value={controller}>{children}</StoreContext.Provider>;
}

export function useStores() {
  const controller = useContext(StoreContext);
  if (!controller) throw new Error("Stores require the merchant provider.");
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  return { controller, state };
}
