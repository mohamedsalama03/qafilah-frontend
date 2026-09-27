# F3-G A2-F3G-L1 — Final test-only remediation

Parent: `146e6c93ec71429c88c5c2de6abf540c329cdc2d`. Runtime behavior is unchanged.

## Gaps and corrections

- **R3:** Identifier labels did not establish where a currency came from. Canonical
  local source identities now follow aliases, destructuring and computed reads.
  Missing-currency conditional branches cannot substitute another context's currency.
  Permanent tests rename the second source to ordinary identifiers.
- **R4:** Initializer-only analysis missed later assignments to retained snapshots.
  Declaration-bound reads/writes now detect Store/context snapshot use across function
  boundaries or before replacement. Current-flow aliases remain legal, including an
  alias named `previousStore`. Existing unknown-source diagnostics and the original
  previous-Store fallback regression remain protected.
- **R7:** String-valued JSX attributes bypassed expression analysis. Currency props
  now reject literals; authoritative props and ordinary text/title attributes pass.
- **R8:** Skipping literal call arguments also skipped currency consumers. Parameter
  positions come from local or imported production function declarations, including
  aliases. The campaign calls the real `minorUnitsToDecimal` with a literal versus an
  authoritative value. Boolean validators and allowed-code comparisons remain legal.
- **R9:** Array element selection lost currency provenance. Literal/aliased array
  selections now propagate through ternary branches and missing-value checks.

## Permanent proof and performance

Before correction, six permanent regression cases reproduced the five gaps (R4 has
module and local cases). The final campaign runs the complete permanent architecture
and decoder suites against in-memory Product-detail mutations: 24 variants, 85 tests
each. Fourteen operative variants are RED through intended assertions; ten pristine,
decoy, validation and authoritative-consumption controls are GREEN. R3/R4/R7/R8/R9
each have a named production assertion. There are no skipped/todo cases, infrastructure
errors or source residue. Old previous-Store fallback coverage remains RED.

All production syntax is examined, including future feature directories. An AST
relevance pass avoids unnecessary value-flow work; it includes folded computed keys
and imported currency consumers. Lexical bindings replace per-file compiler programs.
The inventory is read once, syntax trees are shared by both policies, and each policy
result is cached once per Vitest process. Each mutation starts a fresh process.
The normal five-second test timeout remains unchanged. Per-variant scan timings are
recorded in `artifacts/f3g-l1-final/currency-mutations/results.json`: maximum 1.01 seconds,
mean 0.60 seconds across the final campaign's currency/architecture scans. Stale JSON reports
are removed before execution; timeout, setup failure and skipped tests cannot count
as successful mutation kills. Analysis remains bounded to ordinary static flows,
not arbitrary dynamic JavaScript evaluation.

## Compatibility and gates

Fresh real-browser runs passed four journeys per exact backend authority:

- `7cd52e549c2a657dc66643b36701356d1d024de5`: context currency absent.
- `4c86b8429f6d3e26d07129494de99f7f5b76db73`: LYD, USD, EUR and null.

Both prove login, strict three-field discovery, Store selection/context and Product
workspace access, with no Pricing request or currency persistence. Permanent decoder
tests preserve malformed/unsupported-value rejection and required-field strictness.

Gate evidence includes full Vitest, dedicated architecture, all ten mutation harnesses,
format, lint, typecheck, production build, development and production Playwright,
dependency audit and strict peer checks. Raw evidence is under ignored
`artifacts/f3g-l1-final/`; reproduce the currency campaign with
`node tests/store-currency-mutations.mjs`.

Full Vitest: 60 files / 1,985 tests. Dedicated architecture: 236 assertions. Development
Playwright: 23 tests. Production Playwright: 7 tests. Dependency audit: zero findings.
All ten mutation harnesses: 135 variants, zero unexpected outcomes and no residue.
Frozen-lockfile installation with strict peer dependencies passed without changes.

## Integrity and changed files

Production/source/configuration/dependency SHA-256 checks cover 196 protected tracked
files before and after, against the starting candidate. Runtime modifications: zero.
The backend checkout stays clean at `4c86b842`, with origin/main at `7cd52e54`.
Isolated container source checks match 1,673 published and 1,674 candidate archive
files before and after testing. Owned containers, networks, volumes and private
fixtures were removed; all 51 pre-existing containers were preserved.

Changed files: `tests/architecture-policy.ts`, `tests/currency-authority-policy.ts`,
`tests/production-sources.ts`, `tests/store-currency-architecture.test.ts`,
`tests/store-currency-mutations.mjs`, and this report. No runtime, dependency or backend
change; no Pricing implementation; no amend, squash or push.
