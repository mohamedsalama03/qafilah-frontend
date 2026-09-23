# F3-F Product and Variant media implementation report

**F3-F IMPLEMENTED — all mandatory verification gates passed.** Product and Variant media, public image delivery, isolation and mutation safety are ready for independent Agent 2 certification. Delivery is exactly one local frontend commit above the published baseline, with no push. Independent certification has not yet been performed.

## Scope and authorities

Frontend published baseline and required parent: `fc1b35e0679ab1b5f7e0076c744383216fb97eda`. Backend published authority: `7cd52e549c2a657dc66643b36701356d1d024de5`. Both repositories were verified on clean `main`, with HEAD equal to origin/main and behind/ahead 0/0 before implementation. The canonical backend remains read-only. Real integration uses its exact Git archive and unchanged published Dockerfile, Compose and Nginx configuration in a disposable frontend-owned runtime.

The change adds image management to existing Product and Variant details. It preserves the Qafilah workspace, controls and typography; `DESIGN.md` and `PRODUCT.md` remain unchanged because no new durable visual system is introduced. Pricing, bulk upload, drag/drop reorder, media library, cropping/editing, presigned/direct-storage uploads, video/files, background orphan management and automatic mutation retry remain deferred.

## Exact contracts and permissions

The central registry activates exactly eight media contracts, increasing the total from 27 to 35. `{productMedia}` and `{variantMedia}` are public **MediaAsset UUIDs**, not internal association IDs.

| Method | Published path                                                                              | Success        | Independent grant       |
| ------ | ------------------------------------------------------------------------------------------- | -------------- | ----------------------- |
| GET    | `/api/v1/stores/{store}/catalog/products/{product}/media`                                   | 200 collection | `products.media.view`   |
| POST   | `/api/v1/stores/{store}/catalog/products/{product}/media`                                   | 201 resource   | `products.media.create` |
| PATCH  | `/api/v1/stores/{store}/catalog/products/{product}/media/{productMedia}`                    | 200 resource   | `products.media.update` |
| DELETE | `/api/v1/stores/{store}/catalog/products/{product}/media/{productMedia}`                    | 204, no body   | `products.media.delete` |
| GET    | `/api/v1/stores/{store}/catalog/products/{product}/variants/{variant}/media`                | 200 collection | `products.media.view`   |
| POST   | `/api/v1/stores/{store}/catalog/products/{product}/variants/{variant}/media`                | 201 resource   | `products.media.create` |
| PATCH  | `/api/v1/stores/{store}/catalog/products/{product}/variants/{variant}/media/{variantMedia}` | 200 resource   | `products.media.update` |
| DELETE | `/api/v1/stores/{store}/catalog/products/{product}/variants/{variant}/media/{variantMedia}` | 204, no body   | `products.media.delete` |

The interface also requires `products.view`, `products.media.view` and, for Variant context, `products.variants.view`. Create, update and delete controls independently require their exact write grant. Role names and request-body tenant fields confer no authority. Archived Products have no enabled media writes; inactive Variants retain media editing. Laravel remains final authority.

## Transport, validation and resource handling

The existing central transport now supports explicit `multipartBody` alongside JSON contracts. It snapshots the body before an asynchronous CSRF boundary, keeps browser-generated multipart Content-Type/boundary, credentials, CSRF, cancellation, timeout and normalized session/error handling, and rejects ambiguous JSON-plus-multipart contracts. Existing JSON headers and behavior remain covered by permanent tests. Uploads use the Laravel API origin; there is no direct-storage flow.

Product POST fields are `image`, optional `alt_text`, `position` and `is_primary`; Variant POST excludes `is_primary`. Multipart metadata uses canonical text, decimal position strings and `1`/`0` booleans. Blank optional alt text is transmitted as an empty field for Laravel's nullable normalization. Metadata PATCH remains JSON and cannot replace image bytes.

| Limit      | Contract                                                  |
| ---------- | --------------------------------------------------------- |
| Count      | Product 10; Variant 5                                     |
| File       | JPEG, PNG or WebP; 1–5,242,880 bytes                      |
| Dimensions | Each side 1–8,000 pixels; total at most 40,000,000 pixels |
| Alt text   | Null or canonical single-line text of 1–250 characters    |
| Position   | Integer 0–10,000; default 0                               |

Browser file/type/size and text checks improve feedback; Laravel inspects actual bytes and dimensions and remains authoritative. Resource decoders require the exact envelope, UUID identity, safe path, MIME, bounded metadata, timestamps and Product-only primary flag. Collections reject duplicate public IDs, invalid ordering and invalid Product-primary cardinality. POST accepts a new UUID only inside its captured collection scope; PATCH must return its target UUID; DELETE requires the exact empty 204 contract.

**Validation nuance:** empty PATCH returns 422. A nonempty PATCH repeating existing metadata returns 200 and audits the supplied fields. The form prevents unchanged metadata submission locally; it does not invent an equality-based backend 422. Unknown fields and Variant primary flags remain rejected.

## Product and Variant experience

Compact responsive image grids show safe thumbnails, alt text, position and a Product-only primary badge. Accessible file selection, inline metadata editing, pending feedback, field-error focus, cancellation focus return, delete confirmation, read-only states and explicit outcome review use existing controls. Pending feedback makes no percentage-progress claim.

The first Product upload becomes primary. Selecting another primary sends only `is_primary:true`; there is no unset-primary action. Deletion leaves promotion to Laravel. Variant media never offers a primary flag. After writes, the complete authoritative collection is reread so server ordering and primary decisions are preserved. Duplicate positions are allowed; the browser never reproduces the backend's private association-ID tie-breaker.

## Safe public delivery and CSP

One resolver accepts only `/storage/catalog/{uuid}`, rejects alternate origins, absolute URLs, queries and malformed paths, and resolves against validated `NEXT_PUBLIC_API_ORIGIN`. It never uses the document origin. Unsafe resources fail decoding; invalid rendering configuration produces an unavailable-image state rather than a request.

The only CSP expansion is the validated API origin's `/storage/catalog/` path in `img-src`, alongside existing `'self'` and `data:`. Wildcard API hosts are rejected. Thumbnails use per-image unoptimized rendering and `remotePatterns` remains empty. Production browser evidence verifies intended images render and disallowed API paths/hosts are blocked.

## Mutation and isolation safety

Media queries and controllers bind principal, Store UUID, authority revision, Product UUID, media kind and optional Variant UUID. Existing-asset intentions also bind MediaAsset UUID. Authority checks surround dispatch and publication. Responses arriving after Store, Product, Variant or principal changes cannot publish into a replacement scope or another media kind.

One collection shares a single flight across upload, metadata and delete actions. The flight is installed before notifications; consumed interaction slots prevent double-click, Enter, remount and response-boundary resubmission. No automatic POST/PATCH/DELETE replay exists. Unknown results preserve a payload-free session-memory marker across navigation and authority revisions. It stores no file, submitted metadata, executable request or permission.

Explicit review reloads the current collection and its Product/Variant context. Failed review keeps the lock. Successful review opens a fresh deliberate interaction with no previous file or intent. Current presence, matching metadata or absence is observation only, never proof that an uncertain upload, update or delete committed. Confirmed success remains confirmed when secondary collection/projection refresh fails.

These are in-memory session safeguards, not a browser-restart guarantee. The backend provides no receipt, idempotency key, ETag, version or compare-and-swap. Reviews are not atomic snapshots and later metadata writes can overwrite intervening edits. Upload storage precedes the DB/Audit transaction with best-effort cleanup on failure; deletion commits DB/Audit before best-effort physical removal. A 204 does not guarantee orphan removal after a storage failure. Frontend code does not manage orphans or infer causation from public-file checks.

## Verification and review evidence

A separate critical source review found no actionable defects in transport, strict decoding, permissions, isolation or replay prevention. The final visual review inspected all 22 captures and returned **SHIP** after four Variant unknown-state captures were corrected for scroll position, with no source changes. The one design-detector run returned an empty findings list. All 100 focused axe scans reported zero violations: 22 F3-F and 78 prior-phase scans. These representative checks do not claim full WCAG certification. Independent Agent 2 certification remains a separate next step.

The final real integration evidence is **275/275 passed**: 61 F3-F development cases, 212 prior-phase regressions and two Docker production cases, with zero retries, skips or flaky results. F3-F covers both media kinds, all eight contracts, real public bytes/MIME and rendering, 12 unknown-outcome cases, 16 delayed authority races and exact DELETE focus behavior. All 126 production-source fingerprints, five media harness inputs and nine prior-phase source/copy pairs remained unchanged through the final runs.

Final staging subsequently normalized only the PHP fixture's 122 CRLF endings to LF. The tested bytes and historical hashes are preserved in `fixture-line-ending-normalization/`; both versions parse successfully and their 2,325 PHP tokens have identical types and source lines, with zero non-whitespace token changes. The final verifier reports four byte-identical harness files and one explicitly newline-equivalent fixture. Application source and test assertions did not change.

Fresh frontend image `sha256:8b0611fcb90ea2f935a0cd5b36371f1ef5a324e9e4533c59587b46589b9f9e6f` is healthy and runs as non-root UID 1001. Its bounded 1,359-file scan found no fixture, known-secret, dotenv or browser-source-map matches; all 15 HTTP privacy/CSP checks passed. Six real Product/Variant JPEG, PNG and WebP images retained their exact anonymous public bytes, MIME and browser rendering after actual owned Laravel app and Nginx recreation. Production CSP negative probes blocked both disallowed API paths and an unapproved host.

| Gate / command                                                                      | Current result                                                                                                                             |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile --strict-peer-dependencies`                         | PASS; no dependency changes                                                                                                                |
| `pnpm audit --json` / `pnpm audit --prod --json`                                    | PASS; zero reported vulnerabilities                                                                                                        |
| Full Vitest through `pnpm verify`                                                   | Final 1,880/1,880 passed in 57 test files, including the final environment-origin checks                                                   |
| Architecture suite                                                                  | 297 passed                                                                                                                                 |
| `node tests/media-mutations.mjs`                                                    | 20 operative mutants killed through intended assertions; four controls green; 298 tests per run; 24 protected hashes unchanged; no residue |
| `pnpm verify`                                                                       | PASS: formatting, lint, Next type generation/TypeScript, full Vitest and production build                                                  |
| `pnpm exec playwright test --config playwright.media.config.ts`                     | Final 61/61 passed once each; zero retries, skips, unexpected or flaky results                                                             |
| `pnpm exec playwright test --config artifacts/f3f/playwright.regressions.config.ts` | Final 212/212 passed; zero retries, skips or flaky results                                                                                 |
| `pnpm test:e2e --output=artifacts/f3f/foundation-browser-output`                    | Final 23/23 passed with isolated output                                                                                                    |
| `pnpm test:production --output=artifacts/f3f/foundation-production-output`          | Final 7/7 passed against the final production build with isolated output                                                                   |
| Fresh production image / HTTP privacy and CSP                                       | PASS: healthy, non-root, 1,359-file bounded scan clean, 15 HTTP checks passed                                                              |
| `pnpm exec playwright test --config playwright.media-production.config.ts`          | Final 2/2 passed; real images and public bytes/MIME survived app/Nginx recreation; CSP negatives blocked                                   |
| Owned-runtime cleanup / canonical backend                                           | PASS; all owned resources/private leaves removed, 51 unrelated workloads unchanged; backend clean on main at exact authority, 0/0          |

Prior-phase changes add typed API mocks, exact registry expectations and narrowly authorized media GET reads to traffic guards. They retain older mutation and pricing prohibitions. Harness corrections synchronize existing reads and use deliberate fixture/transport handling without weakening domain assertions. The initial retained regression run passed 211/212 and exposed an initial-read wait race; after correction and reseeding, all 212 passed in a complete fresh run. Preparation failures remain distinct from final complete-run evidence.

An initial root foundation run passed 22 cases and encountered one teardown error when concurrent Docker-browser startup cleared Playwright's shared default output directory (`ENOENT` trace file); no domain assertion failed. The retained `development-preparation.log` and `foundation-preparation` evidence are separate from the final 23/23 passing isolated-output rerun. Repository-standard browser gates now use separate output directories.

## Agent 2 reproduction package

[F3F-integration.md](F3F-integration.md) contains the controlled runtime and reproduction commands. The retained ignored package under `artifacts/f3f/` includes exact backend archive/configuration hashes and mount proof (`backend-runtime-proof.json`), source fingerprints, frozen-install/audit/peer evidence, operative mutation results, sanitized browser traffic, screenshots and focused axe results. Final integration evidence is indexed by `real-integration-summary.json`: `media-results.json`, `regression-results.json`, `media-production-results.json` and `production-public-images.json`. Review evidence includes `finish-review.md`, `design-detect.json`, `docker-review.image.json`, `docker-review.container.json`, `docker-review.image-scan.json` and `docker-review.http.json`. Final root gates are indexed by `final-quality-results.json`, with all three commands exiting zero: `development-final.log`, `verify-final.log` and `production-final.log`. Cleanup and read-only backend proof are recorded in `cleanup-result.json` and `backend-final-state.json`.

Review all eight endpoints and four independent grants; JSON/multipart preservation; public MediaAsset identity and Product/Variant separation; strict path/origin/CSP; primary/order behavior; uncertain committed/uncommitted uploads, updates and deletes; failed/successful review; duplicate and authority-change races; confirmed-success refresh failures; and all prior-phase regressions. Reproduce real-image MIME/bytes and browser rendering checks, including after owned app/Nginx recreation against the published shared media volume. Container recreation evidence does not establish backup or replication guarantees.

Runtime credentials and authenticated browser storage remain private and excluded from the report. Guarded cleanup removed the owned five containers, three volumes, two networks and TLS process; remaining private credential leaves and relevant listeners are empty. All 51 unrelated Docker workloads are unchanged. The protected Enmaa port-3000 application was externally restarted: PID 28228 changed to 18448 at 17:04:41. Our controls never targeted it, and final cleanup preserved PID 18448; its PID was not identical throughout. The canonical backend finished clean on `main` at `7cd52e549c2a657dc66643b36701356d1d024de5`, equal to origin/main, behind/ahead 0/0.

## Exact changed files

The following 62 files are the complete F3-F change, excluding ignored evidence. Final type generation/build returned generated `next-env.d.ts` to its baseline contents automatically; it is not part of the commit. This list matches the reviewed working-tree change set.

- `docs/F3F-implementation-report.md`
- `docs/F3F-integration.md`
- `playwright.media-production.config.ts`
- `playwright.media.config.ts`
- `src/features/auth/components/login-form.test.tsx`
- `src/features/auth/components/scoped-read-revalidation.test.tsx`
- `src/features/inventory/components/product-inventory-feedback.test.tsx`
- `src/features/inventory/contracts.test.ts`
- `src/features/inventory/mutations.test.ts`
- `src/features/media/components/media-form.tsx`
- `src/features/media/components/media-panel.test.tsx`
- `src/features/media/components/media-panel.tsx`
- `src/features/media/contracts.test.ts`
- `src/features/media/contracts.ts`
- `src/features/media/model.test.ts`
- `src/features/media/model.ts`
- `src/features/media/mutations.test.ts`
- `src/features/media/mutations.ts`
- `src/features/media/queries.ts`
- `src/features/media/safety.test.ts`
- `src/features/products/components/product-guidance.test.tsx`
- `src/features/products/components/product-management.test.tsx`
- `src/features/products/components/product-resubmission.test.tsx`
- `src/features/products/components/product-screen.tsx`
- `src/features/products/components/products-screen.test.tsx`
- `src/features/products/contracts.test.ts`
- `src/features/products/mutation-contracts.test.ts`
- `src/features/products/mutations.test.ts`
- `src/features/products/product-guidance.test.ts`
- `src/features/products/product-resubmission.test.ts`
- `src/features/stores/components/store-workspace.test.tsx`
- `src/features/variant-inventory/components/variant-inventory-feedback.test.tsx`
- `src/features/variant-inventory/contracts.test.ts`
- `src/features/variant-inventory/mutations.test.ts`
- `src/features/variant-inventory/safety.test.ts`
- `src/features/variants/components/variants-screen.tsx`
- `src/features/variants/contracts.test.ts`
- `src/lib/api/client.test.ts`
- `src/lib/api/client.ts`
- `src/lib/api/types.ts`
- `src/lib/backend/client.ts`
- `src/lib/backend/contracts.ts`
- `src/lib/env.test.ts`
- `src/lib/env.ts`
- `src/lib/media-url.test.ts`
- `src/lib/media-url.ts`
- `src/proxy.test.ts`
- `src/proxy.ts`
- `tests/architecture-policy.ts`
- `tests/architecture.test.ts`
- `tests/integration/inventory-feedback.spec.ts`
- `tests/integration/inventory.spec.ts`
- `tests/integration/laravel-media-fixtures.php`
- `tests/integration/media-production.spec.ts`
- `tests/integration/media.spec.ts`
- `tests/integration/product-management.spec.ts`
- `tests/integration/products.spec.ts`
- `tests/integration/variant-inventory.spec.ts`
- `tests/integration/variants.spec.ts`
- `tests/media-architecture.test.ts`
- `tests/media-mutations.config.mjs`
- `tests/media-mutations.mjs`

## Commit and final-state handoff

All mandatory verification gates passed. The authorized delivery is exactly one local commit on `main` with subject `feat(dashboard): integrate merchant product media`, directly above `fc1b35e0679ab1b5f7e0076c744383216fb97eda`, without amending, squashing or pushing. The required post-commit frontend state is clean, origin/main unchanged at the published baseline, behind/ahead 0/1. Backend remains unchanged at `7cd52e549c2a657dc66643b36701356d1d024de5`, clean and 0/0.

The committed report cannot include its own commit hash. The delivered candidate, parent, remote authority, branch, divergence and status are recorded after the single commit in `artifacts/f3f/final-git.json` and the final handoff. **Commit: one authorized local child after this report is staged. Push: NOT ATTEMPTED. Review readiness: READY FOR INDEPENDENT AGENT 2 CERTIFICATION.** No unresolved implementation or contract blockers remain.
