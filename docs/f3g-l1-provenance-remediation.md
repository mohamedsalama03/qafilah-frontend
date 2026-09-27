# F3-G L1 — currency provenance remediation

## Design and permanent proof

The previous policy treated unresolved currency receivers as authoritative. The
policy now distinguishes authoritative inputs, safe null, synthesized values,
retained values and unresolved provenance. Unresolved values fail closed at
currency declarations, properties, assignments, JSX attributes and formatter
inputs. Unrelated unknown expressions remain allowed. Currency validation and
pure comparisons do not grant or replace authority.

The bounded analysis follows local aliases/destructuring, current Store-provider
context and the existing scoped context load. Captured Store snapshots and React
ref/state snapshots remain distinct from a current input. Names such as `previous`
are no longer used as evidence of stale currency. Unsupported producers require
an explicit policy decision instead of silently passing. This is a static
architecture guard, not a general JavaScript evaluator.

The exact requested R3 is injected at the real controller's `freezeContext`
publication boundary. Its original awaited `context` and conditional `previous`
declarations are preserved. The production scan in the permanent architecture
suite rejects that mutant. The same suite rejects controller ternary, assignment
and nullish reuse; Product React snapshots; JSX literals; imported function and
arrow-function formatter literals; array `.at` fallback; locale/Role synthesis;
unresolved currency producers; browser persistence; and Pricing requests.

The final currency campaign runs 109 assertions for each of 39 variants:
15 GREEN controls and 24 intended RED violations, including the recovered historical
edit. Authoritative controls and operative violations run against the permanent
production scan. No skipped/todo cases,
infrastructure errors, timeout kills or source residue. Authoritative aliases,
computed/destructured reads, null handling, formatter/JSX consumption, schemas,
validation, comparisons, unrelated unknowns and decoys remain GREEN.

The source inventory, parsed trees and production scan results are still cached
once per process. Mutants change only the in-memory source-reader output. Both
policies share the parsed inventory; assertions verify cache reuse. The campaign
records timings and actual named assertion failures under
`artifacts/f3g-l1-closure/currency-mutations/results.json`.
The combined currency/architecture scan took 1.51 seconds in the full suite and
0.85 seconds in the dedicated architecture run. Under concurrent full-suite and
browser load the campaign averaged 1.32 seconds, maximum 3.74 seconds; the normal
five-second test timeout is unchanged. No production files are reparsed per assertion.

## Exact historical acceptance

The recovered `F2-controller-previous-store-inference` mutation is now permanent.
The controller blob is `277aa9c88563b0d6af467f38095ff72cea0c8adb` at each of
`08ecfa90`, `146e6c93` and `5dbb62a9`. The new exact-edit assertion requires one
occurrence and checks that the entire transformed source equals this one replacement:

```ts
const verified = freezeContext(context);
```

becomes exactly:

```text
const verified = freezeContext(context.store.currency === undefined && previous ? { ...context, store: { ...context.store, currency: previous.store.currency } } : context);
```

The actual awaited `context` and conditional `previous` declarations are untouched.
The current policy was not redesigned or changed to catch this recovered case.
In `tests/store-currency-architecture.test.ts`, these current permanent tests fail:

- `Store currency compatibility architecture keeps repository-wide production currency authority`
- `Store currency compatibility architecture keeps production free of R4 retained snapshot`

Both exact assertions are `expect(violations, JSON.stringify(violations)).toEqual([])`.
Both receive the same nonempty violation:

```json
{
  "rule": "currency-authority",
  "reason": "retained-currency-snapshot",
  "file": "src/lib/stores/controller.ts",
  "line": 289
}
```

The focused run records pristine **109 passed / 0 failed**, historical mutant
**107 passed / 2 failed**, and pristine-after **109 passed / 0 failed**. No
skipped/todo cases or runtime setup errors occurred. The runner supplies the exact
real source mutation to the permanent production scan in memory; source files are
never rewritten. This is a failure of permanent assertions, not a harness-only
text check. The original historical test title was not recorded and is not inferred.
Current failure titles/counts are saved in
`artifacts/f3g-l1-closure/historical-acceptance.json`.

## Runtime and backend integrity

All 196 protected runtime/public/script/configuration/dependency files match the
starting `5dbb62a9bfd2c1fa01375b2cd46891600b7ce00d` bytes. No runtime, dependency,
Pricing or backend implementation changed.

Fresh real-browser compatibility runs passed four journeys per exact backend:

- `7cd52e549c2a657dc66643b36701356d1d024de5`: currency absent.
- `4c86b8429f6d3e26d07129494de99f7f5b76db73`: LYD, USD, EUR and null.

Both cover login, exact three-field discovery, Store selection/context and the
Product workspace, with no Pricing requests or currency persistence. Permanent
decoder tests cover unsupported/malformed currencies and required-field rejection.
Backend image sources matched fresh authority archives before and after testing
(1,673 published files / 1,674 candidate files). The backend checkout remains clean
on `main` at `4c86b842`, with `origin/main` at `7cd52e54`.

Owned containers, networks, volumes and private credentials were removed. All
52 pre-existing containers were preserved in the final closure run.

## Verification

Build, typecheck, format, lint, development Playwright (23), production Playwright
(7), dependency audit (zero findings) and frozen-lockfile strict peer checks passed.
The final production verification encountered overlapping output in the ignored
development route validator. Regenerating development route types with the installed
Next.js route generator restored typecheck; no source, configuration, type-check
exclusions or runtime behavior changed. The original generated output and recovery
log are retained with the closure evidence.
The initial full Vitest run under concurrent load passed 2,006/2,007; one unchanged
Product publish test could not find its button within its existing query wait.
The separate 73-test resubmission suite passed without changing assertions or
timeouts. The final single-worker full run passed all 2,009 tests in 60 files;
dedicated architecture passed all 260 assertions. All ten mutation harnesses
cover 150 passing expected outcomes: 39 freshly rerun currency cases plus 111
previously completed cases across the nine unaffected harnesses. Every protected
source/test input of those retained runs was rehashed and still matches its recorded
before/after hash; this validation is in
`artifacts/f3g-l1-closure/retained-harness-proof.json`. There are zero unexpected
outcomes or residue. The final full run, architecture run and currency campaign
have zero skipped/todo tests. Closure evidence is under `artifacts/f3g-l1-closure/`;
the nine retained harness reports remain under `artifacts/f3g-l1-provenance/`.

Changed files are the currency policy, controller mutation fixtures, permanent
currency architecture tests, currency mutation runner/configuration, and this
report. No runtime, backend or dependency changes; no amend, squash or push.

## Commit boundary

- Branch: `main`.
- Exactly one remediation commit above `5dbb62a9bfd2c1fa01375b2cd46891600b7ce00d`.
- Grandparent: `146e6c93ec71429c88c5c2de6abf540c329cdc2d`.
- origin/main: `3aee44eae48b8ff75dcfe7d5b1fb08adbc3eccf5`.
- Post-commit behind/ahead: `0/4`, with a clean worktree.
- Commit subject: `test(dashboard): fail closed on unknown currency provenance`.
- The final commit identity is recorded in the completion response and local
  `artifacts/f3g-l1-closure/final-git.json`.
