# F3-G — Product and Variant Pricing

Frontend baseline: `add4cc9ca38ffece91763ccf0684684f1efc5092`.
Backend authority: `4c86b8429f6d3e26d07129494de99f7f5b76db73`.

The existing Simple Product and Variant details now expose Pricing read, first setup,
and absolute replacement. The Variant-type parent has no direct pricing panel.

## Contracts and authority

Exactly four contracts were added: GET/PATCH on
`/api/v1/stores/{store}/catalog/products/{product}/pricing` and
`/api/v1/stores/{store}/catalog/products/{product}/variants/{variant}/pricing`.

Product read/write permissions are `products.view` / `products.price.update`;
Variant read/write permissions are `products.variants.view` /
`products.variants.price.update`. The existing Variant workspace also requires
Product context access. Backend grants remain independent. The frontend editor
requires the corresponding read grant as well as the write grant; a write-only
principal receives no editor or invented reconciliation access.

PATCH sends only `{amount}` as a strict JSON integer in `1..999999999999`.
Decimal input remains text: validate digits/precision, concatenate whole and padded
fractional digits, check the bound, then convert the proven safe integer to JSON.
Display uses the existing digit-splitting formatter. LYD has three decimals; USD
and EUR have two. Zero, signs, exponent notation, excessive precision and overflow
are rejected. No floating-point money arithmetic supplies authority.

Currency comes exclusively from selected Store context. Null or temporarily absent
currency blocks editing without a default. Discovery remains the strict three-field
Store schema. A verified currency change now revokes the operational scope before
publishing new context, preventing old drafts and responses from crossing currency
revisions. The certified repository-wide currency policy is unchanged.

## Mutation and projection behavior

Each deliberate interaction permits one PATCH. Pending attempts single-flight;
confirmed and unknown attempts consume the slot across remounts. An amount-free,
session-owned uncertainty marker survives Store navigation and authority revisions.
Only authorized explicit GET review opens a fresh blank interaction. Failed review
keeps the lock; matching current state never proves an earlier PATCH committed.
Stale handlers cannot reuse a slot. No transport, query or controller automatically
replays Pricing PATCH.

Queries/controllers include session/principal, Store, authority revision, Product
and optional Variant identity. Access and identity are checked around asynchronous
boundaries. Confirmed writes retain their success if a subsequent projection read
fails. Variant changes refresh Variant and parent Product projections; active
configured Variant prices determine the server's minimum, independently of stock.
Inactive Variant prices remain editable but do not contribute. Archived Products
remain readable where authorized and cannot be priced. Pricing does not publish.

## Verification evidence

Evidence is retained in ignored `artifacts/f3g/`. Synthetic credentials and Docker
secrets are private, excluded from reports, and removed during final cleanup.

- Full Vitest: 2,186 passed; architecture subset: 404 passed.
- All 11 mutation campaigns passed: 165 variants (55 GREEN controls, 110 expected RED violations), no residue, and all protected hashes unchanged. Campaigns cover Pricing, currency authority, Media, Variant Inventory, Variants, Inventory, inventory feedback, Product resubmission/guidance, Store discovery and scoped sessions.
- Dedicated Pricing mutation campaign: pristine/decoys/pristine-after GREEN;
  eleven operative mutants RED through intended assertions; residue absent.
- Development real Laravel Pricing: 26 journeys passed on the exact backend source.
- Production image privacy: development routes 404, private links fail closed,
  nonce CSP and no-store/noindex protections passed. Non-root UID 1001, read-only
  root filesystem, no capabilities, no-new-privileges, no fixture/secrets directories.
- Production real Laravel Pricing: all 26 journeys passed over HTTPS through the fresh image, including same-document recovery after read authority is restored.
- Focused F2–F3-F real Laravel regressions: 20 passed, including both media kinds with real public JPEG/PNG/WebP delivery and the inventory feedback remediation.
- Standard development Playwright: 23 passed; production Playwright: 7 passed.
- Frozen install with strict peers, format, lint, typecheck and production build passed. Both full and production dependency audits reported zero vulnerabilities.
- Desktop/mobile visual review and focused axe checks passed; the interface detector returned no findings.
- Final cleanup removed owned containers/volumes, the TLS process and 13 private fixture/TLS/secret files. All 52 pre-existing containers remain present.

All earlier-phase integration changes only allow the two verified Pricing GET
shapes alongside existing panel reads; their mutation restrictions remain intact.
Existing API mocks and exact registry counts were extended for four new methods.
The currency mutation runner's intended assertion name was aligned with the
verified Pricing phase; its guard and operative mutations were not weakened.

## Boundaries

No backend repository files, shared transport, CSP, media URL logic, dependencies,
Store discovery schema or currency provenance policy were changed. Real Laravel
writes affected only disposable synthetic fixtures in the frontend-owned Docker
project. Backend checkout and all 1,674 runtime source files match the authority.
Unrelated Docker workloads are preserved.

No discounts, compare-at pricing, taxes, currency editing, multi-currency, history,
bulk pricing, promotions or subscriptions. The backend supplies no idempotency,
version or compare-and-swap contract: concurrent absolute replacements can overwrite
one another, and review observes current state rather than operation completion.
There is no unset/delete contract. No push is authorized or attempted.

## Changed files and candidate

Production changes are confined to five new Pricing files (`model.ts`,
`contracts.ts`, `queries.ts`, `mutations.ts`, `components/pricing-panel.tsx`), the
Product/Variant detail integrations, the backend contract registry/client, and the
Store controller currency-revision check. Other changes are permanent Pricing unit,
architecture, mutation and Laravel/browser tests, existing API mock/registry updates,
read-traffic assertions, the Pricing Playwright configuration and this report.

The local candidate is one commit with subject
`feat(dashboard): integrate merchant product pricing`, directly above the frontend
baseline. Published frontend and backend branches were rechecked remotely before
commit. The expected final state is `main`, behind/ahead `0/1`, clean, with no push.
The exact candidate identity is returned in the task's final report.
