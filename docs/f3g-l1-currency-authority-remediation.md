# F3-G A2-F3G-L1 — Currency authority guard remediation

The previous guard scanned only Store/Auth/backend directories and treated currency
tokens as violations. Product-layer synthesis escaped the scan, while legitimate
authoritative reads were rejected. Runtime behavior was already correct.

The replacement scans all production application sources, including future feature
directories, runtime scripts and Next configuration. Tests, fixtures, documentation,
development examples, generated and vendor trees are excluded. A TypeScript syntax
and local-symbol policy follows currency values through aliases, computed keys,
destructuring, local helpers and assignments. It rejects manufactured currency,
fallbacks and previous-Store reuse while permitting authoritative reads, schema
validation and explicit-currency formatting. Existing persistence and central
contract/transport rules run over the same production inventory. The exact strict
discovery/context schema separation remains independently asserted.

This is a bounded source policy, not a general JavaScript taint analyzer. It does
not resolve arbitrary dynamic code or prove cross-module dataflow. Ordinary direct,
aliased and computed consumption patterns are permanently challenged; the rollout
decoder and real-browser assertions provide separate behavioral coverage.

## Mutation proof

`node tests/store-currency-mutations.mjs` runs the committed architecture and decoder
tests, injecting only the source reader's in-memory Product detail source. Mutated
values are used in the actual Product detail JSX; the previous-Store mutant retains
a module-level prior snapshot across renders. Production bytes are never rewritten.

- Pristine, comments, strings, direct authoritative reads, aliased authoritative
  reads and pristine-after: GREEN.
- Product LYD fallback (P1), browser-language inference (P2), Role-name inference,
  previous-Store fallback, independent synthesis, localStorage, sessionStorage,
  Pricing GET and PATCH: RED through the named intended assertions.
- All 15 variants execute all 61 tests with no skipped/todo assertions. Infrastructure
  failures cannot count as successful kills. Protected hashes prove zero residue.

## Compatibility and regression

Frontend parent: `08ecfa90ad050ff77d958f605e6770a84b1e0019`.
Published baseline: `3aee44eae48b8ff75dcfe7d5b1fb08adbc3eccf5`.

Fresh real-Laravel browser runs used isolated copies of the exact backend authorities:

- Published `7cd52e549c2a657dc66643b36701356d1d024de5`: four journeys pass with currency
  absent from context.
- Candidate `4c86b8429f6d3e26d07129494de99f7f5b76db73`: four journeys pass, explicitly
  checking LYD, USD, EUR and null decoding.

Each journey verifies login, strict discovery, Store selection/context and Product
list/detail, with no Pricing request or browser currency persistence. Permanent
decoder tests reject unsupported/malformed values and extra or missing required
fields. Discovery remains exactly `{id, name, status}`.

Full Vitest: 60 files / 1,961 tests. Dedicated architecture: 212 tests. Development
Playwright: 23 tests. Production build/Playwright: 7 tests. Format, lint and typecheck
pass. Dependency audit: zero vulnerabilities. The ten mutation harnesses and strict
peer-dependency installation are recorded in the local gate evidence. All ten harnesses
complete 126 variants with zero unexpected outcomes and no mutation residue.

## Integrity and evidence

All 176 protected tracked source, asset, runtime/configuration and dependency files
have identical before/after SHA-256 hashes. Changes are confined to test policy,
source enumeration, architecture tests, mutation tooling and this report.

The canonical backend remains clean at candidate `4c86b842`, with origin/main at
`7cd52e54`. Container source verification compared 1,673 published and 1,674 candidate
files against fresh Git archives before and after testing: zero differences. All
owned containers, networks, volumes and private credentials/fixtures were removed;
all 51 pre-existing containers were preserved. Backend checkout files were never
mounted into a writable test container.

Local logs, mutation reports, source manifests, integrity and cleanup records live
under ignored `artifacts/f3g-l1/`. Reproduce the permanent guard with
`pnpm exec vitest run tests/store-currency-architecture.test.ts`, or its operative
proof with `node tests/store-currency-mutations.mjs`. Runtime, Pricing, backend and
dependency changes: zero. No amend, squash or push.
