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

The auth controller is unavailable until a verified adapter is supplied. It deduplicates identity bootstrap, rejects results from prior generations, and revokes frontend authority on session expiry or permission loss. Logout hides/purges frontend state before awaiting backend termination and does not pretend success if the request fails. Real session-cookie termination must still be verified against Laravel.

Create a QueryClient per browser provider/request, never a server-wide singleton. Context holds controllers, not copies of products/orders/stores. Query defaults are conservative: no retries, no eager prefetch, no focus/reconnect refresh globally, immediate staleness and bounded garbage collection. Future features must select refetch and stale policies based on the real operational projection; no optimistic commerce mutations exist.

`storeKeys.resource` includes principal identity, the validated backend-issued Store UUID and a scope revision. Shape validation is not membership verification. `createScopeController` synchronously cancels/removes prior merchant queries, clears mutations, drops current context and invalidates the old revision before activating another scope. A failed destination parse also clears prior context. `scope.run` binds request cancellation and result acceptance to the exact scope. Logout clears all in-memory cache. No query persistence, localStorage or IndexedDB is used. Future mutation success callbacks must check the current revision and invalidate only the appropriate scoped keys.

Browser restoration, hidden-tab rechecks and cross-tab authority invalidation are frontend privacy safeguards, not session authority. Their isolated tests do not establish actual multi-store or browser-back privacy certification with Laravel.

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
