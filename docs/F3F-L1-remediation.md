# F3-F A2-F3F-L1 — Inventory feedback mutation harness

**A2-F3F-L1 remediated; all required gates passed.** This is a frontend test-harness correction only, ready for focused independent Agent 2 re-review.

## Authority and root cause

Frontend started on clean `main` at `345543faed73e3aa88b66311f9c36109f51920bc`, directly above published `fc1b35e0679ab1b5f7e0076c744383216fb97eda`; origin/main remains the published baseline (0 behind, 1 ahead before remediation). Backend started on clean `main`, HEAD = origin/main = `7cd52e549c2a657dc66643b36701356d1d024de5`, 0/0.

The F3-C L1 mutant required the text `productReadFailed={!!query.error}` to occur exactly once in Product detail. F3-F correctly passes that prop to both Inventory and Media, so the harness threw before executing the mutant. The existing Product, Inventory and Media runtime behavior was correct.

## Correction

The harness now uses the existing TypeScript compiler to resolve the imported `ProductInventoryPanel` symbol and its JSX invocation. It changes only that invocation's failure expression to include its own pending expression. Media, comments, strings and shadowed component names are not targets. Aliases, paired JSX, formatting and equivalent expressions work; absent, ambiguous, malformed or spread-based targets fail closed as harness errors.

Twenty permanent tests execute small JSX fixtures to verify changed Inventory behavior with unchanged Media behavior, cover the actual Product screen, and challenge misleading text and unsupported structures. The L2 mutation and the existing behavioral assertions are unchanged. No runtime source, contract, transport, CSP, URL handling, dependency or lockfile changes are included.

## Operative proof

The repaired harness runs all 30 existing feedback component tests for every variant. Operative results require complete execution, assertion-only failures and the named behavioral invariant; parser/setup errors cannot count as RED.

| Variant                         | Result | Evidence                                                                                              |
| ------------------------------- | ------ | ----------------------------------------------------------------------------------------------------- |
| Pristine                        | GREEN  | 30 passed                                                                                             |
| Comment decoy                   | GREEN  | 30 passed                                                                                             |
| String decoy                    | GREEN  | 30 passed                                                                                             |
| F3-C L1 pending-refresh failure | RED    | Two behavioral assertions failed, including truthful confirmed success during pending Product refresh |
| F3-C L2 quantity-focus steal    | RED    | Four focus assertions failed, including post-review quantity 422 focus after effects settle           |
| Pristine-after                  | GREEN  | 30 passed                                                                                             |
| Residue                         | NONE   | Protected source/test hashes unchanged                                                                |

This proves the harness detects broken rendered behavior rather than merely rejecting changed source text. The additional alias/equivalent-expression fixture succeeds without the former incidental anchor.

## Regression and quality

| Existing harness       | GREEN controls | Expected RED variants | Pristine tests |
| ---------------------- | -------------: | --------------------: | -------------: |
| F3-F media             |              4 |                    20 |            298 |
| F3-E Variant inventory |              4 |                    13 |            148 |
| F3-C inventory         |              4 |                     5 |             98 |
| F3-D variants          |              4 |                    10 |             66 |
| Product guidance       |              4 |                     2 |             15 |
| Product resubmission   |              4 |                     9 |             21 |
| Scoped session         |              4 |                     1 |              4 |

All seven final harness invocations exited zero. RED results came from behavioral assertions, with named invariant checks where provided; the Product resubmission count includes its rejected historical-baseline case. All 59 protected files matched before/after/current hashes, with no residue. One initial resubmission run rejected a Publish-button setup timeout as HARNESS ERROR during concurrent testing. That evidence is preserved separately; the unchanged complete rerun alone passed all 13 variants. No assertion, timeout or harness classification was weakened.

Repository-standard gates passed: frozen install with strict peers (already up to date), format, lint, Next type generation/TypeScript, **1,900 Vitest tests in 58 files**, **297 architecture tests**, **23 development browser tests**, production build, **seven production browser tests**, dependency/peer listing, and both audits with zero reported vulnerabilities. Browser output directories were isolated. Independent source review found no actionable findings.

Real regression passed **25/25**, once each, with zero skips/retries/flaky results or runtime errors: all seven F3-C feedback cases, Product/Variant media CRUD and public bytes, twelve media unknown-outcome cases, and four F3-E inventory cases. Six JPEG/PNG/WebP public images matched exact bytes and MIME; 24 representative axe scans had zero violations. The backend ran from its exact published archive in disposable frontend-owned resources; the canonical backend source/database remained untouched. Full F3-F certification was not repeated because runtime behavior did not change.

All **192 recorded runtime/existing integration inputs** match their original hashes after final type generation/build restored generated `next-env.d.ts`. No production files changed. The canonical backend remains clean on `main`, HEAD = origin/main = `7cd52e549c2a657dc66643b36701356d1d024de5`, 0/0. Cleanup removed all four owned containers, three volumes, two networks and private credential leaves; 51 unrelated containers and the unrelated port-3000 process were preserved.

## Review package and reproduction

Evidence is retained under `artifacts/f3f-l1/`, including `original-anchor-regression.log`, `harness-targeting.log`, `inventory-feedback-harness.log` and `inventory-feedback-mutations/results.json`. Broader proof is indexed by `existing-harness-regression-summary.json`, `real-regression-summary.json`, `final-quality-results.json`, `architecture-full.log`, `runtime-inputs-final.json`, `backend-final-state.json` and `cleanup-result.json`. The original anchor failure and `resubmission-preparation-failure/` remain separate from final passing runs. The real-runtime setup, selected-test configuration, sanitized evidence and exact source-copy differences are retained there for review.

```powershell
$env:QAFILAH_MUTATION_ARTIFACT_ROOT = 'artifacts/f3f-l1'
node tests/inventory-feedback-mutations.mjs
pnpm exec vitest run tests/inventory-feedback-mutations.test.mjs
```

Changed files:

- `tests/inventory-feedback-mutations.mjs`
- `tests/inventory-feedback-mutations.test.mjs`
- `docs/F3F-L1-remediation.md`

All required gates passed. Delivery is exactly one local commit with subject `test(dashboard): harden inventory mutation harness`, parent `345543faed73e3aa88b66311f9c36109f51920bc`, grandparent/origin/main `fc1b35e0679ab1b5f7e0076c744383216fb97eda`, clean `main`, 0 behind/2 ahead. The self-referential commit identity is recorded after committing in `artifacts/f3f-l1/final-git.json` and the final response. No amend, squash or push is performed.
