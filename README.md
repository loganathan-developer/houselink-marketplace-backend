# houselink-marketplace-backend
Backend API and database services for the HouseLink online marketplace.

## Requirements and local setup

- Node.js 24 LTS (verified with 24.21.0), npm, and a running PostgreSQL server.
- Express 5, strict TypeScript, Prisma 7.10 with the PostgreSQL driver adapter.

From this backend directory:

1. Run `npm ci`.
2. Copy `.env.example` to `.env`. Set your local database credentials and generate
   independent random `JWT_SECRET` and `OTP_HASH_SECRET` values of at least 32 characters.
   Never commit `.env` or `.env.test`. Example files contain placeholders only.
3. Create `houselink_dev` and an application PostgreSQL role with permission to use it.
   Set `DATABASE_URL` to that database. Optional `?schema=...` is supported.
4. Run `npx prisma migrate deploy`, then `npx prisma generate`.
5. Run `npm run seed:roles` to idempotently create BUYER, SELLER and ADMIN role definitions.
   This does not create users or assign privileged roles.
6. Run `npm run dev`; default base URL is `http://localhost:5000`.

`GET /api/health` is liveness. `GET /api/ready` checks PostgreSQL and the BUYER seed.
Startup checks the database/seed before listening; SIGINT/SIGTERM drain requests and
disconnect Prisma, with a ten-second shutdown deadline.

## Validation and tests

```sh
npm run typecheck
npm run build
npx prisma validate
npx prisma generate
npx prisma migrate status
npm test
```

Tests require a **separate loopback PostgreSQL database with a name ending in `_test`**.
Set `TEST_DATABASE_URL` in the ignored `.env.test` or shell; application database reuse
is rejected. Each test run creates and removes only its own unique schema. The existing
`npm run test:setup` helper can provision a local test role/database using the development
server's maintenance database. Its credentials are exclusively for local testing.
Do not run this helper against a deployment database. Lint is not configured.

## Authentication and deployment

See [API contracts and security policy](docs/auth-api.md) and
[database design](docs/database-design.md).

Phone and email OTP login, `/me`, refresh rotation, logout and logout-all are implemented.
For local mock retrieval explicitly set `ENABLE_MOCK_OTP_RETRIEVAL=true`; the endpoint
also requires `OTP_PROVIDER=mock` and a loopback client. Mock delivery is local testing
only and does not send SMS or email. Google and staff login remain planned.

**Production is blocked until a real SMS/email provider is implemented and configured.**
`OTP_PROVIDER=sms` currently fails startup; there is no silent mock fallback.

After provider integration, deploy with `NODE_ENV=production`, strong independent secrets,
an HTTPS `FRONTEND_ORIGIN`, Secure cookies and mock retrieval disabled. Set `TRUST_PROXY`
only to actual proxy IPs/CIDRs and ensure proxies replace untrusted forwarded headers.
Use `SameSite=Lax` for the planned same-site web deployment; cross-site HTTPS requires
`SameSite=None`, Secure and testing against browser third-party-cookie restrictions.

Deployment sequence: install dependencies, generate Prisma, build, apply reviewed
migrations, seed roles, then `npm start` (runs compiled `dist/server.js`). Use a separate
migration identity where appropriate and restart under a process supervisor after fatal
errors. Configure readiness probes on `/api/ready`, keep migrations as a release gate,
and schedule expired-auth-data cleanup as described in the database document.
