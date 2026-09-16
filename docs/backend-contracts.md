# Backend contract access and integration register

## F3-A current contract register

F3-A extends the six certified F2 contracts with exactly three Merchant GET contracts, using frontend baseline `c0c7234a602c133d847b6722b95d7d18fc525e1b` and unchanged backend authority `6614690a3b24b39f45c7c1b9ed85c20ecb22cbbf`. The current registry therefore contains **nine contracts**, with **zero Product mutation contracts**. The sections below retain the historical F2/F1 record; they do not describe the current integration status.

| Method/path                                             | Permission                        | Input and result                                                                                                                                                               |
| ------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET `/api/v1/stores/{store}/catalog/products`           | `products.view`                   | Name-prefix `q`, status, Category UUID, paired creation/update timestamps, sort, per_page and opaque cursor; Product array with cursor pagination and effective creation range |
| GET `/api/v1/stores/{store}/catalog/products/{product}` | `products.view`                   | Store and Product UUID route syntax only; Product Resource                                                                                                                     |
| GET `/api/v1/stores/{store}/catalog/categories`         | `categories.view`, conditional UI | Category cursor lookup; never probed without the current grant                                                                                                                 |

Authoritative source: `routes/api.php`, Catalog Merchant controllers/requests/resources, `ListMerchantProductsQuery`, `CatalogCursorCodec`, `ProductCommercialStateLoader`, Product policy and tenant binding. Product list defaults to 25 (maximum 50) and the previous 366 days of creation; explicit ranges are paired and bounded to 366 days. Search is normalized display-name prefix, 2–80 Unicode characters. Sorts are `newest`, `oldest`, `name_asc`, `name_desc`. Cursor responses have next/previous tokens, no numeric page or total count. The effective creation range is pinned in cursors, without a transactional multi-request snapshot.

Product DTOs contain only the published Resource fields. Descriptions remain escaped plain text. Money is an integer count of minor units: LYD exponent 3, USD/EUR exponent 2. Formatting splits integer digits without floating-point conversion. Variant minimum price and aggregate availability can refer to different active Variants; Product quantity remains null for Variant Products.

Product queries reuse the principal/Store/revision scope, central verified transport and normalized errors. A changed permission set, Role identity or Membership identity during Store revalidation revokes operational caches and pending reads before new authority is published. An unchanged authority refresh preserves the existing scope. Product 404 is resource-local; 401/419 retain the global F2 lifecycle. No Storefront/Platform API, client tenant selector, auth token persistence, or Product mutation is activated.

Implementation and verification evidence: `F3-report.md`, `F3-integration.md`, the permanent Product unit/architecture tests, `tests/integration/products.spec.ts`, and `tests/production/products.spec.ts`.

## F2 published contract authority

Frontend baseline: `473b44c1c0bc0627942866c31b11aac4d4c35442`. Backend source: `git@github.com:mohamedsalama03/qafila-e-commerce.git`, main at `6614690a3b24b39f45c7c1b9ed85c20ecb22cbbf`. Both were independently fetched, clean and at published parity before F2 implementation. The backend checkout is read-only.

F1 had no identified backend source. Earlier F2 discovery subsequently found backend `cf09c88d`, verified authentication, and correctly stopped because general Merchant discovery/context authority was absent. The new published revision resolves that blocker. `artifacts/f2-discovery/` retains the earlier local evidence; the historical F1 register below is not the current contract count.

**Source verified: six contracts. Invented: zero.** Runtime verification is recorded separately in `F2-report.md` and the real integration test evidence; source inspection alone never certifies a browser deployment.

| Method and path                      | Exact input                                  | Success                                                             | Published source                                                                                                                                                  |
| ------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/sanctum/csrf-cookie`           | No body                                      | 204, empty                                                          | Sanctum 4.3.2 `SanctumServiceProvider::defineRoutes`, `CsrfCookieController::show`                                                                                |
| POST `/api/v1/auth/login`            | JSON `email`, `password` only                | 200 User envelope                                                   | `routes/api.php`, Identity `AuthenticateUserRequest`, `AuthenticateUserAction`, `AuthenticationController`, `UserResource`                                        |
| GET `/api/v1/me`                     | No input/body                                | 200 User envelope                                                   | `CurrentUserController`, `UserResource`, stateful/session/active middleware                                                                                       |
| POST `/api/v1/auth/logout`           | No functional input                          | 200 status envelope, `data: []`, message `Logged out successfully.` | `LogoutUserAction`, `AuthenticationController`, `StatusResource`                                                                                                  |
| GET `/api/v1/me/stores?page=N`       | Optional positive integer page only; no body | 200 accessible Store collection                                     | Stores `ListAccessibleMerchantStoresRequest`, `ListAccessibleMerchantStores`, `AccessibleMerchantStoreCollection`, `AccessibleMerchantStoreResource`              |
| GET `/api/v1/stores/{store}/context` | Route public UUID only; no query/body        | 200 current Store context                                           | Stores `MerchantStoreContextRequest`, `ReadMerchantStoreContextAction`, `MerchantStoreContextResource`; `ResolveMerchantTenant`; `StorePermissionEvaluator::read` |

All JSON successes use `{success:true,data,meta:{request_id},message:null}` except logout's documented message. Discovery adds `meta.pagination`. Errors use `{success:false,data:null,meta:{request_id},message,errors}`. The client retains only reviewed data and safe bounded support IDs; it never renders raw error text.

### Identity, credentials and CSRF

User data contains public UUID `id`, `name`, `email`, nullable `email_verified_at`, `status:"active"`, nullable `created_at` and `updated_at`. `/me` is identity authority, with no Store membership or permission projection. Active unverified users are allowed. The frontend principal retains only UUID, display name and verification boolean.

Login accepts RFC email (maximum 254, trimmed/lowercased) and a nonempty password up to 4096; unknown keys are prohibited. Registration password rules are not login rules. Wrong credentials and suspended users receive uniform 422 email validation. The published limiter allows five attempts per normalized email/IP per minute before 429. No consumed authentication contract documents 409.

Sanctum SPA authentication uses an HttpOnly Laravel session cookie. The client bootstraps `/sanctum/csrf-cookie`, reads only `XSRF-TOKEN`, URL-decodes its current wire value, and sends `X-XSRF-TOKEN` for mutations. Session cookie values are never read by frontend code. Credentials use `include`; there is no Bearer/JWT or browser auth persistence. Laravel 13 accepts valid same-origin Fetch Metadata independently of a token; same-site cross-origin SPA mutations require the CSRF proof. A missing-header test must therefore use the actual cross-origin topology.

Logout audits before guard logout/session invalidation/token regeneration. A failed audit deliberately leaves the remote session alive. The F1 explicit failed-logout latch therefore remains necessary. A lost response is not proof of termination, and credential mutations are not blindly replayed.

### Discovery and current Store authority

Discovery items are exactly `{id,name,status:"active"}`. Public UUIDs are navigation identifiers. Eligibility requires current active identity, active Store, active explicit membership, and an active Role from the same Store. Owners and nonowners follow explicit membership authority. Owner-only `/api/v1/stores`, membership administration, Role administration, the permission catalog and Platform APIs are not consumed.

Pagination is `current_page`, `per_page:20`, `last_page`, `total`; order is `created_at DESC, id DESC`. Zero eligible Stores returns 200 with `data:[]`, total 0, last page 1. Draft/suspended owned Stores are excluded, so zero is not evidence of no ownership. Each page has an independent database snapshot. The client pins the first page's total, last page and page size for each traversal, checks requested page numbers, and rejects observable metadata drift or repeated canonical UUIDs, including identical duplicates and conflicting names/statuses. It consumes every pinned page within the 1000-page ceiling and requires the final unique count to equal the pinned total before publishing. On observable traversal inconsistency it discards that candidate and reconstructs the full list once from page 1 with fresh metadata; a second inconsistency fails explicitly. Transport/parser failures do not receive this reconstruction retry. Failed inconsistent or transient refreshes retain only the previously verified list with an error state. Healthy 23-Store discovery remains two requests, with no context request per list item.

This A2-F2-L1 remediation detects observable drift; it cannot prove that independent pages share one database snapshot. Concurrent changes can remain indistinguishable when metadata and UUIDs appear consistent. There is no cursor, snapshot token or transaction identifier spanning pages. Discovery remains a navigation list; selected Store context must still be independently verified, and Laravel remains the final operation authority. See `F2-remediation-report.md` for focused closure evidence.

Context data is `{store:{id,name,status:"active"},membership:{id,status:"active"},role:{id,name},permissions:string[]}`. IDs are public UUIDs. Permissions are sorted canonical active explicit grants; zero grants is a valid success. Role name and owner labels never imply capabilities. This projection controls presentation only; Laravel independently reauthorizes every operation.

Context rechecks read current authority in PostgreSQL repeatable-read read-only transactions. Removed permissions return updated grants, a replaced Role returns its current projection, and stale ineligible membership/Role/Store returns safe 403. Foreign, unknown and malformed Stores return 404 without disclosing Store data. An action/middleware race may deny conservatively with 403; there is no reason-code distinction to invent. Global invalid/suspended identity returns 401. Store 403/404 clears Store authority without automatically logging out the identity.

### Error and deployment semantics

400 is the trusted Host/security boundary; 401 is session/identity authority loss; 403 is denied existing authority; 404 is safe absence/foreign Store; 419 is CSRF/session mismatch; 422 is validation/prohibited input; 429 is rate limiting; 500 is a generic failure. Network/timeout and unparseable responses remain distinct frontend failures. No raw SQL, server path, exception or guessed reason code is exposed.

The published development Compose permits exactly `http://localhost:3000` through credentialed CORS and recognizes that stateful SPA domain. `APP_URL` defaults to `http://localhost:8080`; Merchant Host validation compares its normalized host and validates the port syntax. The isolated runtime uses an owned loopback port with the same host and approved frontend origin. No CORS/Host/Origin policy, proxy, or browser bypass is added. CORS exposes no response headers, so support request IDs come from `meta.request_id`; the browser must not assume `X-Request-ID` or `Retry-After` exposure.

Published sessions use Redis, encryption, HttpOnly, SameSite Lax and path `/`. The development Compose explicitly defaults Secure cookies off for HTTP. Production requires HTTPS and an appropriate Secure-cookie deployment. Local HTTP browser evidence does not certify production TLS. Missing frontend API configuration remains fail-closed. `NEXT_PUBLIC_API_ORIGIN` is public build configuration only, never a secret.

## Historical F1 register (retained, superseded by the F2 inventory above)

F1 inspected the supplied frontend and nearby Qafilah directory on 2026-09-13. No Laravel repository or API documentation was available in the identified Qafilah workspace. This is an access limitation; it does not establish that any backend capability is absent.

## Evidence and scope

- Authorized write root: `D:\customers\qafilah\dashboard frontend` only.
- Root inspection found no pre-existing frontend project or Git repository, as recorded in the implementation plan. No Git initialization or push is authorized.
- `D:\customers\qafilah` contained only `dashboard frontend`.
- Immediate directory-name inventory of `D:\customers`: `aila`, `app`, `assar`, `LUNORA`, `porta frontend`, `qafilah`, `wanted-persons`. No sibling was identified as the Qafilah backend. Unrelated sibling contents were not opened.
- No `AGENTS.md` existed at `D:\`, `D:\customers`, or `D:\customers\qafilah`. The frontend now contains Next.js-generated agent guidance.
- The supplied brief establishes the intended Sanctum SPA cookie/session model and Laravel's authority. It supplies no verified route methods, paths, envelopes, pagination, CSRF names, permissions, Store membership contract, or deployment allowlist.

Verified backend contracts: **0**. Assumed backend contracts: **0**. Invented backend contracts: **0**. Real backend requests/integrations: **0**.

All implementation writes are frontend-local. Laravel files, routes, migrations, permissions and Product behavior modified by F1: **0**. The backend is outside the authorized write scope and was not accessible; a before/after tracked-backend diff could not be executed. Do not describe that unavailable diff as a certified runtime proof.

## BACKEND CAPABILITY REQUIRED

These entries request access to existing authoritative contracts before considering any new capability. They block real integration verification, not the isolated frontend foundation.

| ID    | Frontend requirement                                                | Missing verified contract                                                                                                                                          | Impact                                                                                                                      | Recommended phase                                                         | Blocking F1 foundation?                            |
| ----- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------- |
| BC-01 | Authenticate a merchant and recover expired sessions                | CSRF bootstrap, login, identity and logout methods/paths; request and response schemas; session and cookie behavior; 401/419/422/429 semantics                     | Login is a presentation foundation; production does not accept credentials or establish a fake session                      | F2 — Merchant Authentication, Store Context & Dashboard Shell Integration | No; real authentication blocked                    |
| BC-02 | Connect directly from the browser while preserving backend security | Approved frontend/API origins and host rules; Sanctum stateful deployment configuration; credentialed CORS; CSRF cookie/header names; allowed credential semantics | No backend connection can be enabled or certified                                                                           | Same F2                                                                   | No; Origin/Host and real CSRF tests blocked        |
| BC-03 | Show identity, memberships and selected Store safely                | Authoritative identity, Store UUID membership projection, Store selection flow, permission projection and revocation behavior                                      | No invented user, Store switcher, role or merchant membership is rendered                                                   | Same F2                                                                   | No; real multi-Store/browser privacy tests blocked |
| BC-04 | Exercise a representative read-only resource                        | An approved existing resource route with Store scope, response decoder, pagination/cursor, accepted sorts/filters, permissions and 403/404 semantics               | Table/detail examples remain development-only component patterns                                                            | Same F2, only after BC-01–03                                              | No; real representative resource blocked           |
| BC-05 | Display safe errors and support identifiers                         | Documented conflict/validation envelopes; safe field/domain messages; correlation header and browser exposure; rate-limit metadata                                 | Transport supports contract-supplied decoders/header names; it never assumes an envelope or displays raw backend exceptions | Same F2                                                                   | No; real error-envelope mapping blocked            |
| BC-06 | Populate an operational overview                                    | Any authoritative supported aggregate or work-summary projection, including its permissions and freshness requirements                                             | Overview contains no fabricated revenue, orders, counts, charts or product actions                                          | Later authorized overview integration                                     | No                                                 |

## Adapter activation checklist

For every future integration record source/revision evidence, HTTP method/path, authentication and CSRF requirements, request keys, success decoder, error decoder, Store authority, pagination, accepted filters/sorting, statuses and permissions. The centralized transport requires explicit contract evidence; a source label alone is not independent verification.

The transport is a foundation for direct browser-to-Laravel requests with credentials, restricted origin/path resolution, cancellation/timeouts and safe error normalization. No Next.js proxy, bearer flow, token persistence, fabricated endpoint or production mock authentication has been introduced. Actual Sanctum/HttpOnly/CSRF/Origin compatibility remains **NOT INTEGRATED / NOT TESTED against Laravel**.

Unit tests use synthetic contracts to exercise frontend behavior. They do not certify Laravel's actual routes, cookies, permissions, cross-Store authority or session behavior. Production excludes the development component-review route. Authentication expiry, permission revocation, Store-switch leaks, logout/browser-back privacy, actual cookie flags, wrong-Origin rejection and real backend validation require the authoritative backend deployment to be exercised in F2.

No backend changes should be made to bypass this access limitation. No F2 Product work has begun.
