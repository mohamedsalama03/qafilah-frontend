"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FormError, FormField, Input } from "@/components/ui/field";
import type { MerchantProductOption, MerchantVariant } from "../contracts";
import {
  canonicalizeVariantText,
  optionPayloadSchema,
  valuePayloadSchema,
  createVariantPayloadSchema,
  updateVariantPayloadSchema,
} from "../model";
import type { useVariantMutation, VariantOperation } from "../mutations";

export type VariantMutation = ReturnType<typeof useVariantMutation>;
export type Editor =
  | { kind: "option.create" }
  | { kind: "option.update"; option: MerchantProductOption }
  | { kind: "value.create"; option: MerchantProductOption }
  | {
      kind: "value.update";
      option: MerchantProductOption;
      value: MerchantProductOption["values"][number];
    }
  | { kind: "variant.create" }
  | { kind: "variant.update"; variant: MerchantVariant };

const selectStyle =
  "min-h-11 w-full rounded-md border border-border bg-surface px-3 py-2 text-base disabled:bg-surface-subtle md:min-h-9 md:text-sm";

export function matchesEditor(editor: Editor, operation: VariantOperation | null): boolean {
  if (!operation || operation.kind !== editor.kind) return false;
  if (
    "option" in editor &&
    (!("optionUuid" in operation) || operation.optionUuid !== editor.option.id)
  )
    return false;
  if ("value" in editor && (!("valueUuid" in operation) || operation.valueUuid !== editor.value.id))
    return false;
  return (
    !("variant" in editor) ||
    ("variantUuid" in operation && operation.variantUuid === editor.variant.id)
  );
}

function useErrors(mutation: VariantMutation, editor: Editor) {
  const form = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const server =
    mutation.state.status === "error" && matchesEditor(editor, mutation.state.operation)
      ? mutation.state.error?.fieldErrors
      : undefined;
  useEffect(() => {
    if (server) form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [server, mutation.state.status, mutation.state.slot]);
  function invalid(next: Record<string, string>) {
    setErrors(next);
    const name = Object.keys(next)[0];
    form.current?.querySelector<HTMLElement>(`[name="${name}"]`)?.focus();
  }
  return {
    form,
    invalid,
    clear: () => setErrors({}),
    error: (name: string) => errors[name] ?? server?.[name]?.[0],
  };
}

export function StructuralForm({
  editor,
  options,
  mutation,
  disabled,
  onCancel,
}: {
  editor: Editor;
  options: readonly MerchantProductOption[];
  mutation: VariantMutation;
  disabled: boolean;
  onCancel: () => void;
}) {
  return editor.kind.startsWith("variant.") ? (
    <VariantForm
      editor={editor as Extract<Editor, { kind: "variant.create" | "variant.update" }>}
      options={options}
      mutation={mutation}
      disabled={disabled}
      onCancel={onCancel}
    />
  ) : (
    <OptionValueForm
      editor={editor as Exclude<Editor, { kind: "variant.create" | "variant.update" }>}
      mutation={mutation}
      disabled={disabled}
      onCancel={onCancel}
    />
  );
}

function OptionValueForm({
  editor,
  mutation,
  disabled,
  onCancel,
}: {
  editor: Exclude<Editor, { kind: "variant.create" | "variant.update" }>;
  mutation: VariantMutation;
  disabled: boolean;
  onCancel: () => void;
}) {
  const isOption = editor.kind === "option.create" || editor.kind === "option.update";
  const editing = editor.kind.endsWith(".update");
  const field = isOption ? "name" : "value";
  const initialText =
    editor.kind === "option.update"
      ? editor.option.name
      : editor.kind === "value.update"
        ? editor.value.value
        : "";
  const initialPosition =
    editor.kind === "option.update"
      ? editor.option.position
      : editor.kind === "value.update"
        ? editor.value.position
        : editor.kind === "value.create"
          ? editor.option.values.length
          : 0;
  const [text, setText] = useState(initialText);
  const [position, setPosition] = useState(String(initialPosition));
  const [unchanged, setUnchanged] = useState(false);
  const { form, invalid, clear, error } = useErrors(mutation, editor);
  const title = `${editing ? "Edit" : "Create"} ${isOption ? "option" : "value"}`;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (disabled || mutation.isBlocked) return;
    const raw = {
      [field]: text,
      position: /^\d{1,5}$/.test(position) ? Number(position) : Number.NaN,
    };
    const parsed = (isOption ? optionPayloadSchema : valuePayloadSchema).safeParse(raw);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const name = String(issue.path[0] ?? field);
        next[name] ??=
          name === "position"
            ? "Enter a whole number from 0 to 10,000."
            : "Enter 1–80 characters on one line.";
      }
      invalid(next);
      return;
    }
    clear();
    const canonicalText = "name" in parsed.data ? parsed.data.name : parsed.data.value;
    if (editing && canonicalText === initialText && parsed.data.position === initialPosition) {
      setUnchanged(true);
      return;
    }
    setUnchanged(false);
    if (editor.kind === "option.create")
      void mutation.execute({ kind: editor.kind, data: optionPayloadSchema.parse(raw) });
    else if (editor.kind === "option.update")
      void mutation.execute({
        kind: editor.kind,
        optionUuid: editor.option.id,
        data: optionPayloadSchema.parse(raw),
      });
    else if (editor.kind === "value.create")
      void mutation.execute({
        kind: editor.kind,
        optionUuid: editor.option.id,
        data: valuePayloadSchema.parse(raw),
      });
    else
      void mutation.execute({
        kind: editor.kind,
        optionUuid: editor.option.id,
        valueUuid: editor.value.id,
        data: valuePayloadSchema.parse(raw),
      });
  }
  return (
    <form ref={form} aria-label={title} noValidate onSubmit={submit} className="space-y-4">
      <h2 className="text-base font-semibold">{title}</h2>
      {!isOption && (
        <p className="text-sm text-text-muted">
          Option:{" "}
          {editor.kind === "value.create" || editor.kind === "value.update"
            ? editor.option.name
            : ""}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <FormField
          id={`structure-${field}`}
          label={isOption ? "Option name" : "Value"}
          description="1–80 characters, on one line."
          error={error(field)}
          required
        >
          <Input
            name={field}
            value={text}
            autoComplete="off"
            disabled={disabled || mutation.isBlocked}
            onChange={(event) => {
              setText(event.target.value);
              clear();
              setUnchanged(false);
            }}
          />
        </FormField>
        <FormField
          id="structure-position"
          label="Position"
          description="0–10,000; lower values appear first."
          error={error("position")}
          required
        >
          <Input
            name="position"
            inputMode="numeric"
            value={position}
            disabled={disabled || mutation.isBlocked}
            onChange={(event) => {
              setPosition(event.target.value);
              clear();
              setUnchanged(false);
            }}
          />
        </FormField>
      </div>
      {unchanged && <FormError message="Change at least one field before saving." />}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          variant="primary"
          pending={mutation.state.status === "pending"}
          pendingLabel="Saving…"
          disabled={disabled || mutation.isBlocked}
        >
          {editing ? `Save ${isOption ? "option" : "value"}` : title}
        </Button>
        <Button onClick={onCancel} disabled={mutation.isBlocked}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function VariantForm({
  editor,
  options,
  mutation,
  disabled,
  onCancel,
}: {
  editor: Extract<Editor, { kind: "variant.create" | "variant.update" }>;
  options: readonly MerchantProductOption[];
  mutation: VariantMutation;
  disabled: boolean;
  onCancel: () => void;
}) {
  const variant = editor.kind === "variant.update" ? editor.variant : undefined;
  const [sku, setSku] = useState(variant?.sku ?? "");
  const [status, setStatus] = useState<"active" | "inactive">(variant?.status ?? "active");
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [unchanged, setUnchanged] = useState(false);
  const { form, invalid, clear, error } = useErrors(mutation, editor);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (disabled || mutation.isBlocked) return;
    if (
      !variant &&
      options.some((option) => !option.values.some((value) => value.id === selected[option.id]))
    ) {
      invalid({ value_ids: "Select one value for every option." });
      return;
    }
    const candidateSku = canonicalizeVariantText(sku) === "" ? null : sku;
    const parsed = variant
      ? updateVariantPayloadSchema.safeParse({ sku: candidateSku, status })
      : createVariantPayloadSchema.safeParse({
          value_ids: options.map((option) => selected[option.id]),
          sku: candidateSku,
        });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues)
        next[String(issue.path[0] ?? "sku")] ??=
          issue.path[0] === "sku"
            ? "Use up to 64 characters on one line, or leave SKU empty."
            : "Select one value for every option.";
      invalid(next);
      return;
    }
    clear();
    if (variant) {
      const normalized = updateVariantPayloadSchema.parse({ sku: candidateSku, status });
      const changes = {
        ...(normalized.sku !== variant.sku ? { sku: normalized.sku } : {}),
        ...(status !== variant.status ? { status } : {}),
      };
      if (!Object.keys(changes).length) {
        setUnchanged(true);
        return;
      }
      setUnchanged(false);
      void mutation.execute({
        kind: "variant.update",
        variantUuid: variant.id,
        data: updateVariantPayloadSchema.parse(changes),
      });
    } else
      void mutation.execute({
        kind: "variant.create",
        data: createVariantPayloadSchema.parse(parsed.data),
      });
  }
  return (
    <form
      ref={form}
      aria-label={variant ? "Edit variant" : "Create variant"}
      onSubmit={submit}
      noValidate
      className="space-y-4"
    >
      <h2 className="text-base font-semibold">{variant ? "Edit variant" : "Create variant"}</h2>
      {!variant && (
        <>
          <p className="max-w-prose text-sm text-text-muted">
            Choose one value from each option. This combination cannot be changed after creation.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {options.map((option) => (
              <FormField
                key={option.id}
                id={`selection-${option.id}`}
                label={option.name}
                error={error("value_ids")}
                required
              >
                <select
                  name="value_ids"
                  value={selected[option.id] ?? ""}
                  className={selectStyle}
                  disabled={disabled || mutation.isBlocked}
                  onChange={(event) => {
                    setSelected((previous) => ({ ...previous, [option.id]: event.target.value }));
                    clear();
                  }}
                >
                  <option value="">Choose a value</option>
                  {option.values.map((value) => (
                    <option key={value.id} value={value.id}>
                      {value.value}
                    </option>
                  ))}
                </select>
              </FormField>
            ))}
          </div>
        </>
      )}
      <FormField
        id="variant-sku"
        label="SKU"
        description="Optional. Up to 64 characters; case matters. Leave empty to clear an existing SKU."
        error={error("sku")}
      >
        <Input
          name="sku"
          autoComplete="off"
          value={sku}
          disabled={disabled || mutation.isBlocked}
          onChange={(event) => {
            setSku(event.target.value);
            clear();
            setUnchanged(false);
          }}
        />
      </FormField>
      {variant ? (
        <FormField id="variant-status" label="Status" error={error("status")} required>
          <select
            name="status"
            className={selectStyle}
            value={status}
            disabled={disabled || mutation.isBlocked}
            onChange={(event) => {
              setStatus(event.target.value as "active" | "inactive");
              clear();
              setUnchanged(false);
            }}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </FormField>
      ) : (
        <p className="text-xs leading-5 text-text-muted">
          New variants start active. Price and stock are configured separately; active does not mean
          ready to purchase.
        </p>
      )}
      {unchanged && <FormError message="Change the SKU or status before saving." />}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          variant="primary"
          pending={mutation.state.status === "pending"}
          pendingLabel="Saving…"
          disabled={disabled || mutation.isBlocked}
        >
          {variant ? "Save variant" : "Create variant"}
        </Button>
        <Button onClick={onCancel} disabled={mutation.isBlocked}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
