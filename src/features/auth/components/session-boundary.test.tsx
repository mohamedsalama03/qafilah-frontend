import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useEffect, useState } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import type { AuthAdapter } from "@/lib/auth/controller";
import { SessionBoundary, useMerchantSession } from "./session-boundary";

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

type Session = ReturnType<typeof useMerchantSession>;
function PrivateContent({
  label = "Private workspace",
  expose,
}: {
  label?: string;
  expose?: (session: Session) => void;
}) {
  const session = useMerchantSession();
  useEffect(() => {
    expose?.(session);
  }, [expose, session]);
  return <p>{label}</p>;
}

class TestBroadcastChannel {
  static channels: TestBroadcastChannel[] = [];
  static messages: unknown[] = [];
  readonly listeners = new Set<(event: MessageEvent<unknown>) => void>();
  constructor(readonly name: string) {
    TestBroadcastChannel.channels.push(this);
  }
  postMessage(value: unknown) {
    TestBroadcastChannel.messages.push(value);
    for (const channel of TestBroadcastChannel.channels) {
      if (channel !== this && channel.name === this.name)
        channel.listeners.forEach((listener) =>
          listener(new MessageEvent("message", { data: value })),
        );
    }
  }
  addEventListener(_type: "message", listener: (event: MessageEvent<unknown>) => void) {
    this.listeners.add(listener);
  }
  removeEventListener(_type: "message", listener: (event: MessageEvent<unknown>) => void) {
    this.listeners.delete(listener);
  }
  close() {
    TestBroadcastChannel.channels = TestBroadcastChannel.channels.filter(
      (channel) => channel !== this,
    );
  }
}

const adapterWithIdentity = (): AuthAdapter => ({
  loadIdentity: vi.fn(async () => ({ principalId: "unit-test-principal" })),
  logout: vi.fn(async () => {}),
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return { promise, resolve, reject };
}

function MerchantForm({
  expose,
  mounted,
  unmounted,
}: {
  expose: (session: Session) => void;
  mounted: () => void;
  unmounted: () => void;
}) {
  const session = useMerchantSession();
  const [value, setValue] = useState("");
  useEffect(() => {
    expose(session);
    mounted();
    return unmounted;
  }, [expose, mounted, session, unmounted]);
  return (
    <form>
      <label>
        Merchant note
        <input value={value} onChange={(event) => setValue(event.target.value)} />
      </label>
      <button type="button" onClick={() => void session.auth.logout()}>
        Sign out
      </button>
    </form>
  );
}

async function merchantFixture(logout: AuthAdapter["logout"] = async () => {}) {
  const identity = { principalId: "unit-test-principal" };
  const recheck = deferred<{ principalId: string } | null>();
  const loadIdentity = vi
    .fn<AuthAdapter["loadIdentity"]>()
    .mockResolvedValueOnce(identity)
    .mockImplementation(() => recheck.promise);
  const expose = vi.fn<(session: Session) => void>();
  const mounted = vi.fn();
  const unmounted = vi.fn();
  const view = render(
    <SessionBoundary adapter={{ loadIdentity, logout }}>
      <MerchantForm expose={expose} mounted={mounted} unmounted={unmounted} />
    </SessionBoundary>,
  );
  const input = await screen.findByRole("textbox", { name: "Merchant note" });
  const user = userEvent.setup();
  await user.type(input, "Unsaved merchant edit");
  const session = expose.mock.calls.at(-1)![0];
  const scope = session.scope.setScope({
    principalId: identity.principalId,
    storeUuid: "d2cfd6a8-b5aa-4df0-a8bf-2d15d90bb2e1",
  });
  const cached = { private: "cached merchant value" };
  session.queryClient.setQueryData(["private-test-cache"], cached);
  const mutation = session.queryClient.getMutationCache().build(session.queryClient, {
    mutationFn: async () => "private mutation result",
  });
  const operation = deferred<string>();
  let operationSignal!: AbortSignal;
  const result = session.scope
    .run(scope, (signal) => {
      operationSignal = signal;
      return operation.promise;
    })
    .catch((error: unknown) => error);
  const preserved = () => {
    expect(screen.getByRole("textbox", { name: "Merchant note" })).toBe(input);
    expect(input).toHaveValue("Unsaved merchant edit");
    expect(input).toBeVisible();
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();
    expect(session.queryClient.getQueryData(["private-test-cache"])).toBe(cached);
    expect(session.queryClient.getMutationCache().getAll()).toEqual([mutation]);
    expect(session.scope.getScope()).toBe(scope);
    expect(operationSignal.aborted).toBe(false);
  };
  const purged = () => {
    expect(session.queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(session.queryClient.getMutationCache().getAll()).toHaveLength(0);
    expect(session.scope.getScope()).toBeNull();
    expect(operationSignal.aborted).toBe(true);
    expect(unmounted).toHaveBeenCalledTimes(1);
  };
  return {
    view,
    user,
    session,
    identity,
    recheck,
    loadIdentity,
    input,
    operation,
    result,
    mounted,
    preserved,
    purged,
  };
}

beforeEach(() => {
  router.replace.mockClear();
  TestBroadcastChannel.channels = [];
  TestBroadcastChannel.messages = [];
  vi.stubGlobal("BroadcastChannel", TestBroadcastChannel);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("session rendering boundary", () => {
  it.each(["focus", "hidden-visible", "pageshow"] as const)(
    "preserves exact unsaved form, query/mutation cache and pending scope work on %s",
    async (event) => {
      const fixture = await merchantFixture();
      if (event === "hidden-visible") {
        vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
        await act(async () => document.dispatchEvent(new Event("visibilitychange")));
        fixture.preserved();
        expect(fixture.loadIdentity).toHaveBeenCalledTimes(1);
        vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
      }
      await act(async () => {
        if (event === "hidden-visible") document.dispatchEvent(new Event("visibilitychange"));
        else if (event === "pageshow")
          window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
        window.dispatchEvent(new Event("focus"));
      });
      fixture.preserved();
      expect(fixture.loadIdentity).toHaveBeenCalledTimes(2);
      expect(fixture.session.auth.getSnapshot()).toMatchObject({
        status: "authenticated",
        revalidation: { status: "pending" },
      });
      await act(async () => fixture.recheck.resolve(fixture.identity));
      fixture.preserved();
      fixture.operation.resolve("completed scoped work");
      await expect(fixture.result).resolves.toBe("completed scoped work");
    },
  );

  it.each(["network", "server", "timeout", "rate-limited"] as const)(
    "preserves unsaved work on background %s failure and supports explicit retry",
    async (kind) => {
      const fixture = await merchantFixture();
      await act(async () => window.dispatchEvent(new Event("focus")));
      await act(async () => fixture.recheck.reject(new ApiError(kind)));
      fixture.preserved();
      expect(screen.getByRole("status")).toHaveTextContent("Your session couldn’t be rechecked");
      fixture.loadIdentity.mockResolvedValue(fixture.identity);
      await fixture.user.click(screen.getByRole("button", { name: "Retry session check" }));
      expect(fixture.loadIdentity).toHaveBeenCalledTimes(3);
      expect(
        screen.queryByText("Your session couldn’t be rechecked. Your unsaved work is still here."),
      ).not.toBeInTheDocument();
      fixture.preserved();
      fixture.operation.resolve("completed after temporary failure");
      await expect(fixture.result).resolves.toBe("completed after temporary failure");
    },
  );

  it.each(["unauthenticated", "session-expired", "forbidden", "no-identity"] as const)(
    "purges forms, caches and scoped work when revalidation establishes %s authority loss",
    async (kind) => {
      const fixture = await merchantFixture();
      await act(async () => window.dispatchEvent(new Event("focus")));
      fixture.preserved();
      await act(async () => {
        if (kind === "no-identity") fixture.recheck.resolve(null);
        else fixture.recheck.reject(new ApiError(kind));
      });
      fixture.purged();
      expect(screen.queryByRole("textbox", { name: "Merchant note" })).not.toBeInTheDocument();
      await expect(fixture.result).resolves.toMatchObject({ kind: "cancelled" });
    },
  );

  it("purges principal A before mounting a fresh principal B form", async () => {
    const fixture = await merchantFixture();
    await act(async () => window.dispatchEvent(new Event("focus")));
    await act(async () => fixture.recheck.resolve({ principalId: "principal-b" }));
    fixture.purged();
    const nextInput = screen.getByRole("textbox", { name: "Merchant note" });
    expect(nextInput).not.toBe(fixture.input);
    expect(nextInput).toHaveValue("");
    expect(fixture.mounted).toHaveBeenCalledTimes(2);
    expect(fixture.session.auth.getSnapshot()).toMatchObject({
      status: "authenticated",
      principal: { principalId: "principal-b" },
    });
    await expect(fixture.result).resolves.toMatchObject({ kind: "cancelled" });
  });

  it("an old same-principal recheck cannot undo a newer Store switch or cancel its work", async () => {
    const fixture = await merchantFixture();
    await act(async () => window.dispatchEvent(new Event("focus")));
    const nextScope = fixture.session.scope.setScope({
      principalId: fixture.identity.principalId,
      storeUuid: "ef1f37c7-f515-452a-b598-ccdafad4902d",
    });
    const nextData = { private: "new Store value" };
    fixture.session.queryClient.setQueryData(["new-store-cache"], nextData);
    const nextOperation = deferred<string>();
    let nextSignal!: AbortSignal;
    const nextResult = fixture.session.scope.run(nextScope, (signal) => {
      nextSignal = signal;
      return nextOperation.promise;
    });
    await expect(fixture.result).resolves.toMatchObject({ kind: "cancelled" });
    await act(async () => fixture.recheck.resolve(fixture.identity));
    expect(fixture.session.scope.getScope()).toBe(nextScope);
    expect(fixture.session.queryClient.getQueryData(["new-store-cache"])).toBe(nextData);
    expect(nextSignal.aborted).toBe(false);
    nextOperation.resolve("new Store operation completed");
    await expect(nextResult).resolves.toBe("new Store operation completed");
  });

  it.each([false, true])(
    "purges on pagehide persisted=%s and restores only after identity recheck",
    async (persisted) => {
      const fixture = await merchantFixture();
      const wrapper = fixture.input.closest("form")?.parentElement;
      await act(async () =>
        window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted })),
      );
      fixture.purged();
      expect(wrapper).toHaveAttribute("hidden");
      expect(screen.queryByRole("textbox", { name: "Merchant note" })).not.toBeInTheDocument();
      await act(async () =>
        window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })),
      );
      expect(screen.queryByRole("textbox", { name: "Merchant note" })).not.toBeInTheDocument();
      await act(async () => fixture.recheck.resolve(fixture.identity));
      expect(screen.getByRole("textbox", { name: "Merchant note" })).toHaveValue("");
      expect(fixture.mounted).toHaveBeenCalledTimes(2);
      await expect(fixture.result).resolves.toMatchObject({ kind: "cancelled" });
    },
  );

  it.each(["logout", "authority-loss", "pagehide"] as const)(
    "blocks an abort-ignoring stale revalidation after %s",
    async (event) => {
      const fixture = await merchantFixture();
      await act(async () => window.dispatchEvent(new Event("focus")));
      await act(async () => {
        if (event === "logout") await fixture.session.auth.logout();
        else if (event === "authority-loss")
          fixture.session.auth.handleApiError(new ApiError("session-expired"));
        else window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
      });
      fixture.purged();
      await act(async () => fixture.recheck.resolve(fixture.identity));
      expect(screen.queryByRole("textbox", { name: "Merchant note" })).not.toBeInTheDocument();
      expect(fixture.session.auth.getSnapshot().status).not.toBe("authenticated");
      await expect(fixture.result).resolves.toMatchObject({ kind: "cancelled" });
    },
  );

  it("keeps a failed logout explicit and locally purged across focus, repeated failure and successful retry", async () => {
    const first = deferred<void>();
    const retry = deferred<void>();
    const finalRetry = deferred<void>();
    const logout = vi
      .fn<AuthAdapter["logout"]>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => retry.promise)
      .mockImplementationOnce(() => finalRetry.promise);
    const fixture = await merchantFixture(logout);
    await fixture.user.click(screen.getByRole("button", { name: "Sign out" }));
    fixture.purged();
    expect(screen.getByRole("status")).toHaveTextContent("Signing out");
    await act(async () => first.reject(new ApiError("network", { mutationOutcome: "unknown" })));
    expect(
      screen.getByRole("heading", { name: "Sign-out could not be confirmed", level: 1 }),
    ).toBeVisible();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("server may still have an active session");
    expect(screen.getByRole("alert")).toHaveTextContent("before leaving a shared device");
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
      await fixture.session.auth.bootstrap();
      fixture.session.auth.handleApiError(new ApiError("session-expired"));
    });
    expect(fixture.loadIdentity).toHaveBeenCalledTimes(1);
    expect(logout).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "Sign-out could not be confirmed" })).toBeVisible();
    await fixture.user.click(screen.getByRole("button", { name: "Retry sign out" }));
    expect(logout).toHaveBeenCalledTimes(2);
    await act(async () => retry.reject(new ApiError("server")));
    expect(screen.getByRole("heading", { name: "Sign-out could not be confirmed" })).toBeVisible();
    fixture.purged();
    await fixture.user.click(screen.getByRole("button", { name: "Retry sign out" }));
    expect(logout).toHaveBeenCalledTimes(3);
    await act(async () => finalRetry.resolve());
    expect(router.replace).toHaveBeenCalledExactlyOnceWith("/login");
    expect(fixture.session.auth.getSnapshot()).toEqual({
      status: "unauthenticated",
      reason: "signed-out",
    });
    fixture.purged();
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(fixture.loadIdentity).toHaveBeenCalledTimes(1);
    await expect(fixture.result).resolves.toMatchObject({ kind: "cancelled" });
  });

  it("never renders private children or redirects when integration is unavailable", async () => {
    render(
      <SessionBoundary>
        <p>Private workspace</p>
      </SessionBoundary>,
    );
    expect(
      await screen.findByRole("heading", { name: "Sign-in is not available yet" }),
    ).toBeVisible();
    expect(screen.queryByText("Private workspace")).not.toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });
  it("keeps server rendering in a stable unresolved snapshot without fetching or private content", () => {
    const adapter = adapterWithIdentity();
    const html = renderToString(
      <SessionBoundary adapter={adapter}>
        <p>Private workspace</p>
      </SessionBoundary>,
    );
    expect(html).toContain("Checking your session");
    expect(html).not.toContain("Private workspace");
    expect(adapter.loadIdentity).not.toHaveBeenCalled();
  });
  it("boots exactly once under StrictMode and preserves subscriptions after effect replay", async () => {
    const adapter = adapterWithIdentity();
    const expose = vi.fn<(session: Session) => void>();
    render(
      <StrictMode>
        <SessionBoundary adapter={adapter}>
          <PrivateContent expose={expose} />
        </SessionBoundary>
      </StrictMode>,
    );
    await screen.findByText("Private workspace");
    expect(adapter.loadIdentity).toHaveBeenCalledTimes(1);
    const session = expose.mock.calls.at(-1)?.[0];
    expect(session).toBeDefined();
    act(() => {
      session?.auth.handleApiError(new ApiError("forbidden"));
    });
    expect(screen.queryByText("Private workspace")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Access is no longer available", level: 1 }),
    ).toBeVisible();
  });
  it.each(["unauthenticated", "session-expired"] as const)(
    "hides private children and redirects once on %s",
    async (kind) => {
      const adapter: AuthAdapter = {
        loadIdentity: vi.fn(async () => {
          throw new ApiError(kind);
        }),
        logout: async () => {},
      };
      const view = render(
        <SessionBoundary adapter={adapter}>
          <p>Private workspace</p>
        </SessionBoundary>,
      );
      await waitFor(() => expect(router.replace).toHaveBeenCalledExactlyOnceWith("/login"));
      view.rerender(
        <SessionBoundary adapter={adapter}>
          <p>Private workspace</p>
        </SessionBoundary>,
      );
      expect(screen.queryByText("Private workspace")).not.toBeInTheDocument();
      expect(router.replace).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["forbidden", "network"] as const)(
    "keeps private children absent on %s errors",
    async (kind) => {
      const adapter: AuthAdapter = {
        loadIdentity: async () => {
          throw new ApiError(kind);
        },
        logout: async () => {},
      };
      render(
        <SessionBoundary adapter={adapter}>
          <p>Private workspace</p>
        </SessionBoundary>,
      );
      await screen.findByRole("alert");
      expect(screen.queryByText("Private workspace")).not.toBeInTheDocument();
      expect(router.replace).not.toHaveBeenCalled();
    },
  );
  it("purges private cache on pagehide and deduplicates return rechecks until authoritative identity resolves", async () => {
    let resolveRecheck: (value: { principalId: string }) => void = () => {
      throw new Error("No recheck");
    };
    const loadIdentity = vi
      .fn<AuthAdapter["loadIdentity"]>()
      .mockResolvedValueOnce({ principalId: "unit-test-principal" })
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveRecheck = resolve;
          }),
      );
    const adapter: AuthAdapter = { loadIdentity, logout: async () => {} };
    const expose = vi.fn<(session: Session) => void>();
    render(
      <SessionBoundary adapter={adapter}>
        <PrivateContent expose={expose} />
      </SessionBoundary>,
    );
    const privateElement = await screen.findByText("Private workspace");
    const wrapper = privateElement.parentElement;
    const session = expose.mock.calls.at(-1)?.[0];
    session?.queryClient.setQueryData(["private-test-cache"], "sensitive test value");
    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    });
    expect(wrapper).toHaveAttribute("hidden");
    expect(screen.queryByText("Private workspace")).not.toBeInTheDocument();
    expect(session?.queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(loadIdentity).toHaveBeenCalledTimes(1);
    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(loadIdentity).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Private workspace")).not.toBeInTheDocument();
    await act(async () => {
      resolveRecheck({ principalId: "unit-test-principal" });
    });
    expect(screen.getByText("Private workspace")).toBeVisible();
  });
  it("preserves the mounted workspace while hidden and rechecks when visible", async () => {
    const adapter = adapterWithIdentity();
    render(
      <SessionBoundary adapter={adapter}>
        <PrivateContent />
      </SessionBoundary>,
    );
    const workspace = await screen.findByText("Private workspace");
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(screen.getByText("Private workspace")).toBe(workspace);
    expect(adapter.loadIdentity).toHaveBeenCalledTimes(1);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await screen.findByText("Private workspace");
    expect(adapter.loadIdentity).toHaveBeenCalledTimes(2);
  });
  it("starts with empty authority when an adapter is replaced", async () => {
    const first = adapterWithIdentity();
    const second: AuthAdapter = {
      loadIdentity: vi.fn<AuthAdapter["loadIdentity"]>(() => new Promise(() => {})),
      logout: async () => {},
    };
    const view = render(
      <SessionBoundary adapter={first}>
        <PrivateContent />
      </SessionBoundary>,
    );
    await screen.findByText("Private workspace");
    await act(async () => {
      view.rerender(
        <SessionBoundary adapter={second}>
          <PrivateContent />
        </SessionBoundary>,
      );
    });
    expect(second.loadIdentity).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Private workspace")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Checking your session");
  });
  it("keeps a same-principal scoped disagreement local instead of invalidating other tabs", async () => {
    const first = adapterWithIdentity();
    const second = adapterWithIdentity();
    const expose = vi.fn<(session: Session) => void>();
    render(
      <>
        <SessionBoundary adapter={first}>
          <PrivateContent label="First private workspace" expose={expose} />
        </SessionBoundary>
        <SessionBoundary adapter={second}>
          <PrivateContent label="Second private workspace" />
        </SessionBoundary>
      </>,
    );
    await screen.findByText("First private workspace");
    await screen.findByText("Second private workspace");
    await act(async () => {
      await expose.mock.calls
        .at(-1)![0]
        .auth.handleScopedReadError(new ApiError("session-expired"));
    });
    expect(screen.queryByText("First private workspace")).not.toBeInTheDocument();
    expect(screen.getByText("Second private workspace")).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Your workspace couldn’t be loaded" }),
    ).toBeVisible();
    expect(first.loadIdentity).toHaveBeenCalledTimes(2);
    expect(second.loadIdentity).toHaveBeenCalledTimes(1);
    expect(TestBroadcastChannel.messages).toEqual([]);
  });
  it("rechecks a second tab after permission invalidation without trusting or echoing the signal", async () => {
    const first = adapterWithIdentity();
    const second: AuthAdapter = {
      loadIdentity: vi
        .fn<AuthAdapter["loadIdentity"]>()
        .mockResolvedValueOnce({ principalId: "unit-test-principal" })
        .mockImplementation(() => new Promise(() => {})),
      logout: async () => {},
    };
    const expose = vi.fn<(session: Session) => void>();
    render(
      <>
        <SessionBoundary adapter={first}>
          <PrivateContent label="First private workspace" expose={expose} />
        </SessionBoundary>
        <SessionBoundary adapter={second}>
          <PrivateContent label="Second private workspace" />
        </SessionBoundary>
      </>,
    );
    await screen.findByText("First private workspace");
    await screen.findByText("Second private workspace");
    act(() => {
      expose.mock.calls.at(-1)?.[0].auth.handleApiError(new ApiError("forbidden"));
    });
    expect(screen.queryByText("First private workspace")).not.toBeInTheDocument();
    expect(screen.queryByText("Second private workspace")).not.toBeInTheDocument();
    await waitFor(() => expect(second.loadIdentity).toHaveBeenCalledTimes(2));
    expect(TestBroadcastChannel.messages).toEqual([{ type: "invalidate" }]);
  });
});
