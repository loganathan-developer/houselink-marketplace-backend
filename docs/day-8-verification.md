# Day 8 implementation and verification

Implemented on `feature/admin-authentication`, based on committed Day 7
`3be03a2` on `development`. Remote development was fetched and matched the base.
No automatic merge to development or main is part of this work.

## Files created

- `src/modules/admin-auth/admin-auth.routes.ts`
- `src/modules/admin-auth/admin-auth.controller.ts`
- `src/modules/admin-auth/admin-auth.service.ts`
- `src/modules/admin-auth/admin-auth.schema.ts`
- `src/modules/admin-auth/admin-auth.types.ts`
- `src/modules/admin-auth/admin-auth.crypto.ts`
- `src/modules/admin-auth/admin-auth.cookies.ts`
- `src/modules/admin-auth/admin-auth.provision.ts`
- `prisma/provision-admin.ts`
- `prisma/migrations/20260924120000_admin_authentication/migration.sql`
- `tests/admin-auth.scenarios.ts`
- `scripts/verify-admin-auth.ts`
- `postman/admin-auth.postman_collection.json`
- `docs/admin-auth-api.md`
- `docs/day-8-verification.md`

## Files modified

- `.env.example`: admin configuration/provisioning placeholders only.
- `package.json`, `package-lock.json`: Argon2id, OTPAuth, provisioning/smoke commands.
- `prisma/schema.prisma`: three admin models, challenge enum and User relations.
- `src/app.ts`: admin auth router registration.
- `src/config/env.ts`: validated encryption key and issuer configuration.
- `src/config/logger.ts`: additional secret redaction fields.
- `src/middleware/auth.middleware.ts`: separate admin cookies and context checks.
- `src/modules/auth/session.service.ts`: reusable STAFF creation, context-bound
  refresh/revocation, preserving default CUSTOMER creation and buyer logout-all.
- `src/modules/auth/otp/otp-rate-limit.middleware.ts`: reusable shared database
  limiter with optional identity key; existing OTP limit behavior preserved.
- `tests/auth.test.ts`: register admin scenarios and generate a test-only MFA key.
- `tests/categories.scenarios.ts`, `tests/attributes.scenarios.ts`,
  `tests/brands.scenarios.ts`: existing STAFF fixtures use admin cookie names;
  existing assertions retained.
- `README.md`, `docs/auth-api.md`, `docs/brands-api.md`, `docs/categories-api.md`,
  `docs/database-design.md`, `docs/project-workflow.md`: reflect implemented login.

## Database and environment

Added `AdminMfaCredential` (one per user), `AdminLoginChallenge` and
`AdminRecoveryCode` (many per user), with restrictive foreign keys, indexes and
check constraints. MFA verification remains session-specific on AuthSession.

Added configuration: `ADMIN_MFA_ENCRYPTION_KEY` (persistent 32-byte random hex key),
`ADMIN_MFA_ISSUER` (default HouseLink Admin), and CLI inputs `DEV_ADMIN_EMAIL`,
`DEV_ADMIN_PASSWORD`. No real credentials or encryption keys are committed.

Provision command: `npm run admin:provision`, using explicit development inputs.
See [Admin Authentication API](admin-auth-api.md#development-setup) for the exact
PowerShell sequence and repeat-run rules.

## Implemented endpoints

| Method | URL |
| --- | --- |
| POST | `/api/admin/auth/login` |
| POST | `/api/admin/auth/mfa/setup` |
| POST | `/api/admin/auth/mfa/confirm` |
| POST | `/api/admin/auth/mfa/verify` |
| POST | `/api/admin/auth/mfa/recovery` |
| GET | `/api/admin/auth/me` |
| POST | `/api/admin/auth/refresh` |
| POST | `/api/admin/auth/logout` |
| POST | `/api/admin/auth/logout-all` |

Request/response bodies and headers are documented in
[the endpoint table](admin-auth-api.md#endpoints).

## Controls and coverage

Argon2id passwords; generic credential failures; shared PostgreSQL rate limits;
strict Zod bodies; existing CSRF, exact CORS and Helmet; separate HttpOnly admin
cookies; AES-GCM encrypted TOTP secrets; purpose-bound hashed challenges; atomic
attempt/consumption/replay checks; user-bound hashed recovery codes; current ACTIVE
and ADMIN checks; STAFF-only refresh; session-specific MFA; refresh reuse revocation;
STAFF-only admin logout-all; redacted logs and no-store responses.

Added 23 integration scenarios for provisioning/repeatability/buyer refusal,
password failures, strict validation and CSRF, rate limits, encrypted enrollment,
expiration/exhaustion/purpose/reuse, TOTP and concurrent replay, recovery and
concurrent consumption, live roles/status, cookies/profile, refresh/context/reuse,
logout/logout-all isolation, real-cookie business workflows, enrollment restart,
role removal during enrollment and missing-key behavior.

## Verification results

| Check | Result |
| --- | --- |
| `npx prisma validate` | Passed |
| `npx prisma generate` | Passed |
| `npm run typecheck` | Passed |
| `npm run build` | Passed |
| `npm test` | 87 passed, 0 failed; includes all 64 pre-Day-8 tests |
| `npx prisma migrate deploy` | Day 8 applied to existing development DB without reset |
| `npm run verify:admin` | Real provisioning CLI + 38 HTTP checks passed |
| Postman collection structure | 34 requests; JSON and scripts validate; sensitive variables blank |
| `git diff --check` | Passed |

The smoke check used real password/MFA-issued cookies for GET/POST/PATCH categories,
attributes, values and mappings, plus brand create/update/approve/reject, session
refresh/logout, later TOTP, recovery, and buyer OTP regression. It cleaned only its
own temporary accounts/business records and stopped its temporary server.

The Windows sandbox blocked test/Prisma subprocess spawning; those commands ran
successfully with escalation. An earlier test run had transient PostgreSQL connection
timeouts; a subsequent full run passed, as did the final expanded 87-test suite.

## First and later Postman login

First login: provision -> login -> setup -> add secret to authenticator -> confirm
using the replacement challenge token -> save recovery codes -> me -> business APIs
-> refresh -> logout -> verify access denied.

Later login: login -> verify a fresh TOTP using that login challenge -> me -> business
APIs. Recovery is an alternative second factor after password login, using an unused
recovery code. [Exact steps and JSON bodies](admin-auth-api.md#first-login) and
[the collection](../postman/admin-auth.postman_collection.json) are provided.

## Remaining limitations

- Postman desktop was not available for GUI execution. The corresponding real HTTP
  flows were executed by the smoke runner; the manual collection is supplied.
- A read-only schema comparison detected existing drift in the unchanged Day 7
  Brand table: id/string/timestamp types and indexes differ from schema.prisma.
  It reported no Day 8 table differences. No destructive drift correction was run.
  Actual brand operations passed with real Day 8 cookies. Review that legacy drift
  separately before a production deployment.
- npm audit reports four high-severity entries in the existing Prisma dependency
  tree (`prisma`, `@prisma/config`, `deepmerge-ts`, `mysql2`); no forced downgrade or
  unrelated dependency migration was applied.
- A pg adapter deprecation warning appears during tests; it does not fail checks.
- The existing real customer SMS/email delivery provider is still unimplemented,
  so the existing production startup restriction remains.
- Development provisioning is not production onboarding. Public staff signup,
  password/MFA resets, recovery-code regeneration, key rotation tooling and automatic
  expired-challenge cleanup are not implemented. Lost authenticator plus lost recovery
  codes require a trusted operator, not a public bypass.
- Your own admin still needs a persistent MFA key and explicit CLI provisioning.
  The smoke account was intentionally removed; no shared admin password was installed.
