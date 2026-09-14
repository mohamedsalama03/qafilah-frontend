import { z } from "zod";
import { hasAsciiControlCharacters } from "../api/control-characters";
import { readLaravelValidationErrors } from "../api/errors";
import type { ContractEvidence, EndpointContract, SafeErrorDetails } from "../api/types";

export const backendBaseline = "6614690a3b24b39f45c7c1b9ed85c20ecb22cbbf";
const evidence = (source: string): ContractEvidence => ({
  source: `Qafilah backend ${backendBaseline}: ${source}`,
});

const uuid = z.uuid();
const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => !!value.trim() && !hasAsciiControlCharacters(value));
const timestamp = z.iso.datetime({ offset: true }).nullable();
const meta = z.strictObject({ request_id: uuid });
const envelope = <T extends z.ZodType>(data: T) =>
  z.strictObject({
    success: z.literal(true),
    data,
    meta,
    message: z.null(),
  });

const user = z.strictObject({
  id: uuid,
  name: text(100),
  email: text(254),
  email_verified_at: timestamp,
  status: z.literal("active"),
  created_at: timestamp,
  updated_at: timestamp,
});

const accessibleStore = z.strictObject({ id: uuid, name: text(120), status: z.literal("active") });
const pagination = z
  .strictObject({
    current_page: z.number().int().positive().safe(),
    per_page: z.literal(20),
    last_page: z.number().int().positive().safe(),
    total: z.number().int().nonnegative().safe(),
  })
  .refine((value) => value.last_page === Math.max(1, Math.ceil(value.total / 20)));
const storePage = z
  .strictObject({
    success: z.literal(true),
    data: z.array(accessibleStore).max(20),
    meta: z.strictObject({ request_id: uuid, pagination }),
    message: z.null(),
  })
  .refine((value) => {
    const page = value.meta.pagination;
    return (
      new Set(value.data.map((store) => store.id)).size === value.data.length &&
      value.data.length === Math.min(20, Math.max(0, page.total - (page.current_page - 1) * 20))
    );
  });

const permission = z
  .string()
  .min(3)
  .max(120)
  .regex(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/);
const storeContext = z.strictObject({
  store: accessibleStore,
  membership: z.strictObject({ id: uuid, status: z.literal("active") }),
  role: z.strictObject({ id: uuid, name: text(80) }),
  permissions: z
    .array(permission)
    .refine((values) => values.every((value, index) => index === 0 || values[index - 1]! < value)),
});

export type AccessibleStore = z.infer<typeof accessibleStore>;
export type MerchantStoreContext = z.infer<typeof storeContext>;
export interface StorePage {
  stores: AccessibleStore[];
  pagination: { current_page: number; per_page: number; last_page: number; total: number };
}
export interface LoginCredentials {
  email: string;
  password: string;
}
export type MerchantIdentity = z.infer<typeof user>;

const errorEnvelope = z.strictObject({
  success: z.literal(false),
  data: z.null(),
  meta,
  message: z.string(),
  errors: z.record(z.string(), z.array(z.string())),
});

function validation(payload: unknown, fields: readonly string[]): SafeErrorDetails {
  const parsed = errorEnvelope.safeParse(payload);
  return parsed.success ? readLaravelValidationErrors(parsed.data, fields) : {};
}

export const requestIdEvidence = evidence(
  "bootstrap/app.php:117; Support/Http/Middleware/RequestId.php; config/cors.php:14",
);
export function readRequestId(payload: unknown): string | undefined {
  // Discovery additionally has pagination; only the reviewed request_id field is diagnostic.
  const diagnostic = z.object({ meta: z.object({ request_id: uuid }) }).safeParse(payload);
  return diagnostic.success ? diagnostic.data.meta.request_id : undefined;
}

export const merchantContracts = {
  csrf: {
    evidence: evidence(
      "composer.lock Laravel Sanctum4.3.2; SanctumServiceProvider::defineRoutes; CsrfCookieController::show",
    ),
    method: "GET",
    path: () => "/sanctum/csrf-cookie",
    decode: (payload: unknown): void => {
      z.undefined().parse(payload);
    },
  } satisfies EndpointContract<void, void>,
  login: {
    evidence: evidence(
      "routes/api.php:115; Identity AuthenticateUserRequest/AuthenticateUserAction/AuthenticationController/UserResource",
    ),
    method: "POST",
    path: () => "/api/v1/auth/login",
    body: (input: LoginCredentials) => ({ email: input.email, password: input.password }),
    decode: (payload: unknown): MerchantIdentity => envelope(user).parse(payload).data,
    decodeError: (payload: unknown) => validation(payload, ["email", "password"]),
  } satisfies EndpointContract<LoginCredentials, MerchantIdentity>,
  identity: {
    evidence: evidence(
      "routes/api.php:137; Identity CurrentUserController/AuthenticatedIdentityRequest/UserResource/EnsureUserIsActive",
    ),
    method: "GET",
    path: () => "/api/v1/me",
    decode: (payload: unknown): MerchantIdentity => envelope(user).parse(payload).data,
  } satisfies EndpointContract<void, MerchantIdentity>,
  logout: {
    evidence: evidence(
      "routes/api.php:126; Identity AuthenticationController/LogoutUserAction/StatusResource",
    ),
    method: "POST",
    path: () => "/api/v1/auth/logout",
    decode: (payload: unknown): void => {
      z.strictObject({
        success: z.literal(true),
        data: z.array(z.never()).length(0),
        meta,
        message: z.literal("Logged out successfully."),
      }).parse(payload);
    },
  } satisfies EndpointContract<void, void>,
  stores: {
    evidence: evidence(
      "routes/api.php:143; Stores ListAccessibleMerchantStoresRequest/Action/Query; AccessibleMerchantStoreCollection/Resource",
    ),
    method: "GET",
    path: (page: number) =>
      `/api/v1/me/stores?page=${z.number().int().positive().safe().parse(page)}`,
    decode: (payload: unknown): StorePage => {
      const parsed = storePage.parse(payload);
      return { stores: parsed.data, pagination: parsed.meta.pagination };
    },
    decodeError: (payload: unknown) => validation(payload, ["page"]),
  } satisfies EndpointContract<number, StorePage>,
  context: {
    evidence: evidence(
      "routes/api.php:145; Stores MerchantStoreContextRequest/ReadMerchantStoreContextAction/MerchantStoreContextResource; ResolveMerchantTenant",
    ),
    method: "GET",
    path: (storeUuid: string) => `/api/v1/stores/${uuid.parse(storeUuid)}/context`,
    decode: (payload: unknown): MerchantStoreContext => envelope(storeContext).parse(payload).data,
  } satisfies EndpointContract<string, MerchantStoreContext>,
} as const;

export const csrfEvidence = evidence(
  "config/sanctum.php:20; Laravel13 PreventRequestForgery::getTokenFromRequest/newCookie; IdentitySpaSecurityTest",
);
