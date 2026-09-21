# Frontend F3-C — Product Inventory implementation report

## Executive Summary

F3-C integrates inventory for existing simple Products through the two published
Merchant inventory contracts. Set quantity replaces the absolute stock count. The
frontend keeps unknown attempts consumed, requires explicit current-state review,
and separates a confirmed write from later projection-refresh failures.

The final verification ledger and Git identity are retained under `artifacts/f3c/`.
This report is included in the single local implementation commit. No push is authorized.

## Baselines

Both initial gates passed after fetching origin: main, clean, behind/ahead 0/0.

- Frontend HEAD and origin/main: `f0439c35d963bcfd67e79ebda1fcd0e23028b93d`.
- Backend HEAD and origin/main: `6614690a3b24b39f45c7c1b9ed85c20ecb22cbbf`.

## Contracts Activated

- `GET /api/v1/stores/{store}/catalog/products/{product}/inventory`.
- `PATCH /api/v1/stores/{store}/catalog/products/{product}/inventory`.
- Existing Product detail GET is reused for public identity and lifecycle review.

PATCH accepts only `{quantity: integer}`. The strict success envelope contains
`data: {quantity, availability}`, a request UUID, success=true, and message=null.
There is no Product UUID, version, mutation receipt, or invented header in inventory
responses. The central adapter additionally requires confirmed PATCH quantity to
equal the submitted quantity.

## Permissions

Reads require `products.view`. Editing requires both `products.view` and
`products.inventory.update`. Current session and Store context are checked before
dispatch and result publication. Backend permission checks remain final. Neither
role labels nor client identifiers establish authority.

## Inventory Model

Null means Not configured/unavailable; zero means configured/Out of stock; positive
means In stock. Requests contain JSON integers from 0 through 2,000,000,000. Strict
response parsing rejects unknown fields, invalid bounds, and contradictory
quantity/availability combinations. There is no increment, decrement, adjustment,
unset, deletion, reservation, or unlimited-stock operation.

## Product Inventory UI

`ProductInventoryPanel` extends existing Product detail. It provides a labeled
quantity input, availability, explicit Set quantity, safe feedback, and review
actions using the existing design system. Simple Products with viewing permission
receive the panel. Archived Products and read-only members have no enabled editor.
Variant Products retain Managed per variant and activate neither inventory reads
nor writes. No navigation module or dashboard metric was added.

## Query Isolation

The dedicated key contains principal, Store UUID, authority revision, Product UUID,
and `product-inventory`. Query and mutation lifetimes belong to the authenticated
session. Old reads cannot publish after Store/principal/revision change. Focus and
reconnect do not automatically refresh this editor's inventory query.

## Mutation Lifecycle

The controller installs its single-flight latch before notifying subscribers or
dispatching. Success and unknown attempts remain consumed after response settlement
and component remount. Local interaction slots are never sent as backend versions.
No optimistic stock arithmetic or automatic PATCH retry exists.

## Confirmed Success

The authoritative response updates only the originating inventory cache after older
inventory reads are cancelled. Product detail/list projections are invalidated in
their original scope. Projection refresh is a separate operation: its failure can
set a refresh warning but cannot change confirmed success to unknown or renew the
consumed attempt. Change quantity explicitly reviews current state first.

## Unknown Outcomes

Lost responses, ambiguous server failures, and invalid success payloads after
dispatch consume the attempt. The UI says the quantity may already have changed
and offers Review current inventory. It does not automatically replay or describe
browser cancellation as server rollback.

## Reconciliation

Explicit review performs inventory GET and Product identity/lifecycle GET under
current authority. Failure retains the unknown lock. Successful review creates a
new local interaction initialized from observed inventory, not the old submission.
Unknown-review guidance explicitly says it does not establish the earlier write's
outcome. These two reads are not an atomic snapshot or an operation receipt.

## Intervening Stock Change

The real backend regression commits quantity five, loses its response, invokes the
published internal commerce deduction service to reach four, and reviews four.
It verifies exactly one original PATCH and no restoration of five. A subsequent
change requires a separate deliberate submission.

## Concurrency

The UI states that Set quantity replaces current stock and that other changes may
occur while the merchant works. Backend locks preserve transaction integrity;
neither the frontend nor backend contract supplies optimistic lost-update protection.
No ETag, expected quantity, version, or idempotency guarantee is invented.

## Double Submit

Permanent tests exercise synchronous reentrancy, response-boundary events, consumed
success, remounts, stale interaction closures, natural double-click intervals, Enter,
and retained-form requestSubmit. One deliberate operation dispatches at most one
PATCH. Later changes require the explicit reviewed interaction.

## Store / Principal Isolation

Real delayed GET/PATCH tests release Store A responses after Store B is active.
Strengthened principal tests hold responses across logout, sign in another principal
without reloading the document, then release only after the new principal's inventory
is visible. They assert no old data, success, cache corruption, or mutation replay.

## Permission Revocation

Real fixtures revoke read and update grants independently in the same session.
Authoritative context refresh changes capabilities. Store suspension, membership
loss, identity loss, and direct Laravel denials also remain covered. The read-only
fixture deliberately has an Owner Administrator role label without a write grant.

## Error Semantics

Certified normalization remains in use: 401/419 trigger bounded session review;
403 concerns current authority; 404 hides missing/foreign resources; 422 represents
validation/domain errors; 429 provides rate-limit recovery. None causes automatic
mutation replay. Post-dispatch ambiguous 5xx/network outcomes remain unknown.
Backend internals and credentials are not displayed.

## Accessibility / Responsive

The real suite covers 1440, 1280, 1024, 768, and 390px, labeled inputs, keyboard
submission, first-invalid focus, pending controls, success, uncertain outcome,
review, and read-only states. Representative axe scans and overflow assertions
accompany screenshots. A visual pass corrected the Inventory-to-detail spacing.
This is representative verification, not a full WCAG certification.

## Architecture / Mutation Evidence

The architecture suite has 172 passing tests, including the narrow inventory
contract allowance and guards against deferred contracts, unscoped state, direct
transport, retries, arithmetic, persistence, and role/UUID-derived authority.

The in-memory operative runner executes 98 permanent assertions per variant.
Pristine, comment decoy, string decoy, and pristine-after are GREEN. Automatic retry,
unscoped cache, null/zero conflation, response-consistency bypass, and post-success
duplicate submission are RED through their intended assertions. Protected source
hashes are identical before/after; no mutation residue remains.

## Tests

The full Vitest run is GREEN: 1,045 tests across 34 files, no skipped/todo tests.
The final development Playwright run passed 23/23, and production Playwright passed
7/7, both with no retries, skips, or flaky results. Typecheck and the optimized
production build passed. Frozen installation with strict peer dependencies,
formatting, lint, and both dependency audits passed. Both audits report zero
vulnerabilities. Peer checks use the successful strict-peer install and dependency
listing. Real Laravel and Docker evidence are detailed separately below.

## Real Laravel E2E

All 33 permanent isolated real Laravel journeys passed, with no retries, skips,
flaky results, or runtime errors. It uses the exact
published backend archive and real Sanctum sessions, CSRF, authorization, stock
transactions, and persistence. Network fault injection either forwards to real
Laravel before losing/replacing its response or explicitly aborts before forwarding.
Mocks are not the backend proof.

Audit-failure verification invokes the actual published inventory action with a
controlled failing Audit recorder and real database transaction, verifies rollback,
then verifies a later real HTTP write. This is action-level rollback plus HTTP
persistence, not an HTTP endpoint for injecting Audit failures.

## F3-B / F3-A / F2 Regression

The prior real suites retain their assertions. The authorized F3-B and F3-A phase-boundary
changes allow exact simple Product inventory GET traffic; they still prohibit
inventory PATCH and deferred-domain operations in those old journeys. Copied harness
sources isolate fixture/evidence paths and record source hashes.

All 99 prior cases have passing evidence: F2 12, F3-A 18, F3-B 23, M1/L1 39,
and L2 7. The complete second run passed 98/99; one F3-B case stalled before login
with no backend requests or runtime errors. A fresh, complete affected F3-B run
passed 23/23 without changing its assertions. The accepted partition is the 76
unaffected cases from the full report plus the fresh 23-case report. Raw failed
reports are retained, and the ledger validates the partition without rewriting them.

## Production / Docker

A fresh non-root production image is built from fingerprinted runtime/build inputs.
The production check uses isolated HTTPS frontend/API edges on localhost:3000 and
localhost:3844 with real frozen Laravel, real browser CORS, and no auth fallback or
injected Origin header. The existing published `CORS_ALLOWED_ORIGINS` environment
setting is supplied only to the disposable runtime; canonical configuration files
remain unchanged. Certificate validation is bypassed only for the
disposable self-signed certificate in the verification browser.

Image `qafilah-merchant-f3c:review` is
`sha256:74a52867bed725371dae043b4a084b286be487bcf6096263e06e0862f24298d1`.
Its 107 runtime/build inputs have the same SHA-256 fingerprint before build,
after build, and after verification:
`b73ae2ecbcfdf7aebe76e073cfc3c1d7a3302f335e4732e0954c599caeea3f8b`.
The healthy container runs as qafilah, UID/GID 1001, without mounts or sensitive
environment names. The deployed-file scan covered 1,331 files, including dependencies;
known fixture/secret markers, dotenv paths, unexpected application test files, and
browser source maps were absent. This bounded scan is not a universal secret detector.

Thirteen HTTP route checks passed with private/no-store responses, security headers,
and fresh CSP nonces. Fifteen production browser checks passed: real cookie sign-in,
unconfigured inventory, absolute replacements to zero then nine, deep-link reload,
archived/variant restrictions, logout closure, and development/unimplemented 404s.
Exactly two PATCH requests reached Laravel, both 200; browser authority storage
and runtime errors were zero. Desktop/mobile screenshots and two production axe
scans passed without violations or horizontal overflow.

## Backend Read-Only Proof

Canonical Laravel source/tests/configuration are unchanged. Runtime writes target
only the frontend-owned disposable database and published backend image. After a
final fetch, backend main has HEAD and origin/main both at
`6614690a3b24b39f45c7c1b9ed85c20ecb22cbbf`, behind/ahead 0/0, and empty status.
`backend-runtime-proof.json`, `production-cors-runtime-proof.json`, and
`backend-final-git.json` distinguish unchanged published source from disposable
runtime data and the supported CORS environment value.

## Changed Files

- Added inventory contracts, model, queries, mutation controller, panel, and permanent tests.
- Extended central backend registry/client by the two verified contracts.
- Integrated the panel into Product detail without replacing Product metadata authority.
- Updated typed API mocks and the exact registry-count test.
- Extended architecture policy/tests and added the operative mutation runner/config.
- Added isolated real inventory fixtures, suite/config, reproduction guide, and this report.
- Narrowly updated the old F3-B/F3-A read boundaries and development screenshot/interaction readiness.

## Commands Executed

Git fetch/identity/status/diff checks; read-only Laravel source inspection;
`pnpm install --frozen-lockfile --strict-peer-dependencies`; Prettier; ESLint;
TypeScript and Vitest; architecture tests; `node tests/inventory-mutations.mjs`;
Playwright development, production, and real Laravel configurations; production
build and fresh Docker build; dependency audits and dependency listing; isolated
fixture setup/control/cleanup. The evidence ledger records final gate outcomes.

## Commands Failed / Recovered

- A pnpm explain command is unsupported by the installed version; strict-peer
  installation and the dependency listing provide the actual peer gate.
- Initial typed test mocks/fixture values and formatting were corrected.
- The operative runner correctly rejected concurrent test edits; its final frozen
  run passed hash equality. Its classifier was narrowed to recognize Vitest's
  asynchronous assertion mismatch without accepting import/compile failures.
- A heavily parallel full unit run hit two existing async UI readiness deadlines;
  the complete sequential-worker run passed all 1,045 assertions.
- Development screenshots initially injected caret styles during hydration; the
  helper now preserves the caret. A separate early native select interaction now
  follows a real open/close menu readiness check. Error capture and assertions remain.
- The isolated Audit probe first used an invalid audit-source context; it was
  corrected to the action's required HTTP audit context.
- Old F3-B and F3-A no-inventory guards were narrowed to allow only the newly
  authorized simple Product inventory GET, retaining all other phase boundaries.
- One older F3-B permission case stalled before authentication dispatch in the full
  regression run. Healthy backend probes and the empty request trace suggest a
  development client startup stall; its exact cause remains unproven. All 23 F3-B
  cases passed on fresh fixtures with unchanged assertions and zero retries.
- The first production test topology used a single HTTPS origin. Browser GETs
  then omitted Origin and, under the certified no-referrer policy, Referer;
  Sanctum could not recognize the authenticated session after login. Separate
  HTTPS frontend/API origins and the published CORS environment setting corrected
  this verification setup without source changes or synthetic authorization.
- The TLS helper ownership guard initially compared a JSON-decoded DateTime to
  a string. It safely refused to stop the process; comparing UTC ticks and the
  exact recorded command verified ownership before stopping it.
- Missing-path/wildcard discovery lookups were corrected to actual paths.

## Cleanup

Removed the four owned backend containers, two networks, two volumes, the owned
production review container, the PID/start-time-verified TLS helper, seven generated
credential leaves, and the disposable key/certificate. No listeners remain on
3000, 3842, 3843, or 3844. Source archives and sanitized verification artifacts remain.

Of 51 preflight unrelated containers, 49 retain the same IDs, names, image references,
and state. Holoul app/nginx have replacement IDs created during final cleanup;
they retain their names/image references and are healthy under the separate `holoul`
Compose project and working directory. Cleanup was guarded and confined to
`qafilah-f2-runtime` plus the exact owned frontend container and TLS process.
The observation is consistent with concurrent recreation outside this task; Docker
does not identify the caller, and its retained events no longer cover that window.
No unrelated container was restored or changed. The raw mismatch is preserved in
`cleanup-result.json`, with the qualified inspection in
`unrelated-workload-investigation.json`; the ledger does not claim all 51 unchanged.

## Commit / Parent

The authorized candidate is exactly one local commit with subject
`feat(dashboard): integrate merchant product inventory`, directly above
`f0439c35d963bcfd67e79ebda1fcd0e23028b93d`. Its post-commit identity is recorded in
`artifacts/f3c/final-git.json` and the completion response; this report cannot embed
the hash of the commit containing itself. No amend or push is needed.

## Final Git State

Completion is conditional on the post-commit check: main, origin/main at the published
frontend baseline, behind/ahead 0/1, and clean worktree. The exact HEAD, parent,
subject, remote, status, and final backend identity are saved after the one authorized
commit in `artifacts/f3c/final-git.json` and returned in the completion response.
Backend's final pre-commit verification is clean 0/0 at published authority.

## Residual Limitations

The frozen backend supplies no idempotency receipt, operation-status endpoint,
optimistic version, stock unset, adjustment history, or location semantics. Explicit
review observes current state and cannot prove an earlier unknown request's outcome
or terminality. Subsequent absolute replacements can overwrite concurrent changes.
Variant inventory, Pricing, Media, and Variants/Options remain deferred.
The production journey verifies separate HTTPS frontend/API origins with the
frontend origin explicitly allowed by Laravel. A single-origin topology with the
current no-referrer policy does not supply Sanctum's stateful-read recognition
headers; it is not certified by this work. The disposable certificate does not
establish readiness of a deployed public TLS/domain configuration.

## Agent 2 Review Package

Review this report and `docs/F3C-integration.md`, the exact one-commit diff, permanent
tests, `artifacts/f3c/` sanitized result JSON/logs, mutation source hashes, real-request
evidence, screenshots/axe results, Docker source fingerprints/image scan, cleanup
comparison, and post-commit Git identity. Generated fixture credentials and TLS
private keys are not part of the review package or production image.
