import { fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MerchantProduct } from "@/features/products/contracts";
import type { MerchantVariant } from "@/features/variants/contracts";
import { useStores } from "@/features/stores/components/store-provider";
import { ApiError } from "@/lib/api/errors";
import type { MerchantMedia, ProductMedia } from "../contracts";
import { useMediaMutation, type MediaMutationState } from "../mutations";
import { useMedia } from "../queries";
import { MediaPanel } from "./media-panel";

vi.mock("@/features/stores/components/store-provider", () => ({ useStores: vi.fn() }));
vi.mock("../queries", () => ({ useMedia: vi.fn() }));
vi.mock("../mutations", () => ({ useMediaMutation: vi.fn() }));

const product: MerchantProduct = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Canvas bag",
  slug: "canvas-bag",
  description: "Canvas bag",
  type: "variant",
  status: "draft",
  requires_shipping: true,
  price: null,
  quantity: null,
  availability: "unavailable",
  categories: [],
  seo_title: null,
  seo_description: null,
  published_at: null,
  created_at: "2026-09-01T12:00:00+00:00",
  updated_at: "2026-09-01T12:00:00+00:00",
};
const variant: MerchantVariant = {
  id: "55555555-5555-4555-8555-555555555555",
  value_ids: [],
  sku: null,
  status: "inactive",
  price: null,
  quantity: null,
  availability: "unavailable",
  created_at: product.created_at,
  updated_at: product.updated_at,
};
const first: ProductMedia = {
  id: "22222222-2222-4222-8222-222222222222",
  url: "/storage/catalog/33333333-3333-4333-8333-333333333333",
  mime_type: "image/png",
  byte_size: 100,
  width: 100,
  height: 100,
  alt_text: "Bag front",
  position: 0,
  is_primary: true,
  created_at: product.created_at,
  updated_at: product.updated_at,
};
const second: ProductMedia = {
  ...first,
  id: "44444444-4444-4444-8444-444444444444",
  alt_text: "Bag back",
  is_primary: false,
  position: 2,
};
const permissions = [
  "products.view",
  "products.variants.view",
  "products.media.view",
  "products.media.create",
  "products.media.update",
  "products.media.delete",
];

function setup({
  items = [first, second],
  grants = permissions,
  status = "idle",
  slot = 0,
  revision = 1,
  queryError = null,
}: {
  items?: MerchantMedia[];
  grants?: string[];
  status?: MediaMutationState["status"];
  slot?: number;
  revision?: number;
  queryError?: ApiError | null;
} = {}) {
  const state: MediaMutationState = {
    status,
    slot,
    operation: "create",
    result: null,
    collection: null,
    product: null,
    variant: null,
    error: null,
    refreshError: null,
  };
  const mutation = {
    state,
    isBlocked: ["pending", "unknown", "success", "reconciling", "reviewing"].includes(status),
    isPending: ["pending", "reconciling", "reviewing"].includes(status),
    execute: vi.fn().mockResolvedValue(null),
    reconcile: vi.fn(),
    reviewSuccess: vi.fn(),
  };
  vi.mocked(useStores).mockReturnValue({
    state: {
      scope: { principalId: "merchant-a", storeUuid: "store-a", revision },
      context: { permissions: grants },
    },
  } as unknown as ReturnType<typeof useStores>);
  vi.mocked(useMedia).mockReturnValue({
    data: items,
    error: queryError,
    isFetching: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useMedia>);
  vi.mocked(useMediaMutation).mockReturnValue(mutation);
  return mutation;
}
const imageFile = () => new File(["image-bytes"], "bag.png", { type: "image/png" });
function openUpload() {
  fireEvent.click(screen.getByRole("button", { name: "Upload image" }));
}
function chooseImage() {
  const file = imageFile();
  fireEvent.change(screen.getByLabelText(/^Image/, { selector: "input" }), {
    target: { files: [file] },
  });
  return file;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_API_ORIGIN", "https://api.qafilah.test");
});

describe("Scoped Product and Variant media panels", () => {
  it("renders safe API images and server ordering with Product primary controls", () => {
    setup();
    render(<MediaPanel product={product} />);
    expect(screen.getByRole("region", { name: "Product images" })).toBeVisible();
    expect(screen.getAllByRole("listitem").map((item) => item.getAttribute("aria-label"))).toEqual([
      "Image 1",
      "Image 2",
    ]);
    expect(screen.getByRole("img", { name: "Bag front" })).toHaveAttribute(
      "src",
      `https://api.qafilah.test${first.url}`,
    );
    expect(
      within(screen.getByRole("listitem", { name: "Image 1" })).getByText("Primary"),
    ).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Set as primary" })).toHaveLength(1);
    expect(screen.queryByText(/unset primary/i)).not.toBeInTheDocument();
  });
  it.each([
    "https://foreign.test/image.png",
    "//foreign.test/x",
    "/storage/catalog/../secret",
    "data:image/png;base64,x",
    "/storage/catalog/not-a-uuid",
  ])("never requests unsafe returned path %s", (url) => {
    setup({ items: [{ ...first, url }] });
    render(<MediaPanel product={product} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("Image unavailable")).toBeVisible();
  });
  it("hides private media and never mounts read/mutation hooks without read prerequisites", () => {
    setup({ grants: ["products.media.create", "products.media.update", "products.media.delete"] });
    render(<MediaPanel product={product} />);
    expect(useMedia).not.toHaveBeenCalled();
    expect(useMediaMutation).not.toHaveBeenCalled();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
  it.each(["create", "update", "delete"])("honors independent %s permission", (grant) => {
    setup({ grants: ["products.view", "products.media.view", `products.media.${grant}`] });
    render(<MediaPanel product={product} />);
    expect(screen.queryAllByRole("button", { name: "Upload image" })).toHaveLength(
      grant === "create" ? 1 : 0,
    );
    expect(screen.queryAllByRole("button", { name: "Edit image" })).toHaveLength(
      grant === "update" ? 2 : 0,
    );
    expect(screen.queryAllByRole("button", { name: "Delete image" })).toHaveLength(
      grant === "delete" ? 2 : 0,
    );
  });
  it("shows read-only and archived states without enabled writes", () => {
    setup({ grants: ["products.view", "products.media.view"] });
    const view = render(<MediaPanel product={product} />);
    expect(screen.getByText(/viewing images only/)).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    setup();
    view.rerender(<MediaPanel product={{ ...product, status: "archived" }} />);
    expect(screen.getByText(/Archived product images cannot be changed/)).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("keeps inactive Variant editing, separate limits, and no primary", () => {
    const { is_primary: _primary, ...item } = first;
    expect(_primary).toBe(true);
    setup({ items: [item] });
    render(<MediaPanel product={product} variant={variant} />);
    expect(screen.getByRole("region", { name: "Variant images" })).toBeVisible();
    expect(screen.getByText("1 / 5 images")).toBeVisible();
    expect(screen.queryByText("Primary")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload image" })).toBeEnabled();
  });
  it.each([false, true])("blocks upload at the exact kind limit (variant=%s)", (isVariant) => {
    const items = Array.from({ length: isVariant ? 5 : 10 }, (_, i) => ({
      ...first,
      id: `item-${i}`,
    }));
    setup({ items });
    render(<MediaPanel product={product} variant={isVariant ? variant : undefined} />);
    expect(screen.getByRole("button", { name: "Upload image" })).toBeDisabled();
    expect(screen.getByText(/Image limit reached/)).toBeVisible();
  });
  it("submits canonical upload metadata and a real File, without a browser preview", () => {
    const mutation = setup({ items: [] });
    render(<MediaPanel product={product} />);
    openUpload();
    const file = chooseImage();
    fireEvent.change(screen.getByLabelText("Alt text"), { target: { value: "  Bag side  " } });
    fireEvent.change(screen.getByLabelText(/^Position/), { target: { value: "3" } });
    fireEvent.submit(screen.getByRole("form", { name: "Upload image" }));
    expect(mutation.execute).toHaveBeenCalledExactlyOnceWith({
      operation: "create",
      data: { image: file, alt_text: "Bag side", position: 3 },
    });
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
  it("focuses accessible validation on missing file, malformed alt text and fractional position", () => {
    const mutation = setup({ items: [] });
    render(<MediaPanel product={product} />);
    openUpload();
    fireEvent.submit(screen.getByRole("form", { name: "Upload image" }));
    expect(screen.getByLabelText(/^Image/, { selector: "input" })).toHaveFocus();
    expect(screen.getByLabelText(/^Image/, { selector: "input" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    chooseImage();
    fireEvent.change(screen.getByLabelText("Alt text"), { target: { value: "x".repeat(251) } });
    fireEvent.submit(screen.getByRole("form", { name: "Upload image" }));
    expect(screen.getByLabelText("Alt text")).toHaveFocus();
    fireEvent.change(screen.getByLabelText("Alt text"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText(/^Position/), { target: { value: "1.5" } });
    fireEvent.submit(screen.getByRole("form", { name: "Upload image" }));
    expect(screen.getByLabelText(/^Position/)).toHaveFocus();
    expect(mutation.execute).not.toHaveBeenCalled();
  });
  it("edits metadata without image replacement, targets UUID, and prevents an unchanged intent", () => {
    const mutation = setup();
    render(<MediaPanel product={product} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Edit image" })[0]!);
    expect(screen.queryByLabelText("Image")).not.toBeInTheDocument();
    fireEvent.submit(screen.getByRole("form", { name: "Edit image" }));
    expect(mutation.execute).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Alt text"), { target: { value: "" } });
    fireEvent.submit(screen.getByRole("form", { name: "Edit image" }));
    expect(mutation.execute).toHaveBeenCalledExactlyOnceWith({
      operation: "update",
      mediaUuid: first.id,
      data: { alt_text: null },
    });
  });
  it("primary selection submits true for exactly the selected asset", () => {
    const mutation = setup();
    render(<MediaPanel product={product} />);
    fireEvent.click(screen.getByRole("button", { name: "Set as primary" }));
    expect(mutation.execute).toHaveBeenCalledExactlyOnceWith({
      operation: "update",
      mediaUuid: second.id,
      data: { is_primary: true },
    });
  });
  it("requires confirmation before deleting the captured asset", async () => {
    const mutation = setup();
    render(<MediaPanel product={product} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Delete image" })[0]!);
    const dialog = screen.getByRole("alertdialog", { name: "Delete image?" });
    expect(mutation.execute).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete image" }));
    expect(mutation.execute).toHaveBeenCalledExactlyOnceWith({
      operation: "delete",
      mediaUuid: first.id,
    });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });
  it("unmounts uncertain upload files and starts a blank form only after explicit successful review", () => {
    setup({ items: [] });
    const view = render(<MediaPanel product={product} />);
    openUpload();
    chooseImage();
    fireEvent.change(screen.getByLabelText("Alt text"), { target: { value: "Do not replay" } });
    const unknown = setup({ items: [], status: "unknown" });
    view.rerender(<MediaPanel product={product} />);
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("unknown");
    fireEvent.click(screen.getByRole("button", { name: "Review current images" }));
    expect(unknown.reconcile).toHaveBeenCalledOnce();
    expect(unknown.execute).not.toHaveBeenCalled();
    setup({ items: [], slot: 1 });
    view.rerender(<MediaPanel product={product} />);
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    openUpload();
    expect(screen.getByLabelText("Alt text")).toHaveValue("");
    expect(
      (screen.getByLabelText(/^Image/, { selector: "input" }) as HTMLInputElement).files,
    ).toHaveLength(0);
  });
  it.each(["authority", "Product", "Variant"])(
    "discards open local forms on %s identity changes",
    (change) => {
      setup();
      const view = render(<MediaPanel product={product} />);
      openUpload();
      chooseImage();
      setup({ revision: change === "authority" ? 2 : 1 });
      view.rerender(
        <MediaPanel
          product={change === "Product" ? { ...product, id: second.id } : product}
          variant={change === "Variant" ? variant : undefined}
        />,
      );
      expect(screen.queryByRole("form")).not.toBeInTheDocument();
    },
  );
  it("retains confirmed feedback during a secondary read failure and locks writes", () => {
    const mutation = setup({ status: "success", queryError: new ApiError("network") });
    mutation.state = { ...mutation.state, refreshError: new ApiError("network") };
    render(<MediaPanel product={product} productReadFailed />);
    expect(screen.getByRole("status")).toHaveTextContent("Image uploaded.");
    expect(screen.getByText(/change is confirmed/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Upload image" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review current images" }));
    expect(mutation.reviewSuccess).toHaveBeenCalledOnce();
    expect(mutation.execute).not.toHaveBeenCalled();
  });
  it("shows a newer authoritative collection instead of an older reviewed snapshot", () => {
    const mutation = setup({ items: [{ ...second, alt_text: "New authoritative description" }] });
    mutation.state = { ...mutation.state, collection: [first] };
    render(<MediaPanel product={product} />);
    expect(screen.getByText("New authoritative description")).toBeVisible();
    expect(screen.queryByText("Bag front")).not.toBeInTheDocument();
  });
  it.each(["forbidden", "invalid-response", "not-found"] as const)(
    "hides old reviewed thumbnails after %s while retaining confirmed feedback",
    (kind) => {
      const mutation = setup({ status: "success", queryError: new ApiError(kind) });
      mutation.state = { ...mutation.state, collection: [first] };
      render(<MediaPanel product={product} />);
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("Image uploaded.");
    },
  );
});
