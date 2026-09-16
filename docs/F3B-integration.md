# Isolated F3-B Product management verification

The executable backend authority is published commit `6614690a3b24b39f45c7c1b9ed85c20ecb22cbbf`. Its checkout stays read-only. The runtime is built from a fresh Git archive in ignored `artifacts/f3b/runtime/backend-source`, using its existing development Dockerfile and Compose configuration. Existing migrations run only against a new disposable database. Backend source, configuration, middleware, routes, and customer data are not changed.

## Runtime and reproduction

The browser uses `http://localhost:3000`; the isolated backend uses `http://localhost:3842`. The owned Compose project `qafilah-f2-runtime`, database `qafilah_f2_isolated`, and image `qafilah-f2-backend:6614690a` preserve compatibility with the unchanged F2 and F3-A fixture guards. They are separate from the shared Qafilah runtime.

1. Verify the frontend and backend baseline identities. Export only the exact backend revision, excluding untracked files and private environment data.
2. Generate fresh APP_KEY, PostgreSQL, and Redis secrets in the ignored restricted runtime environment file. Build the existing development image. Start only the owned app, nginx, PostgreSQL, and Redis services. Published Host, Origin, CORS, stateful domains, cookie, CSRF, and throttle rules remain in effect.
3. Migrate the isolated database. Seed the unchanged `laravel-fixtures.php`, unchanged `laravel-product-fixtures.php`, then frontend-owned `laravel-product-management-fixtures.php`, copied into the disposable app container's `/tmp`. Each refuses an environment other than local or a database other than `qafilah_f2_isolated`.
4. Copy only generated synthetic browser credentials into `artifacts/f3b/runtime/browser-fixtures.json`, `product-fixtures.json`, and `management-fixtures.json`. Keep permissions restricted and never print them. Private authority identifiers stay inside the disposable container.
5. Run `pnpm exec playwright test --config playwright.product-management.config.ts`. Run the F3-A and F2 regressions through ignored copies whose only differences are fixture and evidence paths, using `artifacts/f3b/playwright.f3a.config.ts` and `artifacts/f3b/playwright.f2.config.ts`. Each owns port 3000. Do not run another development server, build, or type generation concurrently against the same Next output directory.
6. Before a complete rerun, verify Docker project labels and recreate only the named disposable database, then clear only the owned Redis instance and seed again. Permission removal, identity revocation, and Product mutations deliberately change the synthetic database.
7. After all dependent gates finish, remove only the owned project's containers, networks, volumes, and four generated credential files. Preserve sanitized evidence, screenshots, scripts, and the published archive. Never use a global Docker prune.

The ignored runtime folder retains setup, initialization, reset, and cleanup scripts. No fixture data enters application code, production bundles, or the frontend production image.

## Coverage and evidence boundaries

The management suite uses 23 independent synthetic nonowner users. This preserves published login throttles while covering simple and Variant-type draft creation, escaped plain text, nullable SEO clearing, immutable Product type, changed-fields-only PATCH, complete Category replacement and removal, lifecycle transitions, repeated-transition validation, missing grants despite a privileged-looking Role name, create-only access without read grants, and forms without Category read permission.

Permission revocation uses the published permission-removal action after login for `products.create`, `products.update`, and `products.publish`. Subsequent context refresh hides actions; direct same-session browser requests still prove Laravel denial. Foreign Product update/lifecycle requests and foreign Category assignment requests target real synthetic resources in another Store and assert safe `404`/`422` envelopes without foreign data.

Delayed-response scenarios let Laravel actually commit an update, then hold delivery while the browser switches Stores, logs out, or loses identity access. They test client isolation without implying cancellation rolled back server work. Double-click scenarios hold a real mutation response and assert one exact dispatched mutation. Unknown-outcome scenarios let Laravel commit a create, edit, or lifecycle action, then deliberately drop delivery or supply an ambiguous `503` response. Those failures are controlled transport evidence, not claims that Laravel naturally produced the failure. Explicit read reconciliation discovers the committed outcome without automatic mutation replay.

Create, edit, and Archive confirmation surfaces are scanned at 1440, 1280, 1024, 768, and 390 pixels. Keyboard focus, form order, modal focus containment, horizontal overflow, and axe WCAG A/AA tags are checked. Full-page screenshots and desktop/mobile viewport screenshots are retained. This is targeted accessibility evidence, not full accessibility certification.

Sanitized request evidence records methods, synthetic paths, status codes, top-level Catalog body field names, and boolean CSRF/Authorization presence. Traces and video are disabled. Assertions prohibit Bearer headers, unrelated backend surfaces, unsupported mutations, commercial fields, and browser runtime failures. Credential and CSRF values are never included in evidence.

The backend provides no Product version, ETag, expected revision, or idempotency token for these mutations. Changed-field updates limit the write set but do not prevent a later editor overwriting the same fields. A missing Product in the current bounded list cannot prove an uncertain creation failed.

## Results

On 16 September 2026, the complete management suite passed all 23 journeys in 68.8 seconds. The unchanged F3-A suite passed 18 journeys in 55.3 seconds, and the unchanged F2 suite passed 12 journeys in 35.7 seconds. All three runs had zero skipped, flaky, or failing tests. `artifacts/f3b/real-integration-summary.json` summarizes the three underlying Playwright JSON reports.

All 15 create/edit/Archive axe scans across the five widths had zero violations. Keyboard focus remained visible, the modal contained focus, the mobile Product-name input used at least 16px text, and none of the surfaces overflowed horizontally. The duplicate-slug validation state also passed axe. The screenshot directory contains 15 full-page images and six desktop/mobile viewport images. Sanitized request and accessibility evidence is under `artifacts/f3b/browser`.

`artifacts/f3b/regression-harness-integrity.json` records SHA-256 hashes and exact normalized equality for both regression copies. Only fixture/evidence path strings differ from their tracked originals. The final backend fetch and Git proof confirmed `main` at the published revision, zero ahead/behind, and a clean checkout in `artifacts/f3b/backend-final-git.json`.

After the independent production gates passed, guarded cleanup removed only the owned four containers, two networks, two volumes, and four generated credential files. Verification found zero remaining owned resources or credential copies, and no listeners on ports 3842 or 3000. The published archive, sanitized evidence, screenshots, and prior F3-A/L1 evidence were preserved. `artifacts/f3b/cleanup-result.json` records the result. A final backend fetch again confirmed the unchanged published `main` revision, clean checkout, and zero ahead/behind.
