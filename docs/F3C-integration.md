# F3-C Product Inventory integration

The permanent inventory suite exercises the frontend against Laravel authority
`6614690a3b24b39f45c7c1b9ed85c20ecb22cbbf` using real Sanctum cookies, CSRF, Merchant
authorization, scoped reads, absolute stock writes, and database persistence. The
canonical backend checkout is read-only. A fresh Git archive is built with its
published development Dockerfile inside frontend-owned ignored artifacts.

## Isolation and reproduction

Run from the frontend directory. The retained local controls are under
`artifacts/f3c/runtime/`. Setup verifies the clean backend revision and refuses to
reuse the fixture project's existing containers or volumes. The owned Compose
project is `qafilah-f2-runtime`; its database is exactly `qafilah_f2_isolated`; its
HTTP listener is bound only to `127.0.0.1:3842`. Existing Docker workloads are recorded
before setup and compared after cleanup. No shared containers or volumes are reset.

```powershell
& artifacts/f3c/runtime/setup.ps1
& artifacts/f3c/runtime/initialize.ps1
corepack pnpm exec playwright test --config playwright.inventory.config.ts

# A complete fresh rerun, only inside the guarded disposable project:
& artifacts/f3c/runtime/reset-owned-database.ps1
& artifacts/f3c/runtime/initialize.ps1
corepack pnpm exec playwright test --config playwright.inventory.config.ts

# Preserve all previous phase artifacts while rerunning their actual assertions:
& artifacts/f3c/prepare-regressions.ps1
corepack pnpm exec playwright test --config artifacts/f3c/playwright.regressions.config.ts
```

Run browser suites sequentially. Their configurations own a Next development server
on `localhost:3000`; do not run another development server, production build, or Next
type generation against the same `.next` directory concurrently.

The initializer loads the unchanged F2, F3-A, F3-B, response-boundary and reconciliation
fixtures, plus `tests/integration/laravel-inventory-fixtures.php`. Inventory uses 34
independent synthetic nonowner identities. The `docker` identity is reserved for the
production image journey. Fixture scripts reject other environments/databases.
Credential JSON files and `secrets.env` receive owner-only Windows ACLs; private
container copies have mode 0600. Do not print or retain their contents as evidence.

## Permanent coverage

`tests/integration/inventory.spec.ts` contains 33 journeys covering:

- Unconfigured, zero, positive and maximum quantities; absolute replacement,
  persistence and Product projection consistency.
- Strict integer/body validation, same-value rejection, actual Catalog throttling,
  and bounded expired-session reconciliation without replay.
- Read-only access despite an Owner Administrator role label; write permission
  without read permission; archived and variant Products; foreign/unknown/malformed
  Product identifiers.
- Both inventory grants revoked in the same session; Store, membership and identity
  loss; delayed Store A GET/PATCH released under Store B.
- Delayed GET/PATCH held across logout and another principal's login, using client
  navigation without a document reload, then released under the new principal.
- Committed and uncommitted lost responses, inconsistent success data, ambiguous
  server errors, failed explicit review, truthful successful review, and a separately
  deliberate later change.
- A committed set to five followed by the published internal commerce deduction
  service reducing stock to four; explicit review observes four and never replays five.
- Confirmed success retained when later Product refresh fails.
- Natural double-click timing at 0/50/120/300/450 ms, Enter and retained-form
  `requestSubmit` after the response, and consumed state surviving component remount.
- A controlled failing Audit recorder passed to the actual published inventory action:
  the attempted stock change rolls back; a later real HTTP write persists.
- Keyboard and focus states, representative axe scans, overflow checks, and
  screenshots at 1440/1280/1024/768/390, plus unknown/review, pending, success,
  validation and read-only surfaces. This is not a full WCAG audit.

Response-loss tests forward the request to actual Laravel before dropping or replacing
its response, or explicitly abort before forwarding for the uncommitted case. They do
not substitute a mock backend for mutation evidence. The commerce deduction and Audit
failure controls operate only inside the isolated fixture runtime and do not create
new API endpoints or alter backend source.

Sanitized per-journey evidence records paths, methods, catalog payloads, response status,
CSRF/header-presence booleans and counts, never login bodies, cookies or token values.
Traces, video, and browser storage-state exports are disabled.

## Previous phase regressions

Five previous suites are copied to `artifacts/f3c/regressions` with fixture/evidence
paths changed to this phase and the existing WSL Docker launcher replaced by native
`docker exec`. Current tracked assertions are otherwise identical in these copies.

F2, M1/L1, and L2 tracked sources still match their published baseline blobs.
The F3-B assertion change permits the newly authorized, exact Product inventory GET
route in its prior no-inventory-traffic guard. The F3-A detail journey similarly
permits only GET for its exact simple Product inventory path. All old catalog write
restrictions remain. Neither permits inventory PATCH, Variant, Pricing or Media operations.
`regression-harness-integrity.json` records hashes and the explicit phase-boundary
change; `regression-authorized-delta.diff` records its complete tracked diff.

## Production TLS edge

After all development listeners stop, the frontend-owned `runtime/tls-edge.mjs`
provides disposable HTTPS listeners: the frontend at `https://localhost:3000`
forwards to the fresh production container on 3843, and the separate API at
`https://localhost:3844` forwards to the unchanged frozen Laravel runtime on 3842.
The candidate image is built with `NEXT_PUBLIC_API_ORIGIN=https://localhost:3844`.

Before production verification, `runtime/configure-production-origin.ps1` sets
the published `CORS_ALLOWED_ORIGINS` environment knob to
`https://localhost:3000` in the frontend-owned Compose override. It recreates only
the owned app service using the same frozen image; PostgreSQL, Redis and database
fixtures are retained. The host fixture JSON remains unchanged. Evidence in
`production-cors-runtime-proof.json` records unchanged database container IDs,
fixture hash and database table counts. Canonical backend source and configuration
files are never edited. Fresh setup restores the published HTTP origin defaults
before running development suites.

The distinct HTTPS origins ensure the browser naturally sends Origin on API reads,
while the two origins remain same-site for cookie behavior. No Origin, Referer or
authentication header is injected. The existing Sanctum localhost:3000 allowlist
remains unchanged; only its already-supported CORS deployment setting differs from
the HTTP development run. There is no new API route or authentication fallback.

The first same-origin test topology failed closed: login returned 200, but the
confirmation read returned 401. Published `no-referrer` behavior removes Referer,
and same-origin GET supplied no Origin; Sanctum therefore did not recognize the
read as stateful. Moving verification to the supported cross-origin topology
addresses the test deployment without changing frontend authentication or backend
middleware. No inventory mutation occurred during those failed sign-in attempts.

The self-signed localhost certificate is accepted only by the verification browser
configuration. Its private key is disposable, owner-restricted, and removed during
cleanup. Application production code does not disable certificate verification.

## Evidence and cleanup

Inventory results are in `artifacts/f3c/inventory-results.json`, per-journey evidence
in `browser/`, and visual/axe artifacts in `screenshots/`. Previous-suite results are
in `regression-results.json`, with their evidence segregated by phase. Exploratory
runs are retained separately from the final fresh-fixture results.

The accepted evidence covers **132 passing real Laravel journeys**: Inventory 33,
F2 12, F3-A 18, F3-B 23, M1/L1 39, and L2 7, with no skipped cases or automatic
retries. Inventory passed all 33 after the final spacing correction, and its 23
representative axe viewport scans reported zero violations.

The first full legacy run exposed the obsolete F3-A no-inventory-read assertion;
its exact phase-boundary correction is described above. The next full run passed
98/99, including all corrected F3-A cases, but one F3-B journey stalled before
login with no backend requests or browser errors. Its screenshot remained at
“Checking your session…”. Retained Next logs show a browser-startup gap while
backend health probes remained responsive. A development client startup stall is
the working diagnosis; the exact cause was not established.

The entire affected F3-B phase was rerun unchanged on fresh fixtures: **23/23
passed** in `f3b-regression-results.json`. Final regression evidence therefore
consists of the 76 passing F2/F3-A/M1L1/L2 cases in `regression-results.json` plus
that complete fresh F3-B result. The raw failed run remains intact; no assertion
or application behavior was suppressed. `real-integration-summary.json` records
this explicit partition and validates each accepted result. `summarize-real.mjs`
recreates it. Inventory's earlier exploratory and pre-spacing results are retained
separately and are not substituted for the final 33-case result.

After every dependent gate, including production authentication, finishes, stop only
the owned TLS edge and production container, then run
`runtime/finalize-owned-runtime.ps1`, which invokes the separately guarded
`cleanup-owned-runtime.ps1`. It removes only the seven generated runtime credential
leaf files (`secrets.env` and six browser fixture JSON files) and disposable TLS key
and certificate after resolving and checking their absolute paths. Verify the four backend containers,
two networks, two volumes, credentials and relevant listeners are absent. Preserve
sanitized evidence, source archive, images and previous phase artifacts. Record the
unrelated-container comparison and final backend Git identity/clean state separately.

Final cleanup removed all four owned backend containers, two networks, two volumes,
the credential files and TLS material. Ports 3000, 3842, 3843 and 3844 have no
remaining listeners. `cleanup-result.json` retains the exact resource checks;
`backend-final-git.json` records the fetched canonical backend on `main`, unchanged
at `6614690a3b24b39f45c7c1b9ed85c20ecb22cbbf`, clean and zero behind/ahead.

The unrelated-workload comparison is **49 unchanged and two recreated**, not 51
unchanged. The original `holoul-app-1` and `holoul-nginx-1` IDs were replaced at
17:02:54 and 17:02:55 UTC respectively, during the final cleanup window. Their new
containers retain the same names and image references, belong to the separate
`holoul` Compose project and working directory, and are running and healthy.
This task's cleanup validated its four container labels and targeted only
`qafilah-f2-runtime`; it issued no global prune or unrelated workload mutation.
The evidence is consistent with concurrent recreation outside this task's scope,
but Docker does not identify the caller. No unrelated workload was restored,
restarted or otherwise changed to conceal the mismatch. The original comparison
and sanitized inspection are retained in `unrelated-workload-investigation.json`;
the available event history no longer contains that lifecycle window.
