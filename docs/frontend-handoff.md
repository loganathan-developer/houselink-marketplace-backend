# Frontend Handoff: Architecture, Flow and APIs

## Current scope

Implemented: OTP authentication, cookie sessions, buyer profiles, addresses and categories.
See [Category API](categories-api.md) for public lists/tree/details and protected admin management.
Products, cart, orders, payments, Google login and staff login are not implemented.
Local API: `http://localhost:5000`. Frontend origin: `http://localhost:3000`
(must match backend `FRONTEND_ORIGIN`). Real SMS/email delivery is not implemented;
the SMS provider currently prevents production startup.

## Architecture

```text
Frontend (browser)
  -> Express API: request logging, Helmet, CORS, CSRF, JSON parsing, cookies
  -> /api/auth routes OR /api/users routes
  -> authentication middleware on protected routes
     (access JWT + database session + active user)
  -> Zod request validation
  -> route/controller -> service where needed -> Prisma -> PostgreSQL
  -> JSON response + HttpOnly cookies for login/refresh/logout
```

`src/app.ts` mounts routes and middleware. `src/modules/auth` owns identities,
OTP, JWTs and sessions. `src/modules/users` owns profile and address operations.
`prisma/schema.prisma` and `prisma/migrations` define persistence.

```text
User -> AuthIdentity[]          verified phone/email
User -> UserRole[] -> Role      authorization
User -> AuthSession[] -> RefreshToken[]
User -> UserAddress[]           delivery information
User.name / User.profileImage   editable profile
```

## Frontend request rules

Use `credentials: "include"` on every API request. Tokens are HttpOnly cookies;
do not read or store them in localStorage. Browser requests set Origin automatically.
Send `X-CSRF-Protection: 1` on POST/PATCH/DELETE, including OTP requests.
Postman must also explicitly send `Origin: http://localhost:3000`.

```ts
const API = "http://localhost:5000";

export async function api(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${API}${path}`, {
    method,
    credentials: "include",
    headers: {
      ...(method !== "GET" ? { "X-CSRF-Protection": "1" } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const result = response.status === 204 ? null : await response.json();
  if (!response.ok) throw Object.assign(new Error(result?.error?.message ?? "Request failed"), {
    status: response.status, code: result?.error?.code, response: result,
  });
  return result;
}
```

This basic helper does not refresh automatically. Implement refresh coordination
in the application session layer as described below.

## Screen and session flow

1. Login screen: submit phone to OTP request; keep `data.challengeId` in application
   state. Never display it or ask the user to type it.
2. OTP screen: collect a six-digit string and send it with the stored challenge ID.
   Successful verification sets cookies. New users receive BUYER automatically.
3. Load `/api/auth/me` for session roles/status, `/api/users/me` for the profile,
   and `/api/users/me/addresses` for saved delivery addresses.
4. Profile screen: PATCH name/image. Address screen: create, edit, delete or set default.
5. On app reload, check the session. On a protected API 401, attempt refresh once,
   then retry that request once. If refresh fails, clear frontend session state and
   show login. Do not refresh for invalid OTP responses or recursively for refresh itself.
6. Coordinate refresh through one shared promise and across tabs. Concurrent reuse
   of the same refresh token revokes the session.
7. Logout clears the current session; logout-all clears all device sessions.

Development accepts any six-digit numeric OTP only when all are set:
`NODE_ENV=development`, `OTP_PROVIDER=mock`, `ALLOW_ANY_DEV_OTP=true`.
Challenge expiry, consumption and other validity checks still apply. Use a fresh
challenge after successful verification. No mock-retrieval call is needed.

## Authentication APIs

| Method | Endpoint | Request body | Success |
| --- | --- | --- | --- |
| POST | `/api/auth/otp/request` | `{ "phone": "+918765445278" }` | 200, `data.challengeId` |
| POST | `/api/auth/otp/verify` | `{ "challengeId": "returned-uuid", "otp": "123456" }` | 200, `data.user`, cookies |
| POST | `/api/auth/refresh` | None | 200, `{ "success": true }`, rotated cookies |
| GET | `/api/auth/me` | None | 200, `data.user`: id, name, status, roles |
| POST | `/api/auth/logout` | None | 200, success; clears cookies |
| POST | `/api/auth/logout-all` | None | 200, success; requires active access session |

OTP request also accepts `{ "email": "buyer@example.com" }` instead of phone.
Do not send both. Phone and email identities are not automatically linked.
The request response contains only `success` and `data.challengeId`, not resend timing.

## Profile and address APIs

| Method | Endpoint | Body | Success |
| --- | --- | --- | --- |
| GET | `/api/users/me` | None | 200, `data.user`: id, name, profileImage, createdAt, updatedAt |
| PATCH | `/api/users/me` | Nonempty subset of name/profileImage | 200, updated `data.user` |
| GET | `/api/users/me/addresses` | None | 200, `data.addresses` |
| POST | `/api/users/me/addresses` | Address fields below | 201, `data.address` |
| PATCH | `/api/users/me/addresses/:addressId` | Nonempty subset of address fields | 200, `data.address` |
| DELETE | `/api/users/me/addresses/:addressId` | None | 204, empty response |
| PATCH | `/api/users/me/addresses/:addressId/default` | `{}` or none | 200, `data.address` |

Profile example:

```json
{ "name": "Buyer Name", "profileImage": "https://example.com/avatar.png" }
```

Name: trimmed, 1-100 characters. Image: optional HTTPS URL, max 2048 characters,
or `null` to clear. No image upload endpoint exists. Never send roles, status,
phone/email, identity records, credentials or userId in profile/address updates.

Address creation example:

```json
{
  "recipientName": "Buyer Name",
  "contactPhone": "+918765445278",
  "addressLine1": "12 Main Street",
  "addressLine2": "Apartment 4",
  "city": "Chennai",
  "state": "Tamil Nadu",
  "postalCode": "600001",
  "country": "IN",
  "isDefault": true
}
```

AddressLine2 is optional/nullable; isDefault defaults to false. Other fields are
required on creation. Names/city/state: 1-100 characters; address lines: 1-200;
postal code: 1-20 letters/numbers/spaces/hyphens. Phone: international format with
8-15 digits. Country: two letters, normalized uppercase. IDs must be UUIDs.
An address response also includes id, userId and timestamps. Delivery contactPhone
does not change the verified login phone.

Default first in lists. Setting a new default unsets the old one. Deleting it
leaves no default; the frontend should allow selection of a replacement. First
address is not automatically default. Foreign/missing addresses return 404.

## Errors and optional endpoints

Errors use `{ "success": false, "error": { "code": "...", "message": "..." }, "requestId": "..." }`.
Validation errors may include additional issue details.

| Status | Frontend action |
| --- | --- |
| 400 | Show validation feedback; check JSON and UUID format |
| 401 | Invalid OTP or invalid session; use context-specific handling above |
| 403 | Check configured origin and CSRF header; may indicate permission failure |
| 404 | Address unavailable, or route not mounted |
| 413 | Request body exceeds 16 KiB |
| 429 | Rate limited; respect Retry-After when supplied |
| 500/503 | Show retry/service-unavailable message |

`GET /api/health`: liveness. `GET /api/ready`: database and BUYER-role readiness.
`GET /api/auth/otp/mock/:challengeId`: optional local debug route only; requires
explicit mock retrieval opt-in and a loopback client. Do not depend on it in the UI.

Detailed contracts: [auth API](auth-api.md), [profile/address API](users-api.md).
