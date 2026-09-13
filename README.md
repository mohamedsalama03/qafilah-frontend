# Qafilah Merchant Dashboard · F1

A separate Next.js merchant frontend. The Laravel backend is unchanged. **No backend endpoint is connected:** the workspace contained no Qafilah Laravel source or accepted API documentation. Production deliberately shows an unavailable sign-in state. Development-only patterns demonstrate the interface without pretending to be an authenticated store.

## Run locally

Use Node 24 and the pinned pnpm 11.19.0. `.nvmrc` records the validated Node patch. Enable Corepack if your environment does not already provide pnpm:

```powershell
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
pnpm dev
```

Open [component review](http://127.0.0.1:3001/design-system) or the [production-shaped sign-in state](http://127.0.0.1:3001/login). The local frontend origin is **http://127.0.0.1:3001**. This choice does not authorize the origin on Laravel. Production requires a confirmed deployment origin compatible with the backend’s existing cookie, CORS, Origin and Host rules.

Review `.env.example`. No environment file is required for the disconnected foundation. `NEXT_PUBLIC_API_ORIGIN`, when supplied, must be an origin only; HTTPS is mandatory in production. Setting it never enables an API adapter. Never provide Laravel secrets or session tokens.

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

`verify` performs non-mutating format, lint, typecheck and tests, then a normal production build. `pnpm format` is the separate formatter. `pnpm test` terminates; `test:watch` is optional. Playwright owns a development server on 3425 and a production server on 3411, with reuse disabled so an unrelated service cannot supply evidence. Interactive `pnpm dev` remains on 3001. `pnpm start` packages the generated static assets and starts Next’s standalone server, also on 3411 by default. Real Laravel journeys are **not** included or certified.

An optional `pnpm analyze` opens Next.js’s local bundle analyzer. It is not needed to serve the app and adds no analyzer runtime dependency. No external CI service is assumed.

## Production container

```powershell
docker build -t qafilah-merchant-f1:local .
docker run --rm --name qafilah-merchant-f1 -p 127.0.0.1:3200:3000 qafilah-merchant-f1:local
```

The multi-stage image installs from the lockfile, builds standalone output and runs as UID 1001. Its health check checks this frontend’s `/login` document, not an invented Laravel health endpoint. For a connected deployment, the approved public API origin must be set at build time with `--build-arg NEXT_PUBLIC_API_ORIGIN=...`; public build configuration is not a secret. Confirm runtime/deployment headers and origins as part of actual integration. No runtime origin change can substitute for rebuilding browser public configuration.

## Review map

| Area                              | Location                    |
| --------------------------------- | --------------------------- |
| Production unavailable state      | `/`, `/login`               |
| Development shell and overview    | `/design-system`            |
| Table and responsive summaries    | `/design-system/table`      |
| Representative record detail      | `/design-system/detail`     |
| Form, validation, confirmation    | `/design-system/form`       |
| Components and ten error families | `/design-system/components` |
| Disabled login visual pattern     | `/design-system/login`      |

Every development route returns 404 in production; examples are excluded from production bundles. See [architecture](docs/architecture.md), [backend contract inventory](docs/backend-contracts.md), [design system](DESIGN.md), and [F1 implementation and verification report](docs/F1-report.md).

Git was absent at initial inspection. Product Authority subsequently authorized initialization and publication of the unchanged F1 baseline, `ed71b2b0ee6db46cb5e358b079715e5c419170b0`. Focused remediation is one local child commit of that baseline and must not be pushed. See the [focused remediation report](docs/F1-remediation-report.md) for finding traceability and current verification; the original F1 report is historical evidence. F2 has not started.
