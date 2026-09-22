import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import type { MerchantApi } from "@/lib/backend/client";
import { MerchantApiProvider } from "./merchant-api-provider";
import { LoginForm } from "./login-form";
import { loginDestination } from "./login-destination";

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

function apiFixture(): MerchantApi {
  return {
    listProducts: vi.fn(),
    loadProduct: vi.fn(),
    listProductOptions: vi.fn(),
    createProductOption: vi.fn(),
    updateProductOption: vi.fn(),
    createProductOptionValue: vi.fn(),
    updateProductOptionValue: vi.fn(),
    listProductVariants: vi.fn(),
    createProductVariant: vi.fn(),
    loadVariantInventory: vi.fn(),
    updateVariantInventory: vi.fn(),
    loadProductVariant: vi.fn(),
    updateProductVariant: vi.fn(),
    loadProductInventory: vi.fn(async () => ({
      quantity: null,
      availability: "unavailable" as const,
    })),
    updateProductInventory: vi.fn(),
    createProduct: vi.fn(),
    updateProduct: vi.fn(),
    publishProduct: vi.fn(),
    unpublishProduct: vi.fn(),
    archiveProduct: vi.fn(),
    listCategories: vi.fn(),
    authAdapter: {
      loadIdentity: vi.fn(async () => {
        throw new ApiError("unauthenticated");
      }),
      logout: vi.fn(async () => {}),
    },
    login: vi.fn(async () => {}),
    listStoresPage: vi.fn(),
    loadStoreContext: vi.fn(),
  };
}

beforeEach(() => vi.clearAllMocks());

describe("production sign-in", () => {
  it("keeps unconfigured production closed", () => {
    render(
      <MerchantApiProvider api={null}>
        <LoginForm />
      </MerchantApiProvider>,
    );
    expect(screen.getByRole("heading", { name: "Sign-in is not available yet" })).toBeVisible();
    expect(screen.queryByLabelText("Password", { exact: false })).not.toBeInTheDocument();
  });

  it("deduplicates initial identity under StrictMode and validates before credentials leave the form", async () => {
    const api = apiFixture();
    render(
      <StrictMode>
        <MerchantApiProvider api={api}>
          <LoginForm />
        </MerchantApiProvider>
      </StrictMode>,
    );
    await screen.findByRole("button", { name: "Sign in" });
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Enter your email address.")).toBeVisible();
    expect(screen.getByLabelText(/Email address/)).toHaveFocus();
    expect(api.login).not.toHaveBeenCalled();
    expect(api.authAdapter.loadIdentity).toHaveBeenCalledTimes(1);
  });

  it("submits only once, clears the password and navigates only to an implemented safe destination", async () => {
    const api = apiFixture();
    let complete!: () => void;
    vi.mocked(api.login).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    render(
      <MerchantApiProvider api={api}>
        <LoginForm returnTo="/.//evil.example" />
      </MerchantApiProvider>,
    );
    const email = await screen.findByLabelText(/Email address/);
    await userEvent.type(email, "merchant@example.test");
    await userEvent.type(screen.getByLabelText(/^Password/), "synthetic-password");
    const submit = screen.getByRole("button", { name: "Sign in" });
    fireEvent.submit(submit.closest("form")!);
    fireEvent.submit(submit.closest("form")!);
    await waitFor(() => expect(api.login).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Signing in…" })).toBeDisabled();
    complete();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    expect(screen.getByLabelText(/^Password/)).toHaveValue("");
  });

  it("shows sanitized validation and rate-limit recovery, and supports password visibility", async () => {
    const api = apiFixture();
    vi.mocked(api.login)
      .mockRejectedValueOnce(
        new ApiError("validation", {
          details: { fieldErrors: { email: ["These credentials do not match our records."] } },
        }),
      )
      .mockRejectedValueOnce(
        new ApiError("rate-limited", { retryAfterSeconds: 30, requestId: "safe-request-1" }),
      );
    render(
      <MerchantApiProvider api={api}>
        <LoginForm />
      </MerchantApiProvider>,
    );
    await userEvent.type(await screen.findByLabelText(/Email address/), "merchant@example.test");
    await userEvent.type(screen.getByLabelText(/^Password/), "synthetic-password");
    await userEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByLabelText(/^Password/)).toHaveAttribute("type", "text");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("These credentials do not match our records.")).toBeVisible();
    expect(screen.getByLabelText(/Email address/)).toHaveFocus();
    expect(screen.getByLabelText(/^Password/)).toHaveValue("");
    await userEvent.type(screen.getByLabelText(/^Password/), "synthetic-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Try again in 30 seconds");
    expect(screen.getByText("Reference ID: safe-request-1")).toBeVisible();
  });

  it("redirects an existing verified identity without presenting another credential form", async () => {
    const api = apiFixture();
    vi.mocked(api.authAdapter.loadIdentity).mockResolvedValue({
      principalId: "verified-principal",
    });
    const target = "/stores/11111111-1111-4111-8111-111111111111";
    render(
      <MerchantApiProvider api={api}>
        <LoginForm returnTo={target} />
      </MerchantApiProvider>,
    );
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(target));
    expect(screen.queryByLabelText(/^Password/)).not.toBeInTheDocument();
    expect(api.login).not.toHaveBeenCalled();
  });
});

describe("implemented post-login destinations", () => {
  it.each([
    "https://evil.example",
    "//evil.example",
    "/.//evil.example",
    "/login",
    "/design-system",
    "/api/v1/me",
    "/stores/invalid",
    "/stores/11111111-1111-4111-8111-111111111111/products/create",
  ])("rejects %s", (input) => {
    expect(loginDestination(input)).toBe("/");
  });
  it("preserves safe Store query/hash navigation without treating the URL as membership", () => {
    const input = "/stores/11111111-1111-4111-8111-111111111111?view=overview#access";
    expect(loginDestination(input)).toBe(input);
  });
});
