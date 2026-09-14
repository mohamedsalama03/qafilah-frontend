import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/errors";
import { createAuthController } from "./controller";
import { safeReturnPath } from "./return-path";

describe("deterministic authentication authority", () => {
  it("refreshes minimized metadata for the same principal without revoking mounted authority", async () => {
    const purge = vi.fn();
    const loadIdentity = vi
      .fn()
      .mockResolvedValueOnce({
        principalId: "principal-a",
        displayName: "Before",
        emailVerified: false,
      })
      .mockResolvedValueOnce({
        principalId: "principal-a",
        displayName: "After",
        emailVerified: true,
      });
    const controller = createAuthController({
      onAuthorityLost: purge,
      adapter: { loadIdentity, logout: async () => {} },
    });
    await controller.bootstrap();
    await controller.bootstrap();
    expect(controller.getSnapshot()).toEqual({
      status: "authenticated",
      principal: {
        principalId: "principal-a",
        displayName: "After",
        emailVerified: true,
      },
    });
    expect(purge).not.toHaveBeenCalled();
  });
  it("retains stable principal metadata references when nothing changed", async () => {
    const controller = createAuthController({
      adapter: {
        loadIdentity: async () => ({
          principalId: "principal-a",
          displayName: "Merchant",
          emailVerified: true,
        }),
        logout: async () => {},
      },
    });
    await controller.bootstrap();
    const previous = controller.getSnapshot();
    await controller.bootstrap();
    const current = controller.getSnapshot();
    if (previous.status !== "authenticated" || current.status !== "authenticated")
      throw new Error("Expected authority");
    expect(current.principal).toBe(previous.principal);
  });
  it("distinguishes initial anonymous identity from an expired mounted session", async () => {
    const loadIdentity = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ principalId: "principal-a" })
      .mockResolvedValueOnce(null);
    const purge = vi.fn();
    const controller = createAuthController({
      onAuthorityLost: purge,
      adapter: { loadIdentity, logout: async () => {} },
    });
    await controller.bootstrap();
    expect(controller.getSnapshot()).toEqual({
      status: "unauthenticated",
      reason: "not-signed-in",
    });
    await controller.bootstrap();
    await controller.bootstrap();
    expect(controller.getSnapshot()).toEqual({ status: "unauthenticated", reason: "expired" });
    expect(purge).toHaveBeenCalledTimes(2);
  });
  it("rejects unsafe identity metadata instead of retaining previous private authority", async () => {
    const purge = vi.fn();
    const loadIdentity = vi
      .fn()
      .mockResolvedValueOnce({ principalId: "principal-a" })
      .mockResolvedValueOnce({ principalId: "principal-a", displayName: "Unsafe\nname" });
    const controller = createAuthController({
      onAuthorityLost: purge,
      adapter: { loadIdentity, logout: async () => {} },
    });
    await controller.bootstrap();
    await controller.bootstrap();
    expect(controller.getSnapshot()).toMatchObject({
      status: "error",
      error: { kind: "invalid-response" },
    });
    expect(purge).toHaveBeenCalledTimes(1);
  });
  it("remains unavailable without a reviewed adapter and never creates fake identity", async () => {
    const controller = createAuthController();
    expect(controller.getSnapshot()).toEqual({ status: "unavailable" });
    await controller.bootstrap();
    await controller.logout();
    expect(controller.getSnapshot()).toEqual({ status: "unavailable" });
  });
  it("deduplicates concurrent bootstrap requests", async () => {
    const loadIdentity = vi.fn(async () => ({ principalId: "principal-a" }));
    const controller = createAuthController({ adapter: { loadIdentity, logout: async () => {} } });
    const first = controller.bootstrap();
    const second = controller.bootstrap();
    expect(first).toBe(second);
    await first;
    expect(loadIdentity).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toEqual({
      status: "authenticated",
      principal: { principalId: "principal-a" },
    });
  });
  it("does not revoke authority during a deduplicated same-principal recheck", async () => {
    const purge = vi.fn();
    const loadIdentity = vi.fn(async () => ({ principalId: "principal-a" }));
    const controller = createAuthController({
      onAuthorityLost: purge,
      adapter: { loadIdentity, logout: async () => {} },
    });
    await controller.bootstrap();
    const previous = controller.getSnapshot();
    const first = controller.bootstrap();
    const second = controller.bootstrap();
    expect(first).toBe(second);
    expect(controller.getSnapshot()).toMatchObject({
      status: "authenticated",
      revalidation: { status: "pending" },
    });
    await first;
    expect(controller.getSnapshot()).toEqual(previous);
    expect(purge).not.toHaveBeenCalled();
    expect(loadIdentity).toHaveBeenCalledTimes(2);
  });
  it("cannot restore an older principal after newer authority is established", async () => {
    let finishOld!: (identity: { principalId: string }) => void;
    const loadIdentity = vi
      .fn()
      .mockResolvedValueOnce({ principalId: "principal-a" })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve;
          }),
      )
      .mockResolvedValueOnce({ principalId: "principal-b" });
    const controller = createAuthController({ adapter: { loadIdentity, logout: async () => {} } });
    await controller.bootstrap();
    const oldRecheck = controller.bootstrap();
    await Promise.resolve();
    controller.handleApiError(new ApiError("forbidden"));
    await controller.bootstrap();
    finishOld({ principalId: "principal-a" });
    await oldRecheck;
    expect(controller.getSnapshot()).toEqual({
      status: "authenticated",
      principal: { principalId: "principal-b" },
    });
  });
  it("a fresh document after failed logout starts unresolved and rechecks remote authority without claiming logout succeeded", async () => {
    const loadIdentity = vi.fn(async () => ({ principalId: "principal-a" }));
    const adapter = {
      loadIdentity,
      logout: async () => {
        throw new ApiError("network");
      },
    };
    const previousDocument = createAuthController({ adapter });
    await previousDocument.bootstrap();
    await previousDocument.logout();
    expect(previousDocument.getSnapshot().status).toBe("logout-failed");
    previousDocument.dispose();
    const newDocument = createAuthController({ adapter });
    expect(newDocument.getSnapshot()).toEqual({ status: "bootstrapping" });
    await newDocument.bootstrap();
    expect(loadIdentity).toHaveBeenCalledTimes(2);
    expect(newDocument.getSnapshot()).toEqual({
      status: "authenticated",
      principal: { principalId: "principal-a" },
    });
  });
  it("logout rejects stale identity returned from an abort-ignoring adapter", async () => {
    let finish: (value: { principalId: string }) => void = () => {
      throw new Error("No request");
    };
    const purge = vi.fn();
    const logout = vi.fn(async () => {});
    const controller = createAuthController({
      onAuthorityLost: purge,
      adapter: {
        loadIdentity: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
        logout,
      },
    });
    const bootstrap = controller.bootstrap();
    await Promise.resolve();
    const signout = controller.logout();
    expect(controller.getSnapshot().status).toBe("logging-out");
    expect(purge).toHaveBeenCalledTimes(1);
    finish({ principalId: "previous-merchant" });
    await Promise.all([bootstrap, signout]);
    expect(controller.getSnapshot()).toEqual({ status: "unauthenticated", reason: "signed-out" });
    expect(logout).toHaveBeenCalledTimes(1);
  });
  it.each(["unauthenticated", "session-expired"] as const)(
    "immediately hides identity and purges cache on %s",
    async (kind) => {
      const purge = vi.fn();
      const controller = createAuthController({
        onAuthorityLost: purge,
        adapter: {
          loadIdentity: async () => ({ principalId: "principal-a" }),
          logout: async () => {},
        },
      });
      await controller.bootstrap();
      controller.handleApiError(new ApiError(kind));
      expect(controller.getSnapshot()).toEqual({ status: "unauthenticated", reason: "expired" });
      expect(purge).toHaveBeenCalledTimes(1);
    },
  );
  it("drops cached authority on permission loss and requires refresh", async () => {
    const purge = vi.fn();
    const controller = createAuthController({
      onAuthorityLost: purge,
      adapter: {
        loadIdentity: async () => ({ principalId: "principal-a" }),
        logout: async () => {},
      },
    });
    await controller.bootstrap();
    controller.handleApiError(new ApiError("forbidden"));
    expect(controller.getSnapshot()).toMatchObject({
      status: "error",
      error: { kind: "forbidden" },
    });
    expect(purge).toHaveBeenCalledTimes(1);
  });
  it("never restores merchant data or claims successful server logout after network loss", async () => {
    const controller = createAuthController({
      adapter: {
        loadIdentity: async () => ({ principalId: "principal-a" }),
        logout: async () => {
          throw new ApiError("network", { mutationOutcome: "unknown" });
        },
      },
    });
    await controller.bootstrap();
    await controller.logout();
    expect(controller.getSnapshot()).toMatchObject({
      status: "logout-failed",
      error: { kind: "network", mutationOutcome: "unknown" },
    });
    expect(controller.getSnapshot()).not.toHaveProperty("principal");
  });
  it("can retry bootstrap after a synchronously failing adapter", async () => {
    const loadIdentity = vi
      .fn<() => Promise<{ principalId: unknown } | null>>()
      .mockImplementationOnce(() => {
        throw new Error("private exception");
      })
      .mockResolvedValue({ principalId: "principal-a" });
    const controller = createAuthController({ adapter: { loadIdentity, logout: async () => {} } });
    await controller.bootstrap();
    expect(controller.getSnapshot().status).toBe("error");
    await controller.bootstrap();
    expect(controller.getSnapshot().status).toBe("authenticated");
    expect(loadIdentity).toHaveBeenCalledTimes(2);
  });
  it("rejects malformed identity as an invalid boundary response", async () => {
    const controller = createAuthController({
      adapter: { loadIdentity: async () => ({ principalId: "" }), logout: async () => {} },
    });
    await controller.bootstrap();
    expect(controller.getSnapshot()).toMatchObject({
      status: "error",
      error: { kind: "invalid-response" },
    });
  });
  it("hides suspended pages without aborting an in-progress logout", async () => {
    let finish: () => void = () => {
      throw new Error("No logout");
    };
    let logoutSignal: AbortSignal | undefined;
    const controller = createAuthController({
      adapter: {
        loadIdentity: async () => ({ principalId: "principal-a" }),
        logout: (signal) => {
          logoutSignal = signal;
          return new Promise<void>((resolve) => {
            finish = resolve;
          });
        },
      },
    });
    await controller.bootstrap();
    const pending = controller.logout();
    await Promise.resolve();
    controller.suspend();
    expect(controller.getSnapshot()).toEqual({ status: "logging-out" });
    expect(logoutSignal?.aborted).toBe(false);
    finish();
    await pending;
    expect(controller.getSnapshot()).toEqual({ status: "unauthenticated", reason: "signed-out" });
  });
});

describe("post-login redirect safety", () => {
  it.each([
    "https://attacker.test",
    "//attacker.test",
    "/\\attacker.test",
    "/%2fattacker.test",
    "/%252fattacker.test",
    "/\n/attacker.test",
    "javascript:alert(1)",
    "/%zz",
    null,
  ])("rejects unsafe return path %s", (path) => {
    const output = safeReturnPath(path);
    expect(output).toBe("/");
    expect(new URL(output, "https://merchant.example").origin).toBe("https://merchant.example");
  });
  it("preserves a safe local path and query", () => {
    const output = safeReturnPath("/access?context=expired");
    expect(output).toBe("/access?context=expired");
    expect(new URL(output, "https://merchant.example").origin).toBe("https://merchant.example");
  });
});
