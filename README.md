# Qafilah Merchant Dashboard · F2

A separate Next.js merchant frontend using the six published Laravel/Sanctum contracts for authentication, accessible Store discovery and current Store context. Laravel remains the authority for identity, membership and every operation. There are no commerce feature APIs, fabricated metrics, Bearer tokens or browser auth persistence. Without a configured API origin, the entry remains unavailable.

## Run locally

Use Node 24 and the pinned pnpm 11.19.0. `.nvmrc` records the validated Node patch. Enable Corepack if your environment does not already provide pnpm:

```powershell
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
pnpm dev
```

Open [component review](http://127.0.0.1:3001/design-system) or the [production-shaped sign-in state](http://127.0.0.1:3001/login). The local frontend origin is **http://127.0.0.1:3001**. This choice does not authorize the origin on Laravel. Production requires a confirmed deployment origin compatible with the backend’s existing cookie, CORS, Origin and Host rules.

Review `.env.example`. No environment file is required for disconnected component review. `NEXT_PUBLIC_API_ORIGIN` activates the real adapter and must be an origin only; HTTPS is mandatory in production. Never provide Laravel secrets or session tokens. The published backend's approved local browser origin is **http://localhost:3000**; run `pnpm exec next dev --hostname localhost --port 3000` for integration, with the actual local backend API origin configured. The default component-review port 3001 is not an approved backend origin.

## Verify

```powershell
pnpm install --frozen-lockfile
pnpm verify
pnpm exec playwright install chromium
pnpm test:e2e
pnpm test:production
pnpm audit
pnpm peers check
```

`verify` performs non-mutating format, lint, typecheck and tests, then a normal production build. `pnpm format` is the separate formatter. `pnpm test` terminates; `test:watch` is optional. Playwright owns a development server on 3425 and an unconfigured production server on 3411, with reuse disabled. Interactive component review remains on 3001. `pnpm start` packages the generated static assets and starts Next’s standalone server, also on 3411 by default.

Real Laravel coverage is separate: `pnpm exec playwright test --config playwright.integration.config.ts` owns the approved browser origin on localhost 3000 and connects directly to the isolated backend on localhost 3842. It requires the frontend-owned disposable fixture environment described in [F2 integration](docs/F2-integration.md). Never point fixture controls at shared or customer data. Tests disable traces/video and retain only sanitized request/cookie metadata and screenshots. Local HTTP evidence does not certify production TLS/Secure-cookie deployment.

An optional `pnpm analyze` opens Next.js’s local bundle analyzer. It is not needed to serve the app and adds no analyzer runtime dependency. No external CI service is assumed.

## Production container

```powershell
docker build -t qafilah-merchant-f2:local .
docker run --rm --name qafilah-merchant-f2 -p 127.0.0.1:3200:3000 qafilah-merchant-f2:local
```

The multi-stage image installs from the lockfile, builds standalone output and runs as UID 1001. Its health check checks this frontend’s `/login` document, not an invented Laravel health endpoint. For a connected deployment, the approved public API origin must be set at build time with `--build-arg NEXT_PUBLIC_API_ORIGIN=...`; public build configuration is not a secret. Confirm runtime/deployment headers and origins as part of actual integration. No runtime origin change can substitute for rebuilding browser public configuration.

## Review map

| Area                               | Location                    |
| ---------------------------------- | --------------------------- |
| Merchant login and Store selection | `/login`, `/`               |
| Verified current Store overview    | `/stores/[storeUuid]`       |
| Development shell and overview     | `/design-system`            |
| Table and responsive summaries     | `/design-system/table`      |
| Representative record detail       | `/design-system/detail`     |
| Form, validation, confirmation     | `/design-system/form`       |
| Components and ten error families  | `/design-system/components` |
| Disabled login visual pattern      | `/design-system/login`      |

Every development route returns 404 in production; examples are excluded from production bundles. See [architecture](docs/architecture.md), [backend contract inventory](docs/backend-contracts.md), [design system](DESIGN.md), and [F1 implementation and verification report](docs/F1-report.md).

Git was absent at initial inspection. Product Authority subsequently published F1 and its focused remediation. The published F2 starting point is `473b44c1c0bc0627942866c31b11aac4d4c35442`; backend authority is `6614690a3b24b39f45c7c1b9ed85c20ecb22cbbf`. Earlier F2 discovery stopped correctly for missing Store-context authority before that backend publication. F1 reports remain historical. See the [F2 report](docs/F2-report.md) for current results, limitations and the single local F2 commit; no push is authorized.
