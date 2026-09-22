# F3-D real Laravel verification

The permanent browser suite uses the published backend revision
`6614690a3b24b39f45c7c1b9ed85c20ecb22cbbf` in a disposable frontend-owned runtime.
The canonical backend is read-only and is never mounted. Published backend source
is exported with Git archive, built with its published development Dockerfile and
started with its published Compose file plus supported environment overrides.

## Reproduction

Run the retained controls from the frontend directory, sequentially:

```powershell
& artifacts/f3d/runtime/setup.ps1
& artifacts/f3d/runtime/initialize.ps1
pnpm exec playwright test --config playwright.variants.config.ts
& artifacts/f3d/prepare-regressions.ps1
pnpm exec playwright test --config artifacts/f3d/playwright.regressions.config.ts
```

The guarded runtime is `qafilah-f2-runtime`, using the exact disposable database
`qafilah_f2_isolated`, API listener `http://localhost:3842`, and frontend listener
`http://localhost:3002`. Port 3000 belongs to an unrelated project and is preserved.
Published `FRONTEND_URL`, `SANCTUM_STATEFUL_DOMAINS` and `CORS_ALLOWED_ORIGINS` settings
authorize port 3002. No browser Origin is forged and no bearer token is used.

Setup refuses existing owned containers or volumes. Generated credentials receive
private container modes and owner-only host ACLs. Do not print fixture files or
export authenticated browser storage. Before repeating consumed fixtures, use only
the guarded `runtime/reset-owned-database.ps1`, then initialize again. Never reset
an unrelated database or use global Docker cleanup.

Browser suites own Next development output and port 3002. Do not run Next build,
type generation, or another browser suite concurrently with them.

## Coverage

The structural suite covers the nine published contracts through actual Laravel
responses and a complete UI workflow. It also exercises independent grants despite
misleading Role names and Product CRUD permissions; canonical normalization;
complete PATCH payloads; unchanged-value 422; 3/20/100 limits with inactive Variants
counted; immutable, complete and unique combinations; SKU case-sensitive uniqueness
across Products and multiple null SKUs; first-Variant Option creation lock; continued
label, position and Value editing; simple/archived boundaries; foreign/wrong-parent
resources; revocation; Store, Product and principal response races; repeated Enter
and response-boundary submission; committed/uncommitted unknown results; failed and
successful explicit review; and truthful partial configuration with final 422 focus.

Transport-loss cases dispatch to real Laravel when proving a committed outcome,
then drop only the response. Uncommitted cases abort before dispatch. Held-response
races use the actual response. Current-state review never proves causation and
never automatically replays a consumed mutation. Deliberate replay probes are
bounded test interactions, not production retry behavior.

The previous-phase run consists of 139 existing journeys: F3-C inventory 33,
inventory feedback 7, F3-B 23, F3-A 18, F2 12, response-boundary remediation 39 and
reconciliation remediation 7. Tracked test source is compared to published frontend
`bb5534d3d2ede1d72762ac1b4d230650f45bc9ec`. Ignored copies change only fixture/evidence
paths, the legacy WSL launcher to native Docker and the approved frontend origin
from port 3000 to 3002. `regression-harness-integrity.json` records source/copy hashes
and these environment-only substitutions.

## Evidence and cleanup

The final structural run passed **34/34** journeys in one run, with zero failures,
skips, flaky outcomes or automatic retries. The complete nine-contract UI journey
includes Option and Value create/edit, Variant creation, SKU clear, deactivation and
reactivation. The final SKU guard is verified in the browser: U+FEFF-only text is
rejected without a write, real Laravel independently returns 422 for that text, and
a subsequent deliberate empty input clears the SKU successfully. Six representative
surfaces at desktop/mobile sizes produced 12 axe
scans with zero violations.

Preparation issues were confined to the new fixture/test harness: an unsupported
fixture timestamp column was removed after a rolled-back seed; required-field
selectors were aligned with accessible roles; a duplicate heading was scoped to
level 1; and the archived action assertion checks its disabled state. No test was
skipped and no backend source changed. The
final run used a freshly reset guarded database and all corrected permanent tests.

An initial full prior-phase run passed 138/139 cases. One existing save-double-click
case timed out before sign-in while the page displayed “Checking your session…”.
It dispatched no mutation and recorded no browser runtime error. During that minute,
the owned API log shows health checks but no browser request. The exact cause was
not established; simultaneous machine load is only a possibility. The initial
report, screenshot, context, traffic and API log are retained under
`regression-initial-*`. A clean full rerun uses fresh guarded fixtures and no
concurrent heavy verification, with unchanged assertions and zero configured retries.
That clean full rerun passed **139/139** in one run, including the previously timed-out
case, with zero failures, skips, flaky outcomes or retries.

The final combined result is **173 passing real Laravel journeys**. The summary
verifier rechecks every leaf test result, all seven baseline/copy hashes, the final
focused test/configuration/fixture hashes, and 47 recorded structural/inventory
accessibility scans with zero violations. It writes `real-integration-summary.json`.

New sanitized results remain under `artifacts/f3d`. Earlier phase evidence is not
overwritten. `variants-results.json` and `regression-results.json` are the browser
reports; `browser/` holds request methods, paths, payloads, status and scope evidence
without credentials. Representative 1440/390 screenshots and axe scans are in
`screenshots/`. Axe evidence is focused verification, not a complete WCAG audit.

`backend-runtime-proof.json` records the backend identity, clean state, archive hash,
Dockerfile/Compose equality and canonical mount exclusion. Production uses the
separate HTTPS origins `https://localhost:3002` and `https://localhost:3844` with the
fresh production container on loopback 3843. Only published runtime environment
settings change for HTTPS; backend source remains frozen.

The fresh production image passed **11 browser checks covering all nine contracts**,
with eight deliberate structural writes and zero automatic replay. It verified
confirmed creation while a projection read was held, complete parent Option
reconciliation, SKU rejection/clear, activation/deactivation, read-only commercial
projections, a committed lost response followed by authoritative review, lifecycle
boundaries and logout privacy. Three production axe scans reported zero violations;
the final 1440/390 layouts had no horizontal overflow and were visually inspected.
The separate **15 HTTP/privacy checks** passed. All **115 runtime input hashes**
remained unchanged after production verification. See `docker-review.browser.json`,
`docker-review.http.json`, `docker-review.image.json` and the source manifests.

Production helper preparation exposed a held-route completion race, the published
60-per-minute scope limiter, and an immediate geometry assertion during viewport
transition. The helper now awaits the held route, spaces explicit reviews by 15
seconds, and waits for settled responsive geometry while retaining zero-overflow
and axe assertions. Application source, image, backend source and rate-limit
configuration were unchanged. Earlier attempt evidence and the layout diagnostic
remain under `docker-review.browser-*` and `docker-review.layout-diagnostic.*`.
Fresh production groups used separate `f3dprod2-`, `f3dprod3-` and `f3dprod4-`
identities and private files, derived from the permanent seeder with only its group
list and namespace changed. Each derivation proof verifies prior fixture hashes
and preexisting catalog-row digests; final verification used the v4 group.

After production verification, stop the exact owned frontend container and TLS
process, then run `runtime/finalize-owned-runtime.ps1`. It verifies Compose labels,
removes only owned containers/networks/volumes, resolves every credential/TLS leaf
inside the owned runtime before deletion, and compares the original unrelated
Docker inventory with final state. The unrelated port-3000 project is preserved.

Final cleanup removed all four owned backend containers, both networks and both
volumes, and left no private credential/TLS leaf from the explicit 13-path cleanup
list. Root separately stopped the exact owned TLS process and removed the owned
frontend container. Ports 3002, 3842, 3843 and 3844 have no listeners. All **51
unrelated containers** retain their recorded IDs, names, images and states. The
unrelated port-3000 process remains PID **25460**, with its original creation time
and command line verified. Evidence is in `cleanup-result.json`,
`docker-review.cleanup.json`, `runtime/tls-edge.stopped.json` and the before/after
workload inventories.

The final canonical backend is clean on `main`, with HEAD, origin/main and live
remote main all equal to `6614690a3b24b39f45c7c1b9ed85c20ecb22cbbf`, behind/ahead
`0/0`. `backend-final-git.json` records the final read-only Git and live-remote check.
