# F3-B resubmission integration verification

The backend remains published revision `6614690a3b24b39f45c7c1b9ed85c20ecb22cbbf`. A successful fetch and clean `main` proof are retained in `artifacts/f3b-remediation/backend-baseline-git.json`. The frontend candidate starts at `b669c968ca8535475c4f0a9f06cbdc12515b2729`, directly above published `099708075e74b48011016dbde731b2befab2e7d5`.

## Isolated runtime

WSL guest command entry returned `Wsl/Service/0x8007274c` before Git executed. Native Windows Git over the WSL UNC path successfully fetched and verified the same backend checkout, and native Docker reached the existing engine. No WSL shutdown, service restart, or shared workload termination was attempted. Runtime preparation uses native PowerShell and Docker rather than changing the backend environment to work around that host entry failure.

The ignored `artifacts/f3b-remediation/runtime` directory contains a fresh exact Git archive, the unchanged published Compose file and development Dockerfile, frontend-owned setup/initialization/reset controls, and generated restricted secrets. Only the `qafilah-f2-runtime` app, nginx, PostgreSQL, and Redis services are started, using database `qafilah_f2_isolated` and HTTP port 3842. The names preserve the certified fixture guards and are separate from shared workloads. Published Host, Origin, CORS, session, CSRF, and throttle rules remain unchanged.

The unchanged F2, F3-A, and F3-B fixture controls seed their existing synthetic users. `tests/integration/laravel-product-resubmission-fixtures.php` then seeds 39 independent synthetic nonowner identities, each with its own Store and draft/published Products. Independent identities preserve the published login limit during rapid browser tests. The extra create-only identity proves the explicit blank Create-another flow without inventing Product-read authority. All fixture controls refuse any nonlocal environment or database other than the named disposable database.

Five generated credential files must be removed after dependent gates finish: `secrets.env`, `browser-fixtures.json`, `product-fixtures.json`, `management-fixtures.json`, and `resubmission-fixtures.json`. Private fixture copies live only inside the disposable app container. Credentials, cookies, and CSRF values are not printed or included in retained evidence.

## Permanent response-boundary tests

Run `pnpm exec playwright test --config playwright.product-resubmission.config.ts`. The suite owns localhost:3000 and refuses an existing server; other development servers, builds, and type generation must not concurrently use the same Next output directory.

Thirty journeys exercise Publish, Unpublish, Create, Save, and Archive at requested click intervals of 0, 50, 120, 200, 300, and 450 milliseconds. Each uses two real pointer activations at the initiating button's original coordinates, with the second activation carrying the native double-click count. Laravel responses arrive naturally. Evidence records the actual click interval and whether the first HTTP response arrived before the second click. The test does not assume that a 120ms interval exceeds backend response latency; the 450ms representative for every operation must actually cross the response boundary.

Each sequence asserts exactly one dispatched Catalog mutation and reads the authoritative Product afterward. Publish starts from draft and ends published with zero Unpublish requests; Unpublish starts published and ends draft with zero Publish requests. Create, Save, and Archive similarly assert one request, correct final state, and no duplicate-slug or no-op validation residue.

Two additional Create/Save journeys receive the actual `201`/`200` response, hold only the subsequent frontend detail-navigation response, then press Enter a second time. The completed form must have no remaining submit control and no second write. Two more journeys deliberately choose Create another or Start a new edit while the older detail navigation is held; newly entered data must survive release of that old navigation. Another journey holds both the older navigation and the new edit's authoritative GET, then navigates to Overview and releases both responses. Neither delayed completion may override the newer destination.

Three future-action journeys prove that explicit lifecycle review permits a later opposite operation, a fresh edit permits a new sparse PATCH, and Create another opens an empty form accepting a different Product. Keyboard activation of Review product actions must move focus to the neutral action group. Confirmed Publish, Create, and Save panels receive desktop/mobile axe scans and screenshots. These scans are targeted accessibility evidence, not full certification.

An additional independent journey reviews a successful Publish, navigates away, and updates the Product name through a separate authenticated HTTP client. The existing Refresh product action obtains the authoritative new resource while preserving the established 30-second read-cache policy. Subsequent client navigation to Edit must show that fresh name. Saving a different field must send only that field and preserve the external name, rather than prefer an older retained mutation response over the authoritative read.

Input intervals and held test navigation responses challenge the application state machine; they are not application debounce logic. Mutation requests are never artificially delayed in these tests. Sanitized evidence retains only synthetic paths, methods, status codes, timestamps, final synthetic Product IDs, and boolean header presence. Playwright traces and video remain disabled.

## Existing regressions

Ignored copies of the F3-B, F3-A, and F2 suites preserve all existing assertions. Only fixture/evidence paths and the fixture-control transport change from `wsl docker exec` to native `docker exec`. The permanent tracked F3-B lifecycle journey adds the newly required explicit Review product actions step after confirmed Publish and Unpublish; its prior backend, status, denial, and request assertions remain intact. F3-A and F2 tracked tests are unchanged. The copied harnesses preserve all earlier artifact directories. `prepare-regressions.ps1` compares each tracked test against candidate `b669c968`, allowing only the two added read-intent steps, and records original Git blob IDs and current SHA-256 hashes in the integrity evidence.

The regression suite continues to cover unknown mutation outcomes without automatic replay, foreign Products and Categories, permission revocation, Store switching, logout and principal changes, sparse PATCH, Category replacement, Archive, Product reads, and bounded session reconciliation. A complete rerun recreates only the guarded disposable database and owned Redis state before reseeding.

## Reproduction commands

From the frontend root in PowerShell, with Node 24 and pnpm 11 available:

```powershell
& ./artifacts/f3b-remediation/runtime/setup.ps1
& ./artifacts/f3b-remediation/runtime/initialize.ps1
& ./artifacts/f3b-remediation/prepare-regressions.ps1
pnpm exec playwright test --config playwright.product-resubmission.config.ts
$env:F3BR_REGRESSION_REPORT = 'D:/customers/qafilah/dashboard frontend/artifacts/f3b-remediation/f3b-regression-results.json'
pnpm exec playwright test --config artifacts/f3b-remediation/playwright.regressions.config.ts product-management.spec.ts
$env:F3BR_REGRESSION_REPORT = 'D:/customers/qafilah/dashboard frontend/artifacts/f3b-remediation/f3a-regression-results.json'
pnpm exec playwright test --config artifacts/f3b-remediation/playwright.regressions.config.ts products.spec.ts
$env:F3BR_REGRESSION_REPORT = 'D:/customers/qafilah/dashboard frontend/artifacts/f3b-remediation/f2-regression-results.json'
pnpm exec playwright test --config artifacts/f3b-remediation/playwright.regressions.config.ts merchant.spec.ts
```

For a full repeat against the already running owned runtime:

```powershell
& ./artifacts/f3b-remediation/runtime/reset-owned-database.ps1
& ./artifacts/f3b-remediation/runtime/initialize.ps1
```

The reset script validates exact project labels before changing only the named disposable PostgreSQL database and Redis instance. Do not run reset while a browser suite or other verification gate uses that runtime. After all gates finish, the guarded `cleanup-owned-runtime.ps1` removes only this project's Docker resources. Remove the five exact generated credential files separately with native PowerShell `Remove-Item -LiteralPath` after verifying their resolved paths remain under the frontend-owned remediation runtime. Verify zero owned resources, no credential copies, and no listener on port 3842. Keep the archive, scripts, sanitized JSON, screenshots, and prior evidence.

## Results and cleanup

On 17 September 2026, the final remediation suite passed all 39 tests in 79.1 seconds and the final F3-B regression passed all 23 tests in 61.0 seconds. The unchanged F3-A suite passed 18 tests in 51.0 seconds, and F2 passed 12 tests in 40.2 seconds. Every report contains zero skipped, flaky, or failing tests and zero runner errors. The runtime source hashes remained unchanged during the final runs. `real-integration-summary.json` records the exact report statistics.

All 30 timing sequences dispatched exactly one mutation and reached the expected authoritative state. Every 450ms representative received its real HTTP response before the second click. The two repeated-Enter cases and all subsequent navigation, future-action, and external-writer cases passed. Six confirmed-panel axe scans had zero violations, no horizontal overflow, and successful neutral keyboard focus after lifecycle review. The final F3-B regression also repeated its 15 create/edit/Archive scans across five widths with zero violations. Screenshots and detailed timing records are retained under the remediation artifact directory.

Exploratory test corrections did not change application runtime code: the timing harness initially assumed every 120ms click followed a response, and the external-writer harness initially assumed the existing 30-second read cache refreshed automatically on navigation. Final tests record actual response timing and obtain the external writer's resource through the existing explicit Refresh product action. The complete fresh suites then passed.

Final cleanup follows the production/Docker gates. The five generated credential paths are recorded in `cleanup-preflight.json`; sanitized completion evidence and the final read-only backend Git proof are recorded separately after the runtime is released.
