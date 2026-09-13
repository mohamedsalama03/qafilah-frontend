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
import { Button } from "@/components/ui/button";
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
    };
    const onFocus = () => {
      if (document.visibilityState === "visible") recheck();
    };
    const events = createSessionEvents(() => {
      // A cross-tab authority invalidation is distinct from a routine visibility change.
      suspend();
      if (document.visibilityState === "visible") recheck();
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
  if (state.status === "logout-failed")
    return (
      <main className="mx-auto max-w-xl px-6 py-24">
        <ErrorState
          title="Sign-out could not be confirmed"
          description="This dashboard has been cleared locally, but the server may still have an active session. Retry sign-out before leaving a shared device."
          requestId={state.error.requestId}
        />
        <Button className="mx-5" variant="primary" onClick={() => void session.auth.logout()}>
          Retry sign out
        </Button>
      </main>
    );
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
          {state.status === "logging-out"
            ? "Signing out…"
            : state.status === "unauthenticated"
              ? "Returning to sign in…"
              : "Checking your session…"}
        </p>
      </main>
    );
  return (
    <SessionContext.Provider value={session}>
      <QueryClientProvider client={session.queryClient}>
        <div ref={privateContent} key={state.principal.principalId}>
          {state.revalidation?.status === "error" && (
            <div
              role="status"
              className="border-b border-border bg-surface-subtle px-5 py-3 text-sm"
            >
              <p>Your session couldn’t be rechecked. Your unsaved work is still here.</p>
              <Button className="mt-2" size="sm" onClick={() => void session.auth.bootstrap()}>
                Retry session check
              </Button>
            </div>
          )}
          {children}
        </div>
      </QueryClientProvider>
    </SessionContext.Provider>
  );
}
