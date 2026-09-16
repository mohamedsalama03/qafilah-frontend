# Frontend F3-A implementation report

Date: 16 September 2026. Agent 1 implementation; independent Agent 2 certification remains pending.

## Executive Summary

Merchant Product list and detail reads are integrated with the certified F2 session, Store, transport, error and query boundaries. Exactly three Merchant GET contracts were added. No Product mutation, Storefront/Platform API, backend change, dependency change, token persistence or fabricated operational data was introduced.

## Baselines

The initial fetched gates passed with both repositories on `main`, clean and at 0 behind / 0 ahead:

| Repository | HEAD and origin/main                       |
| ---------- | ------------------------------------------ |
| Frontend   | `c0c7234a602c133d847b6722b95d7d18fc525e1b` |
| Backend    | `6614690a3b24b39f45c7c1b9ed85c20ecb22cbbf` |

Frontend work is confined to `D:\customers\qafilah\dashboard frontend`. The backend authority is `/home/mohamed/projects/customers/qafilah` in WSL Ubuntu. Its checkout remains read-only; integration uses an isolated Git archive of that exact revision.

## Contracts Activated

| Method | Published path                                      | Capability                    |
| ------ | --------------------------------------------------- | ----------------------------- |
| GET    | `/api/v1/stores/{store}/catalog/products`           | `products.view`               |
| GET    | `/api/v1/stores/{store}/catalog/products/{product}` | `products.view`               |
| GET    | `/api/v1/stores/{store}/catalog/categories`         | Conditional `categories.view` |

The verified registry contains the six F2 contracts plus these three reads. The existing central transport owns credentials, CSRF, origin checks, cancellation and normalized errors. Thin client methods use strict Product/Category decoders. Published routes, request validators, queries, cursor codec, resources, policies and commercial-state loader were inspected at the frozen backend revision. See `backend-contracts.md` and the registry's evidence references.

## Product Resource / Money

The strict Resource accepts only `id`, `name`, `slug`, `description`, `seo_title`, `seo_description`, `status`, `type`, `requires_shipping`, `published_at`, `price`, `quantity`, `availability`, `categories`, `created_at` and `updated_at`. Nested Categories and response envelopes are also validated. Descriptions render as escaped plain text, including literal HTML-like text.

Money remains integer minor units. Formatting splits integer digits: LYD has three decimal places; USD and EUR have two. Null price is explicitly “Price not configured.” Variant prices display “From …”; detail text explains that minimum active-Variant price and aggregate availability may describe different Variants. The synthetic commercial fixture deliberately verifies that distinction. No floating-point money conversion is used.

## Product List

`/stores/[storeUuid]/products` presents Product, Status, Type, Price, Availability, Categories and Updated. Desktop uses a semantic table; mobile uses a compact semantic list. Content comes from the list projection; there are no metrics, images or row-level detail requests. Loading, empty creation window, no matches, safe failure and denied states are distinct.

## Product Detail

`/stores/[storeUuid]/products/[productUuid]` displays identity/status, escaped description, price/availability/quantity, Categories, shipping requirement, SEO and UTC timestamps. The page contains no Create/Edit/Delete/Publish controls. Post-login return paths recognize only the implemented Store overview, Product list and UUID-shaped detail routes; shape validation does not establish authority.

## Search / Filters / Sort

Explicit Apply filters submits a normalized Product-name prefix of 2–80 Unicode characters, optional draft/published/archived status, conditional Category UUID, paired creation/update dates, and one of newest/oldest/name_asc/name_desc. Page-size choices are 10, 25 and 50, with 25 as default. Keystrokes do not dispatch discovery. Unsupported SKU, description, inventory, price and Attribute filters are absent.

## Historical Date Range

The default previous-366-day creation window is visible before and after discovery; successful responses show the actual effective UTC dates. The interface explains how to choose older dates. Both endpoints of each explicit range are required and bounded to 366 days, with microsecond precision preserved in validation. Updated dates still respect the selected creation window. Invalid hidden date fields are revealed and focused.

## Cursor Pagination

Next and Previous pass opaque backend cursors unchanged. No cursor decoding, numeric page or invented total is used. Search, filters, sort, dates and page size reset the cursor; Store scope changes remount the view and clear navigation. Invalid Product cursors offer Restart; invalid Category cursors reset Category discovery. The creation range is pinned by the published cursor contract, which is not a transactional snapshot across requests.

## Permissions

Products navigation and reads require current `context.permissions` to contain `products.view`. Category lookup is mounted only with `categories.view`; absence is never discovered by a speculative 403. Product reads work without Category lookup permission. Role labels, Product UUIDs and tenant identifiers are not used as authority. Laravel authorizes each request.

## Query Isolation

The existing Store keys include principal, Store UUID and scope revision. Product lists additionally include normalized criteria and cursor; details include Product UUID; Category lookups include criteria and cursor. Existing scope cancellation and pre/post-await authority checks reject obsolete responses. No previous Store data is a loading placeholder.

A Catalog 403 removes inactive cached views of the denied capability in the current scope, preventing fresh cached criteria or details from bypassing an authoritative denial. The observed error remains for explicit recovery. Product data is hidden on error or refetch. Category options, selected labels and cursor controls are hidden on error or refetch; retry clears the selection. Tests cover denial followed by transient context-refresh failure and attempts to revisit cached data.

## Store Switch

Real Laravel list and detail journeys verify A → B, including delaying a real A response until B has been selected. A reads are cancelled/isolated and A content disappears before B data. Switching from an A Product detail opens B's Product list instead of reusing A's Product UUID. Context remains the authority for B.

## Foreign Product

Real Laravel returns resource-local 404 for a foreign Product URL. The page offers Back to products and exposes no foreign name, Store, price, status or Categories. The session remains authenticated. Malformed UUID syntax is rejected before dispatch without treating valid UUID syntax as authority.

## Revocation

Real synthetic permission removal followed by context refresh removes Products navigation and private Product content. Changed permission sets, Membership identity or Role identity rotate the existing scope before publishing new context; unchanged authority refresh preserves it. Backend Product denial clears unsafe cached views even when context revalidation fails transiently. Membership 403 and global Identity/session 401/419 semantics remain distinct.

## Error States

401 and 419 use the existing global session lifecycle; 403 initiates Store-context revalidation and hides denied data; 404 stays resource-local; 422 offers safe discovery recovery; 429, 5xx and network failures use distinct normalized messages. Raw backend internals are never rendered. Controlled transport tests cover 429/500/network recovery separately from actual Laravel responses. Logout, session expiry and pagehide/history privacy remain covered.

## Accessibility / Responsive

Real list and detail screenshots and axe scans cover 1440, 1280, 1024, 768 and 390 pixels. All ten width/route scans and representative empty, denied, missing and controlled-error scans recorded zero violations. Keyboard checks cover focus, filters, Product links and pagination. Desktop/mobile screenshots were visually inspected for wrapping, layout and private states. This is targeted verification, not full WCAG certification.

## Performance

List rows consume the existing Product projection. Request assertions reject per-row Product detail, media, Variant and inventory fanout. Category lookup is one conditional paginated query rather than one per row. Explicit filter submission and cancellation avoid search request storms; the default page size is 25. A microtask cancellation check prevents StrictMode's discarded subscription from sending a redundant initial read. No performance benchmark or load-test claim is made.

## Architecture / Mutation Evidence

The permanent architecture suite has 117 passing tests. Protections cover exactly nine verified contracts, the three authorized Product/Category GET routes, no Product mutations, no Storefront/Platform substitution, central transport, scoped keys and Product UUID inclusion, no role/UUID/tenant authority, no Bearer or token storage, and no unsafe Product HTML.

F3 additions include 23 synthetic violation cases, six mutations of actual Product query-key source and seven actual route-suffix mutations. These forbidden source variants are rejected while pristine source passes. The checks are bounded AST policy and regression evidence, not a proof about arbitrary JavaScript.

## Tests

| Gate                                           | Result / evidence                                                          |
| ---------------------------------------------- | -------------------------------------------------------------------------- |
| Frozen install and strict peers                | PASS; lockfile and package manifest unchanged                              |
| Format, lint and typecheck                     | PASS; `format.log`, `lint.log`, `typecheck.log`                            |
| Vitest, including architecture and F1/F2 units | 631 tests in 22 files; `vitest-final.json`                                 |
| Product component privacy/filter tests         | 21; `privacy-regression.log`                                               |
| Development Playwright / F1 regressions        | 23 PASS; `development-playwright.log`                                      |
| Production build and Playwright                | PASS; 7 browser tests, `production-build.log`, `production-playwright.log` |
| Real Laravel F3 and F2                         | 18 and 12; final JSON reports and integration summary                      |
| Full and production dependency audits          | PASS; no known vulnerabilities                                             |
| Fresh Docker production image                  | Build, health, HTTP, browser and asset evidence under `docker/`            |

No dependencies were added or upgraded. Internal implementation peer review found no remaining blocking findings after the two final privacy corrections; independent certification is pending.

## Real Laravel E2E

`tests/integration/products.spec.ts` contains 18 journeys against isolated synthetic Laravel data. Coverage includes nonowner Product reads, zero results, more than one cursor page, next/previous, page size, prefix/status/Category/sort/date queries, simple and Variant commercial projections, no Category capability, no Product capability, same-session revocation, foreign 404, delayed Store switch, Membership denial, Identity suspension, expiry/logout/history privacy, safe transport failures, and five-width keyboard/axe checks.

The 12 existing F2 browser assertions also pass. Their source was unchanged; an ignored harness copy changes only evidence output location, with normalized-copy equality recorded. Request evidence records zero Catalog writes, zero Authorization headers and zero runtime errors. Read `F3-integration.md` for setup, synthetic controls and exact evidence limits.

## Production Build / Docker

Local production build and production Playwright verify the final source, including both Product deep-link forms. The fresh review image is `qafilah-merchant-f3a:review`; its final content ID and runtime-source fingerprint are recorded in `artifacts/f3a/docker/image.json` and the source manifests.

Final image ID: `sha256:bc92d892e12c3d90fb5a1ecde97a6d5b85b4cdff74d0c03fa3df41b018372977`. Final 93-file input fingerprint: `98962624b840207305e9350f9b41d04b3601064b3a3e63cb2d041f4157ea5fb0`.

Docker checks passed: UID/GID 1001, healthy status, no mounts or sensitive environment keys, 11 HTTP checks, and six desktop/mobile browser checks. Login and Product shells are served; eight development routes return 404. Checks cover no-store/noindex policies, CSP nonces, safe private boundaries, and a bounded scan of 181 final application files including 27 browser assets, with no detected fixture markers, known secret patterns, dotenv files or browser source maps.

The configured Docker API uses HTTPS while the isolated local backend serves HTTP and is subsequently removed during cleanup. Its browser checks establish controlled TLS/network failure and packaging, not successful production TLS authentication. Real authenticated Laravel E2E is separately verified on the published local HTTP topology. The image remains available for Agent 2; the owned review container is removed. The final rebuild also includes the production form of Next's generated type declaration, so the complete 93-file input fingerprint matches the delivered worktree.

## Backend Read-Only Proof

The backend checkout was never edited. Existing migrations and synthetic fixture controls ran only in the frontend-owned archived runtime and disposable database. Final fetch passed: branch `main`, HEAD/origin `6614690a3b24b39f45c7c1b9ed85c20ecb22cbbf`, 0 behind / 0 ahead, empty short status and empty diff check. Sanitized proof is retained in `artifacts/f3a/backend-final-git.json`.

## Changed Files

- New routes: `src/app/(merchant)/stores/[storeUuid]/products/page.tsx` and `products/[productUuid]/page.tsx`.
- New Product feature: `src/features/products/model.ts`, `model.test.ts`, `contracts.ts`, `contracts.test.ts`, `queries.ts`, and `components/{product-filters,product-screen,product-shared,products-screen}.tsx` plus `products-screen.test.tsx`.
- Existing integration: `src/lib/backend/{contracts,client}.ts`, `src/lib/stores/controller.ts` and its test, Store switcher/workspace and workspace test, auth login destination and its new test, and login-form test fixture.
- Architecture: `tests/architecture-policy.ts` and `tests/architecture.test.ts`.
- Browser/integration: `playwright.products.config.ts`, `tests/integration/{products.spec.ts,laravel-product-fixtures.php}`, `tests/production/products.spec.ts`.
- Documentation: `docs/backend-contracts.md`, `docs/F3-integration.md`, and this report.

Generated local evidence remains ignored. Package manifest, lockfile, Dockerfile and backend source are unchanged. Final staged names are recorded with the Git evidence.

## Commands Executed

Commands ran from the frontend unless explicitly addressed to the read-only WSL backend. PowerShell prepended the existing Corepack shim directory only to test-process PATH when Playwright needed `pnpm`.

```text
git fetch --prune origin
git branch --show-current
git rev-parse HEAD
git rev-parse origin/main
git rev-list --left-right --count origin/main...HEAD
git status --short
corepack pnpm install --frozen-lockfile --strict-peer-dependencies
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm exec vitest run --reporter=json --outputFile=artifacts/f3a/vitest-final.json
corepack pnpm exec vitest run src/features/products/components/products-screen.test.tsx
corepack pnpm test:e2e
corepack pnpm build
corepack pnpm test:production
corepack pnpm exec playwright test --config playwright.products.config.ts
corepack pnpm exec playwright test --config artifacts/f3a/playwright.f2.config.ts
corepack pnpm audit
corepack pnpm audit --prod
corepack pnpm list --depth 0
node node_modules/prettier/bin/prettier.cjs --write <changed files>
git diff --check
git commit -m "feat(dashboard): integrate merchant product catalog reads"
git rev-parse HEAD^
git status -sb
git log -1 --format="%H%n%P%n%s"
```

Frontend-owned archived-runtime setup/reset/cleanup and Docker build/browser/asset scripts, their sanitized outputs, and input fingerprints are retained under `artifacts/f3a/runtime` and `artifacts/f3a/docker`. No force, amend, backend commit or push command is used.

## Commands Failed / Recovered

- Docker Desktop was stopped; normal hidden startup restored the engine. No socket repair or factory reset was needed.
- Playwright initially could not resolve `pnpm`; the existing Corepack shims were added to the process PATH.
- A Windows shell quoting failure for Prettier paths was recovered by invoking its Node entry point directly.
- A generated Next type-file race during concurrent development/type checking was recovered by stopping the test server before final type generation/build. Test typing errors were fixed before final checks.
- Real deep-link login exposed the F2 allowlist's missing Product routes; the allowlist was extended only to the two implemented route forms. The old negative fixture now targets the still-unimplemented create route.
- Fixture seeding used the wrong commercial column name once; the transaction rolled back, and the frontend-owned fixture was corrected to the published `currency_code` schema.
- A Store-region selector was corrected to use the existing Store UUID boundary. Independent synthetic readers avoided consuming one account's unchanged five-login-per-minute allowance.
- The logout assertion was corrected from 204 to the published 200 StatusResource; fresh complete suites passed afterwards.
- Final review exposed retained Category selection and cross-criteria cached Product data after denial plus transient context failure. Both were fixed, permanent regressions added, and final runtime-dependent gates rerun.
- Automatic review rejected a combined cleanup command and a computed-path deletion loop before execution. The separately guarded Compose script and four preverified absolute PowerShell literal paths completed cleanup; no blocked action remains.

No failure required changing Laravel contracts, middleware, throttles or shared data. Superseded failed evidence is retained separately from the final passing reports.

## Cleanup

Cleanup completed for the owned `qafilah-f2-runtime` integration project: four containers, two networks and two volumes were removed after verifying project labels. Four exact generated credential files were removed using preverified absolute literal paths. Container-only controls and credentials disappeared with the disposable containers. `artifacts/f3a/cleanup.json` records zero remaining owned services, volumes, networks, credentials or private fixture copies. The separate Docker review container was also removed. No global Docker prune was used. Sanitized logs, screenshots, source/archive evidence and review images are retained.

## Commit / Parent

All mandatory gates passed. Delivery uses exactly one local commit with subject `feat(dashboard): integrate merchant product catalog reads`, directly above `c0c7234a602c133d847b6722b95d7d18fc525e1b`. This tracked report cannot embed its own containing commit hash without a circular self-reference. The actual final commit/parent are returned to the user and recorded in ignored final Git evidence. No amend or push is performed.

## Final Git State

Delivered state is verified after the single commit: frontend `main`, origin/main at `c0c7234a602c133d847b6722b95d7d18fc525e1b`, exactly one local child, `origin/main...HEAD` count `0 1`, clean worktree. Backend remains at the published authority, clean, with count `0 0`. Final command output is saved in `artifacts/f3a/final-git.json`. Push is not attempted.

## Residual Limitations

- Independent Agent 2 certification remains pending.
- Production TLS authentication is not certified by the Docker topology; authenticated integration evidence uses the published local HTTP setup.
- Browser checks use Chromium and representative sizes/states; axe is not full WCAG certification, and synthetic pagehide events do not certify every browser's BFCache behavior.
- Controlled 429/500/network failures are explicitly distinguished from actual Laravel errors. Cursor reads are not a transactional snapshot. The image scan checks known patterns rather than guaranteeing universal secret detection.
- This phase intentionally provides read-only Product list/detail and conditional Category lookup; no Product mutation workflow is activated.

## Agent 2 Review Package

Start with this report, `backend-contracts.md` and `F3-integration.md`. Review the single baseline-to-HEAD diff, the permanent 117-test architecture policy, Product parser/model tests, the 21 component tests, the 18 real Product journeys and unchanged F2 assertions, and the production deep-link test. Local evidence is under `artifacts/f3a/`: final Vitest and integration JSON, development/production logs, browser screenshots and axe/request records, Docker image/health/HTTP/browser/asset evidence, source fingerprints, cleanup evidence and final Git identity. Ignored evidence is available in this workspace; a fresh clone can regenerate it using the tracked integration guide and fixture controls. The retained review image allows independent packaging inspection.
