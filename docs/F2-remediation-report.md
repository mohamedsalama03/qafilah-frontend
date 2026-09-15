# F2 focused minor remediation — A2-F2-L1

## Executive Summary

A2-F2-L1 is REMEDIATED. Store discovery now rejects observable cross-page drift, reconstructs the list at most once, and publishes only a complete consistent candidate. All required frontend, real Laravel and fresh Docker gates passed after targeted recovery of Docker Desktop's socket folders. Backend changes: NO. F3: NOT STARTED. Dependencies added: 0. Push: NOT ATTEMPTED. Delivery is exactly one new local remediation child of the F2 candidate; its full identity is recorded after commit in the final Git artifact and delivery response. Independent focused Agent 2 re-review remains PENDING.

## Agent 2 Finding Received

Agent 2's original decision was **CERTIFIED WITH MINOR CHANGES**: Critical 0, High 0, Medium 0, Low 1. A2-F2-L1 concerns a mixed/incomplete Store navigation list, not an authorization bypass. The reported race changes page 1's total 41 to page 2's total 40, leaving revoked Store 5 present and Store 21 missing. A permanent deterministic reproduction now reconstructs the list and verifies both corrections. Independent focused re-review remains PENDING.

## Baseline / Git Topology

The pre-edit frontend gate passed after `git fetch --prune origin`: branch `main`, clean worktree, behind 0/ahead 1.

| Identity                    | Verified value                                                 |
| --------------------------- | -------------------------------------------------------------- |
| Published F1 / origin/main  | `473b44c1c0bc0627942866c31b11aac4d4c35442`                     |
| F2 candidate / current HEAD | `9f12cefbfe227eb96983a2efa605b52b52c82f07`                     |
| F2 parent                   | `473b44c1c0bc0627942866c31b11aac4d4c35442`                     |
| Backend HEAD / origin/main  | `6614690a3b24b39f45c7c1b9ed85c20ecb22cbbf`                     |
| Remediation commit          | Commit containing this report; full hash in final Git artifact |

The required final topology is one new local child of F2, with published F1 as grandparent, behind 0/ahead 2. No amend, squash, rebase, history rewrite or push is authorized or performed.

## Remediation Scope

Production behavior changes only in `src/lib/stores/controller.ts`, within discovery traversal and its failure handling. Tests cover discovery and its existing chooser presentation. Documentation corrects the pagination overclaim without replacing the historical F2 integration results. A repeatable executable mutation runner exercises the real controller through an in-memory transform.

Backend modifications: NO. Backend contract changes: NO. Verified contracts: 6. Invented contracts: 0. Dependencies added: 0. Auth/session redesign: NO. Context or Store-switch authority redesign: NO. Catalog, Orders, Inventory, Shipping, Payment, Platform Admin, Customer Storefront and F3: NOT STARTED. Informational Agent 2 items remain outside this remediation.

## Root Cause

The F2 candidate validated individual pages, expanded traversal using the maximum observed last page, and silently retained the first occurrence of an overlapping UUID. It did not pin cross-page metadata or require final unique completeness. Independent backend page reads could therefore produce a mixed list that still reached `ready`.

## Pagination Consistency Invariant

An attempt owns a fresh ordered map and a copy of page 1's `total`, `last_page` and `per_page`. Every response must correspond to the requested page and agree with the pinned metadata. Numeric values must be safe integers with valid ranges; the existing 20-item response contract and logical count/page relationships remain enforced. Every pinned page must be consumed, with final unique Store count equal to pinned total. Only then may the candidate enter state and the principal discovery cache.

| Pagination case                                              | Focused result                |
| ------------------------------------------------------------ | ----------------------------- |
| Healthy 0, 1, 20, 23 and 61 Stores                           | PASS; backend order preserved |
| Total increase/decrease, including 41 to 40                  | DETECTED                      |
| Last-page increase/decrease                                  | DETECTED                      |
| Decoded cross-page page-size/current-page mismatch           | DETECTED                      |
| Canonical duplicate UUID, including uppercase representation | DETECTED                      |
| Conflicting duplicate name/status                            | DETECTED                      |
| Final unique count and incomplete/oversized final page       | VALIDATED                     |
| Huge last page                                               | BOUNDED                       |
| Mixed or partial new `ready` publication                     | ZERO                          |

## Bounded Retry Design

`DiscoveryInconsistency` is a private typed error with the existing safe `invalid-response` message. Only this type starts one full reconstruction from page 1. Attempt two owns a new map, page counter and paginator copy; it may legitimately pin different metadata. Both attempts belong to the same principal/discovery generation. A second inconsistency fails explicitly, with no third traversal. Healthy traversal incurs zero extra requests. Ordinary API errors, malformed transport responses, network failure, timeout, 400/401/403/404/419/422/429/500 and cancellation do not receive this special retry.

| Retry invariant                                       | Result |
| ----------------------------------------------------- | ------ |
| Trigger restricted to decoded traversal inconsistency | PASS   |
| Maximum attempts / full retries                       | 2 / 1  |
| First failed aggregate discarded                      | PASS   |
| New consistent metadata accepted on attempt two       | PASS   |
| No merge between attempts                             | PASS   |
| Second inconsistency fails explicitly                 | PASS   |
| Third attempt / request loop                          | ABSENT |

## Cross-Page Metadata Validation

The comparison precedes per-page relationship checks, so observable disagreement cannot extend or shorten the pinned traversal. `current_page` must match the requested page. The unchanged real backend adapter also rejects wrong response page numbers, and its strict decoder rejects malformed page sizes/statuses before they reach the controller. Those transport/contract failures retain their existing non-retry semantics. Controlled decoded-adapter fixtures separately exercise the controller's consistency checks; this does not weaken production decoding or invent backend behavior.

## Duplicate / Conflict Handling

Store UUIDs are normalized through the existing parser. Canonical name/status conflicts cause inconsistency. Identical repeated UUIDs also cause inconsistency: a page-boundary duplicate can displace another Store even when its metadata matches. There is no silent first-wins/last-wins normalization. Map insertion preserves backend page/item order. The final unique-count guard provides a further completeness constraint.

## Initial Discovery Failure

Before any successful traversal, repeated inconsistency yields `discoveryStatus: error`, a safe message and an empty unpublished candidate. It never yields successful zero Stores, a partial chooser, single-Store auto-entry or a context request. Rendered chooser tests assert the error, absence of zero-Store copy and absence of automatic navigation. No internal names, UUIDs, paginator comparisons or fabricated request IDs enter error copy.

## Background Refresh Failure

Repeated inconsistency retains exactly the previously verified list and discovery cache while exposing the error state. The failed candidate never merges into them. Existing selected context and scope remain unchanged; navigation discovery failure alone is not selected Store denial. Rendered tests preserve the old chooser entries and count, surface failure, and exclude candidate entries and zero-Store copy.

## Transient Failure Retention

Permanent tests assert exact retained UUIDs, array/cache identity and failure state after network, server, timeout and rate-limit refresh failure. A rendered network-failure test verifies the old two-Store list remains visible with the error. The special reconstruction does not replay these failures. These assertions close the previously GREEN transient-clears-list mutation gap.

## Pagination Ceiling

Production ceiling: **1000 pages**, unchanged. An oversized first-page paginator fails before requesting page 2 or allocating by total. The permanent test supplies 20 valid first-page items with total 20001 and last page 1001; a removed guard is detected with at most two adapter calls. Huge/unsafe numeric metadata, malformed relationships and incomplete candidates fail explicitly. Pinned metadata prevents a growing paginator from extending the loop indefinitely; retry count bounds repeated drift.

## Generation / Cancellation Safety

Current ownership is checked before dispatch, after each awaited response, before retry and before publication. Existing cancellation and generation mechanisms remain intact. Deferred tests resolve stale responses after disposal/logout, principal replacement, session loss, or a selected-context denial that invalidates an older discovery generation. The old request is aborted/ignored, cannot repopulate state/cache, and cannot clear the newer pending task. Concurrent discovery calls within a current generation still deduplicate; no new public refresh API was added.

| Generation invariant                                                 | Result                            |
| -------------------------------------------------------------------- | --------------------------------- |
| Logout/disposal during first attempt or retry                        | Late publication blocked          |
| Principal replacement during first attempt or retry                  | Old principal publication blocked |
| Newer discovery after existing invalidation supersedes attempt/retry | PASS                              |
| Old finalizer cannot clear newer pending discovery                   | PASS                              |
| Retry remains in original generation                                 | PASS                              |
| Old generation cannot publish partial aggregate                      | PASS                              |

## Request Counts

| Case                                       | Discovery requests        |
| ------------------------------------------ | ------------------------- |
| 0 / 1 / 20 healthy Stores                  | 1 each                    |
| 23 healthy Stores                          | 2, no automatic retry     |
| 61 healthy Stores                          | 4                         |
| Two-page first attempt with page-two drift | 2                         |
| Successful two-page reconstruction         | 2                         |
| Two failed page-two traversals             | 4 total, sequence 1,2,1,2 |
| Third automatic traversal                  | 0                         |
| Oversized first-page last_page             | 1                         |
| Context fanout per discovered Store        | 0                         |

## Mutation Evidence

The tracked runner `node tests/store-discovery-mutations.mjs` applies executable in-memory Vite transforms to the actual controller and runs the permanent tests. It rejects transformation/compile failures as evidence: RED requires assertion failures. All 17 variants matched expectations: 13 adversarial RED and four pristine/decoy GREEN runs. Full pristine runs each execute all 77 discovery/controller tests; selected mutants use an explicit focused test pattern. Results and killing assertion names are recorded in `artifacts/f2-remediation/mutations/results.json`.

| Executable variant                               | Result        |
| ------------------------------------------------ | ------------- |
| Accept total drift                               | RED           |
| Accept last-page drift                           | RED           |
| Accept page-size drift                           | RED           |
| Accept wrong current page                        | RED           |
| Silent identical duplicate normalization         | RED           |
| Conflicting duplicate first-wins                 | RED           |
| Publish mixed candidate after each page          | RED           |
| Remove retry bound                               | RED           |
| Remove 1000-page ceiling                         | RED           |
| Clear verified list on transient refresh failure | RED           |
| First page only                                  | RED           |
| Disable consistency reconstruction               | RED           |
| Original F2 executable source                    | RED           |
| Pristine before / after                          | GREEN / GREEN |
| Harmless comment / documentation decoys          | GREEN / GREEN |
| Mutation residue                                 | ABSENT        |

The duplicate acceptance mutations also bypass the redundant final unique-count check; otherwise that independent completeness check would still reject a truncated deduped list. The first-wins variant additionally removes the conflicting-metadata guard. This is executable acceptance behavior, not a documentation-only mutation. The baseline reproduction recorded `ready`, 40 published Stores, revoked Store 5 retained and Store 21 missing. Both decoys also pass the actual architecture inspector. Production source SHA-256 before/after: `a292ec7a801b7c307eb375a0c62d7df535a9f2056e1f399b8ab9c6f79de4a943`; source bytes were never rewritten by the runner.

## Focused Tests

Focused discovery/controller/chooser: **92 tests / 3 files PASS**. The new discovery file adds 48 cases; the existing chooser suite adds four rendered regressions. One original overlap test now expects the intentionally stricter behavior; all remaining F2 and F1 assertions remain. Tests use controlled response sequences and deferred handshakes without arbitrary sleeps.

## Full Frontend Verification

| Gate                                               | Remediation result                                        |
| -------------------------------------------------- | --------------------------------------------------------- |
| Frozen install                                     | PASS                                                      |
| Format / lint / typecheck                          | PASS                                                      |
| Full Vitest                                        | 460/460 tests across 18 files PASS; 0 failed/skipped/todo |
| Architecture                                       | 81/81 PASS; existing F1/F2 cases retained                 |
| Focused discovery/controller/chooser               | 92/92 tests across 3 files PASS                           |
| F1 development Playwright                          | 23/23 PASS, 54.6 seconds                                  |
| Production Playwright                              | 6/6 PASS, 10.9 seconds                                    |
| Real Laravel Playwright                            | 12/12 PASS, 36.0 seconds; 0 skipped/flaky/unexpected      |
| Production build                                   | PASS                                                      |
| Audit                                              | 0 vulnerabilities at all severities                       |
| Peer check                                         | PASS; no peer dependency issues                           |
| Fresh Docker build / boot / image scan             | PASS                                                      |
| Exact runtime-secret / fixture / browser-map scans | PASS; zero matches                                        |

The full suite preserves Sanctum adapter, CSRF/login/current identity/logout, failed-logout latch, same-principal lifecycle, Store context/switch isolation, foreign denial, permission projection, membership/identity status handling, return-path safety and Bearer architecture regression coverage. F1 M1, M2 and L1-L6 closures remain protected. Source behavior was frozen throughout final runtime verification; only the remediation report changed afterward.

## Real Laravel Regression

All 12 existing journeys passed again against the exact published backend. An ignored harness redirects only fixture/evidence paths into `artifacts/f2-remediation`, preserving baseline artifacts and every original test assertion. The backend snapshot, schema and authority actions ran only in the guarded disposable runtime. Results: 12 expected, 0 skipped, 0 flaky, 0 unexpected, 36.0 seconds.

| Required real regression                                 | Remediation rerun                |
| -------------------------------------------------------- | -------------------------------- |
| Sanctum login / CSRF / current identity                  | PASS                             |
| 23 nonowner Stores, 20+3, exactly two discovery requests | PASS                             |
| Selected Store context / A-to-B isolation                | PASS                             |
| Foreign denial / draft-owned exclusion                   | PASS                             |
| Permission removal / Role replacement                    | PASS                             |
| Membership suspension and rediscovery                    | PASS                             |
| Identity suspension                                      | PASS                             |
| Logout / failed logout / same-principal revalidation     | PASS                             |
| Store chooser long-name containment / axe / keyboard     | PASS                             |
| Return-path safety / Bearer guard                        | PASS in full frontend regression |

Healthy pagination retained two discovery requests, zero reconstruction retries and no context fanout. The selected destination still receives its independent context check; switching A to B requires one destination context request. The controlled cross-page race remains a deterministic frontend-adapter test rather than an invented backend endpoint or nondeterministic live membership race.

## Production Build / Docker

The local production build and six production browser checks passed. The fresh retained image is `qafilah-merchant-f2-remediation:review`, ID `sha256:5f2b1294edc66d0e0545b45c6b34af82fc6aa832ab7f1061dfb3134b46aaaa97`, size 70,299,259 bytes. It became healthy under UID/GID 1001:1001. Nine HTTP checks passed, including login 200, eight development-route 404s, fresh CSP and no-store behavior. Structural browser checks at 1440 and 390 pixels passed with no overflow or auth storage. The owned review container was then stopped and removed; the image remains local for review.

The bounded image scan covered 92 application files and 24 browser assets, including ten exact generated runtime secrets. Fixture, generic credential, exact-secret, environment-file and browser-map matches were all zero. The separate source scan covered all 136 tracked/new frontend files and 24 production browser assets, also with zero exact-secret/fixture/map matches. Dependency source maps are excluded from browser-map classification; these are bounded scans, not an exhaustive secret audit.

The image uses the same public build origin `https://localhost:3842` as the original F2 structural image check. The isolated Laravel service is HTTP, so the image's expected TLS failure is a controlled structural network-error check; no credentials were entered or login attempted there. The separate 12-journey browser suite supplies actual HTTP Laravel integration proof. Production TLS/Secure-cookie/CORS deployment is not newly certified.

Docker Desktop 4.82.0 initially failed on inaccessible sockets in `docker-secrets-engine/engine.sock` and `Docker/run/dockerInference`. In response to the user's Docker error report, the failed Desktop processes were stopped and the two verified socket-only parent directories were renamed to timestamped sibling backups. Docker recreated them and Engine 29.6.1 became available in Windows and WSL. No Docker settings, VHD/data directories, containers, images or volumes were reset or deleted during this recovery. The socket backups remain preserved; the recovery record is `artifacts/f2-remediation/docker-socket-recovery.json`. This matches a firsthand workaround reported in [Docker's issue tracker](https://github.com/docker/desktop-feedback/issues/554), not a claimed vendor fix.

## Backend Read-Only Proof

Backend HEAD and origin/main remain `6614690a3b24b39f45c7c1b9ed85c20ecb22cbbf`, clean, behind 0/ahead 0. Source, routes, migrations, authorization/security configuration, tests and backend history are unchanged. A Git archive of that exact revision supplied the isolated Docker runtime; existing migrations, fixture helpers and authority actions affected only its separately named synthetic database. Final read-only status includes untracked files. Evidence: `artifacts/f2-remediation/backend-runtime-check.json` and final gate/Git records.

## Documentation

`backend-contracts.md` explicitly describes independent page snapshots, observable drift detection, strict duplicate handling, exactly one full retry, completeness and failure semantics. `F2-report.md` corrects the original pagination claim and qualifies its historical no-retry statement. Its certified integration history remains intact. Discovery remains navigation data; selected Store context remains the authority projection; Laravel remains operation authority. No stable-snapshot or authorization-strength overclaim is made. This report traces A2-F2-L1 through root cause, runtime change, tests, mutation evidence and remaining delivery gates.

## Commands Executed

Frontend baseline and final fetch, branch/status, HEAD/parent/grandparent/origin identity, parity and diff checks; backend read-only status/identity/parity; source and installed Next guide inspection; frozen pnpm install; focused/full Vitest; executable mutation harness and decoys; formatting, ESLint and typecheck; production build; F1 development/production Playwright; all 12 real Laravel journeys; audit and `pnpm peers check`; exact source/asset secret scans; fresh Docker build, non-root health, HTTP/browser/image checks; guarded cleanup; scoped full diff review; and exactly one new local remediation commit. Sanitized logs, test JSON, image details and Git proof are retained under `artifacts/f2-remediation`.

## Commands Failed / Recovered

Docker Desktop start/restart initially failed on inaccessible socket files. Targeted parent-directory rename recovered it without factory reset or settings changes, allowing all required runtime gates to pass. The original failure evidence remains as history. `pnpm explain peer-requirements` was unsupported by installed pnpm; `pnpm peers check` passed. An early full-suite command used an extra argument separator and produced a standard log rather than JSON; the final direct `pnpm exec vitest run --reporter=json --outputFile=...` invocation records structured evidence. A supplemental API pagination probe initially reused the pre-login CSRF value for logout and correctly received 419; rereading the rotated cookie fixed that probe. All 12 browser journeys passed on their first run. Deliberate mutation assertion failures are expected proof, not pristine regressions. No frontend implementation regression required a runtime workaround.

## Commands Not Executed

Backend full PHPUnit was not required for this frontend-only change and was not rerun. Backend source edits, new contracts, security configuration changes, database migration changes, auth/context redesign, unrelated Agent 2 informational remediation and F3 work were not undertaken. Amend, rebase, squash, force operations, Git push and image push were NOT ATTEMPTED. No Docker factory reset, global prune, global socket deletion or WSL distribution deletion was performed.

## Cleanup

Frontend Playwright-owned servers stopped on suite completion. In-memory mutation transforms never rewrite production source. The fresh frontend review container was stopped and removed, and its image retained. The isolated backend containers, network, volumes, generated credentials and temporary fixture database are removed only after source/image scans finish, with labels/names guarded; exact completion is recorded in `artifacts/f2-remediation/cleanup.json`. Pre-existing shared containers, volumes and images are preserved, and no global Docker prune is used. Sanitized evidence, snapshot and reproduction scripts remain. The two renamed host socket folders remain as reversible backups, and Docker Desktop remains running.

## Commit / Parent

The remediation commit is the sole new local child containing this report, with subject `fix(dashboard): harden store discovery pagination consistency` and parent `9f12cefbfe227eb96983a2efa605b52b52c82f07`. Its full hash is recorded after commit in `artifacts/f2-remediation/final-git.json` and the delivery response, avoiding a self-referential commit hash in tracked content. Neither F2 nor published F1 is amended or rewritten.

## Final Git State

Required post-commit identity: branch `main`; HEAD is the sole remediation child, HEAD^ is `9f12cefbfe227eb96983a2efa605b52b52c82f07`, HEAD^^ and origin/main are `473b44c1c0bc0627942866c31b11aac4d4c35442`. After final fetch, behind 0/ahead 2, clean worktree and empty diff-check output are verified in `artifacts/f2-remediation/final-git.json`. Push is NOT ATTEMPTED.

## Residual Risks

Only observable cross-page inconsistency is detectable. Ordinary page pagination supplies no cursor, snapshot token or shared transaction identifier. A concurrent change can leave apparently consistent metadata and UUIDs even though pages were read at different times. Reconstruction does not establish a shared snapshot. Each selected Store still requires independent context verification before private workspace rendering; the backend authorizes operations. Production TLS/CORS deployment, additional browser/screen-reader coverage and unrelated Agent 2 informational items remain outside this focused change. The host runtime blocker was recovered; all required verification gates passed.

## Agent 2 Focused Re-review Package

Review the sole remediation child of F2, the controller diff, permanent discovery/chooser tests, mutation runner/results and corrected pagination documentation. Focus on A2-F2-L1, strict duplicates, one reconstruction, initial/background failure semantics, transient retention, ceiling enforcement, cancellation and truthful snapshot limits. Original decision: CERTIFIED WITH MINOR CHANGES, Low 1. Known Low findings remaining after implementation verification: 0; independent focused re-review remains PENDING. Runtime checks passed, but this report does not claim Agent 2 has independently approved the remediation.

Exact changed files:

- `src/lib/stores/controller.ts`
- `src/lib/stores/controller.test.ts`
- `src/lib/stores/discovery.test.ts`
- `src/features/stores/components/store-workspace.test.tsx`
- `tests/store-discovery-mutations.mjs`
- `tests/store-discovery-mutations.config.mjs`
- `docs/backend-contracts.md`
- `docs/F2-report.md`
- `docs/F2-remediation-report.md`

Evidence: `artifacts/f2-remediation/vitest-final.json`, `mutations/results.json`, `mutations/baseline-a2-observed.json`, `mutations/architecture-decoys.json`, `development-e2e.log`, `production-e2e.log`, `build.log`, `audit.json`, `peers-check.log`, `production-source-scan.json`, `runtime/setup-status.json`, `integration-harness.json`, `backend-runtime-check.json`, and final gate/Git records. Additional evidence includes integration-results.json, docker/summary.json, docker-socket-recovery.json and cleanup.json. All required checks passed; the remaining independent action is focused Agent 2 re-review. No broader implementation work is needed for the known finding.
