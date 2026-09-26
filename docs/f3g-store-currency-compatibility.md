# F3-G Store currency compatibility

## Scope and authorities

Frontend baseline: `3aee44eae48b8ff75dcfe7d5b1fb08adbc3eccf5` on `main`,
clean and equal to `origin/main` before work. Current backend:
`7cd52e549c2a657dc66643b36701356d1d024de5`. Certified backend candidate:
`4c86b8429f6d3e26d07129494de99f7f5b76db73`.

Only the selected Store context decoder changes at runtime. A separate
`selectedContextStore` strict object reuses the required discovery fields and
accepts optional `currency: "LYD" | "USD" | "EUR" | null`. Absence stays absent;
null stays null. The key is temporarily optional so the frontend can be published
before the backend, without breaking the currently published context response.

`accessibleStore` and `/me/stores` remain exactly `{ id, name, status }`, strict.
Unsupported currencies, empty/lowercase/whitespace strings, numbers, booleans,
objects, arrays, unknown Store fields, and missing required fields are rejected.
There is no fallback, inference, editable currency, browser persistence, permission
change, pricing route activation, or Product/Variant pricing implementation.

## Permanent proof

- `src/lib/backend/store-currency.test.ts`: 21 decoder/transport cases, including
  absent/LYD/USD/EUR/null, strict rejection, required fields, and discovery separation.
- `tests/store-currency-architecture.test.ts`: 15 syntax-based guards and operative
  negative controls for schema ownership, optional typed currency, defaults,
  Role/locale inference, persistence, and pricing endpoint activation. Comments and
  standalone documentation do not serve as mutation anchors.
- `tests/compatibility/store-currency.spec.ts`: four real-browser journeys per
  backend authority. Non-owner login, four-Store discovery, selection, real context
  decoding, Product list/detail, no pricing requests, and no currency persistence.
  Development Next debug records are inspected separately from application storage.
- `tests/integration/laravel-store-currency-fixtures.php`: synthetic non-owner
  fixtures for four Stores, restricted to a disposable local database.
- `playwright.store-currency.config.ts`: dedicated configuration, one worker,
  zero retries, no credential-bearing trace/video, no reuse of an existing server.

To repeat the dedicated browser run, build a disposable runtime from the exact
chosen backend Git archive using its published Dockerfile/Compose topology.
Migrate only that isolated database (`qafilah_f2_isolated`), copy and execute the
frontend fixture script inside its app container, and securely copy
`/tmp/f3g-browser.json` to a private local fixture file. Allow frontend origin
`http://localhost:3002` in that runtime's CORS/Sanctum configuration. Set
`F3G_BACKEND_AUTHORITY`, `F3G_API_ORIGIN`, and `F3G_FIXTURES`, then run:

```text
pnpm exec playwright test --config playwright.store-currency.config.ts
```

Repeat for both authorities; never seed a real Store database. The published run
requires currency to be absent; the candidate run requires exact LYD/USD/EUR/null.
Unconfigured prices remain null and are not used to discover currency.

## Verification

- Full `pnpm verify`: format, lint, types, 60 Vitest files / 1,936 tests, production build.
- Focused compatibility tests: 36 passed, included in the full Vitest run.
- Development Playwright: 23 passed.
- Production Playwright: 7 passed.
- Real published backend compatibility: 4 passed; real candidate compatibility: 4 passed.
- Candidate F3-B–F3-F regression: 11 passed, covering Product create/edit/uncertain
  reconciliation, Simple inventory absolute replacement, all nine structural
  Variant contracts, Variant inventory bounds and uncertain outcomes, Product and
  Variant public JPEG/PNG/WebP uploads/metadata/deletion, and unknown upload review.
- Store discovery and scoped-session mutation harnesses: pristine/decoys green,
  operative mutants red, pristine-after green. No production mutation residue.
- Frozen-lockfile install with strict peers and no scripts passed; dependency
  audit reported zero vulnerabilities. No dependency or lockfile changes.

Execution logs and isolated runtime evidence are under ignored
`artifacts/f3g-compat/`. Adapted existing regression copies change only fixture and
evidence locations, API origin, and owned container names; original suites and
assertions remain unchanged, with source/copy hashes recorded.

## Backend preservation and rollout

Both runtimes were built from exact Git archives, with 1,673 published and 1,674
candidate application/configuration/migration/route/test/dependency files matching
their archives. Source repositories were never mounted into writable containers.
All fixture writes targeted isolated databases. The canonical backend remained
clean on candidate `4c86b8429f6d3e26d07129494de99f7f5b76db73`, with
`origin/main` still `7cd52e549c2a657dc66643b36701356d1d024de5` (0 behind / 1 ahead).

Both isolated runtime projects, their networks/volumes, and private fixture/secret
files were removed after source-integrity rechecks. Pre-existing containers were
preserved. Next's generated environment declarations were restored by type
generation after the development runs; they are not part of the compatibility diff.

The compatibility commit is one local child of the frontend baseline. Neither
repository is pushed. Pricing implementation remains a separate authorization.
Requiring currency rather than accepting omission is deferred until the backend
rollout and its supported rollback window are explicitly resolved.
