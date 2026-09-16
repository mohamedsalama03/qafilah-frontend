# Isolated F3-A Product integration verification

The backend authority is published commit `6614690a3b24b39f45c7c1b9ed85c20ecb22cbbf`. Its checkout remains read-only. Integration uses a fresh Git archive under ignored `artifacts/f3a/runtime/backend-source`, its existing development Dockerfile and Compose configuration, and a new disposable database. No backend HTTP test routes, configuration changes, migrations, or source edits are introduced.

## Verified results

On 16 September 2026, the final F3 suite passed all 18 journeys in 54.3 seconds, with zero skipped, flaky, or failing tests. The unchanged F2 assertions passed all 12 journeys in 36.9 seconds. The F2 run used an ignored harness copy changing only its evidence output directory; `artifacts/f3a/f2-harness-integrity.json` records the source hash and normalized-copy equality.

`artifacts/f3a/integration-results.json` and `artifacts/f3a/f2-integration-results.json` contain the final results. All ten list/detail axe scans at the five requested widths had zero violations, as did the representative no-results, denied, missing-Product, and controlled-failure scans. Screenshots and sanitized request evidence are retained under `artifacts/f3a/browser`; desktop/mobile list viewport images supplement the full-page captures.

## Runtime and reproduction

The frontend browser origin is `http://localhost:3000`; the isolated backend is `http://localhost:3842`. The owned Compose project is `qafilah-f2-runtime`, with database `qafilah_f2_isolated` and backend image `qafilah-f2-backend:6614690a`. These names intentionally preserve compatibility with the certified F2 fixture control and regression suite. They are distinct from the shared Qafilah project and database.

1. Verify both required published Git baselines and clean worktrees. Archive only the exact backend revision into the frontend artifact directory. Never copy backend `.env`, credentials, or untracked files.
2. Generate new random APP_KEY, database password, and Redis password into an ignored, restricted environment file. Build the snapshot's existing `development` target. Start only the project's PostgreSQL, Redis, app, and nginx services using the published Compose file and a frontend-owned app-image override. HTTP port and database name differ from defaults; CORS, Host, Origin, stateful domains, cookies, and CSRF rules remain unchanged.
3. Execute existing migrations only against that owned database. Copy `tests/integration/laravel-fixtures.php` and `tests/integration/laravel-product-fixtures.php` into the disposable container's `/tmp`; seed F2 first, then F3. Both controls refuse a nonlocal environment or any database other than `qafilah_f2_isolated`. The F3 seed also refuses preexisting F3 users.
4. Copy `/tmp/f2-browser.json` to ignored `artifacts/f2/runtime/browser-fixtures.json`, and `/tmp/f3-browser.json` to ignored `artifacts/f3a/runtime/product-fixtures.json`. These contain generated synthetic credentials: restrict their access, never print them, and delete them after testing. Private authority identifiers stay inside the container.
5. Run `pnpm exec playwright test --config playwright.products.config.ts` for F3, and `pnpm exec playwright test --config playwright.integration.config.ts merchant.spec.ts` for F2. Each owns localhost:3000 and refuses an existing server. Do not run development and production builds concurrently in the same Next output directory.
6. For a complete rerun, verify exact Compose project labels, then recreate only the named disposable database and clear only the owned Redis instance before migrating and seeding again. Revocation and identity tests intentionally alter synthetic authority. A failed fixture transaction rolls back before reseeding.
7. After all gates, remove only this Compose project's containers/networks/volumes and generated credentials. Preserve sanitized JSON evidence and screenshots under `artifacts/f3a/browser`. No global Docker prune or backend deletion is appropriate.

The executed setup, initialization, reset, and cleanup controls are retained in ignored `artifacts/f3a/runtime`. The tracked PHP control uses existing published fixture helpers, permission-removal and membership actions, and synthetic model records satisfying the published schema. Fixture data never enters the frontend application, production image, or browser bundles.

## Coverage and evidence limits

The Product suite exercises real Sanctum and Merchant Catalog requests for a nonowner reader, zero Products, multiple cursor pages, next/previous navigation, name-prefix search, status/Category sorting, historical creation and updated windows, simple commercial data, independent active-Variant aggregates, unconfigured price, and plain-text description rendering. Additional journeys cover permissions absent before requests, same-session Product grant removal, backend denial, foreign Product 404, delayed A response during Store B selection, detail-to-list Store switching, Membership 403, Identity/session 401, logout, and page-history privacy.

Independent browse journeys use separate synthetic nonowner identities sharing the same fixture Stores and permission Roles. This avoids consuming a single account's login quota during a rapid suite; the published login and Catalog throttles are not changed or cleared between tests.

The cursor-error test changes only the outgoing cursor to invalid text; Laravel produces the actual `422` envelope. The Store-switch test delays a real Laravel response without fabricating its contents. The pagehide test dispatches lifecycle events to inspect the synchronous privacy boundary, without claiming every browser uses BFCache. Session expiry is represented by removing the browser's session cookie while retaining stale CSRF state; Laravel supplies the real unauthenticated result. The F2 regression separately verifies real `419` from a missing CSRF token.

A separately named controlled transport-failure journey supplies `429`/`500` envelopes and a failed connection after real authentication, then recovers using real Product responses. It verifies safe error rendering and recovery; those supplied statuses are not presented as naturally generated backend failures.

Synthetic Variant data deliberately gives the cheapest active Variant zero stock and a different active Variant positive stock. An inactive Variant has a cheaper price and more stock. The Product projection must show the active minimum price and independently derived availability; it must not imply those belong to the same Variant.

Request evidence retains only synthetic paths, methods, status codes, and whether an Authorization header existed. Traces/video are disabled to avoid credential/session capture. Assertions reject Catalog writes, Storefront/Platform requests, Bearer headers, per-row detail/commercial/media calls, and browser runtime errors.

Representative list/detail scans and screenshots cover 1440, 1280, 1024, 768, and 390 pixels, plus keyboard focus and Product-link activation. Permission, missing-Product, and no-results states receive axe scans. This is targeted accessibility evidence, not full WCAG certification.

Production deep-link tests run separately with the production build and assert private documents fail closed to the sign-in boundary, maintain no-store/noindex policies, and contain no synthetic Product data. The Docker review checks production packaging independently. Successful real authentication is verified against the published local development HTTP topology; no production HTTPS/CORS/cookie bypass is supplied.
