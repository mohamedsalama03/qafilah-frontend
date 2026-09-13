import type { FieldPath, FieldValues, UseFormReturn } from "react-hook-form";

export type SafeValidationErrors = Readonly<Record<string, readonly string[]>>;

/**
 * Call only with the transport's normalized, safe validation messages.
 * The explicit dictionary maps verified backend keys to registered form fields;
 * dictionary order is form order and determines the first focus target.
 * Unknown/domain keys remain visible at form level, never silently discarded.
 */
export function applyValidationErrors<T extends FieldValues>(
  form: Pick<UseFormReturn<T>, "setError" | "setFocus">,
  errors: SafeValidationErrors,
  fieldMap: Readonly<Record<string, FieldPath<T>>>,
  formMessage?: string,
) {
  const formErrors: string[] = formMessage ? [formMessage] : [];
  let firstField: FieldPath<T> | undefined;
  let fieldCount = 0;

  for (const [backendKey, field] of Object.entries(fieldMap)) {
    if (!Object.hasOwn(errors, backendKey)) continue;
    const messages = errors[backendKey];
    if (messages.length === 0) continue;
    form.setError(field, { type: "server", message: messages.join(" ") });
    firstField ??= field;
    fieldCount += 1;
  }

  for (const [backendKey, messages] of Object.entries(errors)) {
    if (!Object.hasOwn(fieldMap, backendKey)) formErrors.push(...messages);
  }
  if (formErrors.length > 0)
    form.setError("root.server", { type: "server", message: formErrors.join(" ") });
  if (firstField) form.setFocus(firstField);

  return { fieldCount, formErrors };
}
