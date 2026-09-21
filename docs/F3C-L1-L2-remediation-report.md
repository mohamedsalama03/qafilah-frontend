# F3-C — Inventory feedback remediation

## Executive Summary

This change addresses only A2-F3C-L1 and A2-F3C-L2. Inventory contracts, transport,
query identity, mutation controller, reconciliation, and permissions retain their
certified implementation. Final verification evidence is under `artifacts/f3c-l1l2/`.

## Root Cause

Product detail passed `query.isFetching` and `query.error` through one unavailable
flag. The panel used that flag both to disable editing and to describe a failed
projection refresh, so ordinary successful saves briefly displayed failure wording.

After review, mutation guidance remains in the interaction state. The parent
feedback effect treated any retained guidance as a focus trigger, including a later
quantity error. That parent effect ran after the form's input-focus effect and took
focus away from the field needing correction.

## L1 Remediation

Product detail now passes separate `productReadPending` and `productReadFailed`
signals. Both retain the existing edit restriction. Only an actual Product error or
the controller's recorded refresh error can display the secondary failure guidance.

## Refresh State Model

Confirmed save plus pending refresh keeps Quantity saved without a failure warning.
A successful refresh keeps that success. An actual refresh failure keeps confirmed
inventory success and adds truthful secondary guidance. Initial Product loading and
the existing Product metadata/error presentation are unchanged.

## L2 Remediation

The generic feedback effect yields to actionable quantity errors. Review guidance
focus applies only while idle; it does not focus an empty feedback area during a
later submission. Generic non-field errors retain their alert and receive feedback
focus. The quantity effect explicitly follows status and interaction-slot changes.

## Focus Priority

Quantity validation has priority over general feedback. Client validation focuses
the input directly; server quantity errors focus it through the form effect. The
parent effect cannot override that focus. Status and alert announcements remain.

## Real 422 Focus Evidence

Fresh same-value and post-reconciliation same-value PATCH requests returned real
Laravel 422 responses. After visible errors and two animation frames, the final
active element remained `inventory-quantity`. The post-review case additionally
checks that focus remains there after accessibility inspection and screenshots.
Both cases preserve `aria-invalid=true`, the quantity error ID in `aria-describedby`,
and the useful generic alert. The post-review case first loses a committed write,
explicitly reads current inventory, and begins a new deliberate interaction.

## Confirmed Success Regression

The real-provider suite holds the actual Product query promise across confirmed
success and tests both its later resolution and rejection. Real Laravel tests hold
or drop only the secondary Product response. All three cases passed: no false warning
while pending or after success, and a truthful secondary warning after actual failure.
The mutation controller and authoritative inventory publication are unchanged.

## Unknown Outcome Regression

All 33 prior real inventory cases passed unchanged, including committed and
uncommitted uncertain outcomes, failed and successful review, and committed five
followed by commerce deduction to four. The uncertain attempt stays consumed until
explicit review; no automatic inventory PATCH replay was observed or added.

## Inventory Safety Regression

Contracts, strict integer bounds, null/zero distinction, response consistency,
single-flight/consumed slots, scoped publication, permissions, and archived/variant
boundaries retain their certified source. Final regression results are recorded below.

## Accessibility

Existing field labels, required state, error associations, alerts, and status messages
are preserved. Eleven permanent integrated component cases and seven focused real
journeys cover keyboard/client/server validation, fresh and repeated same-message
422s, final post-review focus, and generic feedback. Twelve representative axe
scans across 1440px and 390px reported zero violations. Batched visual inspection
confirmed truthful pending success and a visible quantity focus/error state without
layout changes. This is not a full assistive-technology or WCAG certification.

## Mutation Evidence

The new feedback harness executes all 30 permanent panel/integration assertions per
variant. Pristine, comment decoy, string decoy, and pristine-after are GREEN.
Restoring the ProductScreen `isFetching` failure conflation is RED through two
behavioral failures. Removing field-error focus priority is RED through four focus
failures, including the designated post-review case. Source hashes are unchanged
before/after and residue is absent. Existing inventory, Product guidance, Product
resubmission, and scoped-session harnesses also passed. Across all five harnesses,
39 expected outcomes comprise 20 GREEN controls and 19 RED operative/historical
rejected variants. Every protected before/after hash matches current source.

## Full Tests

The full Vitest suite passed 1,058 tests across 35 files, including 172 architecture
tests, with no skipped/todo assertions. Frozen strict-peer installation, formatting,
and lint passed. Both dependency audits report zero vulnerabilities; the strict-peer
install and dependency listing establish peer verification. Typecheck and the
production build passed. Development Playwright passed 23/23 and production
Playwright passed 7/7, with no retries, skips, or flaky outcomes. All executable
quality gates passed on their first final runs.

## Real Laravel Regression

Use only isolated synthetic fixtures against backend authority
`6614690a3b24b39f45c7c1b9ed85c20ecb22cbbf`. Canonical source is never mounted for
runtime mutation. All seven focused remediation journeys and all 132 unchanged
regressions passed, without retries, skips, failures, or flaky results. The regression
breakdown is inventory 33, F2 12, F3-B 23, reconciliation 7, response-boundary 39, and
F3-A 18. All six tracked prior test sources still match the candidate exactly.
Their copied harness changes only fixture/evidence paths and the native Docker
launcher. The original inventory suite also contributes 23 zero-violation axe scans.

## Production / Docker

Fresh image `qafilah-merchant-f3c-l1l2:review` is
`sha256:934e3890b4a3b68fee67153a10c3252d0c3727053f4af84427b67c746ae5d46c`.
All 107 runtime/build inputs match before build, after build, and after verification
with fingerprint `d211c4b98928e85f5d069acdb8b336cdb57e825c2fbca02e3ab80b891a1d2c69`.
The healthy container ran as UID/GID 1001 without mounts or sensitive environment
names. The bounded scan of 1,331 deployed files found no known fixture/secret markers,
dotenv paths, unexpected application test files, or browser source maps. This is
not a universal secret-detection guarantee.

Thirteen HTTP/privacy checks and 18 real production-browser checks passed. The
browser verified actual cookie login, zero and positive inventory persistence,
pending/successful Product refresh without false warnings, and final quantity focus
after explicit review followed by a real same-value 422. Exactly three deliberate
PATCHes produced 200, 422, and 200. Archived/variant restrictions, anonymous/logout
closure, development/unimplemented 404s, empty authority storage, and zero runtime
errors remained verified. Three production axe scans reported zero violations;
desktop and mobile screenshots were inspected in the final bounded confirmation.

The existing separate HTTPS frontend/API test topology uses the backend's published
CORS environment setting only in the disposable runtime. It does not inject
authorization or modify canonical Laravel configuration. The browser accepts only
the disposable self-signed test certificate through its verification settings; this
does not certify a deployed public-domain TLS setup.

## Backend Read-Only Proof

Initial and final fresh fetches verified main, HEAD and origin/main at
`6614690a3b24b39f45c7c1b9ed85c20ecb22cbbf`, clean with zero behind/ahead.
The disposable runtime used a Git archive of that revision and its published
Dockerfile/Compose files; the canonical checkout was never mounted. Final evidence
is in `backend-runtime-proof.json` and `backend-final-git.json`.

## Changed Files

Twelve files changed: two runtime components, five behavioral test/fixture/configuration
files, three mutation harness files, and two documents. Runtime changes are confined to the
inventory panel and its Product detail caller. No dependencies or backend files are
changed. The exact file/hash manifest is `final-changed-files.json`.

## Commands Executed

Git baseline/status/fetch checks; frozen install with strict peers; formatter, lint,
typecheck, Vitest/architecture; development/production Playwright; isolated real
Laravel verification; all five operative mutation harnesses; production build and
Docker verification; dependency audits/listing; guarded cleanup and final Git checks.
Final results and logs are retained under `artifacts/f3c-l1l2/`.

## Commands Failed / Recovered

No final functional test, mutation harness, browser run, or build failed. Preparation
lint found unused imports in the new focused suite; those were removed before the
full lint gate. An installed-Next documentation lookup used the wrong extension;
the actual `use-client.md` was located and read before edits. A Windows wildcard
lookup was corrected, and a documentation patch with mismatched context was
reapplied to the intended section. An auxiliary evidence-review assertion referenced
a missing Vitest metadata field; it was corrected to the exported counters and
per-file assertion results. No production source correction or assertion weakening
was needed after the initial two fixes.

## Cleanup

Guarded cleanup removed the four owned backend containers, two networks, two
volumes, seven credential files, and two TLS leaf files. The exact owned frontend
container and verified TLS process were removed separately. No owned resources or
listeners on ports 3000, 3842, 3843, or 3844 remain. All 51 unrelated containers
retained their recorded IDs, names, image references, and states; the comparison
records zero differences. No global Docker cleanup was performed.

## Commit / Parent

This report belongs to exactly one local remediation commit above
`1604c28f1f04d8d1f0c26bd14ba16cb0a1468132`, with subject
`fix(dashboard): refine inventory feedback states`. The candidate is not amended or
squashed, and no push is performed. The containing commit's hash is captured in
`artifacts/f3c-l1l2/final-git.json` and the final response after commit creation.

## Final Git State

The post-commit `final-git.json` records main, HEAD parent
`1604c28f1f04d8d1f0c26bd14ba16cb0a1468132`, grandparent and origin/main
`f0439c35d963bcfd67e79ebda1fcd0e23028b93d`, behind/ahead 0/2, and a clean worktree.
It also records the unchanged clean backend authority with 0/0. This separate
ignored artifact avoids embedding a commit's own hash in its tracked content.

## Agent 2 Focused Re-review Package

Review the small runtime diff, new real-provider behavioral tests, the focused real
Laravel suite and reproduction guide, mutation variant assertions/source hashes,
final test results, production image/input evidence, cleanup comparison, and final
Git identity. `final-evidence-ledger.json` verifies the raw results and current
source hashes. Independent `final-verification-review.json` reports PASS with no
blocking findings. Earlier F3-C evidence under `artifacts/f3c/` remains intact.
