import { z } from "zod";
import {
  decodeProductInventory,
  type ProductInventory,
  type ProductInventoryReadInput,
  type UpdateProductInventoryInput,
} from "../../features/inventory/contracts";
import { inventoryPayloadSchema } from "../../features/inventory/model";
import {
  decodeMerchantProductOption,
  decodeMerchantVariant,
  decodeProductOptions,
  decodeProductVariants,
  type CreateProductOptionInput,
  type UpdateProductOptionInput,
  type CreateProductOptionValueInput,
  type UpdateProductOptionValueInput,
  type CreateProductVariantInput,
  type UpdateProductVariantInput,
  type ProductOptionsReadInput,
  type ProductVariantsReadInput,
  type ProductVariantReadInput,
  type MerchantProductOption,
  type MerchantVariant,
} from "../../features/variants/contracts";
import {
  optionPayloadSchema,
  valuePayloadSchema,
  createVariantPayloadSchema,
  updateVariantPayloadSchema,
} from "../../features/variants/model";
import {
  categoryQueryString,
  decodeCategoryPage,
  decodeMerchantProduct,
  decodeProductPage,
  productQueryString,
  type CategoryListInput,
  type CategoryPage,
  type MerchantProduct,
  type ProductListInput,
  type ProductPage,
  type ProductReadInput,
} from "../../features/products/contracts";
import { catalogUuidSchema } from "../../features/products/model";
import {
  productMutationErrorFields,
  type CreateProductInput,
  type ProductLifecycleInput,
  type UpdateProductInput,
} from "../../features/products/mutation-contracts";
import {
  normalizeCreateProductPayload,
  normalizeUpdateProductPayload,
} from "../../features/products/mutation-model";
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

const structuralErrorFields = [
  "product",
  "option",
  "value",
  "variant",
  "name",
  "position",
  "value_ids",
  "value_ids.0",
  "value_ids.1",
  "value_ids.2",
  "sku",
  "status",
] as const;

export const merchantContracts = {
  productOptions: {
    evidence: evidence(
      "routes/api.php:418; Catalog ListProductOptionsQuery/MerchantProductOptionCollection/ProductPolicy",
    ),
    method: "GET",
    path: (input: ProductOptionsReadInput) =>
      `/api/v1/stores/${catalogUuidSchema.parse(input.storeUuid)}/catalog/products/${catalogUuidSchema.parse(input.productUuid)}/options`,
    decode: decodeProductOptions,
  } satisfies EndpointContract<ProductOptionsReadInput, MerchantProductOption[]>,
  createProductOption: {
    evidence: evidence(
      "routes/api.php:420; Catalog CreateProductOptionRequest/CreateProductOptionAction/MerchantProductOptionResource",
    ),
    method: "POST",
    path: (input: CreateProductOptionInput) =>
      `/api/v1/stores/${catalogUuidSchema.parse(input.storeUuid)}/catalog/products/${catalogUuidSchema.parse(input.productUuid)}/options`,
    body: (input: CreateProductOptionInput) => optionPayloadSchema.parse(input.data),
    decode: decodeMerchantProductOption,
    decodeError: (payload: unknown) => validation(payload, structuralErrorFields),
  } satisfies EndpointContract<CreateProductOptionInput, MerchantProductOption>,
  updateProductOption: {
    evidence: evidence(
      "routes/api.php:422; Catalog UpdateProductOptionRequest/UpdateProductOptionAction/MerchantProductOptionResource",
    ),
    method: "PATCH",
    path: (input: UpdateProductOptionInput) =>
      `/api/v1/stores/${catalogUuidSchema.parse(input.storeUuid)}/catalog/products/${catalogUuidSchema.parse(input.productUuid)}/options/${catalogUuidSchema.parse(input.optionUuid)}`,
    body: (input: UpdateProductOptionInput) => optionPayloadSchema.parse(input.data),
    decode: decodeMerchantProductOption,
    decodeError: (payload: unknown) => validation(payload, structuralErrorFields),
  } satisfies EndpointContract<UpdateProductOptionInput, MerchantProductOption>,
  createProductOptionValue: {
    evidence: evidence(
      "routes/api.php:424; Catalog CreateProductOptionValueRequest/CreateProductOptionValueAction/MerchantProductOptionResource",
    ),
    method: "POST",
    path: (input: CreateProductOptionValueInput) =>
      `/api/v1/stores/${catalogUuidSchema.parse(input.storeUuid)}/catalog/products/${catalogUuidSchema.parse(input.productUuid)}/options/${catalogUuidSchema.parse(input.optionUuid)}/values`,
    body: (input: CreateProductOptionValueInput) => valuePayloadSchema.parse(input.data),
    decode: decodeMerchantProductOption,
    decodeError: (payload: unknown) => validation(payload, structuralErrorFields),
  } satisfies EndpointContract<CreateProductOptionValueInput, MerchantProductOption>,
  updateProductOptionValue: {
    evidence: evidence(
      "routes/api.php:426; Catalog UpdateProductOptionValueRequest/UpdateProductOptionValueAction/MerchantProductOptionResource",
    ),
    method: "PATCH",
    path: (input: UpdateProductOptionValueInput) =>
      `/api/v1/stores/${catalogUuidSchema.parse(input.storeUuid)}/catalog/products/${catalogUuidSchema.parse(input.productUuid)}/options/${catalogUuidSchema.parse(input.optionUuid)}/values/${catalogUuidSchema.parse(input.valueUuid)}`,
    body: (input: UpdateProductOptionValueInput) => valuePayloadSchema.parse(input.data),
    decode: decodeMerchantProductOption,
    decodeError: (payload: unknown) => validation(payload, structuralErrorFields),
  } satisfies EndpointContract<UpdateProductOptionValueInput, MerchantProductOption>,
  productVariants: {
    evidence: evidence(
      "routes/api.php:436; Catalog ListProductVariantsQuery/MerchantVariantCollection/ProductPolicy",
    ),
    method: "GET",
    path: (input: ProductVariantsReadInput) =>
      `/api/v1/stores/${catalogUuidSchema.parse(input.storeUuid)}/catalog/products/${catalogUuidSchema.parse(input.productUuid)}/variants`,
    decode: decodeProductVariants,
  } satisfies EndpointContract<ProductVariantsReadInput, MerchantVariant[]>,
  createProductVariant: {
    evidence: evidence(
      "routes/api.php:438; Catalog CreateProductVariantRequest/CreateProductVariantAction/MerchantVariantResource",
    ),
    method: "POST",
    path: (input: CreateProductVariantInput) =>
      `/api/v1/stores/${catalogUuidSchema.parse(input.storeUuid)}/catalog/products/${catalogUuidSchema.parse(input.productUuid)}/variants`,
    body: (input: CreateProductVariantInput) => createVariantPayloadSchema.parse(input.data),
    decode: decodeMerchantVariant,
    decodeError: (payload: unknown) => validation(payload, structuralErrorFields),
  } satisfies EndpointContract<CreateProductVariantInput, MerchantVariant>,
  productVariant: {
    evidence: evidence(
      "routes/api.php:440; Catalog FindProductVariantQuery/MerchantVariantResource/CatalogRouteBinding",
    ),
    method: "GET",
    path: (input: ProductVariantReadInput) =>
      `/api/v1/stores/${catalogUuidSchema.parse(input.storeUuid)}/catalog/products/${catalogUuidSchema.parse(input.productUuid)}/variants/${catalogUuidSchema.parse(input.variantUuid)}`,
    decode: decodeMerchantVariant,
  } satisfies EndpointContract<ProductVariantReadInput, MerchantVariant>,
  updateProductVariant: {
    evidence: evidence(
      "routes/api.php:442; Catalog UpdateProductVariantRequest/UpdateProductVariantAction/MerchantVariantResource",
    ),
    method: "PATCH",
    path: (input: UpdateProductVariantInput) =>
      `/api/v1/stores/${catalogUuidSchema.parse(input.storeUuid)}/catalog/products/${catalogUuidSchema.parse(input.productUuid)}/variants/${catalogUuidSchema.parse(input.variantUuid)}`,
    body: (input: UpdateProductVariantInput) => updateVariantPayloadSchema.parse(input.data),
    decode: decodeMerchantVariant,
    decodeError: (payload: unknown) => validation(payload, structuralErrorFields),
  } satisfies EndpointContract<UpdateProductVariantInput, MerchantVariant>,
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
  products: {
    evidence: evidence(
      "routes/api.php:404; Catalog ListMerchantProductsRequest/ListMerchantProductsQuery/MerchantProductCollection/MerchantProductResource; CatalogApiTest/CatalogDiscoveryApiTest",
    ),
    method: "GET",
    path: (input: ProductListInput) =>
      `/api/v1/stores/${catalogUuidSchema.parse(input.storeUuid)}/catalog/products?${productQueryString(input.criteria, input.cursor)}`,
    decode: decodeProductPage,
    decodeError: (payload: unknown) =>
      validation(payload, [
        "status",
        "category",
        "q",
        "sort",
        "created_from",
        "created_to",
        "updated_from",
        "updated_to",
        "per_page",
        "cursor",
      ]),
  } satisfies EndpointContract<ProductListInput, ProductPage>,
  product: {
    evidence: evidence(
      "routes/api.php:408; Catalog MerchantProductController/FindMerchantProductQuery/MerchantProductResource/CatalogRouteBinding; CatalogApiTest/CatalogCommercialStateApiTest",
    ),
    method: "GET",
    path: (input: ProductReadInput) =>
      `/api/v1/stores/${catalogUuidSchema.parse(input.storeUuid)}/catalog/products/${catalogUuidSchema.parse(input.productUuid)}`,
    decode: decodeMerchantProduct,
  } satisfies EndpointContract<ProductReadInput, MerchantProduct>,
  categories: {
    evidence: evidence(
      "routes/api.php:469; Catalog ListMerchantCategoriesRequest/ListMerchantCategoriesQuery/MerchantCategoryCollection/MerchantCategoryResource; CatalogApiTest/CatalogDiscoveryApiTest",
    ),
    method: "GET",
    path: (input: CategoryListInput) =>
      `/api/v1/stores/${catalogUuidSchema.parse(input.storeUuid)}/catalog/categories?${categoryQueryString(input.criteria, input.cursor)}`,
    decode: decodeCategoryPage,
    decodeError: (payload: unknown) =>
      validation(payload, ["status", "q", "sort", "per_page", "cursor"]),
  } satisfies EndpointContract<CategoryListInput, CategoryPage>,
  productInventory: {
    evidence: evidence(
      "routes/api.php:414; Inventory ProductInventoryController/FindProductInventoryQuery/ProductInventoryResource; Catalog PreAuthorizeCatalogRoute/ProductPolicy; CatalogCommercialStateApiTest",
    ),
    method: "GET",
    path: (input: ProductInventoryReadInput) =>
      `/api/v1/stores/${catalogUuidSchema.parse(input.storeUuid)}/catalog/products/${catalogUuidSchema.parse(input.productUuid)}/inventory`,
    decode: decodeProductInventory,
  } satisfies EndpointContract<ProductInventoryReadInput, ProductInventory>,
  updateProductInventory: {
    evidence: evidence(
      "routes/api.php:416; Inventory UpdateProductInventoryRequest/UpdateProductInventoryAction/ProductInventoryController/ProductInventoryResource; CatalogMutationGuard; CatalogCommercialStateApiTest",
    ),
    method: "PATCH",
    path: (input: UpdateProductInventoryInput) =>
      `/api/v1/stores/${catalogUuidSchema.parse(input.storeUuid)}/catalog/products/${catalogUuidSchema.parse(input.productUuid)}/inventory`,
    body: (input: UpdateProductInventoryInput) => inventoryPayloadSchema.parse(input.data),
    decode: decodeProductInventory,
    decodeError: (payload: unknown) => validation(payload, ["quantity", "product"]),
  } satisfies EndpointContract<UpdateProductInventoryInput, ProductInventory>,
  createProduct: {
    evidence: evidence(
      "routes/api.php:406; Catalog CreateProductRequest/CreateProductAction/MerchantProductController::store/MerchantProductResource/ProductPolicy; CatalogApiTest",
    ),
    method: "POST",
    path: (input: CreateProductInput) =>
      `/api/v1/stores/${catalogUuidSchema.parse(input.storeUuid)}/catalog/products`,
    body: (input: CreateProductInput) => normalizeCreateProductPayload(input.data),
    decode: decodeMerchantProduct,
    decodeError: (payload: unknown) => validation(payload, productMutationErrorFields),
  } satisfies EndpointContract<CreateProductInput, MerchantProduct>,
  updateProduct: {
    evidence: evidence(
      "routes/api.php:460; Catalog UpdateProductRequest/UpdateProductAction/MerchantProductController::update/MerchantProductResource/ProductPolicy; CatalogApiTest",
    ),
    method: "PATCH",
    path: (input: UpdateProductInput) =>
      `/api/v1/stores/${catalogUuidSchema.parse(input.storeUuid)}/catalog/products/${catalogUuidSchema.parse(input.productUuid)}`,
    body: (input: UpdateProductInput) => normalizeUpdateProductPayload(input.data),
    decode: decodeMerchantProduct,
    decodeError: (payload: unknown) => validation(payload, productMutationErrorFields),
  } satisfies EndpointContract<UpdateProductInput, MerchantProduct>,
  publishProduct: {
    evidence: evidence(
      "routes/api.php:462; Catalog MerchantCatalogActionRequest/TransitionProductAction::publish/MerchantProductController::publish/MerchantProductResource/ProductPolicy",
    ),
    method: "POST",
    path: (input: ProductLifecycleInput) =>
      `/api/v1/stores/${catalogUuidSchema.parse(input.storeUuid)}/catalog/products/${catalogUuidSchema.parse(input.productUuid)}/publish`,
    decode: decodeMerchantProduct,
    decodeError: (payload: unknown) => validation(payload, ["status"]),
  } satisfies EndpointContract<ProductLifecycleInput, MerchantProduct>,
  unpublishProduct: {
    evidence: evidence(
      "routes/api.php:464; Catalog MerchantCatalogActionRequest/TransitionProductAction::unpublish/MerchantProductController::unpublish/MerchantProductResource/ProductPolicy",
    ),
    method: "POST",
    path: (input: ProductLifecycleInput) =>
      `/api/v1/stores/${catalogUuidSchema.parse(input.storeUuid)}/catalog/products/${catalogUuidSchema.parse(input.productUuid)}/unpublish`,
    decode: decodeMerchantProduct,
    decodeError: (payload: unknown) => validation(payload, ["status"]),
  } satisfies EndpointContract<ProductLifecycleInput, MerchantProduct>,
  archiveProduct: {
    evidence: evidence(
      "routes/api.php:466; Catalog MerchantCatalogActionRequest/TransitionProductAction::archive/MerchantProductController::archive/MerchantProductResource/ProductPolicy",
    ),
    method: "POST",
    path: (input: ProductLifecycleInput) =>
      `/api/v1/stores/${catalogUuidSchema.parse(input.storeUuid)}/catalog/products/${catalogUuidSchema.parse(input.productUuid)}/archive`,
    decode: decodeMerchantProduct,
    decodeError: (payload: unknown) => validation(payload, ["status"]),
  } satisfies EndpointContract<ProductLifecycleInput, MerchantProduct>,
} as const;

export const csrfEvidence = evidence(
  "config/sanctum.php:20; Laravel13 PreventRequestForgery::getTokenFromRequest/newCookie; IdentitySpaSecurityTest",
);
