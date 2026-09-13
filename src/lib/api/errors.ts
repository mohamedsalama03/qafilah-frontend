import type { SafeErrorDetails } from "./types";
import { hasAsciiControlCharacters } from "./control-characters";

export type ApiErrorKind =
  | "unauthenticated"
  | "forbidden"
  | "not-found"
  | "conflict"
  | "session-expired"
  | "validation"
  | "rate-limited"
  | "server"
  | "network"
  | "timeout"
  | "cancelled"
  | "invalid-response"
  | "configuration"
  | "http";

const messages: Record<ApiErrorKind, string> = {
  unauthenticated: "Sign in to continue.",
  forbidden: "You do not have permission to perform this action.",
  "not-found": "The requested resource could not be found.",
  conflict: "This resource changed. Refresh it before trying again.",
  "session-expired": "Your session has expired. Sign in again to continue.",
  validation: "Check the highlighted fields and try again.",
  "rate-limited": "Too many requests. Wait before trying again.",
  server: "The service could not complete this request. Try again later.",
  network: "The service could not be reached. Check your connection.",
  timeout: "The request took too long. Refresh to check the latest state.",
  cancelled: "The request was cancelled.",
  "invalid-response": "The service returned an unexpected response.",
  configuration: "This connection is not configured for use.",
  http: "The request could not be completed.",
};

export class ApiError extends Error {
  readonly name = "ApiError";
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly requestId?: string;
  readonly retryAfterSeconds?: number;
  readonly fieldErrors: Readonly<Record<string, readonly string[]>>;
  readonly formErrors: readonly string[];
  /** Unknown means the UI must reconcile authoritative state before resubmitting. */
  readonly mutationOutcome: "unknown" | "not-applicable";

  constructor(
    kind: ApiErrorKind,
    options: {
      status?: number;
      requestId?: string;
      retryAfterSeconds?: number;
      details?: SafeErrorDetails;
      mutationOutcome?: "unknown" | "not-applicable";
    } = {},
  ) {
    super(
      kind === "conflict" && options.details?.conflictMessage
        ? (safeDisplayMessage(options.details.conflictMessage) ?? messages.conflict)
        : messages[kind],
    );
    this.kind = kind;
    this.status = options.status;
    this.requestId = safeRequestId(options.requestId);
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.fieldErrors = sanitizeFieldErrors(options.details?.fieldErrors);
    this.formErrors = sanitizeMessages(options.details?.formErrors);
    this.mutationOutcome = options.mutationOutcome ?? "not-applicable";
  }
}

export function kindForStatus(status: number): ApiErrorKind {
  const known: Record<number, ApiErrorKind> = {
    401: "unauthenticated",
    403: "forbidden",
    404: "not-found",
    409: "conflict",
    419: "session-expired",
    422: "validation",
    429: "rate-limited",
  };
  return known[status] ?? (status >= 500 ? "server" : "http");
}

export function safeRequestId(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-zA-Z0-9._:-]{1,128}$/.test(value) ? value : undefined;
}

function safeDisplayMessage(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim() || value.length > 300) return undefined;
  if (
    hasAsciiControlCharacters(value) ||
    /[<>]/.test(value) ||
    /SQLSTATE|stack trace|exception|(?:\/var\/|[a-z]:\\)/i.test(value)
  )
    return undefined;
  return value.trim();
}

function sanitizeMessages(values?: readonly string[]): readonly string[] {
  return Object.freeze(
    (values ?? []).slice(0, 10).flatMap((value) => {
      const safe = safeDisplayMessage(value);
      return safe ? [safe] : [];
    }),
  );
}

function sanitizeFieldErrors(
  fields?: Readonly<Record<string, readonly string[]>>,
): Readonly<Record<string, readonly string[]>> {
  const result: Record<string, readonly string[]> = Object.create(null);
  for (const [field, values] of Object.entries(fields ?? {}).slice(0, 100)) {
    if (
      /^[a-zA-Z0-9_.-]{1,100}$/.test(field) &&
      !["__proto__", "constructor", "prototype"].includes(field)
    ) {
      result[field] = sanitizeMessages(values);
    }
  }
  return Object.freeze(result);
}

/** Opt in only when the reviewed endpoint actually uses Laravel's field-error shape. */
export function readLaravelValidationErrors(
  payload: unknown,
  allowedFields: readonly string[],
): SafeErrorDetails {
  if (!payload || typeof payload !== "object" || !("errors" in payload)) return {};
  const errors = payload.errors;
  if (!errors || typeof errors !== "object") return {};
  const fields: Record<string, readonly string[]> = Object.create(null);
  for (const field of allowedFields) {
    const value: unknown = Object.getOwnPropertyDescriptor(errors, field)?.value;
    if (Array.isArray(value) && value.every((message: unknown) => typeof message === "string"))
      fields[field] = value;
  }
  return { fieldErrors: sanitizeFieldErrors(fields) };
}

export function normalizeUnexpectedError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError("network");
}
