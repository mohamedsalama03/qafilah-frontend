# F3-B L2 reconciliation guidance integration

The focused suite uses the frozen Laravel revision
`6614690a3b24b39f45c7c1b9ed85c20ecb22cbbf` through real Sanctum cookies, CSRF,
merchant authorization, Product writes and explicit Product reads. The seven synthetic
merchants are independent of the existing F2, F3-A, F3-B and M1/L1 fixtures.

## Permanent coverage

`tests/integration/product-reconciliation.spec.ts` and
`tests/integration/laravel-product-reconciliation-fixtures.php` cover:

- An uncertain PATCH aborted before reaching Laravel: typed B, proven server A, explicit
  GET A, detached old form, visible polite atomic status, keyboard access and one later
  deliberate description-only PATCH.
- A real PATCH that returns 200 and commits B before response delivery is deliberately
  lost: explicit GET B and the same guidance after form renewal. The backend mutation
  result proves commitment independently of matching input values.
- A known successful Save whose subsequent review GET fails: the completed submission
  remains confirmed. A later explicit Start a new edit loads a fresh form and guidance.
- A committed Create whose response is lost: explicit list review precedes a separate
  blank form, its guidance, and one deliberate creation with a different payload.
- Create-only access: Create another produces blank fields and accessible guidance
  without requiring Product or Category reads.
- A failed uncertain review: uncertainty and the write lock survive until a later
  successful explicit GET.
- An authoritative archived result: guidance appears while editing remains unavailable.

The first, second and separate-create journeys capture desktop (1440) and mobile (390)
screenshots, check overflow and mobile input sizing, and run six representative axe scans.
These automated scans support the specific tested surfaces; they are not a full WCAG audit.
No trace, video, storage state, passwords or cookie values are written to public evidence.

## Isolated runtime and reproduction

Run from the frontend directory. Docker must be available. The backend checkout is read
only: the setup script verifies its clean revision, creates a Git archive, and builds the
published development Dockerfile from the frontend-owned archive. It refuses to reuse
existing containers or volumes bearing the fixture project name. It does not change
Laravel, published throttles, CORS, middleware, host checks or contracts.

The retained local scripts and all new outputs are under `artifacts/f3b-l2/` (ignored).
Prior phase artifacts remain untouched. The owned project is `qafilah-f2-runtime`, the
database is `qafilah_f2_isolated`, and the backend binds only `127.0.0.1:3842`.

```powershell
# First setup: exact archive, four owned services, schema and synthetic fixture sets.
& 'artifacts/f3b-l2/runtime/setup.ps1'
& 'artifacts/f3b-l2/runtime/initialize.ps1'

# Subsequent complete rerun: reset only the guarded synthetic database and its Redis.
& 'artifacts/f3b-l2/runtime/reset-owned-database.ps1'
& 'artifacts/f3b-l2/runtime/initialize.ps1'

# Wait for initialization to finish before starting Playwright.
pnpm exec playwright test -c playwright.product-reconciliation.config.ts

# Preserve old suite artifacts by generating assertion-identical harness copies.
& 'artifacts/f3b-l2/prepare-regressions.ps1'
$env:F3BL2_REGRESSION_REPORT = Join-Path (Get-Location) 'artifacts/f3b-l2/m1l1-regression-results.json'
pnpm exec playwright test -c artifacts/f3b-l2/playwright.regressions.config.ts product-resubmission.spec.ts
$env:F3BL2_REGRESSION_REPORT = Join-Path (Get-Location) 'artifacts/f3b-l2/f3b-regression-results.json'
pnpm exec playwright test -c artifacts/f3b-l2/playwright.regressions.config.ts product-management.spec.ts
$env:F3BL2_REGRESSION_REPORT = Join-Path (Get-Location) 'artifacts/f3b-l2/f3a-regression-results.json'
pnpm exec playwright test -c artifacts/f3b-l2/playwright.regressions.config.ts products.spec.ts
$env:F3BL2_REGRESSION_REPORT = Join-Path (Get-Location) 'artifacts/f3b-l2/f2-regression-results.json'
pnpm exec playwright test -c artifacts/f3b-l2/playwright.regressions.config.ts merchant.spec.ts
```

Run these suites sequentially. Each configuration starts and stops its own frontend on
port 3000. Do not run another Next development server, build or type generation against
the same `.next` directory concurrently. The frontend API origin is fixed to the owned
Laravel listener for this test run.

All four tracked regression suites are compared to baseline
`e3eff36f62d793c4248a80506b926a07e3aa0e29` before copying. Their assertions and deliberate
review steps are unchanged. Copies alter only fixture/evidence paths and replace the WSL
Docker launcher with the native Docker CLI where needed. The integrity JSON records
baseline Git blobs and source/copy SHA-256 hashes.

The fixture loader writes five private browser fixture JSON files plus `secrets.env`
with owner-only filesystem permissions. Their contents must never be printed, committed
or included in screenshots. The PHP fixtures run only when Laravel reports `local` and
the database name is exactly `qafilah_f2_isolated`.

## Evidence and cleanup

The final frozen-source run passed all 99 real Laravel tests: focused L2 7/7 (21.6s),
M1/L1 39/39 (78.1s), F3-B 23/23 (61.2s), F3-A 18/18 (48.3s), and F2 12/12 (38.3s).
There were no skipped, flaky or failed tests in the final reports. All six new guidance
axe scans passed. The 30 natural double-click cases each dispatched one mutation; 20
recorded the real response before the second click, including every 450ms case.

The first focused attempt encountered a test selector collision with Next's separate
route announcer (`role=alert`). Message-filtered alert selectors corrected the harness;
the isolated fixture database was reset before the final 7/7 run. No runtime change was
needed. Two regression JSON reports initially resolved relative to the ignored config
directory and were copied to the documented evidence directory; reproduction commands
use absolute report paths. The prior phase's evidence was preserved.

Focused results are in `artifacts/f3b-l2/reconciliation-results.json`, sanitized request
and guidance evidence in `browser/`, and the six visual/axe surfaces in `screenshots/`.
The four regression reports and `regression-harness-integrity.json` live in the same new
artifact directory. Natural response-boundary timing evidence is in `m1l1-browser/`.

After all frontend and production Docker checks finish, run the separately guarded
`runtime/cleanup-owned-runtime.ps1`, then remove only the six generated credential leaf
files using native PowerShell `Remove-Item -LiteralPath` after resolving and checking
their absolute paths remain under the new runtime directory. Verify the project's four
containers, two networks and two volumes are absent, the six private files are absent,
port 3842 is free, and shared container identities/images/states remain unchanged.
Keep sanitized evidence, archive and images. The final cleanup result and backend Git
proof are recorded separately in this artifact directory.
