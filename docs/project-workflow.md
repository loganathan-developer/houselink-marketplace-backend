# Project Workflow

This document explains how the HouseLink Marketplace backend works from setup to
runtime. It is meant as a short overview for reviews, handoff discussions and
manager updates.

## 1. Project purpose

This repository contains the backend API for the HouseLink marketplace. The
current implemented scope is authentication, user session handling, role seeding,
database connectivity and health/readiness checks.

Marketplace features such as products, orders, seller approval workflows, admin
screens and Google login are planned but not yet implemented. Staff password + MFA
login is implemented; see [Admin Authentication API](admin-auth-api.md).

## 2. Local development workflow

1. Install dependencies with `npm ci`.
2. Copy `.env.example` to `.env`.
3. Configure PostgreSQL in `DATABASE_URL`.
4. Set strong local values for `JWT_SECRET` and `OTP_HASH_SECRET`.
5. Run database migrations with `npx prisma migrate deploy`.
6. Generate the Prisma client with `npx prisma generate`.
7. Seed the default roles with `npm run seed:roles`.
8. Start the development server with `npm run dev`.

The default API URL is:

```text
http://localhost:5000
```

Useful checks:

```text
GET /api/health
GET /api/ready
```

## 3. Runtime request flow

1. `src/server.ts` starts the HTTP server.
2. `src/app.ts` builds the Express application.
3. Middleware handles security headers, CORS, JSON parsing, request logging,
   authentication, validation, not-found responses and error formatting.
4. Route files connect API endpoints to controllers.
5. Controllers validate request intent and call services.
6. Services contain business logic and database transactions.
7. Prisma communicates with PostgreSQL.
8. Responses are returned in a consistent success or error shape.

## 4. Authentication workflow

Customer login uses phone/email OTP. Admin login uses a provisioned password,
then TOTP enrollment/verification or a recovery code, creating a separate STAFF
session only after MFA. The sequence below describes customer login.

1. Client requests an OTP using `/api/auth/otp/request`.
2. Backend validates the phone/email and creates an OTP challenge.
3. In local development, when `NODE_ENV=development`, `OTP_PROVIDER=mock` and
   `ALLOW_ANY_DEV_OTP=true`, any six-digit numeric OTP is accepted for that challenge.
4. Client verifies the OTP using `/api/auth/otp/verify` with `challengeId` and `otp`.
5. Backend consumes the OTP challenge, creates or finds the user, assigns the
   BUYER role for new users and creates an auth session.
6. Access and refresh tokens are sent as HttpOnly cookies.
7. Client calls `/api/auth/me` to get the logged-in user.
8. Client calls `/api/auth/refresh` to rotate refresh tokens.
9. Client calls `/api/auth/logout` or `/api/auth/logout-all` to revoke sessions.

Important security behavior:

- Tokens are stored in cookies, not JavaScript storage.
- Refresh tokens are rotated and stored only as hashes.
- Reusing an old consumed refresh token revokes the session.
- Protected routes check the current user, session and roles in the database.
- Unsafe requests require CSRF protection headers and a trusted origin.

## 5. Database workflow

Prisma manages the PostgreSQL schema. The main authentication tables are:

- `User`: account profile and status.
- `Role`: role definitions such as BUYER, SELLER and ADMIN.
- `UserRole`: roles assigned to users.
- `AuthIdentity`: verified phone, email or future Google identities.
- `OtpChallenge`: temporary OTP verification records.
- `AuthSession`: active login sessions.
- `RefreshToken`: refresh-token rotation history.
- `RateLimitBucket`: shared rate-limit counters.

The backend uses transactions and database locks for sensitive flows such as OTP
verification, refresh rotation, logout and logout-all.

## 6. Testing workflow

Run checks before handing off changes:

```text
npm run typecheck
npm run build
npx prisma validate
npx prisma generate
npm test
```

Tests require a separate local PostgreSQL database whose name ends with `_test`.
The test setup protects against accidentally using the development or production
database.

## 7. Deployment workflow

Deployment should follow this sequence:

1. Install dependencies.
2. Generate Prisma.
3. Build TypeScript.
4. Apply reviewed migrations.
5. Seed roles.
6. Start the compiled server with `npm start`.
7. Use `/api/ready` as the readiness probe.

Production is blocked until a real SMS/email OTP provider is implemented. The
current mock provider and `ALLOW_ANY_DEV_OTP` are only for local development and testing.

## 8. How to explain this to a manager

Short version:

```text
This backend currently implements the secure authentication foundation for the
HouseLink marketplace. It uses Express, TypeScript, Prisma and PostgreSQL. Users
log in with phone or email OTP, sessions are stored securely with HttpOnly
cookies, refresh tokens are rotated, and all protected requests verify the live
database session and user status. The project also includes migrations, role
seeding, health/readiness checks and integration tests. Marketplace modules like
products, orders, seller approval and admin workflows are planned next.
```

If asked what is completed:

```text
Authentication, session management, role seeding, database schema, health checks,
security middleware and auth integration tests are completed.
```

If asked what is pending:

```text
Real SMS/email OTP delivery, Google login, staff/admin login, seller onboarding,
product listings, orders, payments and frontend integration are pending.
```
