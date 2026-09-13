"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { createAuthController, type AuthAdapter } from "@/lib/auth/controller";
import { createSessionEvents } from "@/lib/auth/session-events";
import { createQueryClient } from "@/lib/query/client";
import { createScopeController } from "@/lib/query/scope";
import { ConnectionUnavailable } from "./connection-unavailable";
import { ErrorState } from "@/components/ui/error-state";
import type { ApiError } from "@/lib/api/errors";

function createSession(adapter?: AuthAdapter) {
  const queryClient = createQueryClient();
  const scope = createScopeController(queryClient);
  const controller = createAuthController({ adapter, onAuthorityLost: () => scope.clear() });
  const serverSnapshot = controller.getSnapshot();
  let publishInvalidation: (() => void) | undefined;
  const auth = {
    ...controller,
    async logout(): Promise<void> {
      await controller.logout();
      publishInvalidation?.();
    },
    handleApiError(error: ApiError): void {
      controller.handleApiError(error);
      if (["unauthenticated", "session-expired", "forbidden"].includes(error.kind))
        publishInvalidation?.();
    },
  };
  return {
    queryClient,
    scope,
    auth,
    getServerSnapshot: () => serverSnapshot,
    setInvalidationPublisher: (publish?: () => void) => {
      publishInvalidation = publish;
    },
  };
}
type MerchantSession = Pick<ReturnType<typeof createSession>, "queryClient" | "scope" | "auth">;
const SessionContext = createContext<MerchantSession | null>(null);

export function useMerchantSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("Merchant session requires its protected boundary.");
  return value;
}

/** No adapter is registered in F1; only reviewed Laravel contracts may supply one. */
export function SessionBoundary({
  children,
  adapter,
}: {
  children: React.ReactNode;
  adapter?: AuthAdapter;
}) {
  // A replacement adapter must never inherit the previous session's identity or cache.
  const session = useMemo(() => createSession(adapter), [adapter]);
  const state = useSyncExternalStore(
    session.auth.subscribe,
    session.auth.getSnapshot,
    session.getServerSnapshot,
  );
  const privateContent = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    let active = true;
    const hide = () => {
      // Hide synchronously before the browser can capture a page-history snapshot.
      if (privateContent.current) privateContent.current.hidden = true;
    };
    const suspend = () => {
      hide();
      session.auth.suspend();
    };
    const recheck = () => {
      hide();
      void session.auth.bootstrap();
    };
    // React StrictMode cancels its first effect setup before this starts any request.
    queueMicrotask(() => {
      if (active) recheck();
    });
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) recheck();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") recheck();
      else suspend();
    };
    const onFocus = () => {
      if (document.visibilityState === "visible") recheck();
    };
    const events = createSessionEvents(() => {
      if (document.visibilityState === "visible") recheck();
      else suspend();
    });
    session.setInvalidationPublisher(events.invalidate);
    window.addEventListener("pagehide", suspend);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      window.removeEventListener("pagehide", suspend);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      session.setInvalidationPublisher();
      events.close();
      session.auth.dispose();
    };
  }, [session]);

  useEffect(() => {
    if (state.status === "unauthenticated") router.replace("/login");
  }, [state.status, router]);

  if (state.status === "unavailable") return <ConnectionUnavailable />;
  if (state.status === "error")
    return (
      <main className="mx-auto max-w-xl px-6 py-24">
        <ErrorState
          title={
            state.error.kind === "forbidden"
              ? "Access is no longer available"
              : "Your session couldn’t be checked"
          }
          description={state.error.message}
          requestId={state.error.requestId}
          retry={() => {
            void session.auth.bootstrap();
          }}
        />
      </main>
    );
  if (state.status !== "authenticated")
    return (
      <main aria-busy="true" className="mx-auto max-w-md px-6 py-24">
        <p role="status" className="text-text-muted">
          Checking your session…
        </p>
      </main>
    );
  return (
    <SessionContext.Provider value={session}>
      <QueryClientProvider client={session.queryClient}>
        <div ref={privateContent}>{children}</div>
      </QueryClientProvider>
    </SessionContext.Provider>
  );
}
