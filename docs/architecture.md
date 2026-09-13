# F1 architecture and security decisions

## Authority and routes

Laravel alone owns identity, Store membership, TenantContext, permissions, validation, money, inventory, order/fulfillment/shipment/payment states, reporting, timeline/audit and notifications. The browser calls Laravel directly through one transport when approved contracts become available. There is no Next.js API proxy, business route handler, JWT/bearer mechanism, browser auth storage, mock-auth bypass, permission inference from role names or platform/customer storefront surface.

The current production pages are deliberately inert. `/login` and `/` disclose no identity or business data. The `(merchant)` layout demonstrates the session boundary; the server page does not serialize a protected shell while real contracts remain unavailable. `/design-system/[[...pattern]]` conditionally imports `src/dev` only inside a compile-time development branch; production resolves to `notFound()`. Development routes are generic component review, not product routes or authentication bypasses. No `/stores/[uuid]` routing convention is finalized without Store authority.

## Code boundaries

- `app`: RSC page composition, route/layout boundaries, safe loading/errors and metadata.
- `features/auth`: an unavailable production entry and a narrow session boundary.
- `features/overview`: a truthful overview presentation, without metrics or inferred merchant state.
- `components/layout`: original brand and compact responsive shell. There is no fake user identity, notification, search or unsupported navigation.
- `components/ui`, `components/data-table`: reusable accessible presentation primitives. Tables render externally supplied current pages only.
- `lib/api`: the only credentialed request transport, cancellation and normalized errors.
- `lib/auth`, `lib/query`: deterministic lifecycle and tenant-sensitive cache boundaries.
- `lib/forms`, `lib/formatting`: safe presentation-only transforms.
- `src/dev`, tests: isolated examples and synthetic protocol tests; neither provides real backend authority.

No empty feature folders were created for future commerce functions. No global state library, Context server cache, chart library, analytics, telemetry service, date library or Storybook was installed.

## API contracts and transport

There are **zero actual endpoint definitions or requests**. `EndpointContract` is an internal adapter interface, not an invented Laravel response envelope. A future adapter must cite accepted source evidence and validate its exact request/response shapes, method, path, authentication, Store scope, pagination, filters and statuses. Typed contracts preserve distinct envelopes rather than flattening everything into a generic API response.

`createApiClient` accepts a validated API origin and explicit reviewed contract. Requests include cookie credentials and use `cache: no-store`, CORS semantics and `redirect: error`. Credentialed absolute/protocol-relative URLs, malformed headers and mutation calls without a verified CSRF provider fail before sending. Request and retry headers are read only when their exact names have been configured with contract evidence. CSRF names, cookie reading, bootstrap route and authentication payloads are intentionally unspecified. HttpOnly sessions are never read by React; no token is persisted.

The transport accepts AbortSignals and a bounded timeout. It also races cancellation against adapters that ignore abort, so late results cannot overwrite newer state. Automatic retries are disabled, including mutations. A lost mutation response/timeout or unsuccessful result decoding is marked as an unknown outcome; future UI must reconcile authoritative state before permitting another submission. A timeout is never proof that Laravel did not apply an operation.

Errors distinguish 401,403,404,409,419,422,429,5xx, network, timeout, cancellation, configuration and invalid response. Raw response bodies, exception text, SQL and server paths are never displayed. Safe 409/422 details must be explicitly decoded by reviewed contracts. Field messages are whitelisted, bounded and mapped to forms; unmapped domain errors can appear at form level. Request IDs are syntax bounded. No 419 recovery loop or automatic 429 retry exists.

## Authentication and tenant cache lifecycle

The auth controller is unavailable until a verified adapter is supplied. Initial bootstrap establishes identity. Visible-page focus, return to visible state and persisted `pageshow` can revalidate that identity in the background; concurrent checks share one pending operation. An authenticated workspace remains mounted during revalidation. The same principal preserves React form state, QueryClient data/mutations, Store scope revision and operations registered through `scope.run`. A transient network/server/timeout/rate-limit failure preserves that workspace with explicit recheck-failure guidance and a retry action; it does not claim fresh verification or start an automatic retry loop.

Confirmed missing identity, 401/419, established 403 authority loss, a changed principal, explicit logout and intentional page lifecycle invalidation revoke old authority and purge its cache/scoped work. A changed principal receives a fresh private React subtree, so old form state cannot appear under the new identity. Generation checks reject old revalidation results after revocation. Ordinary hidden-tab visibility does not hide/unmount the workspace, clear its cache or abort scoped operations. Tokenless cross-tab authority invalidation remains a revocation event, distinct from routine focus.

The established `pagehide` privacy policy is retained for both persisted and non-persisted events: hide the private DOM synchronously, then purge local authority. A restored BFCache document must verify identity before rendering its private workspace again. This deliberately sacrifices unsaved state across page-history suspension while preserving it across ordinary tab changes. Synthetic persisted/non-persisted event tests demonstrate the frontend policy; they do not certify actual browser BFCache behavior with Laravel merchant data.

Logout clears private frontend authority before awaiting the adapter. `logging-out` and `logout-failed` are explicit states. Failure states that server sign-out is unconfirmed, warns about the possibly active remote session on a shared device and offers **Retry sign out**, which invokes logout again. Focus, visibility, history rechecks and generic bootstrap cannot silently restore a workspace after logout intent. Successful retry remains locally cleared and returns to sign-in; another failure keeps the specific recovery state. Logout intent is memory-only: a full document reload creates a new controller and must verify remote identity afresh; no browser marker/token is persisted and server termination is never inferred. In current F1 production no adapter exists, including after reload. Real cookie/session termination remains unverified.

Create a QueryClient per browser provider/request, never a server-wide singleton. Context holds controllers, not copies of products/orders/stores. Query defaults disable automatic retries, eager prefetch and query-level focus/reconnect refetch, with immediate staleness and bounded garbage collection. The separate session revalidation described above still runs on focus/visibility restoration. Future features must select resource refetch and stale policies from the real operational projection; no optimistic commerce mutations exist.

`storeKeys.resource` includes principal identity, the validated backend-issued Store UUID and a scope revision. Shape validation is not membership verification. `createScopeController` synchronously cancels/removes prior merchant queries, clears mutations, drops current context and invalidates the old revision before activating another scope. A failed destination parse also clears prior context. `scope.run` binds request cancellation and result acceptance to the exact scope. Logout clears all in-memory cache. No query persistence, localStorage or IndexedDB is used. Future mutation success callbacks must check the current revision and invalidate only the appropriate scoped keys.

Browser restoration, background session revalidation and cross-tab invalidation remain frontend safeguards rather than session authority. Their isolated tests do not establish actual multi-Store or browser-back privacy certification with Laravel. Clearing mutation cache cannot cancel arbitrary mutation requests or undo backend effects; cancellation applies to queries and operations registered through the scope controller.

Return navigation is validated against a fixed synthetic HTTPS origin. The helper checks both parsed origin and the final serialized pathname/query/hash as a fresh navigation target. Dot-segment normalization must never turn an accepted result into a protocol-relative destination. Unsafe input falls back to `/`; local query/hash navigation remains supported. The helper creates no real backend login or redirect contract.

## Forms and tables

RHF and Zod handle example UX structure only; no Laravel business rules are duplicated. Inline errors label and describe fields; backend-field mapping focuses the first recognized field. Unknown domain errors are kept visible at form level. Pending actions disable duplicates and confirmations start on the safe cancellation choice. Significant forms remain full pages.

TanStack Table v9 uses only its required sorting feature. Sorting is opt-in per column and requires an external handler; there is no client-side global sorting/filter/pagination. Pagination callbacks accept previous/next availability and an honest label, which can represent opaque backend cursors without parsing them. Each row requires a stable ID. Mobile summaries retain actions; wide structured data has a keyboard-focusable scroll region. No row performs its own fetch. The local component example uses explicitly labeled predefined pages and state controls, not product filters.

## Rendering, headers and deployment

Pages remain Server Components. Interactive boundaries cover navigation, dialogs, forms, table control and session lifecycle. No authenticated data is statically generated. The root layout is dynamic, including not-found documents, so every document receives a fresh nonce. `src/proxy.ts` is Next.js 16’s security-header entry, not a Laravel proxy or authorization check. It overwrites inbound nonce/CSP headers and applies a per-request script nonce, strict-dynamic, framing denial, no base/object embedding and private no-store caching. Production forbids eval and inline scripts without an approved nonce. Inline style attributes are allowed for Radix positioning; that narrow styling allowance does not authorize script execution. Production uses upgrade-insecure-requests; HTTPS/HSTS policy belongs to the confirmed deployment. Static assets can be cached normally.

All documents have noindex/nofollow/noarchive metadata/headers and robots exclusion. Browser source maps are disabled. Remote images have an empty allowlist until media contracts exist. No wildcard origins or public sensitive caches are introduced. Production API configuration is public build-time configuration, never a secret; absent configuration deliberately keeps integration unavailable and malformed supplied values fail validation.

The loading boundary lives under the merchant group, so unavailable development routes can return a real HTTP 404 before streaming begins. Production tests assert the status code as well as the absence of example content. A visual not-found page with HTTP 200 is not accepted as route exclusion.

Local production startup uses the same standalone server as Docker. A small Windows-only packaging step repairs Next's traced file symlinks that point to package directories into directory junctions. Both the link location and its resolved target must remain inside `.next/standalone`; only the generated link is unlinked, never its target or source dependencies. Two filesystem regression tests check valid repair and rejection of external targets. Linux Docker output requires no repair. The application port and hostname are explicit; production Playwright owns its dedicated port rather than reusing another project’s service.

## Toolchain decisions

The blank workspace had no incumbent versions. Current stable Next16/React19/Tailwind4 and TanStack Query5/Table9 were inspected at installation. TypeScript6 is pinned because the current ESLint TypeScript parser does not yet support TypeScript7. ESLint10 uses the supported official Next plugin, typescript-eslint and React Hooks rules directly: the aggregate Next lint configuration currently brings React plugins whose peer ranges/runtime lag ESLint10. This avoids retaining deprecated ESLint9 or suppressing parser/rule failures. Accessibility is checked behaviorally with Testing Library and axe in a real browser. Exact dependencies are locked by pnpm; native compilation scripts are not blanket authorized.

## Source references

Implementation was checked against the installed Next16.3.5 docs, including CSP and CLI conventions, plus official [Next.js installation](https://nextjs.org/docs/app/getting-started/installation), [Tailwind PostCSS setup](https://tailwindcss.com/docs/installation/framework-guides/nextjs), and [TanStack Table manual sorting](https://tanstack.com/table/latest/docs/framework/react/guide/sorting). Generic Laravel knowledge is not a substitute for Qafilah source; no route is inferred from these references.
