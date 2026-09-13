# Backend contract access and integration register

F1 inspected the supplied frontend and nearby Qafilah directory on 2026-09-13. No Laravel repository or API documentation was available in the identified Qafilah workspace. This is an access limitation; it does not establish that any backend capability is absent.

## Evidence and scope

- Authorized write root: `D:\customers\qafilah\dashboard frontend` only.
- Root inspection found no pre-existing frontend project or Git repository, as recorded in the implementation plan. No Git initialization or push is authorized.
- `D:\customers\qafilah` contained only `dashboard frontend`.
- Immediate directory-name inventory of `D:\customers`: `aila`, `app`, `assar`, `LUNORA`, `porta frontend`, `qafilah`, `wanted-persons`. No sibling was identified as the Qafilah backend. Unrelated sibling contents were not opened.
- No `AGENTS.md` existed at `D:\`, `D:\customers`, or `D:\customers\qafilah`. The frontend now contains Next.js-generated agent guidance.
- The supplied brief establishes the intended Sanctum SPA cookie/session model and Laravel's authority. It supplies no verified route methods, paths, envelopes, pagination, CSRF names, permissions, Store membership contract, or deployment allowlist.

Verified backend contracts: **0**. Assumed backend contracts: **0**. Invented backend contracts: **0**. Real backend requests/integrations: **0**.

All implementation writes are frontend-local. Laravel files, routes, migrations, permissions and Product behavior modified by F1: **0**. The backend is outside the authorized write scope and was not accessible; a before/after tracked-backend diff could not be executed. Do not describe that unavailable diff as a certified runtime proof.

## BACKEND CAPABILITY REQUIRED

These entries request access to existing authoritative contracts before considering any new capability. They block real integration verification, not the isolated frontend foundation.

| ID    | Frontend requirement                                                | Missing verified contract                                                                                                                                          | Impact                                                                                                                      | Recommended phase                                                         | Blocking F1 foundation?                            |
| ----- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------- |
| BC-01 | Authenticate a merchant and recover expired sessions                | CSRF bootstrap, login, identity and logout methods/paths; request and response schemas; session and cookie behavior; 401/419/422/429 semantics                     | Login is a presentation foundation; production does not accept credentials or establish a fake session                      | F2 — Merchant Authentication, Store Context & Dashboard Shell Integration | No; real authentication blocked                    |
| BC-02 | Connect directly from the browser while preserving backend security | Approved frontend/API origins and host rules; Sanctum stateful deployment configuration; credentialed CORS; CSRF cookie/header names; allowed credential semantics | No backend connection can be enabled or certified                                                                           | Same F2                                                                   | No; Origin/Host and real CSRF tests blocked        |
| BC-03 | Show identity, memberships and selected Store safely                | Authoritative identity, Store UUID membership projection, Store selection flow, permission projection and revocation behavior                                      | No invented user, Store switcher, role or merchant membership is rendered                                                   | Same F2                                                                   | No; real multi-Store/browser privacy tests blocked |
| BC-04 | Exercise a representative read-only resource                        | An approved existing resource route with Store scope, response decoder, pagination/cursor, accepted sorts/filters, permissions and 403/404 semantics               | Table/detail examples remain development-only component patterns                                                            | Same F2, only after BC-01–03                                              | No; real representative resource blocked           |
| BC-05 | Display safe errors and support identifiers                         | Documented conflict/validation envelopes; safe field/domain messages; correlation header and browser exposure; rate-limit metadata                                 | Transport supports contract-supplied decoders/header names; it never assumes an envelope or displays raw backend exceptions | Same F2                                                                   | No; real error-envelope mapping blocked            |
| BC-06 | Populate an operational overview                                    | Any authoritative supported aggregate or work-summary projection, including its permissions and freshness requirements                                             | Overview contains no fabricated revenue, orders, counts, charts or product actions                                          | Later authorized overview integration                                     | No                                                 |

## Adapter activation checklist

For every future integration record source/revision evidence, HTTP method/path, authentication and CSRF requirements, request keys, success decoder, error decoder, Store authority, pagination, accepted filters/sorting, statuses and permissions. The centralized transport requires explicit contract evidence; a source label alone is not independent verification.

The transport is a foundation for direct browser-to-Laravel requests with credentials, restricted origin/path resolution, cancellation/timeouts and safe error normalization. No Next.js proxy, bearer flow, token persistence, fabricated endpoint or production mock authentication has been introduced. Actual Sanctum/HttpOnly/CSRF/Origin compatibility remains **NOT INTEGRATED / NOT TESTED against Laravel**.

Unit tests use synthetic contracts to exercise frontend behavior. They do not certify Laravel's actual routes, cookies, permissions, cross-Store authority or session behavior. Production excludes the development component-review route. Authentication expiry, permission revocation, Store-switch leaks, logout/browser-back privacy, actual cookie flags, wrong-Origin rejection and real backend validation require the authoritative backend deployment to be exercised in F2.

No backend changes should be made to bypass this access limitation. No F2 Product work has begun.
