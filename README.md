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

## Buyer profile and addresses

See [Buyer Profile & Address API](docs/users-api.md) for request bodies, validation,
responses and default-address rules. All endpoints require an active authenticated session.

| Method | Endpoint |
| --- | --- |
| GET, PATCH | `/api/users/me` |
| GET, POST | `/api/users/me/addresses` |
| PATCH, DELETE | `/api/users/me/addresses/:addressId` |
| PATCH | `/api/users/me/addresses/:addressId/default` |

Profile updates accept only `name` and optional `profileImage`. Verified identities,
credentials, roles and status stay outside profile updates. Addresses belong to the
authenticated user; a transaction and database unique index enforce at most one default.
Deleting the default leaves no default selected.

Migration: `20260922000000_buyer_profile_addresses`. Apply migrations and generate the
Prisma client using the local setup steps above.

## Categories and subcategories

See [Category API](docs/categories-api.md) for public browsing, trees and breadcrumbs,
and protected admin creation, updates, moves, ordering and activation.

Public: `GET /api/categories`, `/api/categories/tree`, `/api/categories/slug/:slug`,
`/api/categories/:categoryId`. Admin: `GET/POST /api/admin/categories` and
`GET/PATCH /api/admin/categories/:categoryId`.

Visibility requires active ancestors. Hierarchy changes are serialized to prevent cycles;
nesting is limited to 64 levels. Admin access retains the existing STAFF/MFA requirement.
After migrations and client generation, `npm run seed:categories` optionally adds
repeatable development-only samples without overwriting admin edits.

## Authentication and deployment

See [API contracts and security policy](docs/auth-api.md) and
[database design](docs/database-design.md).

Phone and email OTP login, `/me`, refresh rotation, logout and logout-all are implemented.
For simplified local development, set `NODE_ENV=development`, `OTP_PROVIDER=mock` and
`ALLOW_ANY_DEV_OTP=true`; `/api/auth/otp/verify` then accepts any six-digit numeric OTP
for an existing challenge. For local mock retrieval explicitly set
`ENABLE_MOCK_OTP_RETRIEVAL=true`; the endpoint also requires `OTP_PROVIDER=mock` and a
loopback client. Mock delivery is local testing only and does not send SMS or email.
Google and staff login remain planned.

**Production is blocked until a real SMS/email provider is implemented and configured.**
`OTP_PROVIDER=sms` currently fails startup; there is no silent mock fallback.
Production rejects `ALLOW_ANY_DEV_OTP=true`.

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
