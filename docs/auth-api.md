# Authentication API

## Running and testing

Run `npx prisma migrate deploy`, `npx prisma generate`, `npm run seed:roles`, then `npm run dev`.
The default API address is `http://localhost:5000`.

For the simplified development flow, set `NODE_ENV=development`, `OTP_PROVIDER=mock`
and `ALLOW_ANY_DEV_OTP=true`. The frontend calls `/api/auth/otp/request`, stores the
returned `challengeId`, then calls `/api/auth/otp/verify` with that `challengeId` and
any six-digit numeric OTP. The mock retrieval endpoint is optional debug tooling only
and remains disabled unless `ENABLE_MOCK_OTP_RETRIEVAL=true`.

Run `npm run test:setup` once to provision the separate local
`houselink_auth_step15_test` database and its non-superuser test role. Provisioning
uses only a loopback development PostgreSQL server's maintenance database; it requires
permission to create the test role/database. It never connects to the application database.

Configure `.env.test` (git-ignored) or the shell with:

```dotenv
TEST_DATABASE_URL=postgresql://TEST_USER:TEST_PASSWORD@localhost:5432/houselink_auth_step15_test
```

Replace TEST_USER/TEST_PASSWORD with local test credentials. Never reuse deployment credentials.
Run `npm test` for the real Express/Prisma/PostgreSQL integration suite.
There is no DATABASE_URL fallback: missing URLs, non-loopback hosts, names not ending
in `_test`, connection overrides, and application-database reuse are rejected.
Each run additionally creates a unique schema, applies all checked-in migrations,
and verifies removal of its schema afterward. Tests use independent test-only secrets.
Concurrency tests hold a database lock until both HTTP requests are confirmed waiting,
then release it to test single-use OTP verification and refresh rotation.

For Postman, enable the cookie jar and add this header to every POST/PUT/PATCH/DELETE:

```http
X-CSRF-Protection: 1
Origin: http://localhost:3000
Content-Type: application/json
```

Browser requests must use `credentials: "include"`, the same custom header, and the
exact configured `FRONTEND_ORIGIN`. Do not persist tokens in JavaScript storage.
Coordinate refresh calls with a single shared refresh promise; cross-tab callers also
need coordination. Two uses of the same refresh token cause session revocation,
even when the second request was an accidental concurrent refresh.

## Endpoints

All auth responses include `Cache-Control: no-store`. Errors use the existing
`{ success: false, error: { code, message }, requestId }` envelope.

| Method | Route | Auth / role | Input | Success | Important failures | Availability |
| --- | --- | --- | --- | --- | --- | --- |
| GET | /api/health | None | None | 200 liveness | 403 origin | All environments |
| GET | /api/ready | None | None | 200 DB and BUYER ready | 503 unavailable, 403 origin | All environments |
| POST | /api/auth/otp/request | None | Phone or email request below | 200 challengeId | 400, 403, 429, 503 delivery | Customer API; real delivery blocked |
| POST | /api/auth/otp/verify | None | challengeId UUID, otp string; optional matching phone/email | 200 safe user + cookies | 400, 401 invalid OTP, 403, 429 | Customer API |
| POST | /api/auth/refresh | Refresh cookie | No body required | 200 success + replacement cookies | 401, 403, 429 | Customer API |
| GET | /api/auth/me | Valid access cookie; any role | None | 200 safe user | 401, 403 origin, 429 | Customer API |
| POST | /api/auth/logout | Optional access/refresh cookie | No body required | 200 success + cleared cookies | 403, 429 | Customer API; idempotent |
| POST | /api/auth/logout-all | Valid access cookie; any role | No body required | 200 success + cleared cookies | 401, 403, 429 | Customer API |
| GET | /api/auth/otp/mock/:challengeId | Loopback client, no role | UUID path parameter | 200 destination, otp, expiresAt | 400, 403, 404, 429 | Mounted only in development/test with mock provider + explicit opt-in |

Buyer profile and address APIs are mounted under `/api/users`; see [users API](users-api.md).
Category browsing and protected admin management are mounted; see [categories API](categories-api.md).
Google login, staff login, identity linking and product/order APIs are not mounted. All auth routes share IP
limits. Mutations require the CSRF header plus trusted Origin/Referer. Every route may
return a generic 500 for unexpected failures; malformed JSON is 400 and bodies over
16 KiB are 413. Query parameters are unused and never supply credentials or roles.

### Request contracts

Phone request (existing phone field preserved):

```json
{ "phone": "+919876543210", "channel": "PHONE", "purpose": "LOGIN" }
```

Email request:

```json
{ "email": "buyer@example.com", "channel": "EMAIL", "purpose": "LOGIN" }
```

Channel defaults from the supplied field; purpose defaults to LOGIN. Supply exactly
one of phone/email. Extra fields, client roles, mismatched channels and LINK_IDENTITY
are rejected with 400. Email is trimmed and lowercased; dots and plus tags are preserved.
Phone/email identities are never automatically merged or linked to another account.

Verification uses the challenge UUID returned by request:

```json
{ "challengeId": "returned-uuid", "otp": "012345" }
```

Supplying the matching phone or email is still accepted for compatibility. When supplied,
the challenge must also match channel, destination and LOGIN purpose. Without phone/email,
the backend loads the destination from the challenge itself. **Breaking security change:**
challengeId is now required. Verification no longer guesses the latest challenge for a
phone number. **CSRF contract change:** origin-less Postman/CLI requests must now supply
the configured Origin or a Referer from that exact origin, as well as
X-CSRF-Protection: 1.

Phone normalization trims whitespace and removes spaces, parentheses and hyphens.
OTP must be a six-character numeric string; leading zeros are preserved.
New users receive only BUYER. Requesting an OTP never creates a user.
Verification consumes the OTP and creates user/identity/roles/session/refresh hash in
one transaction. Incorrect attempt increments commit even though verification fails.

Login response:

```json
{
  "success": true,
  "message": "OTP verified successfully",
  "data": { "user": { "id": "uuid", "phone": "+919876543210", "roles": ["BUYER"] } }
}
```

Email login returns `email` instead of `phone` in the safe user object.
The /me response contains only `data.user.id`, `data.user.name`, `data.user.status` (ACTIVE), and `data.user.roles`.
Invalid credentials, blocked/deleted users, and expired/revoked sessions return 401.
Authenticated role failures return 403. CSRF/origin failures return 403.
Rate limits return 429; IP limits include Retry-After. OTP request success returns only data.challengeId. Logout without credentials is idempotent.

Mock retrieval requires development/test, OTP_PROVIDER=mock,
ENABLE_MOCK_OTP_RETRIEVAL=true, and a loopback client address. Request an OTP first,
retrieve it using the returned challenge ID, then verify before its expiry.
Mock codes remain in process memory; use one local backend process for this workflow.

## Sessions and cookies

Access JWTs default to 15 minutes (configuration capped at one hour).
Only HS256 is allowed. Signature, expiry, issuer, audience, UUID subject and session
ID are checked. JWTs contain sub, sid, iss, aud, iat, exp and a unique jti, with no roles
or secrets. The jti keeps tokens distinct even when refreshed within the same second.

Refresh tokens contain 32 cryptographically random bytes. PostgreSQL stores only
SHA-256 hashes. Each token is consumed once and linked to its replacement.
Consumed records are retained for reuse detection. Reuse revokes the entire session;
that revocation commits before returning 401. PostgreSQL user advisory locks serialize
rotation, session creation and logout operations across API instances.

Sessions default to a 30-day absolute lifetime and a 7-day idle lifetime.
Successful refresh advances idle expiry without changing absolute expiry.
Refresh expiry defaults to 7 days and is capped by session idle and absolute expiry.
Access expiry is also capped by the session lifetime.
Idle activity is measured by refresh, not by every protected API request.

Cookies are named access_token and refresh_token, are HttpOnly and host-only:
access uses Path=/api; refresh uses Path=/api/auth so both refresh and logout receive it.
Expiry matches the token lifetime. Clearing uses identical cookie options.
Secure is mandatory in production. COOKIE_SAME_SITE defaults to lax for same-site
deployments. Cross-site HTTPS deployments require none and Secure; browser third-party
cookie policies still apply and must be verified in the target deployment.

## Security and deployment

CORS permits only the exact FRONTEND_ORIGIN with credentials; no wildcard origins.
Unsafe requests require X-CSRF-Protection: 1 and the exact trusted Origin. When Origin
is absent, a Referer URL with that exact origin is required. Missing, null and hostile
origins fail closed. A valid Referer never overrides a bad Origin. The header forces
browser preflight and excludes HTML forms; origin checking and SameSite provide
additional protection. This does not protect against script execution on the trusted frontend.
See [OWASP custom-header guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html#employing-custom-request-headers-for-ajaxapi).

Helmet is enabled; JSON bodies are limited to 16 KiB.
Rate limits are shared in PostgreSQL: all auth routes allow 120 requests/IP subnet/minute;
OTP generation also has its configured IP and destination limits, and verification
has the persisted challenge attempt limit. IPv6 addresses are grouped by /56.
Unavailable rate-limit storage fails closed.
Delete expired RateLimitBucket rows periodically using the expiresAt index; retain
consumed refresh tokens at least through session expiry for reuse auditing.

TRUST_PROXY defaults to empty (no proxy trust). Behind a reverse proxy, specify only
actual proxy IPs/CIDRs, comma-separated. Boolean/universal trust is rejected. Proxies
must replace client-supplied forwarding headers; proxy clients otherwise share one IP
limit. See [Express proxy guidance](https://expressjs.com/en/guide/behind-proxies/).

Authentication loads current session/user status and roles from PostgreSQL on every
protected request. requireRole and requireAnyRole deny by default. ADMIN additionally
requires a STAFF session with mfaVerifiedAt; a customer OTP session cannot authorize
ADMIN even if that account already has the role. No staff login endpoint is implemented. Resource ownership
must be enforced in resource service queries using both resource ID and owner ID.
Buyer address handlers enforce resource ownership; category management uses the existing admin authorization policy.

Cookie configuration: COOKIE_SAME_SITE and optional COOKIE_SECURE.
Production also requires an HTTPS frontend and independent non-placeholder secrets.
Existing JWT/session lifetime and origin variables are reused.
DATABASE_URL optionally supports ?schema=... for isolated PostgreSQL schemas.
Use independent, randomly generated JWT_SECRET and OTP_HASH_SECRET values.
Production must set OTP_PROVIDER=sms and disable mock retrieval, but the existing SMS
provider is still unimplemented and currently prevents production startup.
UserStatus.DELETED supports soft deletion; no deletion endpoint is introduced.

The additive auth_security migration adds DELETED and RateLimitBucket with an expiry
index. It does not delete or reset existing data.

Security logs record request IDs and event names without request bodies, cookies,
tokens or token hashes. Unexpected errors log their error type, not potentially
sensitive Prisma error messages.

## Remaining release checks

- Implement and configure real SMS/email delivery. The provider interface receives channel, destination, string OTP, challengeId and expiry; the selected real provider must route PHONE/EMAIL, enforce a delivery timeout and safely handle retries. Only local mock delivery currently works.
- Validate HTTPS cookies/CORS against the actual frontend and browser deployment.
- Re-run dependency auditing at release time. The 2026-09-21 npm audit reported zero known vulnerabilities; no dependency versions were changed by this audit.

## Runtime and verified local flow

Startup connects Prisma and checks the seeded BUYER role before listening. Readiness
returns 503 on database/seed failure; liveness remains independent. HTTP request/body
receipt timeout is 30 seconds, headers 10 seconds, idle sockets 30 seconds and keep-alive
5 seconds. PostgreSQL pool acquisition is bounded to 5 seconds and statements to
10 seconds. SIGINT/SIGTERM stop accepting connections, drain requests and disconnect
Prisma; a 10-second deadline forces termination. Fatal exceptions/rejections exit with
failure after cleanup. A process supervisor should restart the service.

Postman/manual development flow (cookie jar enabled, base http://localhost:5000):
health -> OTP request -> verify with challengeId and any six-digit numeric OTP when
`ALLOW_ANY_DEV_OTP=true` -> me -> refresh -> me -> logout -> refresh returns 401.
Logout-all invalidates every existing device session;
protected APIs check session state, so old access JWTs stop working immediately as well.
Phone and email follow the same flow. Login, refresh and logout concurrency is serialized
in PostgreSQL. A refresh may complete just before concurrent logout, but its newly issued
tokens are revoked by logout and cannot resurrect the session. In-flight requests that
already passed authentication may complete; future resource mutations must enforce
ownership/status transactionally where required.

Google, private admin password/MFA login and identity linking are planned, not implemented.
Role definitions alone grant nobody privileges. Keep blocked/deleted identity records
as tombstones so OTP login cannot silently recreate a disabled account.
