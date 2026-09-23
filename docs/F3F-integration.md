# F3-F real Laravel and public-image verification

The permanent media suites use the exact published backend authority
`7cd52e549c2a657dc66643b36701356d1d024de5` in a disposable frontend-owned runtime.
The canonical backend repository and database are read-only. Its exact Git archive,
published Dockerfile, Compose configuration, Nginx configuration and persistent
public-media volume topology are retained unchanged. Supported frontend origin and
CORS environment overrides select the isolated browser origins.

## Reproduction and isolation

From the frontend directory, run the retained controls sequentially:

```powershell
& artifacts/f3f/runtime/setup.ps1
& artifacts/f3f/runtime/initialize.ps1
pnpm exec playwright test --config playwright.media.config.ts --output artifacts/f3f/media-browser-output
& artifacts/f3f/prepare-regressions.ps1
pnpm exec playwright test --config artifacts/f3f/playwright.regressions.config.ts --output artifacts/f3f/regression-browser-output
```

The owned Docker project is `qafilah-f3f-runtime`; the isolated database retains
the exact fixture guard name `qafilah_f2_isolated`. The API is
`http://localhost:3842` and development frontend `http://localhost:3002`. Setup
refuses existing resources with the owned project identity. Credentials are
generated, kept private and never printed or stored in browser evidence. The
canonical backend source is not mounted. All resets must use the guarded
`runtime/reset-owned-database.ps1`, followed by initialization, while no browser
suite is running. The unrelated port-3000 application is preserved.

Next development, type generation and local builds share generated output and run
sequentially. The separate frontend Docker build has its own generated output.
Every concurrent Playwright job must also use its own output directory, as shown
below; Playwright clears that directory at startup.
Production uses real HTTPS browser/API origins, `https://localhost:3002` and
`https://localhost:3844`, through a frontend-owned transparent TLS edge. It forwards
the actual browser headers, without Origin substitution or authentication bypass.
The local self-signed certificate is accepted only by the test browser, without
changing system trust.

```powershell
& artifacts/f3f/docker-review.build-review.ps1
& artifacts/f3f/docker-review.start.ps1
& artifacts/f3f/runtime/configure-production-origin.ps1
& artifacts/f3f/runtime/prepare-tls.ps1
& artifacts/f3f/runtime/start-owned-tls.ps1
pnpm exec playwright test --config playwright.media-production.config.ts --output artifacts/f3f/production-media-browser-output
```

## Permanent coverage

The development suite covers all eight GET/POST/PATCH/DELETE contracts; Product
and Variant JPEG, PNG and WebP uploads; browser-rendered thumbnails and exact
anonymous public bytes/MIME; Product ten and Variant five limits; byte, dimension,
pixel, metadata and position bounds; primary selection, server ordering and delete
fallback; public 404 after deletion; inactive and archived lifecycle behavior;
independent grants, grants without read permission, revocation and context-read
prerequisites; foreign, wrong-parent, cross-kind, malformed and unknown identities.

Actual Laravel responses are held across Store, Product, Variant and principal
changes. A pending deletion uses legitimate browser Back navigation to leave its
blocking dialog before changing authority. Committed response-loss cases forward
the request to Laravel before dropping the response. Uncommitted cases abort
before dispatch. Both media kinds exercise all three unknown mutation outcomes,
explicit current-collection review and fresh deliberate intent. Failed review,
remount, duplicate timing, repeated Enter and secondary-refresh failure are also
covered. No successful domain response is fabricated. Failure injection is
explicitly limited to transport loss, delays, unsafe response data and read errors.

The published metadata contract has an important distinction: an **empty PATCH
returns 422**, while a nonempty PATCH repeating existing metadata returns **200**
and audits the supplied fields. The frontend prevents unchanged form submission
locally; it must not reinterpret a valid backend 200 as 422.

The production suite verifies fail-closed private routes and exact CSP, then
uploads six real images through the fresh non-root frontend container. Anonymous
HTTPS reads must match each uploaded byte and MIME. It recreates the exact owned
Laravel app and Nginx containers, proves new container IDs with the retained shared
volume, and repeats public bytes/MIME and browser rendering checks. Deliberate
negative image probes verify CSP blocks the API origin outside its media path and
an unapproved host. These negative probes are test-only DOM elements.

## Prior phases and evidence

All **212** previous real Laravel journeys remain: F2 12, F3-A 18, F3-B 23,
response-boundary 39, reconciliation 7, F3-C inventory 33, inventory feedback 7,
F3-D variants 34 and F3-E Variant inventory 39. Permanent traffic guards allow only
new authorized scoped media GET reads; their write prohibitions and deferred
pricing checks remain. Ignored harness copies change only evidence/fixture paths,
the owned runtime container, the native Docker launcher and approved frontend
origin. `regression-source-diff.patch` and `regression-harness-integrity.json`
retain the exact reviewed source differences and source/copy hashes.
The historical date-filter journey also waits for a successful initial collection
response and a visible returned row before applying its filters. This prevents its
filtered-response waiter from consuming the outstanding default response; the
exact historic Product identity and empty updated-range expectations remain.

Sanitized traffic, screenshot and focused axe evidence lives under
`artifacts/f3f`. Traffic records exclude cookies, credentials, multipart bytes and
authenticated storage. Focused axe scans are representative checks, not a full
WCAG certification. `backend-runtime-proof.json` records published-source hashes
and runtime mounts. Docker image evidence records source fingerprints, fresh image
identity, non-root UID/GID, health, private-page behavior and a bounded scan for
fixtures, known secret patterns, dotenv files and browser source maps.

Initial harness preparation exposed file-label selector ambiguity, Chromium's
unavailable body retrieval for 204 responses, the empty-versus-unchanged PATCH
distinction, and modal-blocked outside-click navigation. These were corrected in
the harness without weakening domain assertions. Preparation logs/results remain
separate from the final fresh complete runs. A later generated Next development
route table contained only login/not-found; its preserved ignored cache was moved
aside after proving no competing Qafilah Next server, restoring private routing
without a source change. The restarted fresh complete development run passed.
The first prior-phase regression run passed 211/212; the date-filter journey
captured the still-pending initial GET. Its initial-read synchronization was
corrected before reseeding the isolated runtime and repeating all 212 journeys.
A concurrently started foundation browser run shared Playwright's default
`test-results` directory with the Docker production suite. Production startup
cleared a trace path, causing a foundation context-close ENOENT after its test
assertions. That coordination failure is retained separately; final foundation
verification uses isolated output paths. It was not an application failure.

## Final results and cleanup

The final complete runs passed **61/61** media cases, **212/212** prior-phase cases
and **2/2** Docker HTTPS/public-media cases: **275/275**, with zero skipped cases,
retries or flaky results. The representative axe evidence contains **100** scans
(22 media and 78 prior-phase), with zero violations. The verifier checks all
Playwright leaves and SHA-256 hashes for **126** runtime inputs and **9** prior
source/copy pairs. Four media harness files remain byte-identical to the tested
inputs. Final staging normalized only the PHP fixture's **122 CRLF endings to
LF**, preserving its tested snapshot and historical hash manifest. All **2,325**
PHP tokens retain their types and source lines, with no non-whitespace token
change; both versions parse successfully in the retained published backend image.
`fixture-line-ending-normalization/` records both hashes, exact byte equivalence
and the isolated syntax/token proof. The five harness inputs are therefore four
unchanged files plus one explicitly equivalent newline-normalized fixture; no
browser or application tests were repeated for this newline-only change.

The fresh production image is
`sha256:8b0611fcb90ea2f935a0cd5b36371f1ef5a324e9e4533c59587b46589b9f9e6f`.
It ran healthy as UID/GID **1001**; a bounded scan checked **1,359** files and
found no prohibited fixture, secret, dotenv or browser-source-map residue.
Fifteen HTTP probes and three private browser routes passed. Six real uploaded
images retained their exact public MIME/bytes and rendered after app/Nginx
container recreation with the same published media volume. The runtime-input
fingerprint is
`5f7fbbb4b7a58c9a224d9a9f5d572d89e9e2c87d5778fddf9f51994598436e17`.
Detailed results are in `artifacts/f3f/real-integration-summary.json`,
`production-public-images.json` and the Docker review evidence.

Guarded cleanup removed the owned TLS process, five containers, three volumes,
two networks and generated private credential leaves. No owned resources,
credential leaves or relevant listeners remain. All **51** unrelated containers
retain their initial identities, images and states. The unrelated Enmaa port-3000
application was externally restarted during verification, changing PID 28228 to
18448; no F3-F control targeted it, and final PID remained 18448. Original PID
continuity is not claimed. The canonical backend finished on exact published
`main`, clean and **0/0**, recorded in `backend-final-state.json`.
`cleanup-result.json` and `protected-port3000-final.json` retain cleanup evidence.
No global Docker cleanup was used. Container recreation persistence is not backup
or replication, and
best-effort physical deletion does not promise orphan cleanup after storage failure.
