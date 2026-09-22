import { createApiClient } from "../api/client";
import type {
  ProductInventoryReadInput,
  UpdateProductInventoryInput,
} from "../../features/inventory/contracts";
import { inventoryPayloadSchema } from "../../features/inventory/model";
import type {
  CreateProductOptionInput,
  UpdateProductOptionInput,
  CreateProductOptionValueInput,
  UpdateProductOptionValueInput,
  CreateProductVariantInput,
  UpdateProductVariantInput,
  ProductOptionsReadInput,
  ProductVariantsReadInput,
  ProductVariantReadInput,
} from "../../features/variants/contracts";
import { ApiError } from "../api/errors";
import type { EndpointContract } from "../api/types";
import type {
  CategoryListInput,
  MerchantProduct,
  ProductListInput,
  ProductReadInput,
} from "../../features/products/contracts";
import type {
  CreateProductInput,
  ProductLifecycleInput,
  UpdateProductInput,
} from "../../features/products/mutation-contracts";
import {
  normalizeCreateProductPayload,
  normalizeUpdateProductPayload,
} from "../../features/products/mutation-model";
import { normalizeCategoryCriteria, normalizeProductCriteria } from "../../features/products/model";
import type { AuthAdapter } from "../auth/controller";
import { parseStoreUuid } from "../query/keys";
import {
  csrfEvidence,
  merchantContracts,
  readRequestId,
  requestIdEvidence,
  type LoginCredentials,
  type MerchantIdentity,
} from "./contracts";

export interface MerchantApiOptions {
  apiOrigin: string;
  mode?: "production" | "development" | "test";
  fetch?: typeof globalThis.fetch;
  /** Test seam for the readable CSRF cookie only; no cookie value is persisted. */
  readCookie?: () => string;
}

function readCsrfCookie(readCookie: () => string): string {
  const cookies = readCookie()
    .split(";")
    .map((cookie) => cookie.trim())
    .filter((cookie) => cookie.startsWith("XSRF-TOKEN="));
  if (cookies.length !== 1) throw new ApiError("configuration");
  try {
    return decodeURIComponent(cookies[0]!.slice("XSRF-TOKEN=".length));
  } catch {
    throw new ApiError("configuration");
  }
}

export function createMerchantApi(options: MerchantApiOptions) {
  const readCookie =
    options.readCookie ?? (() => (typeof document === "undefined" ? "" : document.cookie));
  const api = createApiClient({
    apiOrigin: options.apiOrigin,
    mode: options.mode,
    fetch: options.fetch,
    requestIdFromBody: { evidence: requestIdEvidence, decode: readRequestId },
    csrf: {
      evidence: csrfEvidence,
      headerName: "X-XSRF-TOKEN",
      getToken: async () => readCsrfCookie(readCookie),
    },
  });
  let pendingLogin: Promise<void> | null = null;

  const identity = (signal?: AbortSignal) =>
    api.request(merchantContracts.identity, undefined, { signal });
  const prepareCsrf = (signal?: AbortSignal) =>
    api.request(merchantContracts.csrf, undefined, { signal });

  async function requestStructuralRead<Input extends ProductOptionsReadInput, Output>(
    contract: EndpointContract<Input, Output>,
    input: Input,
    signal?: AbortSignal,
  ): Promise<Output> {
    const requestInput = { ...input };
    try {
      contract.path(requestInput);
    } catch {
      throw new ApiError("configuration");
    }
    return api.request(contract, requestInput, { signal });
  }

  async function requestStructuralMutation<Input extends { data: unknown }, Output>(
    contract: EndpointContract<Input, Output>,
    input: Input,
    matches: (result: Output, requestInput: Input) => boolean,
    signal?: AbortSignal,
  ): Promise<Output> {
    let requestInput: Input;
    try {
      // Snapshot and normalize before CSRF can yield; caller edits cannot retarget this attempt.
      requestInput = { ...input, data: contract.body!(input) };
      contract.path(requestInput);
    } catch {
      throw new ApiError("configuration");
    }
    await prepareCsrf(signal);
    const result = await api.request(contract, requestInput, { signal });
    // These resources omit Store/Product ownership and mutation receipts. Check only published
    // identities and submitted fields; request scope and backend nesting establish authority.
    if (!matches(result, requestInput))
      throw new ApiError("invalid-response", { mutationOutcome: "unknown" });
    return result;
  }

  async function requestProductMutation<Input>(
    contract: EndpointContract<Input, MerchantProduct>,
    input: Input,
    signal?: AbortSignal,
    productUuid?: string,
  ): Promise<MerchantProduct> {
    try {
      contract.path(input);
      contract.body?.(input);
    } catch {
      throw new ApiError("configuration");
    }
    // Fresh CSRF precedes this deliberate request. Neither transport nor this adapter replays it.
    await prepareCsrf(signal);
    const result = await api.request(contract, input, { signal });
    if (productUuid && result.id.toLowerCase() !== productUuid.toLowerCase())
      throw new ApiError("invalid-response", { mutationOutcome: "unknown" });
    return result;
  }

  async function confirmLogin(
    credentials: LoginCredentials,
    signal?: AbortSignal,
    expected?: MerchantIdentity,
  ) {
    const current = await identity(signal);
    if (
      current.email !== credentials.email.trim().toLowerCase() ||
      (expected && current.id !== expected.id)
    )
      throw new ApiError("invalid-response", { mutationOutcome: "unknown" });
  }

  const authAdapter: AuthAdapter = {
    async loadIdentity(signal) {
      try {
        const current = await identity(signal);
        return {
          principalId: current.id,
          displayName: current.name,
          emailVerified: current.email_verified_at !== null,
        };
      } catch (error) {
        if (error instanceof ApiError && error.kind === "unauthenticated") return null;
        throw error;
      }
    },
    async logout(signal) {
      // Each explicit attempt gets fresh CSRF, including retry after a lost success response.
      await prepareCsrf(signal);
      try {
        await api.request(merchantContracts.logout, undefined, { signal });
      } catch (error) {
        if (error instanceof ApiError && error.kind === "unauthenticated") {
          try {
            await identity(signal);
          } catch (confirmation) {
            if (confirmation instanceof ApiError && confirmation.kind === "unauthenticated") return;
            throw confirmation;
          }
        }
        throw error;
      }
    },
  };

  return {
    authAdapter,
    listProductOptions(input: ProductOptionsReadInput, signal?: AbortSignal) {
      return requestStructuralRead(merchantContracts.productOptions, input, signal);
    },
    createProductOption(input: CreateProductOptionInput, signal?: AbortSignal) {
      return requestStructuralMutation(
        merchantContracts.createProductOption,
        input,
        (result, request) =>
          result.name === request.data.name && result.position === request.data.position,
        signal,
      );
    },
    updateProductOption(input: UpdateProductOptionInput, signal?: AbortSignal) {
      return requestStructuralMutation(
        merchantContracts.updateProductOption,
        input,
        (result, request) =>
          result.id === request.optionUuid.toLowerCase() &&
          result.name === request.data.name &&
          result.position === request.data.position,
        signal,
      );
    },
    createProductOptionValue(input: CreateProductOptionValueInput, signal?: AbortSignal) {
      return requestStructuralMutation(
        merchantContracts.createProductOptionValue,
        input,
        (result, request) =>
          result.id === request.optionUuid.toLowerCase() &&
          result.values.filter(
            (value) =>
              value.value === request.data.value && value.position === request.data.position,
          ).length === 1,
        signal,
      );
    },
    updateProductOptionValue(input: UpdateProductOptionValueInput, signal?: AbortSignal) {
      return requestStructuralMutation(
        merchantContracts.updateProductOptionValue,
        input,
        (result, request) =>
          result.id === request.optionUuid.toLowerCase() &&
          result.values.some(
            (value) =>
              value.id === request.valueUuid.toLowerCase() &&
              value.value === request.data.value &&
              value.position === request.data.position,
          ),
        signal,
      );
    },
    listProductVariants(input: ProductVariantsReadInput, signal?: AbortSignal) {
      return requestStructuralRead(merchantContracts.productVariants, input, signal);
    },
    createProductVariant(input: CreateProductVariantInput, signal?: AbortSignal) {
      return requestStructuralMutation(
        merchantContracts.createProductVariant,
        input,
        (result, request) =>
          result.status === "active" &&
          result.sku === (request.data.sku ?? null) &&
          result.value_ids.length === request.data.value_ids.length &&
          result.value_ids.every((id) => request.data.value_ids.includes(id)),
        signal,
      );
    },
    async loadProductVariant(input: ProductVariantReadInput, signal?: AbortSignal) {
      const requestInput = { ...input };
      const result = await requestStructuralRead(
        merchantContracts.productVariant,
        requestInput,
        signal,
      );
      if (result.id !== requestInput.variantUuid.toLowerCase())
        throw new ApiError("invalid-response");
      return result;
    },
    updateProductVariant(input: UpdateProductVariantInput, signal?: AbortSignal) {
      return requestStructuralMutation(
        merchantContracts.updateProductVariant,
        input,
        (result, request) =>
          result.id === request.variantUuid.toLowerCase() &&
          (request.data.sku === undefined || result.sku === request.data.sku) &&
          (request.data.status === undefined || result.status === request.data.status),
        signal,
      );
    },
    login(credentials: LoginCredentials, signal?: AbortSignal): Promise<void> {
      if (pendingLogin) return pendingLogin;
      const input = { email: credentials.email, password: credentials.password };
      const task = (async () => {
        await prepareCsrf(signal);
        let expected: MerchantIdentity;
        try {
          expected = await api.request(merchantContracts.login, input, { signal });
        } catch (error) {
          if (
            error instanceof ApiError &&
            error.mutationOutcome === "unknown" &&
            error.kind !== "cancelled"
          ) {
            // A lost response may already have established a session. Never replay credentials.
            try {
              await confirmLogin(input, signal);
              return;
            } catch {
              throw error;
            }
          }
          throw error;
        }
        await confirmLogin(input, signal, expected);
      })();
      pendingLogin = task;
      void task
        .finally(() => {
          if (pendingLogin === task) pendingLogin = null;
        })
        .catch(() => {});
      return task;
    },
    async listStoresPage(page: number, signal?: AbortSignal) {
      if (!Number.isSafeInteger(page) || page < 1) throw new ApiError("configuration");
      const result = await api.request(merchantContracts.stores, page, { signal });
      if (result.pagination.current_page !== page) throw new ApiError("invalid-response");
      return result;
    },
    async loadStoreContext(storeUuid: string, signal?: AbortSignal) {
      // UUID parsing only limits request syntax; the server must establish Membership authority.
      try {
        parseStoreUuid(storeUuid);
      } catch {
        throw new ApiError("configuration");
      }
      const result = await api.request(merchantContracts.context, storeUuid, { signal });
      if (result.store.id.toLowerCase() !== storeUuid.toLowerCase())
        throw new ApiError("invalid-response");
      return result;
    },
    async listProducts(input: ProductListInput, signal?: AbortSignal) {
      let requestInput: ProductListInput;
      try {
        requestInput = { ...input, criteria: normalizeProductCriteria(input.criteria) };
        merchantContracts.products.path(requestInput);
      } catch {
        throw new ApiError("configuration");
      }
      const result = await api.request(merchantContracts.products, requestInput, { signal });
      if (result.pagination.per_page !== requestInput.criteria!.per_page)
        throw new ApiError("invalid-response");
      return result;
    },
    async loadProduct(input: ProductReadInput, signal?: AbortSignal) {
      const requestInput = { ...input };
      try {
        merchantContracts.product.path(requestInput);
      } catch {
        throw new ApiError("configuration");
      }
      const result = await api.request(merchantContracts.product, requestInput, { signal });
      // Product UUID limits syntax and response identity; verified Store context supplies authority.
      if (result.id.toLowerCase() !== requestInput.productUuid.toLowerCase())
        throw new ApiError("invalid-response");
      return result;
    },
    async listCategories(input: CategoryListInput, signal?: AbortSignal) {
      let requestInput: CategoryListInput;
      try {
        requestInput = { ...input, criteria: normalizeCategoryCriteria(input.criteria) };
        merchantContracts.categories.path(requestInput);
      } catch {
        throw new ApiError("configuration");
      }
      const result = await api.request(merchantContracts.categories, requestInput, { signal });
      if (result.pagination.per_page !== requestInput.criteria!.per_page)
        throw new ApiError("invalid-response");
      return result;
    },
    async loadProductInventory(input: ProductInventoryReadInput, signal?: AbortSignal) {
      const requestInput = { storeUuid: input.storeUuid, productUuid: input.productUuid };
      try {
        merchantContracts.productInventory.path(requestInput);
      } catch {
        throw new ApiError("configuration");
      }
      return api.request(merchantContracts.productInventory, requestInput, { signal });
    },
    async updateProductInventory(input: UpdateProductInventoryInput, signal?: AbortSignal) {
      let requestInput: UpdateProductInventoryInput;
      try {
        requestInput = {
          storeUuid: input.storeUuid,
          productUuid: input.productUuid,
          data: inventoryPayloadSchema.parse(input.data),
        };
        merchantContracts.updateProductInventory.path(requestInput);
      } catch {
        throw new ApiError("configuration");
      }
      await prepareCsrf(signal);
      const result = await api.request(merchantContracts.updateProductInventory, requestInput, {
        signal,
      });
      // No UUID/version is returned: operation scope supplies correlation, never a receipt.
      if (result.quantity !== requestInput.data.quantity)
        throw new ApiError("invalid-response", { mutationOutcome: "unknown" });
      return result;
    },
    async createProduct(input: CreateProductInput, signal?: AbortSignal) {
      let requestInput: CreateProductInput;
      try {
        requestInput = {
          storeUuid: input.storeUuid,
          data: normalizeCreateProductPayload(input.data),
        };
      } catch {
        throw new ApiError("configuration");
      }
      return requestProductMutation(merchantContracts.createProduct, requestInput, signal);
    },
    async updateProduct(input: UpdateProductInput, signal?: AbortSignal) {
      let requestInput: UpdateProductInput;
      try {
        requestInput = {
          storeUuid: input.storeUuid,
          productUuid: input.productUuid,
          data: normalizeUpdateProductPayload(input.data),
        };
      } catch {
        throw new ApiError("configuration");
      }
      return requestProductMutation(
        merchantContracts.updateProduct,
        requestInput,
        signal,
        requestInput.productUuid,
      );
    },
    async publishProduct(input: ProductLifecycleInput, signal?: AbortSignal) {
      const requestInput = { storeUuid: input.storeUuid, productUuid: input.productUuid };
      return requestProductMutation(
        merchantContracts.publishProduct,
        requestInput,
        signal,
        requestInput.productUuid,
      );
    },
    async unpublishProduct(input: ProductLifecycleInput, signal?: AbortSignal) {
      const requestInput = { storeUuid: input.storeUuid, productUuid: input.productUuid };
      return requestProductMutation(
        merchantContracts.unpublishProduct,
        requestInput,
        signal,
        requestInput.productUuid,
      );
    },
    async archiveProduct(input: ProductLifecycleInput, signal?: AbortSignal) {
      const requestInput = { storeUuid: input.storeUuid, productUuid: input.productUuid };
      return requestProductMutation(
        merchantContracts.archiveProduct,
        requestInput,
        signal,
        requestInput.productUuid,
      );
    },
  };
}

export type MerchantApi = ReturnType<typeof createMerchantApi>;
