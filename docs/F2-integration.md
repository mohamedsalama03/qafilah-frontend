# Isolated F2 integration verification

The tested backend is published main `6614690a3b24b39f45c7c1b9ed85c20ecb22cbbf`. Its checkout remains read-only. The frontend tests use a Git archive of that exact revision and its existing development Dockerfile/Compose configuration. Existing migrations initialize a new disposable PostgreSQL database; no backend migration or configuration file is changed. Synthetic fixture helpers and published authority-change actions are reused from the snapshot.

## Environment used

| Resource                     | Owned name / address                        |
| ---------------------------- | ------------------------------------------- |
| Frontend integration browser | `http://localhost:3000`                     |
| Backend HTTP                 | `http://localhost:3842`                     |
| Compose project              | `qafilah-f2-runtime`                        |
| PostgreSQL database          | `qafilah_f2_isolated`                       |
| Backend image                | `qafilah-f2-backend:6614690a`               |
| Frontend review image        | `qafilah-merchant-f2:review`                |
| Review container             | `qafilah-merchant-f2-review`, loopback 3843 |

The browser origin is the backend's published development CORS origin. Only the external HTTP port, isolated database name, image name and generated secrets differ from the existing development Compose defaults. No Host, Origin, CORS, stateful domain, CSRF or cookie rule is relaxed. Redis and PostgreSQL networks/volumes are separate from the shared Qafilah services. No worker, scheduler or outbound mail service is started.

The source snapshot and execution evidence live under ignored `artifacts/f2/runtime/`. The reviewed scripts there (`setup.sh`, `initialize.sh`, `reset-owned-database.sh`) record the exact executed steps. The tracked test control is `tests/integration/laravel-fixtures.php`; it refuses any environment other than local and the exact isolated database. Its credential output is written to private files, never printed. Playwright reads the ignored browser fixture file in memory and disables traces/video.

## Reproduction recipe

1. Verify the backend checkout's expected HEAD and clean state. Export its exact Git revision to a new frontend-owned artifact directory with `git archive`, without copying `.env`, Git metadata or untracked backend files.
2. Build that snapshot using its existing Dockerfile, target `development`. Generate new cryptographic APP_KEY, DB_PASSWORD and REDIS_PASSWORD into an ignored, access-limited environment file. Do not print it or use production values.
3. Use the snapshot's `compose.yaml`, project `qafilah-f2-runtime`, and a frontend-owned override that changes only the app image to `qafilah-f2-backend:6614690a`. Set HTTP_PORT 3842 and DB_DATABASE `qafilah_f2_isolated`; retain the published development security defaults. Start only postgres, redis, app and nginx. Never use the shared Compose project.
4. In the owned app container, run its existing `qafilah-entrypoint php artisan migrate --force --no-interaction` against that new database. This initializes existing schema, not new backend code. Copy the frontend-owned fixture control to `/tmp/f2-fixtures.php`; run `qafilah-entrypoint php /tmp/f2-fixtures.php seed`. Copy `/tmp/f2-browser.json` to ignored `artifacts/f2/runtime/browser-fixtures.json`. The fixture tool emits only a safe summary.
5. Run `pnpm exec playwright test --config playwright.integration.config.ts`. Playwright owns localhost 3000 and refuses to reuse an existing server. The test suite consumes the six real HTTP contracts directly through the browser. Authority changes execute existing backend actions through Docker CLI, not test-only API routes.
6. For a complete rerun, recreate only the named disposable database and clear only the owned Redis instance after verifying Compose project labels. Existing shared services must remain untouched. Rerun schema initialization and fixture seeding. This is necessary because membership and identity suspension tests intentionally change synthetic authority.
7. After verification, stop/remove only this Compose project's containers, networks and volumes. Remove the generated ignored credential files and private fixture copies. Preserve sanitized reports/screenshots and the final frontend image for review. Do not globally prune Docker or delete backend files.

## What the tests establish

Twelve real-adapter journeys cover login/CSRF/current identity;23 nonowner Stores across two pages; zero eligible Stores with draft ownership; one Store and deep-link refresh; uppercase and malformed UUID navigation; A-to-B context/permission isolation with the destination request delayed; safe foreign 404; same-session permission removal, Role replacement and membership 403; misleading Role label with zero grants; identity 401; logout failure/retry, tokenless cross-tab invalidation and browser-back privacy; status 400/401/419/422/429; five responsive widths and keyboard/axe; transient 500 recheck; and synchronous private portal hiding during page-history suspension.

The 500 recheck and failed logout are explicitly simulated transport failures through the real adapter; all baseline authentication and Store responses come from Laravel. The page-history test dispatches lifecycle events to measure the synchronous privacy boundary; it does not claim every browser will choose BFCache. Browser back is exercised separately.

Cookie evidence contains names and flags only: HttpOnly Laravel session; readable XSRF cookie; SameSiteLax, path `/`, host localhost and Securefalse in the published HTTP development configuration. Application localStorage/sessionStorage are empty. Installed Next development tooling creates IndexedDB `__next_debug_channel`; its records were inspected for the actual fixture password/session/CSRF values without retaining those values, and none were present. Production storage checks separately require no databases.

The Docker production image is built with public HTTPS origin `https://localhost:3842` to verify the configured login surface and production policies. The isolated backend port serves HTTP, so that container check deliberately does not claim a successful production TLS connection. Real successful authentication is certified here only for the published local development topology. A production deployment still needs its approved HTTPS/CORS/Host/cookie topology; no bypass is supplied.
