# F3-E Variant inventory implementation report

**F3-E IMPLEMENTED — ready for independent review.** All required gates passed. The backend and published history remain unchanged; delivery is one local frontend commit with no push.

## Scope and authority

This change adds merchant Variant inventory viewing and absolute quantity replacement within the existing Variant detail surface. Frontend authority and required parent: `3b828756be8dd11e0dfdfc0d8b384a57f58fc135`. Published backend authority: `6614690a3b24b39f45c7c1b9ed85c20ecb22cbbf`.

The canonical backend is read-only; real verification uses its exact archive in a disposable frontend-owned Laravel runtime. F3-E is limited to Variant inventory. `DESIGN.md` and `PRODUCT.md` remain unchanged; this report is the documentation boundary because the feature establishes no new durable visual system.

Deferred scope remains Product/Variant pricing and media, Locations/Warehouses, stock adjustments/history, bulk inventory, reservations/backorders, unlimited stock and all F3-F work. F3-C Simple Product inventory is not reimplemented.

## Published contracts and behavior

Exactly two contracts are activated, both at `/api/v1/stores/{storeUuid}/catalog/products/{productUuid}/variants/{variantUuid}/inventory`:

| Method | Operation                                      | Access                                                                          |
| ------ | ---------------------------------------------- | ------------------------------------------------------------------------------- |
| GET    | Read current Variant inventory                 | `products.variants.view`, retaining the frontend's `products.view` prerequisite |
| PATCH  | Replace quantity with `{ "quantity": number }` | `products.variants.inventory.update`, retaining both read prerequisites         |

Role names and unrelated Product, Variant or Simple Product inventory grants confer no authority. Both responses require the strict successful envelope and `{ quantity, availability }` resource, including consistent quantity/availability and a UUID request ID. The response contains no resource identity or mutation receipt; correctness depends on the requested nested identity and current scope.

Frontend writes contain only a JSON integer from 0 through 2,000,000,000. Laravel additionally accepts coercible integer strings; the form deliberately sends numbers. Null is readable as **Not configured / unavailable**, zero as **Out of stock**, and positive quantities as **In stock**. Null writes, invalid values, extra fields and unchanged quantities are rejected; unchanged quantity returns 422. Inventory updates remain available for inactive Variants. Archived Products remain readable but cannot be changed.

Variant Product quantity always remains null. Parent availability uses the backend's maximum configured quantity among active Variants: no configured active stock is unavailable, maximum zero is out of stock, and a positive maximum is in stock. Inactive stock does not contribute. Availability is independent of pricing, including unpriced active stock.

## Implementation and interaction safety

The dedicated feature contains strict contracts, parsing/labels, scoped queries, a mutation controller and the Inventory panel. The shared adapter registers only the two new endpoints; the existing Variant detail embeds the panel and preserves confirmed inventory feedback through recoverable projection failures.

Query identity includes principal, Store, authority revision, Product UUID and Variant UUID. Authority is checked before dispatch and after response. Aborted or superseded reads/writes cannot publish into a replacement scope; invalid identity or authority fails closed. Successful updates publish the confirmed inventory and invalidate only the originating Variant and Product projections.

Submission is single-flight and consumes its local interaction slot. Mutation retries are zero. Lost responses, malformed success or other uncertain outcomes lock further submission; no timer, remount, repeated Enter, double-click or background refresh replays the request. Explicit review loads current inventory, Product and Variant before a fresh interaction becomes available. Failed review preserves the lock. Matching current quantities never attribute success to an earlier uncertain write.

Controllers survive component remounts in session memory. A separate quantity-free marker, keyed by principal/Store/Product/Variant, survives Store A→B→A and authority revisions. It carries no payload, response, permission or executable request into the new scope. Both mechanisms are in-memory session safeguards, with no browser persistence; they do not claim protection across a full browser/session restart.

A confirmed PATCH remains successful when a later cache or Product/Variant projection refresh fails. The interface reports the refresh problem and requires explicit fresh review before another change. Unknown outcomes label displayed observations **Last known quantity** and **Last known availability**.

The published backend serializes replacement writes and Audit persistence within a transaction; Audit failure rolls back the write. It provides no idempotency key, receipt, ETag, version, expected quantity, compare-and-swap or operation-status endpoint. Fresh review is not an atomic snapshot or concurrency guarantee: a later absolute replacement can overwrite intervening changes.

## Design and verification status

The panel retains the incumbent quiet, compact workspace, semantic colors, native typography, logical alignment and existing controls. Desktop/mobile states, keyboard flow, field-error focus and pending/success/review feedback were inspected. Two findings were fixed and reviewed for shipping: desktop input/button alignment and explicit “Last known” labels during uncertainty. Focused axe evidence covers 19 scans with zero violations; this is not a complete accessibility audit.

A separate read-only production-source review found no actionable issues in transport, permissions, scoped publication, replay prevention, explicit review or parent projection handling. This implementation review does not replace independent certification. Commerce deduction evidence invokes Laravel's published inventory deduction port in the isolated runtime; it does not claim coverage of an entire checkout flow.

| Gate / command                                                                      | Result                                                                                                               |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `pnpm exec vitest run --reporter=json --outputFile=artifacts/f3e/vitest.json`       | 1,556 passed; includes 246 architecture tests                                                                        |
| `node tests/variant-inventory-mutations.mjs`                                        | 13 mutants killed; four controls green; 148 tests per run; 15 source/test/tool hashes unchanged; no mutation residue |
| `pnpm verify`                                                                       | PASS: formatting, lint, TypeScript, 1,556 tests in 49 files and production build                                     |
| Focused panel and feedback component tests                                          | 30 passed after final visual fixes                                                                                   |
| `pnpm exec playwright test --config playwright.variant-inventory.config.ts`         | Final 39 passed after all fixes                                                                                      |
| `pnpm exec playwright test --config artifacts/f3e/playwright.regressions.config.ts` | 173 passed in the complete fresh rerun; zero skips, retries or flaky cases                                           |
| `pnpm test:e2e`                                                                     | 23 passed; zero retries or skips                                                                                     |
| `pnpm test:production`                                                              | 7 passed against the final production build; zero retries or skips                                                   |
| Runtime cleanup                                                                     | PASS: owned resources removed; unrelated workloads preserved                                                         |

Previous-phase test changes are limited to typed API mock additions and registry-count expectations, except the new Variant panel integration coverage and architecture extensions. The F3-D browser suite allows exactly the new nested inventory GET while retaining inventory-write, pricing and media prohibitions. No legacy production feature logic changes beyond the specified Variant detail integration and shared adapter/registry additions.

The initial retained regression run passed 172/173; one F3-A page-size test observed the still-pending initial 25-row response instead of the requested 10-row response. Its wait is now synchronized to the initial read before changing page size, preserving all assertions. The failed-run evidence is retained separately from the complete 173/173 passing fresh rerun. All 212 final Laravel cases passed on their first attempt with no skips, retries or flaky results.

Reproduction and isolation controls are documented in [F3E-integration.md](F3E-integration.md). Ignored evidence lives under `artifacts/f3e/`: `vitest.json`, `variant-inventory-mutations/results.json`, `variant-inventory-results.json`, `regression-results.json`, `backend-runtime-proof.json`, `regression-harness-integrity.json`, `real-integration-summary.json`, `verify-final.log`, `foundation-final.log`, `production-final.log`, `browser/` and `screenshots/`. Cleanup evidence is at `cleanup-result.json`: no owned runtime resources or generated credentials remain; all 51 pre-existing containers and the protected port-3000 process are preserved. Exact post-commit Git identity is recorded in `final-git.json`. Evidence excludes credentials and authenticated browser storage.

## Exact changed files

These 43 files are the complete F3-E change. Ignored evidence is excluded. The final type generation/build restored `next-env.d.ts` to its published contents; it is not part of this commit.

- `docs/F3E-implementation-report.md`
- `docs/F3E-integration.md`
- `playwright.variant-inventory.config.ts`
- `src/features/auth/components/login-form.test.tsx`
- `src/features/auth/components/scoped-read-revalidation.test.tsx`
- `src/features/inventory/components/product-inventory-feedback.test.tsx`
- `src/features/inventory/contracts.test.ts`
- `src/features/inventory/mutations.test.ts`
- `src/features/products/components/product-guidance.test.tsx`
- `src/features/products/components/product-management.test.tsx`
- `src/features/products/components/product-resubmission.test.tsx`
- `src/features/products/components/products-screen.test.tsx`
- `src/features/products/contracts.test.ts`
- `src/features/products/mutation-contracts.test.ts`
- `src/features/products/mutations.test.ts`
- `src/features/products/product-guidance.test.ts`
- `src/features/products/product-resubmission.test.ts`
- `src/features/stores/components/store-workspace.test.tsx`
- `src/features/variant-inventory/components/variant-inventory-feedback.test.tsx`
- `src/features/variant-inventory/components/variant-inventory-panel.test.tsx`
- `src/features/variant-inventory/components/variant-inventory-panel.tsx`
- `src/features/variant-inventory/contracts.test.ts`
- `src/features/variant-inventory/contracts.ts`
- `src/features/variant-inventory/model.test.ts`
- `src/features/variant-inventory/model.ts`
- `src/features/variant-inventory/mutations.test.ts`
- `src/features/variant-inventory/mutations.ts`
- `src/features/variant-inventory/queries.ts`
- `src/features/variant-inventory/safety.test.ts`
- `src/features/variants/components/variants-screen.test.tsx`
- `src/features/variants/components/variants-screen.tsx`
- `src/features/variants/contracts.test.ts`
- `src/lib/backend/client.ts`
- `src/lib/backend/contracts.ts`
- `tests/architecture-policy.ts`
- `tests/architecture.test.ts`
- `tests/integration/laravel-variant-inventory-fixtures.php`
- `tests/integration/products.spec.ts`
- `tests/integration/variant-inventory.spec.ts`
- `tests/integration/variants.spec.ts`
- `tests/variant-inventory-architecture.test.ts`
- `tests/variant-inventory-mutations.config.mjs`
- `tests/variant-inventory-mutations.mjs`

## Commit handoff

Subject: `feat(dashboard): integrate merchant variant inventory`. Delivery is exactly one local commit on `main`, directly above frontend authority `3b828756be8dd11e0dfdfc0d8b384a57f58fc135`, without amending or pushing. The committed report cannot contain its own hash; the exact delivered frontend authority, parent, remote authority, branch, divergence and status are recorded after commit in `artifacts/f3e/final-git.json` and the final handoff message.

The final repository audit requires frontend `main`, clean worktree, origin/main unchanged, behind/ahead 0/1, and the canonical backend clean at `6614690a3b24b39f45c7c1b9ed85c20ecb22cbbf` with behind/ahead 0/0. All 43 intended files were reviewed; application and operative mutation inputs match the tested hashes. No unresolved implementation or contract blockers remain. Independent certification is the next step; no deferred functionality has started.
