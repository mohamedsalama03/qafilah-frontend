# F3-E real Laravel verification

The permanent Variant inventory browser suite uses published backend
`6614690a3b24b39f45c7c1b9ed85c20ecb22cbbf` in a disposable frontend-owned runtime.
The canonical backend is read-only. Its exact Git archive, published development
Dockerfile and Compose configuration are used with supported origin environment
overrides. No canonical backend directory is mounted or edited.

## Reproduction

Run the retained controls from the frontend directory, sequentially:

```powershell
& artifacts/f3e/runtime/setup.ps1
& artifacts/f3e/runtime/initialize.ps1
pnpm exec playwright test --config playwright.variant-inventory.config.ts
& artifacts/f3e/prepare-regressions.ps1
pnpm exec playwright test --config artifacts/f3e/playwright.regressions.config.ts
```

The isolated runtime is `qafilah-f2-runtime`, the exact disposable database is
`qafilah_f2_isolated`, the API is `http://localhost:3842`, and Next uses
`http://localhost:3002`. Setup refuses existing owned containers/volumes. Generated
credentials have private container modes and owner-only host ACLs. Never print the
fixture credentials or export authenticated browser storage. Before repeating
consumed fixtures, run only the guarded `runtime/reset-owned-database.ps1`, followed
by initialization. Do not reset any other database.

Browser suites, type generation, and builds share Next output and must run
sequentially. The existing unrelated port-3000 project remains untouched.

## Coverage and evidence

The suite exercises both exact Variant inventory contracts against Laravel,
including unconfigured/zero/positive/maximum values; frontend numeric payloads;
backend integer-string coercion; bounds, unknown fields and unchanged-value 422;
independent read/write grants despite unrelated grants and misleading Role names;
inactive Variants; archived Product behavior; wrong-parent and foreign nesting;
active-only parent availability with parent quantity always null; unpriced active
stock; Simple Product inventory separation; Audit rollback; and commerce deduction.

Browser safety coverage holds actual Laravel GET/PATCH responses across Store,
Product, Variant and principal changes. It covers lost committed and uncommitted
responses, malformed success and server errors, explicit failed/successful review,
duplicate submission and repeated Enter, navigation remount, Store A→B→A,
authority revision refresh, and confirmed success followed by projection failure.
Reconciliation observes current state; matching quantities never prove that an
uncertain earlier request committed. Only fresh reviewed intent permits a new
PATCH. Mutation retries remain zero.

Response-loss interception forwards the write to actual Laravel before dropping
its response when proving a committed result. The uncommitted case aborts before
dispatch. Delayed-response tests return actual responses. Only failure injection
is synthetic; successful domain behavior is never replaced by mocks.

Sanitized request methods, paths, payloads, statuses and scope evidence are retained
under `artifacts/f3e/browser`. Desktop/mobile screenshots and focused axe scans are
in `artifacts/f3e/screenshots`. No bearer tokens, passwords, cookies or authenticated
storage are included in those evidence records. Axe coverage is focused verification,
not a complete accessibility audit.

Previous-phase coverage retains 173 journeys: F2 12, F3-A 18, F3-B 23,
response-boundary remediation 39, reconciliation remediation 7, F3-C inventory 33,
inventory feedback 7 and F3-D variants 34. The first seven sources are compared
against frontend authority `3b828756be8dd11e0dfdfc0d8b384a57f58fc135`, allowing only
the explicit initial-read synchronization described below; ignored copies
only change fixture/evidence paths, legacy WSL invocation to native Docker, and
the approved origin from port 3000 to port 3002. The F3-D suite permits only the
new nested inventory GET while retaining all pricing/media and inventory write
prohibitions. This is the only changed structural-suite assertion.

The first prior-phase run passed 172/173. One existing F3-A page-size test's broad
response waiter captured the initial `per_page=25` response while its intended
`per_page=10` request was still pending. Traffic and the failure screenshot confirm
this synchronization race; the browser recorded no runtime error. The permanent
test now captures the initial read before login, awaits its HTTP 200 response, then
changes page size. All original pagination/sort assertions remain intact. The
initial report and exact failure context, screenshot and sanitized traffic remain
under `regression-initial-results.json` and `regression-initial-failure/`.

`backend-runtime-proof.json` records authority, archive hash, Dockerfile/Compose
equality and runtime mounts. `regression-harness-integrity.json` records regression
source/copy hashes and substitutions.

## Final results

The final focused run passed **39/39** journeys after the alignment and truthful
last-known-value refinements. The fresh complete prior-phase run passed **173/173**,
including the corrected pagination case, for **212 passing Laravel journeys**.
Every final leaf result passed once, with zero retries, skips, failures or flaky
outcomes. The earlier 172/173 run remains disclosed above and is not counted as
a successful full run.

`node artifacts/f3e/verify-integration.mjs` verifies every final leaf result, all
eight prior source/copy hash pairs, the permanent F3-E test/configuration/fixture
hashes and **113 unchanged frontend runtime inputs**. It records **19 focused**
and **59 regression** axe scans, all with zero violations, in
`real-integration-summary.json`. `product-pagination-test-sync-proof.json` verifies
that removing exactly the two synchronization additions reproduces the published
F3-A test source, without changing any original assertion.

## Cleanup

After all validation, stop the exact owned frontend process and run
`artifacts/f3e/runtime/finalize-owned-runtime.ps1`. It verifies Compose ownership,
removes only owned containers/networks/volumes, validates every credential path
inside the owned runtime, deletes those exact private leaves, and compares the
recorded unrelated containers with their final state. No global Docker cleanup is
used. Results remain in `artifacts/f3e/cleanup-result.json`.

Final cleanup removed all four owned backend containers, both networks, both
volumes and every generated private credential leaf. All **51 original unrelated
containers** retain their IDs, names, images and states. The unrelated port-3000
Node process retains PID **34432**, its creation time and listening address.

The first cleanup comparison used `--no-trunc` only for its final snapshot, which
expanded 14 image display labels. Raw evidence was preserved, and comparison with
identical Docker options plus full immutable container IDs confirmed zero actual
differences. A separate comparison confirms the identical port-3000 snapshots.
Evidence is in `cleanup-result.json`, `cleanup-initial-comparison.json`,
`recheck-cleanup.mjs` and `protected-port3000-cleanup.json`.
