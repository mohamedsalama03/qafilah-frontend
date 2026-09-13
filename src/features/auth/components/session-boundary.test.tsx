import { act, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useEffect } from "react";
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
    expect(screen.getByRole("heading", { name: "Access is no longer available" })).toBeVisible();
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
  it("hides on tab suspension without fetching until the tab becomes visible", async () => {
    const adapter = adapterWithIdentity();
    render(
      <SessionBoundary adapter={adapter}>
        <PrivateContent />
      </SessionBoundary>,
    );
    await screen.findByText("Private workspace");
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(screen.queryByText("Private workspace")).not.toBeInTheDocument();
    expect(adapter.loadIdentity).toHaveBeenCalledTimes(1);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await screen.findByText("Private workspace");
    expect(adapter.loadIdentity).toHaveBeenCalledTimes(2);
  });
  it("starts with empty authority when an adapter is replaced", async () => {
    const first = adapterWithIdentity();
    const second: AuthAdapter = {
      loadIdentity: () => new Promise(() => {}),
      logout: async () => {},
    };
    const view = render(
      <SessionBoundary adapter={first}>
        <PrivateContent />
      </SessionBoundary>,
    );
    await screen.findByText("Private workspace");
    view.rerender(
      <SessionBoundary adapter={second}>
        <PrivateContent />
      </SessionBoundary>,
    );
    expect(screen.queryByText("Private workspace")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Checking your session");
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
