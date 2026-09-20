# Frontend F3-B L2 remediation report

## Executive Summary

Focused remediation of A2-F3B-L2 above `e3eff36f62d793c4248a80506b926a07e3aa0e29`. Product reconciliation guidance now belongs to the existing scoped mutation slot and survives keyed form renewal. All required frontend regression gates pass, including 902 unit tests, 99 real Laravel journeys, and production/Docker verification. M1/L1 safeguards and mutation contracts remain unchanged. An independent final audit confirms the tested inputs still match the source. A later host Docker startup failure prevents a fresh resource inventory; its precise cleanup-evidence limitation is recorded below.

## Root Cause

Explicit reconciliation correctly populated the authoritative Product cache and renewed the mutation slot. Renewal remounted the keyed form, while the old form's async handler then called its own `setNotice`. That component instance no longer owned the displayed form. The same local-reset branch could lose the intended blank-create guidance.

## L2 Remediation

The existing `freshSlot` state update now atomically carries presentation-only guidance: `product-loaded` for a successful explicit Product review, or `blank-product` for a deliberate blank creation reset. `MutationFeedback` renders that guidance as an accessible status. Obsolete post-renewal form setters are removed; the keyed fields still initialize from current query data or blank defaults.

## Notice Lifecycle

Guidance belongs to the existing session → exact Store authority scope → Product/create controller. It survives slot-triggered and incidental form remounts and remains visible while the merchant reviews or edits. The next actual mutation's existing pending/error/success state replaces it. Local no-change validation copy stays independent.

No timer, DOM manipulation, storage, new global application state, automatic read/write, retry, or focus effect is added. Slot numbering, stale-handler rejection, reconciliation latches, and same-render query/slot ownership remain unchanged. The event does not establish whether an uncertain write committed.

## Uncommitted Unknown Update

Permanent and real Laravel tests pass: typed B, uncertain PATCH aborted before it reaches Laravel, server remains A, explicit GET returns A, and the renewed form shows A with “The latest product was loaded from the server. Review it before making another change.” All five reconstructed probe iterations preserve the notice. The real journey also verifies the old form detaches and a later deliberate description-only PATCH succeeds exactly once.

## Committed Unknown Update

Permanent and real Laravel tests pass for the committed-B scenario: Laravel returns 200 for the real PATCH, its browser response is deliberately lost, explicit GET returns B, and the renewed form shows B with the same guidance. The backend response proves commitment independently of matching values. A later deliberate field edit sends exactly one new sparse PATCH.

## Start New Edit

Successful explicit review carries `product-loaded` into the new edit slot. The form continues to use current query data rather than a retained mutation Product. Known successful writes remain known when a later review GET fails. Archived authoritative results can show the guidance in the read-only form branch.

## Create Another

Confirmed Create-another and reviewed unknown Start-a-separate-product both retain the intended “A new blank product form is ready. No earlier request has been repeated.” guidance. Existing keyed renewal resets input and errors. The earlier payload is not reused or replayed.

## M1/L1 Regression

All 84 permanent M1/L1 resubmission tests pass, including 60 click/Enter combinations for five operations at 0, 50, 120, 200, 300, and 450 ms. All 13 existing operative harness variants have their expected results, including unsafe post-success guards, stale handlers, and stale Product precedence. Initial existing mutation/UI/architecture subset: 287 passed. All 39 real natural/held response-boundary tests pass: Publish double-click sends one Publish and zero Unpublish; Unpublish sends one Unpublish and zero Publish; Create and Save resubmissions send one POST/PATCH; Archive stays single-flight. Confirmed locks, explicit future actions, and captured-slot handlers are unchanged.

## Unknown Outcome Regression

Unknown locks still require explicit reconciliation. Failed unknown reconciliation retains the unknown state and submitted input. Failed review of a known successful write retains confirmed success. Guidance is only created after successful explicit renewal and does not alter authority, dispatch, error classification, or replay behavior.

## Accessibility

The visible status uses `role="status"`, `aria-live="polite"`, and `aria-atomic="true"`. Keyboard and immediate-remount tests pass, including keeping a merchant's newer focus choice while a review completes. The notice does not focus itself. Six focused axe scans pass across uncommitted-update, committed-update, and separate-blank guidance at desktop 1440 and mobile 390 widths. Root visually inspected all six screenshots: readable guidance, correct values, no layout defect or overflow. These checks cover the tested surfaces, not a full WCAG audit.

## Mutation Evidence

The original external Agent 2 probe file was not found locally. Permanent behavioral tests recreate the described five-run uncommitted-update probe: exact `e3eff36` in-memory source reproduces **0/5** notices through five assertion failures; corrected code passes **5/5**. The notice-loss mutant removes only fresh-slot guidance while retaining server values, slot identity, locks, and dispatch behavior. All nine targeted behavioral assertions fail. Pristine, comment decoy, string decoy, and pristine-after each pass 15 component tests.

All 13 preserved resubmission variants and all five bounded scoped-session variants also produce their expected results. The latter kills unlimited reconciliation with four assertion failures. Mutants execute through in-memory module transforms; compilation failures and timeouts do not count as RED. All protected source/test hashes are unchanged, and every harness reports residue absent. Output-root options preserve earlier evidence; adding `MutationFeedback` to protected hashes extends coverage without changing the old behavioral assertions or transforms.

## Full Tests

Full Vitest: **902 passed, zero failed/pending, 31 files**, including **144 architecture assertions**. Focused L2/M1/L1 combined subset: **105 passed** (21 new guidance tests and 84 preserved resubmission tests). Formatting, lint, Next type generation/TypeScript, and frozen strict-peer installation pass. Development Playwright: **23 passed**. Production build and production Playwright: **7 passed**. Browser suites have zero failures, flaky cases or skips. Both dependency audits report zero vulnerabilities. No dependency or lockfile changes. The final production build returned generated `next-env.d.ts` to its baseline content; no generated-file edit is included.

## Real Laravel Regression

All **99 real Laravel journeys pass**, with zero failures, retries/flaky cases, or skips: focused L2 **7**, preserved M1/L1 natural/held response boundaries **39**, F3-B **23**, F3-A **18**, and F2 **12**. Tests use a fresh frontend-owned archive of frozen backend authority with isolated synthetic data; Laravel checkout source is read-only. The four old tracked suites match their baseline blobs. Ignored harness copies adjust only evidence/fixture paths and native Docker transport; assertions and deliberate review steps remain intact. See `docs/F3B-L2-integration.md` for reproduction and `artifacts/f3b-l2/*-results.json` for complete results.

## Production / Docker

Production build and all seven production browser tests pass. Fresh image `qafilah-merchant-f3b-l2:review` is `sha256:6ac1954bbbf91c8ec829d49896e2cbffce00a2ee52bbd850bae400dd23225cd0`. All **102 runtime/build inputs** match before build, after build, and after verification: fingerprint `4115630bd7f13c374a2ad0cf64e67d7f4caa93a31f5f99d94758e882be84f21e`.

The container was healthy with zero failing streak, ran as UID/GID **1001/1001**, bound only loopback port 3843, and had no mounts or sensitive environment names. **13 HTTP** and **10 browser** cases pass. The bounded deployed-file scan checked **1,331 files** (217 application, 1,114 dependencies; 28 browser assets), with zero fixture/secret matches, dotenv files, unexpected application paths, browser source maps or map references. The owned review container was removed; its image and sanitized evidence remain.

Docker browser checks deliberately verify safe failure against configured HTTPS while the isolated Laravel service speaks HTTP; the observed failure is `net::ERR_SSL_PROTOCOL_ERROR`. This structural check does not certify production TLS authentication. The 99 real Laravel HTTP journeys provide separate authentication and Product integration evidence. Docker build and verification both exited zero with no failed commands. No Next build/type generation or runtime edit followed image fingerprinting.

## Backend Read-Only Proof

Initial fetched backend: `main`, HEAD and `origin/main` both `6614690a3b24b39f45c7c1b9ed85c20ecb22cbbf`, behind/ahead `0/0`, clean. Initial frontend: `main`, HEAD `e3eff36f62d793c4248a80506b926a07e3aa0e29`, parent `b669c968ca8535475c4f0a9f06cbdc12515b2729`, grandparent and `origin/main` `099708075e74b48011016dbde731b2befab2e7d5`, behind/ahead `0/2`, clean. Both baselines passed before source edits. A fresh native Git fetch and final backend check on September 20 confirm the same required `main` revision, `0/0`, and clean status. Evidence: `artifacts/f3b-l2/backend-final-git.json`. Backend modifications: **0**.

## Changed Files

The 14 intended tracked files are:

- `src/features/products/mutations.ts`
- `src/features/products/components/mutation-feedback.tsx`
- `src/features/products/components/product-form-screen.tsx`
- `src/features/products/product-guidance.test.ts`
- `src/features/products/components/product-guidance.test.tsx`
- `tests/product-guidance-mutations.mjs`
- `tests/product-guidance-mutations.config.mjs`
- `tests/product-resubmission-mutations.mjs`
- `tests/scoped-session-mutations.mjs`
- `playwright.product-reconciliation.config.ts`
- `tests/integration/product-reconciliation.spec.ts`
- `tests/integration/laravel-product-reconciliation-fixtures.php`
- `docs/F3B-L2-integration.md`
- `docs/F3B-L2-report.md`

Runtime scope is limited to the first three files. The two existing harness changes preserve old evidence paths by default and add an explicit output-root override; resubmission input hashing also covers `MutationFeedback`. No dependencies, lockfile, backend, API contracts, or unrelated feature files change. Evidence files under `artifacts/f3b-l2/` are ignored and retained locally.

## Commands Executed

Commands run from the frontend workspace, with frontend-owned artifact paths:

```text
git fetch --prune origin
git rev-parse HEAD HEAD^ HEAD^^ origin/main
git rev-list --left-right --count origin/main...HEAD
git status --short
git status -sb
git log -1 --format="%H%n%P%n%s"
corepack pnpm install --frozen-lockfile --strict-peer-dependencies
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm exec vitest run --maxWorkers=4 --reporter=json --outputFile=artifacts/f3b-l2/vitest-results.json
node tests/product-guidance-mutations.mjs
node tests/product-resubmission-mutations.mjs
node tests/scoped-session-mutations.mjs
corepack pnpm exec playwright test --reporter=list,json
corepack pnpm build
corepack pnpm exec playwright test --config playwright.production.config.ts --reporter=list,json
corepack pnpm exec playwright test -c playwright.product-reconciliation.config.ts
corepack pnpm exec playwright test -c artifacts/f3b-l2/playwright.regressions.config.ts product-resubmission.spec.ts
corepack pnpm exec playwright test -c artifacts/f3b-l2/playwright.regressions.config.ts product-management.spec.ts
corepack pnpm exec playwright test -c artifacts/f3b-l2/playwright.regressions.config.ts products.spec.ts
corepack pnpm exec playwright test -c artifacts/f3b-l2/playwright.regressions.config.ts merchant.spec.ts
corepack pnpm audit --json
corepack pnpm audit --prod --json
git diff --check
```

The last two mutation harnesses used `QAFILAH_MUTATION_ARTIFACT_ROOT=artifacts/f3b-l2`. Playwright JSON output was directed to the new phase directory; PowerShell comma-containing reporter arguments were quoted. Native Git fetched and checked the read-only backend over its existing UNC path. The isolated runtime setup, initialization/reset, regression preparation and guarded cleanup commands are documented in `docs/F3B-L2-integration.md`. The Docker build/verification scripts, input hashes, image scan, HTTP and browser checks are retained under `artifacts/f3b-l2/docker-review.*`. Targeted Prettier writes format only new/changed files. Git staging and the one new commit occur only after all gates pass.

## Commands Failed / Recovered

- A skill reference lookup used `references` instead of its actual `reference` directory. The correct installed hardening/craft guidance was read before UI edits.
- Runtime-independent proof work first executed after the fix landed; it is labeled current smoke. Rejected-baseline evidence uses exact committed source through in-memory transforms, never a falsely labeled live baseline run.
- The first real-browser run used a broad alert selector that also matched Next.js's route announcer. The harness now selects the intended message explicitly; fresh fixture data is used for the corrected run. No application assertions or runtime behavior were weakened.
- Two early regression report paths resolved beneath the ignored configuration directory. The successful reports were copied to the intended L2 root and subsequent reports use absolute paths; test assertions and outcomes were unaffected.
- Final peer review requested a direct HTTP 200 assertion for the explicit reconciliation response. It was added before parsing the same response body. All seven focused tests passed again on fresh synthetic fixtures. No runtime change was needed.
- After the session resumed on September 20, Docker Desktop was stopped. A startup attempt for final inventory failed at its host `C:\Users\Mohamed\AppData\Local\Docker\run\dockerInference` socket with “The file cannot be accessed by the system.” The waiting read-only Docker client was stopped. No socket/configuration repair or factory reset was attempted. Earlier image/build/browser verification remains valid because all 102 tested inputs still match; fresh live cleanup inventory is not claimed.

## Cleanup

The frontend review container was removed and verified absent on September 19. Guarded isolated-runtime cleanup also ran that day: retained Docker API proxy logs contain paired removal requests/responses for four containers, two networks and two volumes, followed by an owned-container inventory request. Those proxy lines omit response status codes, so they are historical removal evidence rather than a new live absence assertion.

All six credential leaf files are verified absent on September 20, and ports 3842/3843 have no listeners. Fresh Docker inventory and a final comparison of shared container states could not run because of the separate host socket failure. No shared workload, Docker socket/configuration, or backend source was changed to repair it. Prior phase artifacts, images and sanitized evidence are retained. See `artifacts/f3b-l2/cleanup-final-evidence.json` and `cleanup-docker-api-log.txt` for the exact limitation. Mutation transformations occur in memory; all protected hashes match and residue is absent.

## Commit / Parent

The commit containing this report is the single new local remediation commit, with subject `fix(dashboard): preserve product reconciliation guidance`, directly above `e3eff36f62d793c4248a80506b926a07e3aa0e29`. Its exact hash is recorded after creation in `artifacts/f3b-l2/final-git.json` and the final response. A tracked report cannot contain its own commit hash. No amend, squash, or push.

## Final Git State

Post-commit verification requires `main`, HEAD parent `e3eff36f62d793c4248a80506b926a07e3aa0e29`, grandparent `b669c968ca8535475c4f0a9f06cbdc12515b2729`, `origin/main` `099708075e74b48011016dbde731b2befab2e7d5`, behind/ahead `0/3`, clean, and exactly one commit above the L2 starting revision. `artifacts/f3b-l2/final-git.json` records the actual identity and assertions after creation; final delivery is gated on those assertions.

## Agent 2 Focused Re-review Package

This report, `docs/F3B-L2-integration.md`, the three-file runtime diff, permanent guidance tests, exact-baseline/operative evidence, preserved M1/L1/scoped-session proofs, 99 real Laravel results, screenshots/axe scans, Docker checks, and final Git/backend/cleanup evidence form the package under `artifacts/f3b-l2/`. Both independent implementation reviews have no open findings. The final independent evidence audit verifies every recorded runtime/proof input against current files. Reviewers should retain the documented Docker cleanup-inventory limitation; it is not a Product behavior failure. F3-C is not started.
