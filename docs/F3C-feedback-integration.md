# F3-C L1/L2 real Laravel verification

This focused suite verifies feedback and focus against the frozen Laravel revision
`6614690a3b24b39f45c7c1b9ed85c20ecb22cbbf`. It changes no inventory contract or
backend source. All runtime controls and new evidence are isolated under
`artifacts/f3c-l1l2`; earlier F3-C evidence is preserved.

## Reproduction

From the frontend directory, use the retained frontend-owned runtime controls:

```powershell
& artifacts/f3c-l1l2/runtime/setup.ps1
& artifacts/f3c-l1l2/runtime/initialize.ps1
pnpm exec playwright test --config playwright.inventory-feedback.config.ts
& artifacts/f3c-l1l2/prepare-regressions.ps1
pnpm exec playwright test --config artifacts/f3c-l1l2/playwright.regressions.config.ts
```

Setup refuses an occupied `qafilah-f2-runtime` Compose project and builds a fresh
Git archive with the published backend development Dockerfile. The exact disposable
database is `qafilah_f2_isolated`, exposed through the existing loopback backend
listener on port 3842. The canonical backend checkout is never mounted. Generated
fixture credentials have owner-only host ACLs and private container file modes.
Do not print these files or export authenticated browser storage.

The initializer loads the existing F2/F3-A/F3-B regression fixtures and inventory
fixtures. Seven new inventory groups serve the focused feedback tests; the prior
34 groups retain their behavior, including the untouched `docker` production group.
Before repeating tests with consumed fixtures, reset only the guarded owned database
using `runtime/reset-owned-database.ps1`, then initialize it again. This also clears
only that owned project's Redis limiter state.

Browser suites own the shared Next development output and localhost:3000 listener.
Run them sequentially, without concurrent Next builds or type generation.

## Focused coverage

The seven permanent journeys in `tests/integration/inventory-feedback.spec.ts` cover:

- A real confirmed PATCH while an actual successful Product GET response is held:
  success is announced and failure guidance remains absent.
- The same confirmed PATCH followed by successful projection refresh, and separately
  a dropped projection response: success remains confirmed in both, with secondary
  failure guidance appearing only in the failed case.
- Initial Product loading before inventory is mounted, preserving the existing
  Product loading surface.
- Client validation and a real fresh same-value Laravel 422, submitted by keyboard.
- A lost committed PATCH, explicit current-inventory reconciliation, and a later
  deliberate same-value PATCH returning a real quantity-specific 422.
- A real Catalog rate-limit 429 after review, with useful generic feedback focus and
  no fabricated field validation error.

Quantity-error assertions wait for two browser animation frames after visible error
state, then check the final active element, `aria-invalid`, `aria-describedby`, the
associated error text and the retained alert. This exposes the parent feedback
effect stealing focus after the child field effect; it does not accept transient
input focus. The post-review journey repeats the final focus assertion after its
axe scans and screenshots. No arbitrary sleep or automatic test retry is used.

The confirmed pending journey holds the real Product response through accessibility
inspection; the failure journey drops only that secondary response. Inventory PATCH
responses and persistence remain actual Laravel results. The generic error comes
from the published Catalog limiter. No backend mock or invented endpoint is used.

## Evidence

`feedback-results.json` records **7/7 passing**, with zero retries, skips or flaky
cases. Sanitized request counts and final focus details are in `browser/`. Six
representative surfaces at 1440 and 390 pixels produced **12 axe scans with zero
violations**, saved with screenshots in `screenshots/`. These checks are focused
accessibility evidence, not a complete WCAG audit.

The full previous-phase run uses copies of 132 existing journeys: F3-C 33, F3-B 23,
F3-A 18, F2 12, response-boundary remediation 39 and reconciliation remediation 7.
The six tracked source files match candidate
`1604c28f1f04d8d1f0c26bd14ba16cb0a1468132` exactly. Copies change only fixture/evidence
paths and the old WSL Docker launcher to native Docker. Integrity hashes are in
`regression-harness-integrity.json`; results are in `regression-results.json`.
The full run retains unknown committed/uncommitted writes, failed and successful
review, intervening commerce deduction, scope and principal races, revocations,
double-submit, response consistency, null/zero/bounds, and lifecycle boundaries.

The complete unchanged regression run passed **132/132** in one run. Together with
the focused suite, this provides **139 passing real Laravel journeys**, with zero
failures, skips, flaky cases or retries. Its inventory subset produced another
**23 axe scans with zero violations**. `summarize-real.mjs` validates both result
files, every accepted test status, the six baseline source hashes and the 35 combined
inventory accessibility scans, then writes `real-integration-summary.json`.

## Production and cleanup

The runtime retains the previously established separate HTTPS topology:
frontend `https://localhost:3000`, API `https://localhost:3844`, and the fresh
production container on loopback 3843. The disposable TLS edge forwards to the
frozen backend on 3842. Before production verification,
`runtime/configure-production-origin.ps1` uses only the published
`CORS_ALLOWED_ORIGINS` runtime setting and recreates only the owned app container;
it does not alter canonical backend configuration or database containers.

After production verification, stop only the owned TLS process and frontend
container, then run `runtime/finalize-owned-runtime.ps1`. It validates Compose labels,
removes only owned containers/networks/volumes, and deletes exact credential and TLS
leaf paths after resolving them inside the owned runtime directory. No global Docker
cleanup is permitted. `docker-workloads-before.json` and the final comparison preserve
any changes in unrelated workloads without attributing their cause.

The final fresh production image passed **18 browser checks** over this real HTTPS
Laravel deployment, including confirmed success while Product refresh is pending,
successful refresh without failure wording, and a post-review same-value 422 whose
final focus remains on quantity. Its three deliberate PATCH responses were
`200, 422, 200`; no automatic replay occurred. Three production axe scans (post-review
422, desktop inventory, and mobile inventory) had zero violations. The separate 13
HTTP/privacy checks, healthy non-root
container verification and bounded image scans also passed. Evidence is retained in
`docker-review.browser.json`, `docker-review.http.json`, `docker-review.container.json`
and `docker-review.image-scan.json`.

Final scoped cleanup removed all four backend containers, both networks, both
volumes, seven credential files and both TLS leaf files. Root separately removed
the exact owned frontend container and verified TLS process. Ports 3000, 3842,
3843 and 3844 have no remaining listeners. All **51 unrelated containers retained
their recorded IDs, names, image references and states**. `cleanup-result.json`,
`production-cleanup.json` and the before/after workload inventories preserve these
checks. The fetched canonical backend remains on `main`, with HEAD and origin/main
both `6614690a3b24b39f45c7c1b9ed85c20ecb22cbbf`, clean and zero behind/ahead, as recorded
in `backend-final-git.json`.
