# F2 implementation plan

Frontend baseline: `473b44c1c0bc0627942866c31b11aac4d4c35442`, main, published parity 0/0 and clean at start. Backend baseline: `6614690a3b24b39f45c7c1b9ed85c20ecb22cbbf`, WSL Ubuntu `/home/mohamed/projects/customers/qafilah`, main, published parity 0/0 and clean. Both repositories were fetched and checked before implementation.

## Authority and scope

The earlier discovery at backend cf09c88d correctly stopped for missing current-Merchant Store authority. The newly published backend now implements that authority; historical evidence remains under `artifacts/f2-discovery/`. The latest explicit resume instruction supersedes backend documentation's writing-time certification-pending/F2-paused language. Backend source/configuration remains read-only throughout this frontend task.

Activate exactly six source-verified contracts through the existing centralized transport:

| Contract                           | Purpose                                                                      | Source at backend 6614690a                                                           |
| ---------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| GET /sanctum/csrf-cookie           | Sanctum SPA session/CSRF bootstrap                                           | Installed SanctumServiceProvider and CsrfCookieController; composer.lock             |
| POST /api/v1/auth/login            | Email/password login                                                         | routes/api.php 115; Identity AuthenticateUserRequest/Action/AuthenticationController |
| GET /api/v1/me                     | Active identity authority                                                    | routes/api.php 137; CurrentUserController/UserResource                               |
| POST /api/v1/auth/logout           | Audited remote session termination                                           | routes/api.php 125; LogoutUserAction/StatusResource                                  |
| GET /api/v1/me/stores?page=N       | All eligible owner/nonowner accessible Store pages                           | routes/api.php 143; ListAccessibleMerchantStores/Request/Collection                  |
| GET /api/v1/stores/{store}/context | Current Store, membership, Role and explicit effective permission projection | routes/api.php 145; ReadMerchantStoreContextAction/Request/Resource                  |

Owner Store lists, membership administration, Role administration, permission catalog and Platform APIs are excluded. No JWT/Bearer/browser token persistence, no backend changes, no domain feature batch, no F3 and no push. Prefer zero dependencies.

## Implementation boundaries

1. Add a narrow source-linked endpoint registry and runtime decoders. Parse JSON meta.request_id without assuming cross-origin header exposure. Read only the verified XSRF cookie, never session-cookie values. Keep mutation retries conservative and reconcile an unknown login outcome through current identity.
2. Extend minimal identity display metadata in the existing auth controller. Preserve same-principal mounted work, query/scope cancellation rules, stale-generation protection and the failed-logout intent latch. Identity 401/419 revoke globally; Store context 403/404 revoke selected Store authority without generic global logout.
3. Add a principal-owned Store lifecycle controller with complete paginated discovery, deduplicated requests, immutable context snapshots, scope revision keys and synchronous old-context removal. Same-Store rechecks do not reset scope. No URL, role label or catalog entry is authorization.
4. Add production login, Store selection and `/stores/[storeUuid]` shell routes with the existing design primitives. One eligible Store enters predictably after context verification; zero eligible Stores is not a claim of zero ownership. Use explicit permission codes for truthful shell UX only, without exposing unimplemented domain pages.
5. Preserve unconfigured production fail-closed checks and development-route exclusion. Add configured real-backend browser coverage separately.

## Shared interfaces

The backend client will expose `createMerchantApi`, `authAdapter`, `login`, `listStoresPage` and `loadStoreContext`. Export minimized `AccessibleStore`, `StorePage` and `MerchantStoreContext` types. Auth principals may include displayName/emailVerified, while principalId remains the cache/security identity.

The Store controller will expose subscribe/getSnapshot, discover, select, revalidate, leave and dispose. Its snapshot includes discoveryStatus/stores/discoveryError, selectedUuid/contextStatus/context/contextError, scope and refreshing. Principal discovery cache is separate from Store cache, but both clear on global authority loss. The UI owns shared API and Store React providers and route composition.

## Isolated environment

Use a source snapshot of the exact published backend with its existing Dockerfile/Compose/schema/fixture helpers. Backend checkout files are never changed or used as writable mounts. Create separately named disposable PostgreSQL/Redis and generated synthetic credentials; do not use shared services or real customer data.

The published development CORS origin is http://localhost:3000. Prefer that exact frontend origin and an owned loopback backend port while preserving the backend's configured Host validation and security defaults. Do not relax Origin/CORS/Host. Record actual cookies without values. Local HTTP integration does not certify production TLS/Secure-cookie deployment. If existing tooling/configuration cannot support a safe isolated run, report the precise blocker instead of using a bypass.

## Verification

Add meaningful DTO/transport, auth, Store lifecycle, pagination, authority loss and UI tests. Preserve F1 redirect corpus, scoped keys, mutation-only Bearer rejection, production fixtures, focus and long-token tests. Real browser Laravel evidence must cover CSRF/login/identity/discovery/context, valid nonowner membership, more than 20 Stores, zero/one/multiple Stores, A-to-B no-flash isolation, foreign/malformed deep links, refresh, permissions/Role/membership change, logout and browser-back/cross-tab privacy, status/errors and request counts.

Run frozen install, format, lint, typecheck, full Vitest, architecture/mutation controls, dev and production E2E, real Laravel E2E, audit/peers, production build, fresh frontend Docker build/healthy nonroot boot, responsive/accessibility and bounded secret/map/fixture checks. Report all failures and limits; no mock-only completion claim.

## Delivery

Update tracked contract/architecture/environment documentation and F2 report/closure evidence, preserving F1 history. Verify backend remains exact published 6614690a, clean 0/0. After all required gates pass, create exactly one local frontend child of 473b44c1 with subject `feat(dashboard): integrate merchant authentication and store context`. Verify frontend clean, behind 0/ahead 1. Do not amend baseline or push. Retain review evidence and final image intentionally; remove only owned disposable resources.
