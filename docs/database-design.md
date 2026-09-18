database-design.md# Authentication Database Design

## Scope

Authentication for the fashion marketplace:
- Buyer and Seller: phone OTP, email OTP and Google login.
- Staff: privately provisioned accounts with password and MFA.
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
- Access tokens expire after 15 minutes. Set the access cookie `Max-Age` to
  the remaining access-token lifetime.
- Refresh tokens expire after at most 30 days and rotate on every use. Set
  the refresh cookie `Max-Age` to the remaining refresh-token lifetime,
  never beyond the session's absolute expiry.
- Scope the access cookie to `/` and the refresh cookie to `/api/auth`.
  Keep the refresh and logout endpoints under that path.
- On logout, revoke the server-side session and its refresh-token state,
  then clear both cookies with matching names and scope and `Max-Age=0`.

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
- status: enum ACTIVE or BLOCKED, default ACTIVE.
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
- SUPER_ADMIN

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
- EMAIL identifier uses a documented normalization policy.
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
- Passwords are hashed using Argon2id.
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
- Linking requires a userId and an authenticated session.
- Store a keyed digest of the OTP, not a plain short-code hash.
- Keep the digest key outside the database.
- Reject expired, consumed or invalidated challenges.
- Verify and consume a challenge atomically.
- Resending invalidates the previous challenge.
- Enforce attempt, resend and broader abuse limits.
- Expired challenge records are cleaned up.

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
- Logout-all and account blocking revoke all user sessions.

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
