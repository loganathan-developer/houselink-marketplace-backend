# Authentication Database Design

## Scope

Authentication design for the marketplace (planned features are labeled below):
- Buyer and Seller: phone/email OTP implemented; Google login planned.
- Staff: private password + MFA login planned; ADMIN authorization already requires a STAFF session with MFA.
- JWT access tokens with rotating refresh tokens.
- PostgreSQL stores identities, roles and login sessions.

## Web authentication cookie policy

- Send the short-lived access JWT and the opaque refresh token in separate
  HTTP-only cookies. Do not expose either token to browser JavaScript.
- Use `Secure=true` in production. Use `Secure=false` only for local HTTP
  development when needed.
- Use `SameSite=Lax` for the planned same-site web frontend. If a future
  deployment requires cross-site cookies, use `SameSite=None` only with
  `Secure=true` and CSRF protection. Keep cookies host-only by omitting Domain.
- Access tokens default to 15 minutes (configuration capped at one hour). Cookie
  `Expires` matches JWT expiry, capped by the session lifetime.
- Refresh tokens default to seven days and rotate on every use. Cookie `Expires`
  matches token expiry, capped by idle and absolute session expiry. Sessions
  default to seven idle days and thirty absolute days.
- Scope the access cookie to `/api` and the refresh cookie to `/api/auth`.
  Keep the refresh and logout endpoints under that path.
- On logout, revoke the server-side session and its refresh-token state,
  then clear both cookies with matching names and scope and an expired `Expires` date.

## Common conventions

- Primary IDs use UUID.
- Dates use PostgreSQL timestamp with time zone.
- Required fields are NOT NULL.
- Fields marked optional allow NULL.
- Foreign keys enforce relationships.
- Raw passwords, OTPs and refresh tokens are never stored.

## 1. User

Purpose: Store the account.

Fields:
- id: UUID, primary key.
- name: text, optional.
- status: enum ACTIVE, BLOCKED or DELETED, default ACTIVE.
- createdAt: timestamp, default current time.
- updatedAt: timestamp, maintained on updates.

Verified login phone/email values belong to AuthIdentity.

## 2. Role

Purpose: Define available roles.

Fields:
- id: UUID, primary key.
- code: unique text.

Initial values:
- BUYER
- SELLER
- ADMIN

## 3. UserRole

Purpose: Assign roles to users.

Fields:
- userId: UUID, foreign key to User.
- roleId: UUID, foreign key to Role.
- assignedAt: timestamp, default current time.

Constraints:
- Composite primary key: userId + roleId.
- Index roleId.

Public requests cannot assign administrative roles.

## 4. AuthIdentity

Purpose: Store verified login identities.

Fields:
- id: UUID, primary key.
- userId: UUID, foreign key to User.
- provider: enum PHONE, EMAIL or GOOGLE.
- identifier: text.
- verifiedAt: timestamp.
- createdAt: timestamp, default current time.

Constraints:
- Unique combination: provider + identifier.
- Index userId.

Rules:
- PHONE identifier uses normalized international format.
- EMAIL identifier is trimmed and lowercased; dots and plus tags are preserved.
- GOOGLE identifier stores Google's stable subject ID.
- Create the identity only after successful verification.
- Never merge accounts automatically because emails match.
- Linking a new identity requires authentication to the
  existing account and verification of the new identity.

## 5. PasswordCredential

Purpose: Store staff password credentials.

Fields:
- userId: UUID, primary key and foreign key to User.
- passwordHash: text.
- passwordChangedAt: timestamp.

Rules:
- Planned staff password implementation must hash passwords using Argon2id.
- OTP-only accounts do not need this record.
- A password alone does not grant staff access.
- Staff sessions require successful MFA.

## 6. OtpChallenge

Purpose: Track a temporary verification challenge.

Fields:
- id: UUID, primary key.
- destination: text.
- channel: enum PHONE or EMAIL.
- purpose: enum LOGIN or LINK_IDENTITY.
- userId: UUID, optional foreign key to User.
- codeDigest: text.
- createdAt: timestamp, default current time.
- expiresAt: timestamp.
- attemptCount: integer, default 0.
- consumedAt: timestamp, optional.
- invalidatedAt: timestamp, optional.

Indexes:
- destination + channel + purpose + createdAt.
- expiresAt.

Rules:
- A new customer's challenge does not require a userId.
- LINK_IDENTITY remains planned and is rejected by public OTP schemas. Future linking requires a userId and an authenticated session.
- Store a keyed digest of the OTP, not a plain short-code hash.
- Keep the digest key outside the database.
- Reject expired, consumed or invalidated challenges.
- Verify and consume a challenge atomically.
- Resending invalidates the previous challenge.
- Enforce attempt, resend and broader abuse limits.
- Resend availability is computed from createdAt plus the configured cooldown.
- Cleanup is an operational task; no scheduled deletion job is implemented.

## 7. AuthSession

Purpose: Track each authenticated login session.

Fields:
- id: UUID, primary key.
- userId: UUID, foreign key to User.
- context: enum CUSTOMER or STAFF.
- mfaVerifiedAt: timestamp, optional.
- createdAt: timestamp, default current time.
- lastSeenAt: timestamp.
- idleExpiresAt: timestamp.
- absoluteExpiresAt: timestamp.
- revokedAt: timestamp, optional.

Indexes:
- userId + revokedAt.
- absoluteExpiresAt.
- idleExpiresAt.

Rules:
- Access JWTs reference the session ID.
- Protected APIs check user and session status.
- STAFF sessions require MFA before privileged access.
- Refreshing cannot extend the absolute session lifetime.
- Logout revokes the current session.
- Logout-all revokes all user sessions. Authentication and refresh reject BLOCKED/DELETED users on every request; future status-changing services should also revoke sessions in the same transaction.

## 8. RefreshToken

Purpose: Track refresh-token rotation.

Fields:
- id: UUID, primary key.
- sessionId: UUID, foreign key to AuthSession.
- tokenHash: unique text.
- createdAt: timestamp, default current time.
- expiresAt: timestamp.
- consumedAt: timestamp, optional.
- revokedAt: timestamp, optional.
- replacedById: UUID, optional unique foreign key
  to another RefreshToken.

Indexes:
- sessionId.
- expiresAt.

Rules:
- Generate cryptographically random refresh tokens.
- Store only their hashes.
- Consume the previous token and create its replacement
  in one transaction.
- Replacement tokens must belong to the same session.
- Reject tokens from expired or revoked sessions.
- Detect reuse of a consumed token and revoke its session.
- Retain rotation history while needed for reuse detection.

## Relationships

- User has many AuthIdentity records.
- User has many roles through UserRole.
- User has zero or one PasswordCredential.
- User has many AuthSession records.
- AuthSession has many RefreshToken records.

## Deletion policy

- Blocking and logout do not delete accounts.
- Account deletion is a separate controlled workflow.
- Initially restrict User deletion while related records exist.
- Do not cascade account deletion into future order or
  financial records.
- Expired session cleanup explicitly removes token history
  before deleting the associated session.

## Additional work before staff authentication launches

Design and implement:
- Permission and RolePermission.
- MFA credentials and single-use recovery codes.
- Staff invitations and password-reset records.
- Security audit records.

## Seller approval

SellerProfile will store business onboarding and approval.
Seller approval is separate from User.status and UserRole.
A Seller role alone does not authorize approved-seller actions.

## Implementation boundary

Database constraints protect relationships and uniqueness.
Backend services enforce verification, permissions, ownership,
rate limits and allowed state transitions.

## Implemented abuse protection and transaction rules

RateLimitBucket stores a hashed scope/IP key, hit count and expiry with an expiry index.
Atomic PostgreSQL upserts share IP limits across API instances. IPv6 uses /56 grouping.
OTP request/verify share a destination/channel/LOGIN advisory lock. Verification requires
the exact challenge UUID plus matching destination/channel/purpose. The HMAC includes
all four plus the OTP; phone digest format is preserved. No raw OTP or refresh token
is stored in PostgreSQL. Plain mock codes exist only in bounded local development memory.

Wrong attempts commit before the API returns 401. User creation, BUYER assignment,
challenge consumption, session creation and refresh hashing commit together.
User advisory locks serialize login session creation, refresh, logout and logout-all.
Refresh replacement stays in the same session; consumed token reuse revokes that session
and all its tokens before returning 401. Status and roles are read from the database
on every protected request; existing access JWTs therefore stop working after revocation.

The existing 20260918120000_auth_security migration adds DELETED and RateLimitBucket.
This audit adds no migration, index, constraint or schema change. Existing UUID keys,
identity uniqueness, foreign keys with Restrict and authentication query indexes suffice.
Future administrative status/role changes must use the same user lock where atomicity
with authentication is required. Ownership filters belong in future resource services.

## Retention operations

Schedule bounded batches deleting expired RateLimitBucket records using the expiry index.
Remove expired OTP challenges according to the audit/privacy retention policy. Retain
consumed refresh records through session expiry for replay detection; subsequently delete
self-referencing refresh history in a controlled order before deleting expired sessions.
There is no background retention worker in this repository. Never reset the application
database to clean up authentication records. Readiness checks database/BUYER availability;
migration status remains a separate deployment gate.
