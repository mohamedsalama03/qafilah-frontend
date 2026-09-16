# Frontend F3-B implementation report

## Executive Summary

Merchant Product creation, sparse editing, Category assignment, publish, unpublish and archive are implemented against the frozen Laravel authority. All implementation, real Laravel, regression, production, accessibility and Docker gates passed. The backend is unchanged; no push is authorized or attempted.

## Baselines

- Frontend: `099708075e74b48011016dbde731b2befab2e7d5`, `main`, fetched `origin/main` equal, initially clean, behind/ahead `0/0`.
- Backend: `6614690a3b24b39f45c7c1b9ed85c20ecb22cbbf`, fetched `origin/main` equal, initially clean, behind/ahead `0/0`.
- Backend contract inspection used the published source. Integration uses a frontend-owned exact Git archive and synthetic local data.

## Contracts Activated

Exactly five mutation contracts were added to the existing nine-entry registry:

| Method | Merchant path                                                 | Permission         |
| ------ | ------------------------------------------------------------- | ------------------ |
| POST   | `/api/v1/stores/{store}/catalog/products`                     | `products.create`  |
| PATCH  | `/api/v1/stores/{store}/catalog/products/{product}`           | `products.update`  |
| POST   | `/api/v1/stores/{store}/catalog/products/{product}/publish`   | `products.publish` |
| POST   | `/api/v1/stores/{store}/catalog/products/{product}/unpublish` | `products.publish` |
| POST   | `/api/v1/stores/{store}/catalog/products/{product}/archive`   | `products.update`  |

Evidence is attached to each registry entry. Existing strict Product response decoding is reused. Update/lifecycle response UUIDs must match the requested Product; mismatch is an unknown mutation outcome and never enters cache. Lifecycle requests have no body. Each write uses the central cookie/CSRF transport.

## Permissions

Canonical current-context grants control presentation; Laravel makes the final authorization decision. Create-only merchants can use the direct create route, receive a confirmed-created state, and create another blank product without a Product GET or read-cache publication. Product reads require `products.view`; Category lookup independently requires `categories.view`. Role labels, Product UUIDs, numeric Store IDs and tenant IDs confer no authority.

## Create Product

`/stores/[storeUuid]/products/new` sends only supported fields. The server creates a draft with a null publication timestamp. Simple and unconfigured Variant types are supported at creation; the UI explains that Variant configuration is unavailable. No price, quantity, media, Variant or status mutation is sent.

## Edit Product

`/stores/[storeUuid]/products/[productUuid]/edit` sends only changed canonical fields. Type is immutable. Unchanged values are omitted; null clears SEO. Background focus/reconnection Product refetch is disabled while editing to preserve input; explicit authority checks remain active. Archived Product edits are unavailable, matching the backend's 422 rejection.

## Category Assignment

The existing Merchant Category GET supplies selectable UUIDs only with `categories.view`. At most 20 distinct Categories can be selected. PATCH replaces the whole set; `[]` removes every assignment. Without Category viewing access, the form neither probes Categories nor sends `category_ids`. Foreign assignments are rejected by Laravel.

## Publish / Unpublish

Only draft → published and published → draft are offered. Both use their dedicated endpoints. No PATCH status simulation or repeated invalid transition is offered.

## Archive

Draft/published → archived uses the dedicated endpoint and `products.update`. The accessible confirmation starts focus on Cancel and explains that restoring is unavailable. Private dialog overlays participate in the certified session privacy boundary. Archived is terminal; archive is never described as delete.

## Validation

Payload schemas mirror backend normalization and limits: Unicode NFKC and edge-whitespace canonicalization, code-point lengths, plain text with preserved description line breaks, ASCII lowercase hyphenated slugs, strict booleans, nullable SEO, and distinct bounded Category UUIDs. Validation fields are safely decoded from real Laravel errors. Invalid submissions focus the first field once; typing does not steal focus. Backend validation remains authoritative.

## Unknown Mutation Outcomes

Dispatched network, timeout, ambiguous 5xx, malformed success or mismatched UUID outcomes are never automatically replayed. The UI says the change may have committed and blocks the old command. Product reconciliation is an explicit authoritative GET that replaces editable defaults. Unknown create uses explicit list review; a finite list cannot prove absence. Only after successful review may a separate deliberate action reset to a blank create form; it never reuses an earlier payload. A merchant without Product viewing access must obtain a review from someone with that access. Failed pre-write CSRF preparation remains a known pre-dispatch error.

## Concurrency

There is no backend ETag/version precondition, idempotency key or mutation receipt. Sparse PATCH reduces the fields affected but cannot prevent last-write overwrites. The form explains this limitation. No conflict protection is invented.

## Double Submit

A synchronous controller latch coalesces repeated action calls before React updates. Pending controls are disabled. The memory-only controller belongs to the session, exact authority scope, and Product/create slot, so incidental remounts retain pending and unknown locks.

## Store / Principal Isolation

Each command captures principal, Store UUID, revision and Product UUID when applicable. Scope changes cancel the browser wait and prevent old success/error/cache publication. Cancellation does not establish server rollback. Late responses cannot restore a logged-out workspace or write into another Store's cache.

## Permission Revocation

Context revalidation rotates authority when grants change; affected actions disappear. Direct 403 denials trigger context revalidation and remain authoritative. Create, update and publish revocation are covered separately.

## Foreign Resource Protection

Strict path identity and verified Store scope are used together. Foreign Product update/lifecycle and foreign Category assignment are challenged against actual Laravel. No foreign names/data are displayed.

## Cache Reconciliation

Confirmed responses replace only the matching principal/Store/revision Product detail and invalidate that scope's Product lists. Older matching GETs are cancelled before replacement. Another Store is never touched. Create-only access does not publish Product read cache. Category cache is not globally cleared.

## Error Semantics

401/419 enter the certified bounded scoped-session reconciliation without replaying a write. 403 revalidates authority; 404 remains missing/foreign; 422 maps safe field or lifecycle errors; 429 remains throttling. Sent ambiguous failures remain unknown. Raw backend internals are never displayed.

## UI / UX

Compact existing Qafilah tokens, controls and layout are retained. Forms separate details, SEO and organization; useful actions appear only with current grants. Meaningful unsaved changes warn for document links, Store switching and browser unload. Store switching never submits. Browser history/programmatic navigation is not a new global navigation system.

## Accessibility / Responsive

Unit coverage verifies labels, field focus, pending buttons, dialog Cancel focus, action gating and unsaved navigation. Static Impeccable detector: zero findings. Browser verification passed at 1440, 1280, 1024, 768 and 390 pixels; all 15 representative axe scans reported zero violations. Focus is visible, mobile inputs use at least 16px text, and no horizontal overflow was detected. Twenty-one screenshots cover creation, editing and archive confirmation. No full-WCAG claim is made.

## Architecture / Mutation Evidence

144 permanent architecture assertions protect the exact registry, central transport, authorized call sites, Store-scoped reconciliation, disabled retries and forbidden capability families. Operative unsafe retry/cache mutants are rejected. The preserved scoped-session mutation harness was copied to F3-B artifacts: pristine/comment/string controls GREEN, intentional unlimited same-principal retry RED with four assertion failures, pristine-after GREEN. Source hashes prove no mutation residue.

## Tests

- Frozen install and strict peer dependency check: PASS.
- Formatting, lint and TypeScript: PASS.
- Full Vitest: 797 passed; zero failed/pending (27 files).
- Mutation controller/UI subset: 59 passed.
- F3-A Product component regression: 21 passed unchanged except additional API fixture methods.
- Development browser: 23/23 passed, zero skipped/failed/flaky.
- Production build: PASS, including both new dynamic routes.
- Production browser: 7/7 passed, zero skipped/failed/flaky; create/edit deep links included.
- Docker final gate: PASS.
- Both dependency audits: zero vulnerabilities.

## Real Laravel E2E

F3-B: 23/23 passed in 68.8 seconds, zero skipped, failed or flaky. Fresh frozen backend archive, isolated synthetic fixture groups, no mock-only certification. The suite includes actual writes, 422/403/404 challenges, revocation, scope/identity loss, controlled lost responses and duplicate-submit counts. Unchanged F3-A: 18/18 passed in 55.3 seconds. Unchanged F2: 12/12 passed in 35.7 seconds. Their copied harnesses normalize byte-for-byte to the original assertions; only fixture/evidence paths change. All three suites have zero skipped, failed or flaky tests.

## Production / Docker

Fresh image `qafilah-merchant-f3b:review`, ID `sha256:4e4b1ccea3551f4c241bf132a3a11854c9911456577575a39b2ba760fa505806`, passed with non-root UID/GID 1001, healthy status and zero failing health checks. Thirteen HTTP checks and ten desktop/mobile browser checks verified login/list/detail/create/edit deep links and eight development-route 404s. Anonymous private pages fail closed with no private Catalog reads, writes, credentials, storage or browser runtime errors.

All 1,330 deployed regular files were scanned: 216 application files and 1,114 dependency files, including 28 browser assets. Zero known fixture/secret matches, dotenv files, unexpected application files, browser source maps or map references. All 102 runtime/build inputs matched before build and after verification, fingerprint `5c79cc8745cdf4ebc9eff4ab418d894ea1115b5ed2033e35db6402940861555a`. The owned frontend review container was removed; the image remains. The configured HTTPS URL against the isolated HTTP backend produced the expected controlled SSL-protocol failure, not fake authentication. Successful production TLS authentication is not claimed.

## Backend Read-Only Proof

Final fetched backend identity/status: branch `main`, HEAD and `origin/main` both `6614690a3b24b39f45c7c1b9ed85c20ecb22cbbf`; behind/ahead `0/0`; clean. Sanitized proof is `artifacts/f3b/backend-final-git.json`. No Laravel checkout source modifications were made; fixture setup belongs solely to the isolated frontend-owned runtime.

## Changed Files

- `docs/F3B-integration.md`
- `docs/F3B-report.md`
- `playwright.product-management.config.ts`
- `src/app/(merchant)/stores/[storeUuid]/products/[productUuid]/edit/page.tsx`
- `src/app/(merchant)/stores/[storeUuid]/products/new/page.tsx`
- `src/components/ui/confirmation-dialog.tsx`
- `src/features/auth/components/login-destination.test.ts`
- `src/features/auth/components/login-destination.ts`
- `src/features/auth/components/login-form.test.tsx`
- `src/features/auth/components/scoped-read-revalidation.test.tsx`
- `src/features/products/components/mutation-feedback.tsx`
- `src/features/products/components/product-actions.tsx`
- `src/features/products/components/product-form-screen.tsx`
- `src/features/products/components/product-management.test.tsx`
- `src/features/products/components/product-screen.tsx`
- `src/features/products/components/products-screen.test.tsx`
- `src/features/products/components/products-screen.tsx`
- `src/features/products/contracts.test.ts`
- `src/features/products/mutation-contracts.test.ts`
- `src/features/products/mutation-contracts.ts`
- `src/features/products/mutation-model.test.ts`
- `src/features/products/mutation-model.ts`
- `src/features/products/mutations.test.ts`
- `src/features/products/mutations.ts`
- `src/features/products/queries.ts`
- `src/features/stores/components/store-switcher.tsx`
- `src/features/stores/components/store-workspace.test.tsx`
- `src/features/stores/components/store-workspace.tsx`
- `src/lib/backend/client.ts`
- `src/lib/backend/contracts.ts`
- `src/lib/forms/unsaved-changes.ts`
- `tests/architecture-policy.ts`
- `tests/architecture.test.ts`
- `tests/integration/laravel-product-management-fixtures.php`
- `tests/integration/product-management.spec.ts`
- `tests/production/products.spec.ts`

## Commands Executed

Baseline Git identity/status/fetch checks; frozen backend source inspection; `pnpm install --frozen-lockfile`; `pnpm install --frozen-lockfile --strict-peer-dependencies`; `pnpm format:check`; `pnpm lint`; `pnpm typecheck`; `pnpm exec vitest run --maxWorkers=4 --reporter=json --outputFile=artifacts/f3b/vitest-results.json`; focused Product tests; the copied operative scoped-session harness; `pnpm audit --json`; `pnpm audit --prod --json`; development Playwright; real management Playwright and unchanged F3-A/F2 harness copies; `pnpm build`; production Playwright. Windows uses `corepack pnpm` and the existing local Node runtime. Docker build/run/scan and guarded cleanup are performed by the review harness. Sanitized logs and JSON reports are under `artifacts/f3b/`.

## Commands Failed / Recovered

- Initial file discovery used two outdated paths; located the actual feature paths before editing.
- Prettier's shell glob with route brackets did not match; repository-wide formatting handled the routes.
- Initial lint found an unused destructured type variable; sparse update construction was corrected.
- A temporary inline Node harness-copy command had a quoting error; a native PowerShell text copy recovered it without changing the permanent harness.
- One full-suite run under competing work exceeded the existing one-second read-test wait. The unchanged 21-test suite passed independently; all 797 tests then passed with four workers. No assertion was weakened or skipped.
- Independent review identified Category criteria, stale edit data visibility, create-only access, pre-dispatch outcome classification and validation-focus defects; corrections and focused regressions were applied.
- Browser harness selectors initially treated required-label markers as part of an exact label, expected different archive wording, and queried a form while a deliberately retained Store-picker modal hid it. Selectors/assertions were corrected to the actual accessible controls. A fresh isolated database rerun passed all 23 journeys without skips; no application assertion was weakened.

## Cleanup

Cleanup verified: the four owned backend runtime containers, two networks and two volumes were removed; four exact generated credential files were deleted after absolute-path checks. No owned runtime listeners, containers, networks, volumes or credential files remain. The frontend Docker review container was separately removed. Earlier F3-A/L1 evidence, sanitized F3-B evidence, screenshots, published archive and fresh review image remain. No global prune, shared runtime deletion or push occurred. Evidence: `artifacts/f3b/cleanup-result.json` and `docker-review.cleanup.json`.

## Commit / Parent

The delivered candidate is exactly one local commit with subject `feat(dashboard): integrate merchant product management` and parent `099708075e74b48011016dbde731b2befab2e7d5`. This report belongs to that commit; its own commit hash cannot be embedded in its immutable content. Resolve the exact candidate with `git rev-parse HEAD`; post-commit identity is also recorded in `artifacts/f3b/final-git.json` and the final delivery message. No amend or history rewrite.

## Final Git State

Branch `main`; `origin/main` remains `099708075e74b48011016dbde731b2befab2e7d5`; behind/ahead `0/1`; clean worktree. The exact post-commit checks are retained in `artifacts/f3b/final-git.json`. No push.

## Residual Limitations

No idempotency receipts or optimistic concurrency; uncertain creates cannot be proven absent by a paginated list. Unsaved-change protection covers practical existing navigation rather than every browser history case. Variant configuration, Media, Pricing, Inventory, hard delete and restore remain unimplemented. Local integration and representative accessibility checks do not certify production TLS or full WCAG conformance.

## Agent 2 Review Package

Review this report, `docs/F3B-integration.md`, the implementation diff above the published baseline, permanent contract/architecture/controller/UI tests, and sanitized `artifacts/f3b/` evidence. Reproduce against an exact frozen backend archive with fresh synthetic fixtures. Independent source review resolved its three material findings. The independent screenshot reviewer returned **SHIP for the reviewed visual scope**, covering create/edit/archive at all five widths with no material visual fixes. This is not Agent 2 certification or a full accessibility audit; executable runtime evidence is reported separately above.
