# Qafilah Merchant Dashboard — F1 implementation and verification

**Historical baseline report.** Agent 2 subsequently rejected the baseline with two Medium and six Low findings. The original gate counts and Git state below describe that earlier delivery, not current certification. Product Authority then initialized/published the unchanged baseline at `ed71b2b0ee6db46cb5e358b079715e5c419170b0`. See the [focused remediation report](F1-remediation-report.md) and updated [architecture](architecture.md) for the corrected lifecycle, redirect, guard, overflow/focus and documentation behavior. Independent focused re-review remains pending.

Date: 2026-09-13. Authorized frontend: `D:\customers\qafilah\dashboard frontend`.

The frontend architecture and interface foundation are complete. Real Laravel integration is unavailable: **zero verified backend contracts, zero consumed backend endpoints and zero invented endpoints**. Production renders an honest unavailable sign-in state. Shell, overview, table, detail, form and component examples are development-only. They are not completed commerce features or authenticated merchant pages.

The applicable closure status is **FRONTEND F1 COMPLETE — BACKEND INTEGRATION PARTIALLY BLOCKED**. This report supports review; it is not independent Agent 2 certification or authorization to deploy a connected merchant application.

## Initial state and write boundary

The frontend directory was empty. It had no application source, package manifest, lockfile, environment files, Docker configuration or existing frontend conventions. No Git repository existed in the directory or its ancestors. The parent Qafilah directory contained only this frontend; no Laravel source, accepted API documentation or backend deployment was available. Nearby unrelated projects were not opened or modified. See the [inspection baseline](implementation-plan.md) and [backend evidence register](backend-contracts.md).

Existing source preserved: yes; there was none to replace. All implementation writes stayed in the frontend directory. Backend modifications: **zero**. A tracked before/after Laravel diff could not be executed because the backend was inaccessible. Backend freeze is a write-scope statement, not an independently observed backend-diff proof.

Repository: **unversioned**. Baseline/hash: **N/A**. F1 commit: **NONE — GIT INITIALIZATION REQUIRED / COMMIT NOT CREATED — FRONTEND REPOSITORY INITIALIZATION REQUIRED**. Git initialization was not authorized and was not performed. No commit, push, history rewrite, sibling modification or F2 implementation was attempted.

## Implemented architecture

Next.js 16.3.5 App Router, React/React DOM 19.3.0, TypeScript 6.0.3 in strict mode and Tailwind CSS 4.3.3 form a feature-oriented application. Node 24.18.0 and pnpm 11.19.0 were validated. Direct dependencies are exact versions and `pnpm-lock.yaml` is the sole package lockfile.

Server Components compose routes. Small client boundaries handle forms, navigation, tables and session lifecycle. `app` owns routing; `features` owns presentation domains; `components` owns reusable UI; `lib` owns transport, authentication, query scope and presentation helpers. No global client wrapper owns duplicate server data. No Next.js business API, Laravel proxy, JWT library or broad state-management framework exists.

The centralized transport is implemented but inactive. An explicit contract must supply reviewed evidence, method/path and runtime decoding; optional safe error/header decoding also requires contract evidence. It uses cookie credentials, no-store requests, restricted origins and relative paths, rejected redirects, cancellation and bounded timeouts. Mutation calls require a verified CSRF provider. CSRF routes, cookie names and request envelopes are deliberately unspecified. API origin configuration alone cannot activate authentication.

Authentication is designed for the user's Laravel Sanctum SPA model. The controller deduplicates bootstrap, rejects stale generations and purges frontend authority on logout, expiry and permission loss. SessionBoundary starts unavailable until an adapter is supplied. Hidden-page suspension, restoration checks and tokenless cross-tab invalidation support privacy; none establishes actual Laravel session authority.

TanStack Query holds server state. Scoped keys bind principal, backend-issued Store UUID and scope revision. Store shape validation never proves membership. Switching or invalid destination input invalidates the old scope, cancels scoped queries and operations registered through `scope.run`, clears merchant query/mutation cache, and rejects their late results. Clearing mutation cache cannot cancel arbitrary mutation requests or undo backend effects. Logout clears in-memory cache before remote completion; a failed backend logout is not presented as a successfully terminated server session. There is no persistent query cache or inferred role/permission system.

RHF and Zod provide form structure and presentation validation. Safe backend-field mapping rejects unknown field paths, preserves form-level errors and focuses the first recognized invalid field. Money formatting accepts exact decimal strings and explicit currency/locale; timestamps require explicit timezone and validated instants. These utilities perform no commerce calculations or localization product feature.

Detailed decisions, rendering boundaries, lifecycle semantics, tooling compatibility and CSP constraints are in [architecture.md](architecture.md).

## Design and reusable components

The design uses warm neutral surfaces, evergreen primary actions, subtle borders, compact system typography, restrained radii, tabular numbers and dense operations layouts. Desktop navigation is 228px; the top bar is 60px. Mobile navigation uses a focus-managed drawer and touch-sized controls. The Qafilah wordmark and geometric mark are original. No Shopify source, proprietary assets or pixel-copy layout was used.

There are no revenue cards, fake charts, invented counts, unsupported search/bell controls, fabricated users or selectable fake stores. The overview has a truthful empty foundation. Development examples are clearly labeled throughout and excluded from production bundles. [DESIGN.md](../DESIGN.md) defines tokens and interaction rules; the [closure matrix](F1-closure-matrix.md) records each requested visual principle.

Exact exported reusable UI primitives:

- `Button`, `IconButton`, `Card`, `CardHeader`, `CardContent`.
- `Input`, `Textarea`, `Label`, `Select`, `Checkbox`, `Radio`, `FormField`, `FormError`.
- `StatusBadge`, `PageHeader`, `DetailLayout`, `EmptyState`, `ErrorState`, `Skeleton`, `PageSkeleton`.
- `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`, `Tooltip`, `ActionMenu`, `ConfirmationDialog`, `Toast`.
- `DataTable`, with typed columns, externally supplied pagination and opt-in manual sorting; accessible pagination is part of the table rather than a separately exported component.
- `AppShell`, with sidebar, top bar, mobile drawer, skip link and Store-context slot; `Brand`.

There is no separately exported generic Sheet/Dialog/Badge component merely to pad the inventory. The mobile drawer uses Radix Dialog internally; destructive confirmation uses Radix AlertDialog. Table rows retain structured summaries/actions on mobile and accept stable IDs. Current-page examples never imply a complete server dataset.

## Actual route inventory

| Route                       | Classification        | Actual behavior                                                            |
| --------------------------- | --------------------- | -------------------------------------------------------------------------- |
| `/`                         | Production foundation | Unavailable sign-in state; no protected merchant data serialized           |
| `/login`                    | Production foundation | Explains unavailable sign-in; does not accept credentials                  |
| `/design-system`            | Development-only      | Shell and honest overview foundation                                       |
| `/design-system/table`      | Development-only      | Explicit sample records, pagination controls, loading/empty/error examples |
| `/design-system/detail`     | Development-only      | Representative sample detail and structured information                    |
| `/design-system/form`       | Development-only      | Validation, confirmation and local preview; no backend save                |
| `/design-system/components` | Development-only      | Reusable controls and ten error-state examples                             |
| `/design-system/login`      | Development-only      | Disabled credential-field visual pattern                                   |
| Unrecognized pages          | Production foundation | Safe not-found UI                                                          |

The optional catch-all handles review patterns, not new product routes. All eight tested development URLs, including unrecognized nested examples, return actual HTTP **404** in production. This was verified after moving the loading boundary into the merchant route group so streaming cannot prematurely commit an HTTP 200. Error and global-error boundaries avoid raw exceptions; the merchant loading boundary provides a reusable skeleton.

## Backend integration and security principles

There are no consumed backend routes to list:

| Surface         | Method | Route | Store-scoped? | Authentication    | Purpose                  | Verified?   |
| --------------- | ------ | ----- | ------------- | ----------------- | ------------------------ | ----------- |
| None integrated | N/A    | N/A   | N/A           | No active adapter | Frontend foundation only | 0 contracts |

| Principle                          | Result and evidence limit                                                                     |
| ---------------------------------- | --------------------------------------------------------------------------------------------- |
| Backend remains authority          | YES; no backend mutation or inferred business authority                                       |
| Frontend permissions are UX only   | YES; no fabricated permissions; real projection unavailable                                   |
| TenantContext not recreated        | YES; frontend cache scope is not Laravel tenancy                                              |
| Store UUID not trusted as security | YES; input shape and cache identity only                                                      |
| Session secret inaccessible to JS  | Architecture does not read or persist it; actual HttpOnly cookie flags NOT TESTED             |
| JWT / bearer auth introduced       | NO / NO                                                                                       |
| localStorage / sessionStorage auth | NO / NO; architecture tests and production storage inspection                                 |
| Open redirect                      | No unsafe return path accepted by tested helper; actual login redirect integration NOT TESTED |
| Raw exception exposure             | NO in implemented UI/normalizer; reviewed contract decoders required for future safe messages |
| Platform authority leakage         | NO implemented Platform surface or imports                                                    |
| Sensitive production logs          | None introduced; supported production browser routes had no unexpected warnings/errors        |
| Fake production authentication     | NO; production remains unavailable                                                            |
| CSRF / Origin / Host               | No bypass introduced; real enforcement NOT INTEGRATED / NOT TESTED                            |

Production scripts use a fresh nonce and strict-dynamic; eval and unapproved inline scripts are forbidden. Nonce-bearing Next scripts remain valid. Style attributes remain allowed for Radix positioning. Documents have private no-store caching and no-index metadata/headers, frame denial, nosniff and no-referrer. Remote-image hosts are disabled until verified media contracts exist. Public browser source maps are absent.

The only example environment variable is optional `NEXT_PUBLIC_API_ORIGIN`, blank by default. It permits an origin only, rejects credentials/path/query/fragment and requires HTTPS in production. It is public build configuration, never a session secret. No actual environment file or secret was created.

## Tenancy and error behavior

| Tenancy requirement     | Result                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| Store-scoped keys       | YES; principal, validated Store UUID and revision                                            |
| Store-switch isolation  | PASS isolated controller/cache tests; real Laravel flow NOT TESTED                           |
| Logout cache isolation  | PASS isolated tests; real session termination/browser-back journey NOT TESTED                |
| Cross-Store flash       | Stale scopes and pending results rejected in tests; real multi-Store browser flow NOT TESTED |
| Permissions after 403   | Frontend authority revoked/purged in tests; real permission refresh/projection NOT TESTED    |
| Backend Store authority | PRESERVED by scope; no assumed membership authority                                          |

| Condition              | Implemented frontend response                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| 401                    | Session-expired guidance; invalidate frontend authority                                                |
| 403                    | Permission-denied guidance; revoke/purge prior frontend authority                                      |
| 404                    | Safe not-found resource/page presentation                                                              |
| 409                    | Conflict guidance; retain authoritative reconciliation requirement                                     |
| 419                    | Expired-session/security guidance; no automatic CSRF retry loop                                        |
| 422                    | Safe validation family; explicit field/domain mapping with first-invalid focus                         |
| 429                    | Rate-limit guidance; no automatic retry; metadata only from configured headers                         |
| 500 / 5xx              | Generic temporary-server-error guidance without raw exception body                                     |
| Network failure        | Connection guidance with explicit recovery controls where appropriate                                  |
| Timeout                | Bounded request cancellation and safe timeout guidance                                                 |
| Lost mutation response | Mark outcome unknown, never auto-retry; require authoritative reconciliation before another submission |

Transport tests execute these synthetic response families, and browser review renders the ten status/network/timeout examples. Those are frontend integration/component tests, not real Laravel error-envelope verification. Cancelled requests are distinct from failures. No actual commerce mutation was implemented or executed.

## Executed quality gates

| Gate                         | Final result                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| Frozen clean install         | PASS; lockfile installation also executed in a clean Linux Docker stage                                |
| Formatting                   | PASS; Prettier non-mutating check                                                                      |
| Lint                         | PASS; zero warnings, no broad rule disabling                                                           |
| Strict typecheck             | PASS; Next route type generation and TypeScript                                                        |
| Vitest                       | **172 tests, 12 files, PASS**, no skipped tests                                                        |
| Architecture/security        | Included above: 46 tests, executable mutation controls and harmless decoys                             |
| Development browser E2E      | **16 tests PASS**; 30 surface/viewport combinations plus interactions                                  |
| Production browser E2E       | **6 tests PASS** on an owned standalone server                                                         |
| Real Laravel integration E2E | **NOT TESTED**; backend contracts/deployment unavailable                                               |
| Next.js production build     | PASS                                                                                                   |
| pnpm audit                   | PASS; no reported vulnerabilities, critical 0, high 0; full and production audits executed             |
| pnpm peers check             | PASS; no peer issues reported                                                                          |
| Docker build and boot        | PASS; final image healthy under UID/GID 1001                                                           |
| Bounded secret scan          | PASS; no matches in inspected source/public build for checked key/private-key patterns                 |
| Production fixtures/maps     | PASS; known sample markers absent from server/static build, browser `.map` files absent                |
| Browser console/hydration    | PASS on reviewed supported production pages; zero unexpected warnings/errors and no hydration warnings |

The architecture suite parses executable TypeScript syntax, rejects 36 table-driven forbidden mutants plus a mutation of the actual development guard, and accepts harmless string/comment/documentation decoys. Policies cover centralized transport, browser persistence, JWT/bearer headers, unsafe HTML, Platform/diagnostic/analytics/devtool imports and unrestricted image origins. These checks are bounded source protections, not a universal taint-analysis or penetration-testing claim.

Other tests cover transport cancellation/timeout races, error mapping, hostile paths/headers, CSRF requirements, auth generation and adapter lifecycle, cross-tab invalidation, scoped cache cleanup, formatting, forms, manual table behavior and confirmation focus/duplicate suppression. Two filesystem tests verify safe Windows standalone link repair and rejection of external targets.

Some preliminary runs failed and were corrected before closure: framework/ESLint peer compatibility, Windows traced-link packaging and production streaming-404 behavior. An initial Docker fetch timeout passed on retry with bounded fetch concurrency and a cache mount. An early production browser attempt encountered an unrelated service on a candidate port; its results were discarded. The final production suite starts its own port 3411 with server reuse disabled. These failures are not reported as successful evidence.

## Browser, accessibility and performance evidence

Chromium: **PASS**, full development and production suites. Firefox: **NOT REVIEWED**. Playwright WebKit 26.6 on Windows: **PASS**, focused mobile smoke at 390×844. This is not real Safari/iOS or a full cross-browser certification. Edge was not separately reviewed.

Reviewed viewport sizes: large desktop **1440×900**, laptop **1280×900**, tablet/small desktop **1024×900**, tablet **768×900**, mobile **390×844**. Six development surfaces were inspected across all five sizes. Production sign-in was reviewed at 1440 and 390. No page-level horizontal overflow was found; wide data has deliberate accessible containment.

Six axe scans passed with zero detected violations (four development interaction/surface scans and two production sign-in scans). Keyboard checks cover navigation, visible focus, skip link, drawer open/close/Escape/route changes, menu behavior, safe initial confirmation focus, focus restoration, required-field messages and first-invalid focus. Screenshots were visually inspected. Overall accessibility is **PARTIAL** relative to full conformance: representative checks passed, but no complete WCAG audit or physical assistive-technology/device certification was performed. Screenshots are review evidence, not automated pixel-baseline visual regression tests.

Production `/login` delivered **8 JavaScript resources**, **139,492 encoded body bytes** (about 136.2 KiB), **141,892 transfer bytes** including response overhead. Measurements are Chromium Resource Timing for this route/build only, not Lighthouse scores or a populated merchant application's performance budget. No third-party requests were observed. Real API requests: **0**.

Performance principles achieved in implemented source: centralized query state; no duplicate global server cache; externally bounded table pages; no client pagination/sorting of a complete backend dataset; no row-level requests; RSC route composition; no known unused direct dependency; no production devtools; no observed hydration or application-console errors. Operational load, real request counts, backend latency and large-resource performance remain untested.

Local evidence is intentionally ignored by source packaging: `artifacts/screenshots/`, `artifacts/production-console/`, `artifacts/production-js-metrics.json`, `artifacts/webkit-smoke.json`, `artifacts/docker-verification.json`, and `artifacts/final-source-checks.json`. Reproducible E2E scripts are in `tests/e2e` and `tests/production`.

## Dependencies and reproducibility

Production dependencies, exact:

| Package                       | Version     | Purpose                                              |
| ----------------------------- | ----------- | ---------------------------------------------------- |
| next                          | 16.3.5      | App Router, RSC and standalone server                |
| react / react-dom             | 19.3.0 each | UI runtime                                           |
| @tanstack/react-query         | 5.102.8     | Server state and cancellation/cache lifecycle        |
| @tanstack/react-table         | 9.2.4       | Typed table foundation with manual control           |
| react-hook-form               | 7.88.0      | Form registration and accessible validation behavior |
| zod                           | 4.6.2       | Runtime presentation/input schema validation         |
| @hookform/resolvers           | 5.9.1       | RHF/Zod integration                                  |
| @radix-ui/react-alert-dialog  | 1.1.23      | Confirmation focus and keyboard behavior             |
| @radix-ui/react-dialog        | 1.1.23      | Mobile navigation drawer                             |
| @radix-ui/react-dropdown-menu | 2.1.24      | Accessible resource actions                          |
| @radix-ui/react-tabs          | 1.1.21      | Accessible tab pattern                               |
| @radix-ui/react-tooltip       | 1.2.16      | Supplementary control explanations                   |
| lucide-react                  | 1.45.0      | Consistent imported icons                            |
| clsx                          | 2.1.1       | Conditional classes                                  |
| tailwind-merge                | 3.6.0       | Predictable utility-class overrides                  |

Development dependencies, categorized (all exact versions are in `package.json`):

- Build/types: TypeScript 6.0.3; Tailwind CSS and its PostCSS plugin 4.3.3; PostCSS 8.5.28; Node types 24.13.4; React/DOM types 19.3.0.
- Quality: ESLint 10.10.0; official Next ESLint plugin 16.3.5; typescript-eslint 8.70.0; React Hooks ESLint plugin 7.1.1; Prettier 3.9.6.
- Unit/component: Vitest 5.0.0; jsdom 30.0.1; Testing Library DOM 10.4.1, jest-dom 7.0.1, React 16.3.3 and user-event 14.6.7.
- Browser/accessibility: Playwright Test 1.63.0 and axe Playwright 4.13.0.

Known unused direct dependencies: **0** by source/config review; no dedicated whole-program dependency analyzer was run. TypeScript 6 was chosen for current parser compatibility. Direct supported lint plugins avoid incompatible aggregate React plugin peers without disabling lint rules. No charts, date library, state framework, analytics runtime or production debugging package was added. The optional analyzer uses Next's built-in CLI.

## Docker and production execution

The multi-stage image uses pinned Node 24.18.0 Alpine and pnpm 11.19.0, frozen installation, standalone tracing, a non-root runtime and only required output/static/public assets. A frontend `/login` health check is implemented. Build-time public API configuration is optional; secrets and local evidence are excluded from Docker context.

Final locally verified image: `qafilah-merchant-f1:local`.

Image ID: `sha256:8c22bda1a1173f694a5bd137803812f0795d9237211d4fb0ffd42437c705aaa7`.

Docker-reported image size: **70,148,437 bytes**. Container health: **healthy**. Runtime UID/GID: **1001/1001**. `/login`: **200** with private no-store and CSP; `/design-system`, `/design-system/table`, `/design-system/form`: **404**. Verification used a dedicated loopback port 3421. No image was pushed or deployed externally. The temporary verification container was removed after inspection.

Local `pnpm start` uses the standalone output, defaults to loopback port 3411 and copies only generated static/public assets into that output. On Windows a bounded helper repairs traced directory links into junctions; it checks both link and real target remain inside `.next/standalone` and never deletes the target. Linux container startup requires no such repair. See [README](../README.md) for reproducible commands.

## Remaining limitations and exactly one next phase

All real Laravel journeys remain **NOT INTEGRATED / NOT TESTED**: CSRF bootstrap, login, identity, logout/server cookie termination, cookie flags, credentialed CORS, Origin/Host rejection, approved frontend deployment, Store membership/selection, permissions/revocation, real Store switching and cross-Store flash, logout/browser-back privacy, actual validation/conflict/rate-limit envelopes and one authorized read-only resource. An evidence string on an adapter does not verify its source contract. Future protected RSC data must be authorized before serialization; a client boundary cannot secure already serialized props.

No live merchant data, real overview projection, connected login, Store switcher, commerce mutation or real backend E2E environment exists. Full Catalog, Inventory, Orders, fulfillment/shipping mutations, payments, billing, notifications, Platform Admin, Customer Storefront and localization were not implemented. No F2 work began.

Other limits: no Git baseline/commit, no backend-diff proof, no Firefox or physical Safari/iOS review, no full accessibility certification, no automated visual-regression baseline, no real merchant performance/load measurements, and no security guarantee beyond the described source/tests/browser observations. Development review is not production functionality. The foundation can be reviewed and built; it cannot authenticate a merchant yet.

Recommended next phase, exactly one: **F2 — Merchant Authentication, Store Context & Dashboard Shell Integration**. First obtain the existing certified Laravel contracts/deployment access documented in BC-01–05; integrate only those authoritative contracts and verify session, Store and permission boundaries. No backend Product/security changes are authorized by this recommendation.

## AGENT 2 REVIEW PACKAGE — QAFILAH MERCHANT DASHBOARD F1

| Field                               | Handoff                                                                                                                                |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend path                       | `D:\customers\qafilah\dashboard frontend`                                                                                              |
| Baseline                            | N/A — initially empty and unversioned                                                                                                  |
| Implementation commit               | NONE — Git initialization requires authority                                                                                           |
| Authorized scope                    | F1 architecture, security/tenancy foundations, reusable UI, development examples, tests, Docker and documentation in the frontend only |
| Backend modifications               | ZERO; backend before/after diff unavailable                                                                                            |
| Core stack                          | Next 16.3.5, React 19.3.0, TS 6.0.3, Tailwind 4.3.3, Node 24.18.0, pnpm 11.19.0                                                        |
| Auth architecture                   | Inactive contract-driven Laravel Sanctum SPA cookie/CSRF transport; no JWT/bearer/persisted tokens                                     |
| Real contracts integrated           | 0                                                                                                                                      |
| Security proofs                     | Synthetic transport/auth tests; AST mutants and decoys; nonce/CSP/private headers; production fixture/storage/network checks           |
| Tenancy proofs                      | Unit-tested scoped keys, generation/cancellation and purge behavior; real Laravel isolation NOT TESTED                                 |
| Design proofs                       | Original tokens/primitives and screenshots across five viewport sizes; keyboard behavior and six axe scans                             |
| Performance proofs                  | RSC boundaries, bounded pages, no per-row fetch; measured production login JS and no external requests                                 |
| Tests                               | 172 Vitest; 16 development E2E; 6 production E2E; focused Windows WebKit smoke                                                         |
| Build                               | Frozen install, format, lint, types, production build, audit and peers PASS                                                            |
| Docker                              | Final local image built; non-root healthy boot and 200/404/private-header checks PASS                                                  |
| Known limitations                   | All real backend journeys, unversioned handoff and review limits detailed immediately above                                            |
| Recommended Agent 2 decision target | **REVIEW WITH DECLARED INTEGRATION LIMITATIONS**                                                                                       |
| Push                                | NOT ATTEMPTED                                                                                                                          |

Use the [full closure matrix](F1-closure-matrix.md) and [file inventory](file-inventory.md) for systematic review. F1 ends here; F2 is not started.
