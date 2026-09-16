# A2-F3A-L1 — bounded scoped session reconciliation

16 September 2026. Agent 1 remediation of the single low-severity finding in Agent 2's F3-A review. Independent focused re-review remains pending.

## Executive Summary

The shared session boundary now reconciles a scoped 401/419 with authoritative identity before deciding whether the session is lost. If `/me` confirms the same principal, private reads remain stopped behind an explicit recoverable error. There is one automatic identity reconciliation and **zero automatic scoped-read replays**. The user can deliberately retry the workspace after a fresh identity check.

The fetched baseline gate passed: frontend `main`, HEAD `71bbd71fd887edfad715f799c98ac250a7204d91`, parent/origin `c0c7234a602c133d847b6722b95d7d18fc525e1b`, clean, 0 behind / 1 ahead. Backend `main`, HEAD/origin `6614690a3b24b39f45c7c1b9ed85c20ecb22cbbf`, clean, 0/0. No Product contract, Catalog feature, dependency, CORS/Sanctum setting or backend source is changed. F3-B is not started.

## Root Cause

Scoped Product and Store reads previously passed 401/419 directly to the global authority-loss handler. That treated the scoped response as proof of session death. When identity still succeeded, the login/session lifecycle could reconstruct the same private reads, which failed again. The frontend had no stable state for disagreement between a scoped response and authoritative identity.

Normal same-principal identity revalidation must not erase that disagreement and silently remount the failed work. This is a shared frontend lifecycle defect; it does not require a Product-contract change. The frozen backend cannot naturally produce the divergent response combination, so the loop regression uses controlled read/identity adapters.

## Shared Lifecycle Fix

`createAuthController` adds `handleScopedReadError`, an authenticated `scopedReadError` state, and deliberate `retryScopedRead`. The first scoped 401/419 synchronously revokes the existing private scope/cache, retains the principal for reconciliation, and performs one identity check. Concurrent or repeated errors while the failure is retained do not schedule another check.

`SessionBoundary` removes the private subtree while reconciliation is pending and afterwards shows “Your workspace couldn’t be loaded” with “Retry workspace.” Ordinary focus/visibility rechecks preserve the failure even when identity succeeds. Only deliberate recovery can release it after fresh identity confirmation. A transient identity-check failure remains recoverable with private content hidden.

Both StoreProvider and Product query hooks use this shared method. The existing authoritative error handler remains separate. Scoped disagreement is not broadcast to other tabs as global authority loss; confirmed identity loss can still invalidate them.

The choice of zero automatic scoped replay is intentional: it satisfies the brief's “at most” bound without introducing endpoint-specific retry budgets or any generic replay facility. Recovery tests include the explicit user action; automatic recovery is not claimed.

## 401 Behavior

A scoped 401 followed by same-principal `/me` success retains authenticated identity but blocks private reads in a stable recoverable state. It does not redirect to login or call logout. Further ordinary identity checks do not replay the scoped request.

## 419 Behavior

A scoped 419 follows the same bounded path. It does not independently establish global session death. No login, logout, commerce mutation or unknown mutation outcome is automatically replayed.

## True Session Loss

If authoritative identity returns 401, the controller clears principal and private scopes/caches and enters the existing expired-session login flow. Tests cover this after both scoped 401 and 419. Existing logout, abort-ignoring stale-response, pagehide, identity replacement and F2 authority tests remain in the full suite.

## Bounded Request Counts

Permanent component tests mount the real SessionBoundary, StoreProvider, StoreWorkspace and Product screen against controlled adapters. Counts include initial identity bootstrap:

| Scenario                                             | Identity calls | Store context calls | Product list calls | Settled result                    |
| ---------------------------------------------------- | -------------: | ------------------: | -----------------: | --------------------------------- |
| Persistent Product 401 + identity success            |              2 |                   1 |                  1 | Authenticated recoverable error   |
| Persistent Product 419 + identity success            |              2 |                   1 |                  1 | Authenticated recoverable error   |
| Store-context 401 or 419 + identity success          |              2 |                   1 |                  0 | Authenticated recoverable error   |
| Product 401 or 419 + identity 401                    |              2 |                   1 |                  1 | Expired-session login flow        |
| Explicit retry after Product failure, then success   |              3 |                   2 |                  2 | Fresh workspace visible           |
| Focus/visibility after persistent failure            |              3 |                   1 |                  1 | Failure remains; no scoped replay |
| Explicit retry after that focus check, still failing |              5 |                   2 |                  2 | Stable failure again              |

The final row includes a fresh identity check before deliberate retry and one reconciliation after that explicitly retried read fails. These additional calls require user intent; nothing self-schedules afterwards. Concurrent scoped errors coalesce to one reconciliation. Assertions check exact counts, not an elapsed-time threshold such as “fewer than 200 requests.” Adapter invocation counts are synthetic lifecycle evidence, not a claim of naturally divergent Laravel responses.

## Product Regression

Product list/detail, money, escaped plain text, default/historical creation ranges, filters/sorts/cursors, conditional Categories, Store switching, foreign 404 and permission revocation remain unchanged. The only runtime Product edit routes session errors through the shared read-specific method. The prior Product session-loss test now explicitly makes `/me` return 401 instead of using a fixture that always proves a valid session.

## Store Context Regression

Permanent tests reproduce both Store-context 401 and 419 with successful identity, verifying one context attempt and zero Product reads. StoreProvider wires the same lifecycle method as Products. No Product-only retry guard or separate authentication system is introduced.

## Privacy

The existing synchronous authority-revocation callback disposes Store controllers, cancels scopes and clears private QueryClient data. The protected subtree is absent while identity is uncertain and while scoped failure remains blocked. A test first displays Product data, then holds reconciliation pending and verifies that both DOM data and private caches are gone. Successful identity alone does not restore stale Product/Store content. A two-tab test verifies that same-principal disagreement stays local instead of creating an invalidation cycle.

## Mutation Evidence

`node tests/scoped-session-mutations.mjs` runs a Vite pre-transform against the actual auth-controller success branch without rewriting production files. The operative mutant removes retention of the scoped-failure state after same-principal identity success, restoring automatic remount/retry scheduling.

| Run                              | Four persistent Product/Store 401/419 tests |
| -------------------------------- | ------------------------------------------- |
| Pristine                         | GREEN                                       |
| Comment decoy                    | GREEN                                       |
| String decoy                     | GREEN                                       |
| Operative unlimited-retry mutant | RED: all four exact-count assertions fail   |
| Pristine after mutation          | GREEN                                       |

The mutant causes four identity calls where two are required. The synthetic transport deliberately ends on its fourth scoped attempt with a non-session error, bounding the test process itself. RED comes from assertion failures, not compilation, timeout or a broken harness. SHA-256 hashes of all four runtime files and the permanent lifecycle test are identical before/after; mutation residue is absent. Evidence: `artifacts/f3a-l1/mutations/results.json` and per-run JSON/logs.

## Full Tests

The full Vitest suite passes **645 tests in 23 files**, including **117 architecture tests** and all existing F1/F2/F3 units. Fourteen new regressions cover controlled lifecycle cases, concurrency, cross-tab behavior and unknown logout outcomes. The focused four-file suite passes 92 tests.

Frozen installation with strict peer checks, formatting, lint, typecheck and both full/production audits passed. No known dependency vulnerabilities were reported; package manifest and lockfile remain unchanged. Development Playwright passed **23/23** tests in 46.7 seconds. Production build passed; production Playwright passed **7/7** tests in 13.2 seconds. Final results are retained under `artifacts/f3a-l1/`.

## Real Laravel Regression

Unchanged F3 assertions passed **18/18** in 68.6 seconds; unchanged F2 assertions passed **12/12** in 38.5 seconds. There were no failures, skips or flaky tests. Ten list/detail axe scans across the five existing widths had zero violations. Request evidence records zero Catalog writes, Authorization headers or browser runtime errors.

These runs use a fresh archive of the exact published backend and a disposable synthetic database. Ignored harness copies change only fixture/evidence paths, with normalized-copy integrity recorded; original tests and fixture controls are unchanged. Naturally reachable authority paths, including real expiry/logout, Identity loss, Membership denial and permission revocation, retain real Laravel evidence. Controlled identity/scoped disagreement is separately identified as synthetic.

## Production / Docker

The final production build and all seven browser checks passed, covering login, Product deep links, development-route exclusion and existing security behavior. Fresh image `qafilah-merchant-f3a-l1:review` is `sha256:0ae6b3fe7c1f1dec6cd57d32ebb324a48480ab21b6603eeb1f386d95927a95c0`. Its 93-file runtime/build-input fingerprint is `5c5284a9712bcf02c5dedae763deeac7f1f88146760e5562f2a7d7c64dd4a1f3`, unchanged before/after build and verification.

Docker passed UID/GID 1001, healthy status, 11 HTTP checks including eight development-route 404s, and six desktop/mobile browser checks. The final asset scan examined 181 application files including 27 browser files with zero detected fixtures, known secret patterns, dotenv files or browser source maps. The review container was removed; the image and evidence are retained under `artifacts/f3a-l1/docker/`.

Production Docker verification covers safe failure and packaging. The local isolated backend serves HTTP, whereas the production API configuration requires HTTPS; successful production TLS authentication is not claimed. Checks reject fixture markers, known secret patterns, dotenv files, browser source maps and fake authentication fallback. This is a bounded asset scan rather than a universal secret-detection guarantee.

## Backend Read-Only Proof

Laravel checkout and published authority remain frozen at `6614690a3b24b39f45c7c1b9ed85c20ecb22cbbf`. Migrations and synthetic fixture operations ran only against the frontend-owned archive/runtime and disposable database. Final fetched proof in `artifacts/f3a-l1/backend-final-git.json` confirms `main`, HEAD equal to origin/main at that revision, 0/0, empty short status and empty diff check.

## Changed Files

- Runtime: `src/lib/auth/controller.ts`, `src/features/auth/components/session-boundary.tsx`, `src/features/stores/components/store-provider.tsx`, `src/features/products/queries.ts`.
- Regression tests: auth controller and session boundary tests; new `scoped-read-revalidation.test.tsx`; existing Product test fixture for authoritative session loss.
- Permanent mutation proof: `tests/scoped-session-mutations.mjs` and `tests/scoped-session-mutations.config.mjs`.
- Documentation: this report.

No Product contracts, presentation components, routes, dependencies, build configuration or Laravel source are changed. Next's development type declaration is restored by the final production build and is not part of the remediation diff.

## Commands Executed

Commands run inside the frontend directory, except read-only Git verification explicitly targeting the published WSL backend. Corepack's existing shims are added only to the test process PATH where needed.

```text
git fetch --prune origin
git branch --show-current
git rev-parse HEAD
git rev-parse HEAD^
git rev-parse origin/main
git rev-list --left-right --count origin/main...HEAD
git status --short
corepack pnpm install --frozen-lockfile --strict-peer-dependencies
corepack pnpm list --depth 0
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm exec vitest run <four focused lifecycle/Product test files>
corepack pnpm exec vitest run --maxWorkers=2 --reporter=json --outputFile=artifacts/f3a-l1/vitest-final.json
node tests/scoped-session-mutations.mjs
corepack pnpm test:e2e
corepack pnpm build
corepack pnpm test:production
corepack pnpm exec playwright test --config artifacts/f3a-l1/playwright.products.config.ts
corepack pnpm exec playwright test --config artifacts/f3a-l1/playwright.f2.config.ts
corepack pnpm audit
corepack pnpm audit --prod
git diff --check
git commit -m "fix(dashboard): bound scoped session revalidation"
git rev-parse HEAD^^
git status -sb
git log -1 --format="%H%n%P%n%s"
```

Frontend-owned runtime initialization/cleanup and Docker build/verification scripts are retained with their sanitized evidence. No amend, squash, force or push command is used.

## Commands Failed / Recovered

- Typecheck identified an optional-state narrowing error in the new same-principal branch. An explicit `previous` guard fixed it; typecheck passed afterwards.
- One existing Product UI test exceeded its normal asynchronous lookup window during concurrent full-suite, mutation and browser work. The initial result was retained. The complete unmodified suite then passed with two Vitest workers; no assertion or timeout was weakened.
- The operative mutation run intentionally returns RED and is an expected successful challenge of the regression protections, not an unresolved failure.
- An initial Docker script invocation through legacy Windows PowerShell treated ordinary Docker stderr progress as a terminating native-command error. Running the identical script directly with the workspace PowerShell 7.6.5 completed the fresh build and verification; source inputs were unchanged.

## Cleanup

Cleanup completed without blocked or failed steps. Only the owned isolated project's four containers, two networks, two volumes and three generated credential files were removed after checking project labels and absolute literal paths. The remediation Docker review container was also removed. `artifacts/f3a-l1/cleanup.json` records zero remaining owned resources, credentials or private fixture copies. Prior F3-A evidence remains intact. Sanitized remediation logs, screenshots, mutation results, source archive and review images are retained; no global Docker prune was used.

## Commit / Parent

All required gates passed. Delivery is exactly one new local commit with subject `fix(dashboard): bound scoped session revalidation`, directly above `71bbd71fd887edfad715f799c98ac250a7204d91`. F3-A is neither amended nor squashed. The containing commit's actual hash is recorded after creation in ignored final Git evidence and returned to the user, avoiding a circular hash inside this tracked report.

## Final Git State

Delivery is verified after the single commit: `main`, HEAD remediation commit, HEAD^ `71bbd71fd887edfad715f799c98ac250a7204d91`, HEAD^^ and origin/main `c0c7234a602c133d847b6722b95d7d18fc525e1b`, 0 behind / 2 ahead, clean worktree. Backend remains clean at its frozen authority with 0/0. Exact outputs are saved in `artifacts/f3a-l1/final-git.json`. No push is attempted.

## Agent 2 Focused Re-review Package

Review the single F3-A-to-remediation diff and this report. Start with the shared auth controller's retained scoped error, SessionBoundary's private-subtree exclusion, both read call sites, and `scoped-read-revalidation.test.tsx`. Re-run the permanent mutation harness to verify pristine/decoy GREEN, operative assertion RED and no source residue.

Evidence under `artifacts/f3a-l1/` includes the full Vitest JSON, exact-count mutation runs, original-suite harness integrity, real F2/F3 reports, five-width screenshots/axe records, production logs, Docker fingerprint/image/health/asset evidence, cleanup proof and final frontend/backend Git identity. Ignored artifacts are local review evidence, not committed credentials. Browser coverage is Chromium and representative states; accessibility evidence is not full WCAG certification. Independent focused certification is pending.
