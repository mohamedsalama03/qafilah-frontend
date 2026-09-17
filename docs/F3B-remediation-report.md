# Frontend F3-B M1/L1 remediation report

## Executive Summary

Agent 2 findings A2-F3B-M1 and A2-F3B-L1 are remediated above candidate `b669c968ca8535475c4f0a9f06cbdc12515b2729`. Confirmed Product writes now retain their completed action slot. Explicit review or a blank-form reset is required before another write. All required regression and production gates pass. Backend source, contracts, dependencies, and published history are unchanged; no push is attempted. The candidate is ready for focused Agent 2 re-review.

## Root Cause

The original single-flight latch protected only an outstanding request. A successful response cleared that latch and immediately enabled the opposite lifecycle action or the same submitted form. A second click or Enter arriving after the response could therefore dispatch a second mutation.

## M1 Remediation

The existing `success` state is terminal for its action slot. Publish/Unpublish success replaces the write controls with a confirmation and **Review product actions**. A separate explicit authoritative GET must succeed before another action becomes available. Review completion focuses a neutral container, so continued Enter presses cannot activate the newly available opposite action.

## L1 Remediation

Create and Save success replace the submitted form with a confirmation panel. Its completed payload cannot be submitted again, including while navigation is pending or the route remounts. New deliberate actions receive a new slot; handlers captured from the old slot cannot write through it.

## Mutation State Model

| State                     | Write behavior                                      | Safe transition                                                                     |
| ------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `idle` / definite `error` | A deliberate write may begin                        | `pending`                                                                           |
| `pending`                 | Repeated calls coalesce into the existing operation | `success`, definite `error`, or `unknown`                                           |
| `success`                 | Completed slot rejects writes                       | Explicit review or confirmed-create blank reset                                     |
| `reviewing`               | Writes remain blocked; only the requested GET runs  | Successful authoritative review creates a fresh slot; failure retains known success |
| `unknown` / `reconciling` | No automatic write replay                           | Existing explicit unknown-outcome reconciliation rules                              |

Slot numbers are memory-only interaction identities, scoped to the session, exact Store authority revision, and Product/create controller. They are not backend version or idempotency fields. There is no debounce, timer, artificial write delay, dependency addition, or generic retry framework.

## Publish / Unpublish

The confirmed action is acknowledged without exposing its opposite as an enabled replacement. Explicit **Review product actions** reads current backend state and then enables only valid transitions. A failed read preserves the confirmed lock and reports that the change was saved but could not be reviewed.

## Create

**Create another product** explicitly resets to a blank slot and replaces the pending destination with the new-product route. It does not copy or resend previous input. Create-only merchants retain the existing supported flow without Product read access or read-cache publication.

## Save

**Start a new edit** immediately replaces any older pending destination, then requests authoritative Product details. A successful read creates a fresh form using those details. The edit screen reads its query and mutation slot in the same render, preventing both stale retained-result precedence on reopening and stale props during immediate slot renewal. No navigation runs after the read, so a merchant who has since left for Overview remains there. Failed review retains the completed Save lock. This known-success review GET does not trigger an inaccurate write-in-flight departure warning.

## Archive

The existing confirmation, single-flight behavior, and archived terminal state remain. A completed Archive cannot dispatch again. No delete or restore capability is added.

## Natural Double-Click Evidence

All 60 permanent component interval/input combinations pass across Publish, Unpublish, Create, Save, and Archive. They cover click and Enter at immediate/in-flight, 50, 120, 200, 300, and 450 ms; the zero interval additionally challenges the outstanding request before immediate post-response input. All 30 real Laravel physical double-click sequences dispatch exactly one mutation and retain the expected authoritative final state. Twenty second clicks occur after the HTTP response, including every operation's 450 ms representative. Publish sends one Publish and zero Unpublish, ending published; the inverse ends draft. Separate Create/Save Enter tests explicitly wait for the actual successful response while holding only subsequent navigation, with one POST/PATCH and no duplicate-validation residue.

## New Deliberate Action Evidence

Permanent tests pass for later Unpublish, a new field edit and Save, and blank Create another. Additional passing cases challenge stale handlers, remounts, failed reviews, pending navigation, leaving during a delayed review, a newer authoritative Product returned during immediate review, and reopening after a newer read. Subsequent PATCH construction preserves the freshly reviewed baseline.

## Unknown Outcome Regression

Existing network/lost-response, timeout-after-dispatch, ambiguous 5xx, malformed-success, and mismatched-UUID handling is retained. Unknown locks are not reset by confirmed-success handling. Unknown Create still requires explicit list review before a separate blank action; a finite list does not establish that an uncertain write failed. Pre-dispatch failures remain definite and retryable.

## Store / Principal Isolation

Controllers retain the existing session → exact authority scope → Product/create ownership. Access is checked before dispatch, before publication, and during explicit review. Store/principal changes prevent late responses from publishing into another scope. No global lock is shared across unrelated Stores or Products.

## Permission Regression

`products.create`, `products.update`, `products.publish`, `products.view`, and `categories.view` retain their existing independent meaning. Current context controls presentation and Laravel remains authoritative. Product contracts, Role authority, Store authority, and the backend are unchanged.

## Mutation Evidence

All 13 variants in `resubmission-mutations/results.json` match their expected result. The exact rejected `b669c968` source produces eight response-boundary assertion failures. Pristine, comment decoy, string decoy, and pristine-after each pass 21 focused assertions. Eight operative variants fail only on assertions: terminal controller guard (5), lifecycle completed slot (4), Create completed slot (2), Save completed slot (2), retained handler slot (4), retained reviewed Product precedence (2), query-notification/form-renewal ordering (1), and review mislabeled as a write (1). UI variants remove the selected completed branch and its redundant shared guard together; a branch-only deletion remains protected by the controller. Compiler failures and timeouts do not count as RED proof.

The preserved bounded scoped-session harness also passes: pristine and both comment/string decoys GREEN, unlimited same-principal reconciliation mutant RED with four assertion failures, pristine-after GREEN. Both harnesses transform modules only in memory. Protected source/test hashes are identical before/after; mutation residue is absent.

## Full Tests

| Gate                                       | Result                                    |
| ------------------------------------------ | ----------------------------------------- |
| Formatting                                 | PASS                                      |
| ESLint, zero warnings                      | PASS                                      |
| Next type generation and TypeScript        | PASS                                      |
| Full Vitest                                | 881 passed, zero failed/pending, 29 files |
| Architecture, included above               | 144 passed                                |
| Focused resubmission tests, included above | 84 passed                                 |
| Development Playwright                     | 23/23, zero failed/skipped/flaky; 45.6 s  |
| Production build                           | PASS                                      |
| Production Playwright                      | 7/7, zero failed/skipped/flaky; 15.3 s    |
| Frozen lockfile, strict peer dependencies  | PASS                                      |
| Audit / production audit                   | Zero vulnerabilities in each              |

The initial existing controller/UI/architecture subset also passed all 203 tests. Full Vitest used four workers; no assertions were weakened or tests skipped. Production build restored generated `next-env.d.ts` to its committed form, leaving only the intended 13 files in the remediation diff.

## Real Laravel Regression

All real suites pass with zero failures, skips, flaky tests, or browser runtime errors:

| Suite           | Passed | Duration |
| --------------- | ------ | -------- |
| New remediation | 39     | 79.1 s   |
| Existing F3-B   | 23     | 61.0 s   |
| Existing F3-A   | 18     | 51.0 s   |
| Existing F2     | 12     | 40.2 s   |

All runtime tests use a fresh frontend-owned archive of backend authority `6614690a3b24b39f45c7c1b9ed85c20ecb22cbbf`, isolated containers, and synthetic fixture identities. The backend checkout is not used for fixture mutations. The final new/F3-B suites rerun against fresh data after runtime source freeze. Source hashes remain unchanged through verification. F3-A/F2 assertions match the candidate; F3-B differs only by two required explicit review steps. Copies alter only fixture/evidence paths and native Docker fixture transport. Earlier phase evidence is preserved.

Six confirmed Publish/Create/Save screenshots were visually inspected at 1440 and 390 px. All six targeted axe scans report zero violations and no horizontal overflow; explicit review restores neutral keyboard focus. No full-WCAG certification is claimed.

## Production / Docker

Production build and all seven production browser tests pass. Fresh image `qafilah-merchant-f3b-remediation:review`, ID `sha256:72fc11b0310f87a252b709fafdfc2bd376247ed535f399cb6b770052df4c368e`, passes 13 HTTP and 10 desktop/mobile browser checks. Login, Product list/detail/create/edit deep links, development-route exclusion, anonymous privacy boundaries, credential storage, and browser runtime errors are checked.

The container runs as UID/GID 1001/1001, is healthy with zero failing health checks, binds only loopback port 3843, and has no mounts or sensitive environment names. All 1,331 deployed files were scanned: 217 application files and 1,114 dependency files, including 28 browser assets. Zero known fixture/secret matches, dotenv files, unexpected test/PHP files, browser maps, or map references were found. This is a bounded pattern scan, not a universal secret-detection guarantee.

All 102 runtime/build inputs match before build, after build, and after verification: fingerprint `a2ed74b5a62027b20966fdf8df8cd40f4adedfd3c0dd33bd46e70a256458001e`. The owned review container was removed; its image is retained. Shared Docker workloads remain untouched. HTTPS against the isolated HTTP backend produces the expected `net::ERR_SSL_PROTOCOL_ERROR` and fails closed; successful production TLS authentication is not claimed.

## Backend Read-Only Proof

Initial and final fetched backend HEAD and `origin/main`: `6614690a3b24b39f45c7c1b9ed85c20ecb22cbbf`; branch `main`, behind/ahead `0/0`, clean. Sanitized final proof: `artifacts/f3b-remediation/backend-final-git.json`. Initial frontend HEAD `b669c968ca8535475c4f0a9f06cbdc12515b2729`, parent and fetched `origin/main` `099708075e74b48011016dbde731b2befab2e7d5`, main `0/1`, clean. Contracts, central backend adapters, Product queries, and dependency/lockfile contents have no diff against that candidate.

## Changed Files

Runtime changes are limited to three existing Product feature files; no other application code changes.

- `src/features/products/mutations.ts`
- `src/features/products/components/product-actions.tsx`
- `src/features/products/components/product-form-screen.tsx`
- `src/features/products/product-resubmission.test.ts`
- `src/features/products/components/product-resubmission.test.tsx`
- `tests/product-resubmission-mutations.mjs`
- `tests/product-resubmission-mutations.config.mjs`
- `tests/integration/product-resubmission.spec.ts`
- `tests/integration/laravel-product-resubmission-fixtures.php`
- `tests/integration/product-management.spec.ts` — adds only two explicit review steps to the existing lifecycle journey.
- `playwright.product-resubmission.config.ts`
- `docs/F3B-remediation-integration.md`
- `docs/F3B-remediation-report.md`

## Commands Executed

Executed from the frontend root, using `corepack pnpm` on Windows:

- Baseline/final `git fetch --prune origin`, identity, ancestry, status, and behind/ahead checks; backend equivalents through native Git over the UNC path.
- `pnpm install --frozen-lockfile --strict-peer-dependencies`.
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`.
- `pnpm exec vitest run --maxWorkers=4 --reporter=json --outputFile=artifacts/f3b-remediation/vitest-results.json`, plus focused subsets.
- `node tests/product-resubmission-mutations.mjs` and the preserved scoped-session harness copy under remediation artifacts.
- `pnpm exec playwright test '--reporter=list,json'`.
- `pnpm exec playwright test --config playwright.product-resubmission.config.ts` and preserved F3-B/F3-A/F2 regression harnesses documented in the integration guide.
- `pnpm build`; `pnpm exec playwright test --config playwright.production.config.ts '--reporter=list,json'`.
- `pnpm audit --json`; `pnpm audit --prod --json`.
- Native Docker setup/reset controls for the isolated published backend archive; fresh frontend image build, image-content scan, HTTP/browser checks, source fingerprint comparison, and guarded cleanup.

PowerShell quotes the comma-separated reporter value as one argument. Playwright's JSON output environment variable writes separate phase reports; the local Corepack shims are added only to the child command's PATH. Installed Next.js router guidance was read before code changes.

## Commands Failed / Recovered

- An initial WSL execution failed with `Wsl/Service/0x8007274c` before Git ran. Native Windows Git over the backend UNC path and native Docker completed the checks without restarting WSL/Docker or shared workloads.
- TypeScript initially saw unfinished regression-test literals/options during parallel authoring. The tests were corrected; final Next type generation and TypeScript pass.
- A real 120 ms case received its response after 222 ms. The timing assertion was corrected to record the actual response boundary rather than assume server latency. All intervals still require one mutation and correct final state; explicit post-response cases separately guarantee boundary coverage.
- Focused review found that a retained successful Product could override a newer edit GET. Removing that precedence exposed an immediate query-notification/form-remount race in a new failing test. Reading query data and slot state in the same edit-screen render resolved both cases. New regression tests also cover successful-review departure prompts.
- The new real external-writer regression initially assumed that returning to detail always performs a fresh GET. The existing 30-second read cache correctly reused its value. The test now explicitly uses **Refresh product**, verifies authoritative Product B, and then proves that Edit and its sparse PATCH preserve B over retained mutation A. The read-cache contract is unchanged.
- PowerShell initially split an unquoted comma-separated Playwright reporter argument. Quoting the argument recovered the run; the failure occurred before any tests or server startup.

## Cleanup

Cleanup is complete. Four owned backend runtime containers, two owned networks, two owned volumes, and all five generated credential files were removed after exact ownership/path checks. No owned resources or private container copies remain; port 3842 is free. The frontend Docker review container was also removed. The 49 shared containers retain identical IDs, images, and states before/after cleanup. Published archives, sanitized evidence, screenshots, and the fresh review image are retained. `cleanup-result.json` records these checks.

Both operative harnesses leave no source residue. Earlier phase evidence is preserved. Backend source, dependencies, and existing history are unchanged; no amend, squash, or push.

## Commit / Parent

The commit containing this report is the one new remediation commit, with subject `fix(dashboard): prevent product mutation resubmission`, directly above `b669c968ca8535475c4f0a9f06cbdc12515b2729`. Its parent has not been amended or squashed. The exact new hash is recorded after commit creation in `artifacts/f3b-remediation/final-git.json` and the final response.

## Final Git State

The final post-commit proof is `artifacts/f3b-remediation/final-git.json`: branch `main`; parent `b669c968ca8535475c4f0a9f06cbdc12515b2729`; grandparent and fetched `origin/main` `099708075e74b48011016dbde731b2befab2e7d5`; behind/ahead `0/2`; clean worktree. No push or history rewrite is attempted.

## Agent 2 Focused Re-review Package

Review the three-file runtime diff against `b669c968`, the 84 permanent focused tests, the 13-variant mutation harness, and the real Laravel request/final-state evidence. Internal independent review found the retained-result issue and confirmed its correction; no remaining blocking findings were reported. Agent 2's focused re-review remains the next external decision.

Sanitized evidence under `artifacts/f3b-remediation/` includes `vitest-results.json`, `resubmission-mutations/results.json`, `scoped-session-mutations/results.json`, `natural-double-click-summary.json`, `real-integration-summary.json`, `regression-harness-integrity.json`, `development-results.json`, `production-results.json`, screenshots/axe results, `docker-review.*`, backend proof, cleanup proof, and `final-git.json`. Reproduction instructions are in `docs/F3B-remediation-integration.md`. Earlier phase evidence remains preserved. F3-C is not started.
