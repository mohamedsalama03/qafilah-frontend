# F3-D — Product Variants & Options

## Executive summary

Existing variant Products now have a structural configuration workflow: Options,
Values, Variant combinations, SKU editing/clearing, and activation/deactivation.
The implementation adds exactly nine published Merchant contracts and integrates
with the existing Product detail, Store workspace, authentication, query isolation,
and consumed-interaction mutation patterns.

**Verification: PASS.** Repository gates, all 173 real Laravel journeys, and fresh
production verification passed against the final implementation. The review package
is ready for independent Agent 2 certification; author verification does not replace
that independent certification.

## Published authorities

The initial baseline gate verified both repositories on `main`, clean, with HEAD
equal to origin/main and behind/ahead `0/0`:

- Frontend: `bb5534d3d2ede1d72762ac1b4d230650f45bc9ec`.
- Backend: `6614690a3b24b39f45c7c1b9ed85c20ecb22cbbf`.

Frontend work is confined to this phase. The canonical backend remains read-only,
clean, and at the same published authority. Frontend origin/main was fetched again
and remains the published baseline. Final identity evidence is recorded separately
after the single local candidate commit is created.

## Implementation and activated contracts

Product detail links eligible variant Products to
`/stores/[storeUuid]/products/[productUuid]/variants`. Variant links open the nested
`/[variantUuid]` detail route. Both routes use the existing Store workspace and
dynamic rendering. The login return-path allowlist recognizes only these implemented
route shapes with valid UUIDs.

For the table below, `P` means exactly
`/api/v1/stores/{store}/catalog/products/{product}`. Every route uses the central
reviewed backend registry and cookie-based transport.

| Method | Path                                | Grant                      | Payload                              | Response data          |
| ------ | ----------------------------------- | -------------------------- | ------------------------------------ | ---------------------- |
| GET    | `P/options`                         | `products.variants.view`   | None                                 | Complete Option array  |
| POST   | `P/options`                         | `products.variants.create` | `name`, `position`                   | Created Option         |
| PATCH  | `P/options/{option}`                | `products.variants.update` | Both `name`, `position`              | Updated Option         |
| POST   | `P/options/{option}/values`         | `products.variants.create` | `value`, `position`                  | Complete parent Option |
| PATCH  | `P/options/{option}/values/{value}` | `products.variants.update` | Both `value`, `position`             | Complete parent Option |
| GET    | `P/variants`                        | `products.variants.view`   | None                                 | Complete Variant array |
| POST   | `P/variants`                        | `products.variants.create` | `value_ids`; optional nullable `sku` | Created active Variant |
| GET    | `P/variants/{variant}`              | `products.variants.view`   | None                                 | Variant                |
| PATCH  | `P/variants/{variant}`              | `products.variants.update` | `sku` and/or `status`                | Updated Variant        |

Collections are unpaginated and bounded. Successful envelopes strictly require
`success:true`, reviewed `data`, `meta.request_id`, and `message:null`. The existing
16-contract registry expands to 25; no deferred or invented endpoint is activated.

## Permissions and Product boundaries

View, create, and update grants are checked independently. Role names and Product
CRUD grants confer no Variant authority. The existing Product experience separately
requires `products.view`; structural reads additionally require
`products.variants.view`. Write controls and dispatch checks require their exact
create/update grant.

Simple Products never activate structural queries or editors. Archived variant
Products remain viewable with editing disabled. The backend revalidates current
membership, permissions, Product type, lifecycle, and nested ownership on dispatch.
Authority errors use the certified Store/session revalidation paths.

## Options, Values, and Variants

The UI presents Options, then their Values, then explicit Variant combinations.
Labels use Laravel-compatible NFKC canonicalization, boundary trimming, unsupported
control/format rejection, and Unicode code-point length checks. Option and Value
labels accept 1–80 characters; position is an integer from 0 through 10,000. PATCH
always supplies both the text field and position. Unchanged edits are rejected
locally, while Laravel remains final validation authority.

Variant creation requires one deliberately selected Value from every Option.
There is no preselected or automatically generated matrix. New Variants start
active. Existing combinations are immutable; their editor offers only SKU and
status. SKU is nullable, limited to 64 canonical characters, and case-sensitive.
Blank SKU explicitly clears it to null. Updates send only changed supported fields.
Multiple null SKUs remain valid; Store-wide uniqueness is enforced by Laravel.

## Structural limits and the first Variant boundary

- At most three Options per Product and twenty Values per Option.
- At most one hundred Variants per Product, including inactive Variants.
- The first Variant prevents creation of any additional Options.
- Existing Option/Value labels and positions remain editable; additional Values
  remain possible within the Value limit.

The UI warns before first Variant creation and explains the resulting Option lock.
Read-only Variant price, quantity, and availability projections preserve null/zero
distinctions. Copy explicitly states that active structural configuration does not
establish commercial readiness or purchasability.

## Mutation and unknown-outcome safety

All six writes use one consumed interaction controller per authority scope and
Product. The controller snapshots the operation and payload, latches single flight
before notifying subscribers, and binds form callbacks to the interaction slot.
Changing operation type, nested target, editor, or mounted component cannot bypass
an active or consumed attempt. The central adapter normalizes before awaiting fresh
CSRF and never automatically replays a dispatched write.

Confirmed success remains success while secondary reads are pending or fail. A
failed refresh adds secondary guidance and leaves the confirmed interaction
consumed. Unknown outcomes lock every structural form until explicit authoritative
review. Failed review preserves that lock. Successful review reads Product,
Options, and Variants, rejects inconsistent configuration, and enables a new
deliberate interaction without restoring the previous submission.

Review describes current observations; it is neither a causation receipt nor an
atomic snapshot. Every write is an independent backend transaction. Earlier
confirmed setup remains visible when a later step fails; no multi-step atomic
configuration promise is made.

## Isolation and response safety

Query identity includes principal, Store UUID, authority revision, Product UUID,
and Variant UUID for detail. Operation identity additionally includes relevant
Option/Value/Variant targets. Authority is checked before and after scoped work;
late responses cannot publish into another Store, principal, revision, or Product.

Strict resource decoders reject unexpected fields, malformed projections,
duplicate IDs, duplicate Option/Value labels within their parents, duplicate
Variant combinations, and duplicate non-null case-sensitive SKUs. The adapter
checks known target identities and submitted result fields. Variant update
reconciliation additionally preserves the previously observed immutable combination.
Value writes reconcile the returned parent Option only after cancelling stale reads.

Resources do not echo Store/Product ownership or an operation receipt. Scoped
request context and backend nested-resource enforcement establish that authority;
the frontend does not invent unavailable identity or version guarantees. Real
Laravel exercises foreign and wrong-parent route resources and foreign selected
Value IDs.

## Accessibility and feedback

Forms retain visible labels, required states, field-error associations, and generic
alerts. Actionable field errors keep final focus, including after explicit review;
generic errors receive feedback focus. Errors belong only to the matching editor
operation and cannot follow a different Option/Value/Variant target. Navigating
between Variant details resets unsaved editors. Generic configuration retry refreshes
Product, Options, and Variants together.

The focused real suite records six representative surfaces at 1440px and 390px,
with twelve axe scans reporting zero violations. Screenshots and machine-readable
results are under `artifacts/f3d/screenshots/`. This is focused accessibility
verification, not a complete WCAG or assistive-technology certification.

The implementation review inspected the empty desktop configuration, Variant
detail on mobile, partial-configuration 422 on mobile, and full-limit desktop
screenshots. No visual defect was found in that bounded inspection.

## Unit, architecture, and mutation evidence

Targeted runs completed during implementation:

- 125 schema, payload-model, and central API tests passed.
- 66 structural lifecycle cases passed, also exercised by the mutation harness.
- 44 UI/form cases passed, including limits, independent grants, SKU clear,
  immutable combinations, consumed states, post-review field focus, stale-editor
  error isolation, Product retry, and Variant A→B navigation.
- Targeted formatting and whole-project `tsc --noEmit` passed at the test handoff.
  Final repository formatting, lint, and typecheck gates also passed.

Permanent architecture regressions cover the exact route allowlist, central
transport, strict decoding, scoped queries and mutation publication, independent
authority, retry exclusion, browser-persistence exclusion, and deferred routes.
The final full Vitest run passed **1,341/1,341** tests in 42 files with zero pending
tests; its reporter counts 104 suites. The explicit architecture run passed
**213** tests.
Evidence is `artifacts/f3d/vitest.json`, `vitest.log`, `architecture.json`, and
`architecture.log`.

`artifacts/f3d/variant-mutations/results.json` records all fourteen expected
structural outcomes: four GREEN controls/decoys and ten RED operative mutants,
with sixty-six lifecycle tests per variant and no source residue. Operative
mutants remove single-flight, consumed success/unknown/stale-slot protection,
write-permission checks, response correlation, or the first-Variant Option
boundary. Expected RED results are successful sensitivity checks, not failed
production behavior.

`artifacts/f3d/prior-mutation-proof.json` records all thirty-nine expected outcomes
from the five existing harnesses: twenty GREEN and nineteen RED. Source hashes
before/after match and previous-phase evidence is preserved. Combined, the six
harnesses produced fifty-three expected outcomes: twenty-four GREEN and twenty-nine
RED. `final-mutation-hash-proof.json` reconciles all recorded inputs and operative
transformations against final source, preserves 83 prior evidence files, and verifies
all seven legacy harness copies. The new runner did not record a historical config
hash; its recorded source/test and transformed-code hashes match, and the proof
explicitly distinguishes the current configuration hash from historical evidence.

## Real Laravel evidence

`artifacts/f3d/variants-results.json` records **34/34** focused journeys passed in
94.13 seconds, with zero failures, skips, flaky outcomes, or retries. Coverage
includes all nine contracts; independent grants; Option/Value edits; complete
Variant create/list/detail/update; SKU case, clear, and Store uniqueness; activation;
3/20/100 limits; complete/missing/duplicate/foreign combinations; no-op and normalized
validation; simple/archived and foreign-parent boundaries; revocation; Store,
Product, and principal races; repeated and response-boundary submission; committed
and uncommitted unknown outcomes; failed/successful review; and partial setup.

Transport-loss tests use real Laravel responses for committed cases and abort
before dispatch for uncommitted cases. Request evidence omits credentials. Fixture
and test hashes are recorded in `focused-harness-integrity.json`.

The previous-phase suite contains 139 journeys: F3-C inventory 33 and feedback 7,
F3-B 23, F3-A 18, F2 12, response-boundary remediation 39, and reconciliation
remediation 7. The final fresh run passed **139/139** in 340.94 seconds, with zero
failures, retries, skipped cases, or flaky outcomes. Together the real suites passed
**173/173** journeys. `final-real-evidence-hash-proof.json` independently reconciles
the raw results and 47 recorded structural/inventory axe scans with zero violations.
`regression-harness-integrity.json` records all seven original source hashes against
the frontend baseline and hashes of ignored runtime copies. Copy changes are
limited to fixture/evidence paths, native Docker launching, and the approved
frontend origin on port 3002; assertions remain unchanged.

## Repository gates and production/Docker

Frozen dependency installation completed; no dependency or lockfile change is
required. `audit.json` and `audit-production.json` each report zero vulnerabilities.
`peer-dependencies.json` retains dependency evidence. The final frozen install with
strict peer dependencies, formatting, lint, typecheck, full Vitest, development
Playwright **23/23**, production build, and production Playwright **7/7** passed.
Browser gates recorded no retries, failures, skips, or flaky cases.
`repository-gates.json` records the sequential gate completion.

Fresh image `qafilah-merchant-f3d:review` passed production verification:

- Image: `sha256:fa4c405953b399eeadb764736f9269428c6e56f939d678a30cab0acc968c6b55`.
- All 115 runtime/build inputs have the same before-build, after-build, and
  after-verification fingerprint:
  `ce2e7f64dd0b730d54aeb1a46cebaa37b099601f53f7b61afb902e5da3082ead`.
- Healthy non-root runtime, UID/GID 1001, no mounts or sensitive environment names.
- Fifteen HTTP routes pass private/no-store, fresh CSP nonce, strict-dynamic,
  no unsafe-eval, noindex, nosniff, and frame-denial checks.
- All 1,355 deployed regular files were scanned. No known fixture/secret markers,
  dotenv files, unexpected application test files, or browser source maps were found.
  This is a bounded pattern scan, not a universal secret-detection claim.
- The final HTTPS browser workflow passed eleven checks using actual Laravel:
  all nine contracts, eight deliberate structural writes, valid SKU clear/edit and
  activation changes, invalid SKU rejection with no dispatch, confirmed success
  during a delayed refresh, committed lost-response review with zero replay,
  simple/archived boundaries, logout/deep-link closure, and empty browser authority
  storage. There were zero runtime errors or deferred pricing/inventory/media calls.
- Three production axe scans have zero violations. Final desktop detail/list and
  mobile list screenshots were inspected; layout, wrapping, disabled states, and
  uncertainty guidance are readable with no settled horizontal overflow.

The phase-specific controls and proofs are `artifacts/f3d/docker-review.*`.
Frontend HTTPS on port 3002 and API HTTPS on 3844 use separate browser origins;
the production container binds only loopback port 3843. Supported backend settings
authorize the origins. Production fixture derivations use separate disposable
Stores and preserve earlier rows and evidence. No mutation or request limit is
bypassed. `gate-summary.json` consolidates the final executable assertions.

## Backend read-only proof and cleanup

`backend-runtime-proof.json` records the exact backend authority on `main`, clean
and `0/0`, an exported source archive, matching published Dockerfile/Compose files,
and `canonicalCheckoutMounted:false`. Runtime fixtures live only in a disposable
frontend-owned runtime; the canonical backend checkout is never mounted or edited.
Published environment settings supply allowed origins and stateful-session hosts.
Browser Origin is not forged and bearer credentials are not introduced.

The unrelated application on port 3000 is preserved. Guarded cleanup removes only
the exact owned frontend container, TLS process, backend Compose project, generated
credentials, fixture credentials, and TLS files. `cleanup-result.json` records no
remaining owned containers, networks, volumes, private leaves, or verification
listeners, and all 51 original unrelated containers remain unchanged.
`backend-final-git.json` records final canonical branch, HEAD, origin/main, live
remote, clean status, and behind/ahead `0/0` at the published backend authority.

## Changed files

The change set consists of:

- Two dynamic Merchant Variant route files.
- The new `src/features/variants/` feature: contracts, model, scoped queries,
  consumed-interaction controller, two UI components, and permanent unit/UI tests.
- `src/lib/backend/contracts.ts` and `client.ts` for the nine central contracts.
- Product detail entry and the authentication return-path allowlist, with their
  tests; existing typed Merchant API test fixtures gain the nine new mock methods.
  Existing Product contract and mutation-contract tests update their registry
  manifests/counts for the nine additional structural entries.
- Architecture policy updates and permanent structural architecture regressions.
- Real Laravel fixture, browser suite, and Playwright configuration; the new
  structural mutation runner/configuration.
- This report and `docs/F3D-integration.md`.

No backend source, dependency, or lockfile changes are part of the implementation.
`artifacts/f3d/changed-files.json` lists all 44 changed files (22 added and 22
modified), with final sizes and hashes. The production build restored generated
`next-env.d.ts` to its baseline content; it is not part of the change set.

## Preparation issues and review

Early fixture/test preparation corrected an unsupported fixture timestamp column
after its transaction rolled back, required-field accessible selectors, a duplicate
heading selector, and the archived disabled-action assertion. The final focused
browser run used a freshly reset guarded database. No backend contract or source
was changed and no certification case was skipped.

Unit preparation corrected parameterized negative-input rows, explicit unsafe-input
test casts, and mocked validation states to include the actual operation identity.
The first full Vitest preparation run exposed two legacy registry expectations
that still assumed sixteen entries and the former first-nine order. Their existing
endpoint assertions were preserved while extending the manifests for the nine new
contracts; the subsequent full run passed all 1,339 tests. Review also corrected
configuration retry to refresh Product as well as collections,
and scoped stale field feedback to its editor. Permanent regressions cover those
behaviors. `lifecycle-readonly-review.json` records the bounded cross-layer review
and its resolved retry finding; it is author review, not independent Agent 2
certification.

Final normalization review found that JavaScript `trim()` could classify a
U+FEFF-only SKU as empty, although Laravel rejects that format character. Blank
classification now uses the shared Laravel-compatible canonicalizer. Permanent
create/edit tests prove validation feedback and zero dispatch; the real and
production browser workflows also check rejection before a valid SKU clear.
`normalization-review.json` records the finding, resolution, and source hashes.

The first prior-phase real run passed 138/139 journeys. One journey timed out at
the session-check screen before login and before any Product write. Its retained
traffic shows no writes or browser runtime errors; the backend recorded no browser
request during that interval. The cause is unconfirmed. Initial report, log, page
snapshot, screenshot, and traffic remain under `regression-initial-*`. The full
suite is rerun from fresh fixtures without assertion changes or automatic retries.

The first production browser helper stopped while releasing an intentionally held
GET response (`Route is already handled`). The helper now awaits completion before
removing interception and starting review. The full production workflow is repeated
against a separately seeded isolated Store; the first fixture and failed log remain
preserved. No application source or published backend contract changed for this
harness correction.

The next production run reached the final unknown-outcome review after all eight
deliberate writes, but its rapid sequence of projection and review reads reached
Laravel's published 60/minute Catalog limit. The unknown lock remained intact and
the UI displayed the 429 guidance. That failed attempt is retained as
`docker-review.browser-throttle-attempt.*`. The final helper spaces explicit review
actions by fifteen seconds and uses a third isolated fixture Store. The limiter,
backend configuration, and application source are unchanged. Fixture derivation
proofs preserve all earlier fixture files and existing catalog rows.

The paced run then completed the write/review workflow but an immediate geometry
sample after switching to mobile reported overflow. A separate read-only check of
the same production data measured 390/390 with no overflowing elements. The final
capture waits for the responsive layout to settle before requiring no overflow,
then runs axe and captures the image. The failed run and layout diagnostic are
retained; the fourth isolated fixture group keeps every previous attempt intact.

## Commit, parent, and final Git state

The candidate is the single local commit containing this report, with subject:

`feat(dashboard): integrate merchant product variants`

Its parent and origin/main are
`bb5534d3d2ede1d72762ac1b4d230650f45bc9ec`, on `main`, with behind/ahead `0/1` and a
clean worktree. The report cannot embed its own containing commit hash;
`artifacts/f3d/final-git.json` records that identity after creation, including the
exact parent, branch, remote URL, status, subject, and divergence. No amend, squash,
history rewrite, or push is performed. **Push: NOT ATTEMPTED.**

## Residual limitations and Agent 2 package

Pricing/inventory/media mutations, Option/Value/Variant delete/archive, automatic
matrix generation, bulk creation, and simple→variant conversion remain deferred.
Only published structural contracts are used. Backend uniqueness and race outcomes
remain authoritative. Separate reads are not atomic and no idempotency receipt,
ETag, version precondition, or compare-and-swap mechanism is claimed.

Review the source diff, permanent tests, `docs/F3D-integration.md`, and sanitized
`artifacts/f3d/` evidence together. Key evidence includes the focused browser report,
request/screenshot directories, fixture and regression integrity manifests, six
mutation harness results, dependency audits, backend runtime proof, and bounded
cross-layer review. `gate-summary.json`, `final-evidence-audit.json`,
`final-mutation-hash-proof.json`, `final-real-evidence-hash-proof.json`, the Docker
proofs, cleanup records, changed-file manifest, and final Git identity complete the
local review package. Failed preparation attempts are retained and described above.
No unresolved implementation finding is known. Agent 2 should independently review
the candidate against the two pinned authorities before publication.
