import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import type { MerchantProductOption, MerchantVariant } from "../contracts";
import { StructuralForm, type Editor, type VariantMutation } from "./variant-forms";

const id = (n: number) => `${n.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`;
const options: MerchantProductOption[] = [
  { id: id(1), name: "Size", position: 0, values: [{ id: id(2), value: "Large", position: 0 }] },
  { id: id(3), name: "Colour", position: 1, values: [{ id: id(4), value: "Blue", position: 0 }] },
];
const variant: MerchantVariant = {
  id: id(5),
  value_ids: [id(2), id(4)],
  sku: "SKU-A",
  status: "active",
  price: null,
  quantity: null,
  availability: "unavailable",
  created_at: "2026-09-22T00:00:00+00:00",
  updated_at: "2026-09-22T00:00:00+00:00",
};
function mutation(): VariantMutation {
  return {
    state: {
      status: "idle",
      slot: 0,
      operation: null,
      result: null,
      product: null,
      options: null,
      variants: null,
      error: null,
      refreshError: null,
    },
    isBlocked: false,
    isPending: false,
    execute: vi.fn().mockResolvedValue(null),
    review: vi.fn().mockResolvedValue(null),
  };
}
function setup(editor: Editor, disabled = false) {
  const current = mutation();
  const onCancel = vi.fn();
  const view = render(
    <StructuralForm
      editor={editor}
      options={options}
      mutation={current}
      disabled={disabled}
      onCancel={onCancel}
    />,
  );
  return { current, view, onCancel };
}

describe("structural forms", () => {
  it("requires one deliberate Value selection per Option and sends a single combination", () => {
    const { current } = setup({ kind: "variant.create" });
    const form = screen.getByRole("form", { name: "Create variant" });
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
    expect(screen.getByRole("combobox", { name: "Size" })).toHaveValue("");
    fireEvent.submit(form);
    expect(current.execute).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox", { name: "Size" })).toHaveFocus();
    expect(screen.getByRole("combobox", { name: "Size" })).toHaveAccessibleDescription(
      "Select one value for every option.",
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Size" }), { target: { value: id(2) } });
    fireEvent.submit(form);
    expect(current.execute).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("combobox", { name: "Colour" }), {
      target: { value: id(4) },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "SKU" }), { target: { value: " Ａbc " } });
    fireEvent.submit(form);
    expect(current.execute).toHaveBeenCalledExactlyOnceWith({
      kind: "variant.create",
      data: { value_ids: [id(2), id(4)], sku: "Abc" },
    });
    expect(screen.getByText(/New variants start active/)).toBeVisible();
    expect(screen.queryByRole("combobox", { name: "Status" })).not.toBeInTheDocument();
  });
  it("clears an existing SKU using only the nullable SKU field", () => {
    const { current } = setup({ kind: "variant.update", variant });
    expect(screen.queryByRole("combobox", { name: "Size" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "SKU" }), { target: { value: "  " } });
    fireEvent.submit(screen.getByRole("form", { name: "Edit variant" }));
    expect(current.execute).toHaveBeenCalledExactlyOnceWith({
      kind: "variant.update",
      variantUuid: variant.id,
      data: { sku: null },
    });
  });
  it.each(["variant.create", "variant.update"] as const)(
    "rejects a U+FEFF-only SKU instead of treating it as blank for %s",
    (kind) => {
      const editor: Editor = kind === "variant.create" ? { kind } : { kind, variant };
      const { current } = setup(editor);
      if (kind === "variant.create") {
        fireEvent.change(screen.getByRole("combobox", { name: "Size" }), {
          target: { value: id(2) },
        });
        fireEvent.change(screen.getByRole("combobox", { name: "Colour" }), {
          target: { value: id(4) },
        });
      } else expect(screen.getByRole("textbox", { name: "SKU" })).toHaveValue("SKU-A");
      const sku = screen.getByRole("textbox", { name: "SKU" });
      fireEvent.change(sku, { target: { value: "\uFEFF" } });
      fireEvent.submit(
        screen.getByRole("form", {
          name: kind === "variant.create" ? "Create variant" : "Edit variant",
        }),
      );
      expect(current.execute).not.toHaveBeenCalled();
      expect(sku).toHaveValue("\uFEFF");
      expect(sku).toHaveFocus();
      expect(sku).toHaveAttribute("aria-invalid", "true");
      expect(sku).toHaveAccessibleDescription(/Use up to 64 characters on one line/);
    },
  );
  it("updates only status when the SKU is unchanged and keeps the combination immutable", () => {
    const { current } = setup({ kind: "variant.update", variant });
    fireEvent.change(screen.getByRole("combobox", { name: "Status" }), {
      target: { value: "inactive" },
    });
    fireEvent.submit(screen.getByRole("form", { name: "Edit variant" }));
    expect(current.execute).toHaveBeenCalledExactlyOnceWith({
      kind: "variant.update",
      variantUuid: variant.id,
      data: { status: "inactive" },
    });
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
  });
  it.each([
    {
      editor: { kind: "option.update", option: options[0]! } as Editor,
      title: "Edit option",
      error: "Change at least one field before saving.",
    },
    {
      editor: {
        kind: "value.update",
        option: options[0]!,
        value: options[0]!.values[0]!,
      } as Editor,
      title: "Edit value",
      error: "Change at least one field before saving.",
    },
    {
      editor: { kind: "variant.update", variant } as Editor,
      title: "Edit variant",
      error: "Change the SKU or status before saving.",
    },
  ])("rejects an unchanged $title locally", ({ editor, title, error }) => {
    const { current } = setup(editor);
    fireEvent.submit(screen.getByRole("form", { name: title }));
    expect(current.execute).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(error);
  });
  it("normalizes labels and always sends a complete Option patch", () => {
    const { current } = setup({ kind: "option.update", option: options[0]! });
    fireEvent.change(screen.getByRole("textbox", { name: "Option name" }), {
      target: { value: " Ｓｉｚｅ " },
    });
    fireEvent.submit(screen.getByRole("form", { name: "Edit option" }));
    expect(current.execute).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "Position" }), {
      target: { value: "10000" },
    });
    fireEvent.submit(screen.getByRole("form", { name: "Edit option" }));
    expect(current.execute).toHaveBeenCalledExactlyOnceWith({
      kind: "option.update",
      optionUuid: options[0]!.id,
      data: { name: "Size", position: 10000 },
    });
  });
  it("sends a complete nested Value patch with exact parent and Value IDs", () => {
    const { current } = setup({
      kind: "value.update",
      option: options[0]!,
      value: options[0]!.values[0]!,
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Value" }), {
      target: { value: " Medium " },
    });
    fireEvent.submit(screen.getByRole("form", { name: "Edit value" }));
    expect(current.execute).toHaveBeenCalledExactlyOnceWith({
      kind: "value.update",
      optionUuid: id(1),
      valueUuid: id(2),
      data: { value: "Medium", position: 0 },
    });
  });
  it.each(["-1", "1.5", "10001", "1e2", ""])(
    "rejects unsupported position %j with associated field focus",
    (position) => {
      const { current } = setup({ kind: "option.create" });
      fireEvent.change(screen.getByRole("textbox", { name: "Option name" }), {
        target: { value: "Size" },
      });
      fireEvent.change(screen.getByRole("textbox", { name: "Position" }), {
        target: { value: position },
      });
      fireEvent.submit(screen.getByRole("form", { name: "Create option" }));
      const field = screen.getByRole("textbox", { name: "Position" });
      expect(field).toHaveFocus();
      expect(field).toHaveAttribute("aria-invalid", "true");
      expect(field).toHaveAccessibleDescription(/Enter a whole number from 0 to 10,000/);
      expect(current.execute).not.toHaveBeenCalled();
    },
  );
  it("rejects oversized SKU without dispatch and associates the error", () => {
    const { current } = setup({ kind: "variant.update", variant });
    fireEvent.change(screen.getByRole("textbox", { name: "SKU" }), {
      target: { value: "A".repeat(65) },
    });
    fireEvent.submit(screen.getByRole("form", { name: "Edit variant" }));
    expect(screen.getByRole("textbox", { name: "SKU" })).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "SKU" })).toHaveAccessibleDescription(
      /Use up to 64 characters/,
    );
    expect(current.execute).not.toHaveBeenCalled();
  });
  it.each(["pending", "success", "unknown", "reconciling", "reviewing"] as const)(
    "blocks native submission and controls for %s",
    (status) => {
      const current = mutation();
      current.state = { ...current.state, status };
      current.isBlocked = true;
      current.isPending = ["pending", "reconciling", "reviewing"].includes(status);
      render(
        <StructuralForm
          editor={{ kind: "variant.update", variant }}
          options={options}
          mutation={current}
          disabled={false}
          onCancel={vi.fn()}
        />,
      );
      fireEvent.submit(screen.getByRole("form", { name: "Edit variant" }));
      expect(current.execute).not.toHaveBeenCalled();
      expect(screen.getByRole("textbox", { name: "SKU" })).toBeDisabled();
      expect(
        screen.getByRole("button", { name: status === "pending" ? "Saving…" : "Save variant" }),
      ).toBeDisabled();
    },
  );
  it("blocks even native submission while authoritative reads are pending", () => {
    const { current } = setup({ kind: "option.create" }, true);
    fireEvent.submit(screen.getByRole("form", { name: "Create option" }));
    expect(current.execute).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Option name" })).toBeDisabled();
  });
  it("refocuses a current-slot SKU server error after explicit review", () => {
    const current = mutation();
    current.state = {
      ...current.state,
      slot: 1,
      guidance: "current-configuration-reviewed",
      reviewedUnknown: true,
    };
    const props = {
      editor: { kind: "variant.update", variant } as Editor,
      options,
      disabled: false,
      onCancel: vi.fn(),
    };
    const view = render(<StructuralForm {...props} mutation={current} />);
    const error = new ApiError("validation", {
      details: { fieldErrors: { sku: ["The SKU already exists in this Store."] } },
    });
    current.state = {
      ...current.state,
      status: "error",
      operation: { kind: "variant.update", variantUuid: variant.id, data: { sku: "Duplicate" } },
      error,
    };
    view.rerender(<StructuralForm {...props} mutation={{ ...current }} />);
    expect(screen.getByRole("textbox", { name: "SKU" })).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "SKU" })).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("textbox", { name: "SKU" })).toHaveAccessibleDescription(
      /The SKU already exists/,
    );
  });
});
