# Day 8: Admin Authentication and MFA

Real staff authentication is implemented under `/api/admin/auth`. There is no
public signup, role promotion, password reset, or MFA reset API.

## Development setup

Apply `npx prisma migrate deploy` and `npx prisma generate`. Set a persistent,
independent `ADMIN_MFA_ENCRYPTION_KEY` in the ignored `.env`: 32 random bytes
encoded as 64 hexadecimal characters. Generate it locally with:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Keep this key backed up securely. Do not regenerate it on restart: existing MFA
secrets cannot be decrypted with a different key. Key rotation needs a controlled
decrypt/re-encrypt operation; it is not implemented by changing this variable.
`ADMIN_MFA_ISSUER` defaults to `HouseLink Admin`. Without an encryption key, admin
password login returns 503; buyer authentication remains available.

In PowerShell, explicitly provide development credentials:

```powershell
$env:NODE_ENV = "development"
$env:DEV_ADMIN_EMAIL = "admin@example.test"
$credential = Get-Credential -UserName $env:DEV_ADMIN_EMAIL -Message "Development admin password (12-128 characters)"
$env:DEV_ADMIN_PASSWORD = $credential.GetNetworkCredential().Password
npm run admin:provision
Remove-Item Env:DEV_ADMIN_PASSWORD
Remove-Variable credential
```

Provisioning creates an ACTIVE user, EMAIL identity, Argon2id PasswordCredential
and ADMIN assignment in one transaction. It refuses to promote an existing buyer
or reactivate an inactive account. Repeating it for an ACTIVE ADMIN preserves the
existing password and MFA; an existing ADMIN without a password gets a credential.
It never runs on server startup and refuses test/production mode. It does not
verify mailbox ownership: the internal operator must verify the intended identity.
Production staff provisioning, invitations, and credential resets require a
separate controlled operational process and are not supplied by this development CLI.

## Postman headers and cookies

Base URL: `http://localhost:5000` (or your configured PORT).
Import `postman/admin-auth.postman_collection.json`. Set `adminEmail` and
`adminPassword` locally; never export a collection/environment containing secrets.

For all POST/PATCH/DELETE requests:

```http
Content-Type: application/json
X-CSRF-Protection: 1
Origin: http://localhost:3000
```

Origin must exactly match `FRONTEND_ORIGIN`. Leave Postman's cookie jar enabled.
Use the same hostname throughout. The collection automatically updates
`challengeToken` after login and setup. Set `otp` to your authenticator's current
six-digit code (including leading zeroes).

| Cookie | Path | Purpose |
| --- | --- | --- |
| `admin_access_token` | `/api/admin` | STAFF access JWT |
| `admin_refresh_token` | `/api/admin/auth` | Rotating STAFF refresh token |
| `access_token` | `/api` | Existing CUSTOMER JWT |
| `refresh_token` | `/api/auth` | Existing CUSTOMER refresh token |

Cookies are HttpOnly, host-only, SameSite=Lax by default and Secure in production.
Password-only success never sets admin cookies. Auth responses use `Cache-Control:
no-store`. Raw session tokens are never returned in JSON.

## Endpoints

All bodies are strict: unknown fields are rejected. Success responses use
`{ "success": true, "data": ... }`; refresh/logout return `{ "success": true }`.

| Method and URL | Required authentication | JSON body | Success |
| --- | --- | --- | --- |
| POST `/api/admin/auth/login` | Provisioned ACTIVE ADMIN + valid password | `{"email":"admin@example.test","password":"<password>"}` | 200: `challengeToken`, `expiresAt`, `nextStep` (`MFA_SETUP` or `MFA_VERIFY`) |
| POST `/api/admin/auth/mfa/setup` | Password-verified MFA_SETUP challenge | `{"challengeToken":"<login token>"}` | 200: replacement challenge, `nextStep: MFA_CONFIRM`, `manualKey`, `otpauthUri`, `issuer`, `accountLabel` |
| POST `/api/admin/auth/mfa/confirm` | MFA_ENROLLMENT challenge | `{"challengeToken":"<setup token>","otp":"123456"}` | 200: STAFF cookies, `context`, `mfaVerified`, ten `recoveryCodes` shown once |
| POST `/api/admin/auth/mfa/verify` | Password-verified MFA_LOGIN challenge | `{"challengeToken":"<login token>","otp":"123456"}` | 200: STAFF cookies, `context`, `mfaVerified` |
| POST `/api/admin/auth/mfa/recovery` | Password-verified MFA_LOGIN challenge | `{"challengeToken":"<login token>","recoveryCode":"<32-hex-character code>"}` | 200: STAFF cookies, `context`, `mfaVerified` |
| GET `/api/admin/auth/me` | ACTIVE ADMIN + STAFF + MFA | None | 200: `user: {id,email,roles}`, `context`, `mfaVerified` |
| POST `/api/admin/auth/refresh` | Valid STAFF refresh cookie, current ACTIVE ADMIN, previously verified MFA | `{}` | 200: rotated admin cookies |
| POST `/api/admin/auth/logout` | ACTIVE ADMIN + STAFF + MFA | `{}` | 200: current STAFF session revoked, admin cookies cleared |
| POST `/api/admin/auth/logout-all` | ACTIVE ADMIN + STAFF + MFA | `{}` | 200: all user's STAFF sessions revoked, admin cookies cleared |

## First login

1. Provision the admin using the CLI above, configure the MFA key, and run the API.
2. POST `/api/admin/auth/login` with email/password; expect `nextStep: MFA_SETUP`.
3. POST `/api/admin/auth/mfa/setup` using the login challenge token.
4. Add the returned manual key to an authenticator as time-based, SHA1, six digits,
   30 seconds. The otpauth URI can be encoded as a QR locally; never use an external
   QR-generation website for a secret. Replace the login token with the setup token.
5. POST `/api/admin/auth/mfa/confirm` with the setup token and current authenticator
   code. Save the ten recovery codes in a password manager; they are shown once.
6. GET `/api/admin/auth/me`; expect STAFF and `mfaVerified: true`.
7. Run the collection's category, attribute/value, mapping and brand workflows.
8. POST `/api/admin/auth/refresh` with `{}`; cookies rotate automatically.
9. POST `/api/admin/auth/logout` with `{}`; GET `/api/admin/brands` now returns 401
   with an empty jar (or 403 if a separate customer cookie remains).
10. Test the existing buyer OTP collection; it still creates CUSTOMER sessions.

## Later login and recovery

1. POST `/api/admin/auth/login`; expect `nextStep: MFA_VERIFY`.
2. POST `/api/admin/auth/mfa/verify` with that token and a fresh authenticator code.
3. GET `/api/admin/auth/me`, then use the protected admin business APIs.

The last accepted time step cannot be reused, including immediately after first
enrollment. Wait for a new authenticator code before a second login.
Instead of step 2, `/mfa/recovery` accepts one unused recovery code after password
verification. Recovery never replaces or disables MFA. If the authenticator and
all recovery codes are lost, access cannot be restored through these APIs: contact
the trusted platform operator for identity verification and controlled credential
reset/session revocation. No public bypass or development automatic MFA reset exists.
There is no recovery-code regeneration endpoint in this scope.

## Security and failure behavior

```text
Password -> restricted challenge -> TOTP enrollment/verification or recovery
         -> STAFF session with session-specific mfaVerifiedAt -> admin APIs
```

- ADMIN is a current database role, STAFF is the session context, and MFA
  verification belongs to a specific session. ADMIN + CUSTOMER remains 403.
- Argon2id: 64 MiB memory, three passes, parallelism one, random salt.
- AES-256-GCM encrypts TOTP secrets with user-bound authenticated data. OTPAuth
  validates six-digit SHA1 TOTP with a 30-second period and one-step tolerance.
- Challenges contain 256 random bits and are stored only as SHA-256 hashes. They
  expire after five minutes, permit five attempts, bind to the password change
  timestamp, and use explicit setup/enrollment/login purposes. TOTP and recovery
  are deliberate alternative factors for the same already-enrolled login challenge.
- Setup consumes its input token. Restarting pending enrollment invalidates earlier
  setup/enrollment challenges and replaces only a pending secret, never an active one.
- Each recovery code has 128 random bits. Domain-separated, user-bound SHA-256
  hashes are stored; these are high-entropy random codes, not human passwords.
- User advisory locks and conditional updates serialize challenge/recovery/TOTP
  consumption. Failed attempts commit; challenge consumption and session creation
  commit together. Account and role rows are locked and eligibility is rechecked.
- PostgreSQL rate limits: login 30/IP/15 minutes and 10/email/15 minutes; all MFA
  endpoints share 30/IP/5 minutes; admin auth has an outer 120/IP/minute limit.
- Refresh preserves session identity and MFA timestamp; consumed-token reuse
  revokes the session and all its refresh tokens. Cross-context refresh is rejected.
- Admin logout-all only revokes STAFF sessions. Existing customer logout-all retains
  its pre-Day-8 meaning: it revokes all sessions for that user, including STAFF.
- Logout requires a usable admin access cookie. If it expired, refresh first;
  a blocked user or removed admin role cannot refresh or use protected endpoints.

Errors: 400 invalid body; 401 generic invalid credentials/challenge or unusable
session; 403 insufficient role/context/MFA or CSRF/origin failure; 429 rate limit
with Retry-After; 503 missing MFA key. Responses/logs omit stored credentials.

Production remains blocked by the existing unimplemented real customer OTP delivery
provider. Day 8 does not remove that startup restriction. Provisioning, MFA recovery
operations, key rotation, and expired challenge cleanup need controlled operations.

Library references: [node-argon2](https://github.com/ranisalt/node-argon2),
[OTPAuth](https://github.com/hectorm/otpauth).

## Repeatable verification

`npm test` uses the existing isolated test-database schema and includes the admin
flow plus buyer/category/attribute/brand regressions. `npm run verify:admin` is a
separate HTTP smoke check for an explicitly configured development environment
and loopback database. It runs the real provisioning CLI, enrolls an authenticator,
uses issued cookies for business mutations, checks later TOTP and recovery login,
refresh/logout, and performs buyer OTP login. It removes only its uniquely created
accounts/business records and stops its temporary server. It does not print secrets.
If no MFA key is configured, that disposable smoke account uses a process-only key;
configure a persistent key before provisioning your own admin.

The smoke runner is programmatic HTTP verification, not a Postman desktop run.
The importable collection above provides the corresponding manual workflow.
