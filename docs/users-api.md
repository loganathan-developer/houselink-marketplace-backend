# Buyer Profile & Address API

Base URL for local development: `http://localhost:5000`.

## Authentication and security

All routes require the access-token cookie from OTP login and an active session.
Blocked/deleted users and unauthenticated requests receive `401`.
For mutations, send `Content-Type: application/json`, `X-CSRF-Protection: 1`,
and the configured frontend `Origin` (locally `http://localhost:3000`).
Keep the client cookie jar enabled. See [authentication API](auth-api.md).

User ownership comes exclusively from authentication. Request bodies reject unknown
fields, including `userId`, roles, status, phone/email identities, verification fields
and credentials. Address `contactPhone` is delivery information, not a verified login identity.
Responses use `Cache-Control: no-store`.

## Endpoints

| Method | Endpoint | Success response |
| --- | --- | --- |
| GET | `/api/users/me` | 200, `data.user` |
| PATCH | `/api/users/me` | 200, updated `data.user` |
| GET | `/api/users/me/addresses` | 200, `data.addresses` array |
| POST | `/api/users/me/addresses` | 201, created `data.address` |
| PATCH | `/api/users/me/addresses/:addressId` | 200, updated `data.address` |
| DELETE | `/api/users/me/addresses/:addressId` | 204, no body |
| PATCH | `/api/users/me/addresses/:addressId/default` | 200, updated `data.address` |

JSON success responses include `success: true` and the indicated `data` wrapper.
Address lists contain only the current user's addresses, default first, then creation
time and ID. Missing or foreign address IDs return `404 ADDRESS_NOT_FOUND`.
Malformed UUIDs or invalid bodies return `400 VALIDATION_ERROR`.

## Profile

`GET /api/users/me` returns `id`, `name`, `profileImage`, `createdAt` and `updatedAt`.
It does not return credentials or verified identity records.

Example `PATCH /api/users/me`:

```json
{
  "name": "Buyer Name",
  "profileImage": "https://example.com/avatar.png"
}
```

Provide at least one field. `name` is trimmed and must contain 1-100 characters.
`profileImage` is optional, must be an HTTPS URL of at most 2048 characters, and can
be cleared with `null`. This endpoint stores the URL; it does not upload an image.

## Addresses

Example `POST /api/users/me/addresses`:

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

All fields except `addressLine2` and `isDefault` are required on creation.
Updates accept any nonempty subset of these fields.

| Field | Validation |
| --- | --- |
| recipientName | Trimmed, 1-100 characters |
| contactPhone | International format: `+`, nonzero first digit, 8-15 total digits |
| addressLine1 | Trimmed, 1-200 characters |
| addressLine2 | Optional; trimmed, 1-200 characters, or `null` to clear |
| city, state | Trimmed, 1-100 characters each |
| postalCode | Trimmed, 1-20 characters; letters, numbers, spaces or hyphens |
| country | Two letters, normalized to uppercase |
| isDefault | Boolean; defaults to `false` on creation |

Each address response also includes `id`, `userId`, `createdAt` and `updatedAt`.

## Default address rules

At most one address per user may be default. Creating/updating an address with
`isDefault: true`, or calling the `/default` endpoint, unsets the previous default
inside the same transaction. Per-user transaction locks serialize concurrent changes;
a partial unique database index also enforces the invariant.

Send `{}` or no body to the `/default` and DELETE endpoints. Setting
`isDefault: false` or deleting the current default leaves no default selected.
No replacement is chosen automatically, and the first address is not automatically default.

## Database and tests

Migration `20260922000000_buyer_profile_addresses` adds `User.profileImage`,
`UserAddress`, its user foreign key and the default-address unique index.
Run `npx prisma migrate deploy` and `npx prisma generate` during setup.

`npm test` exercises profile updates, protected fields, CRUD, defaults, concurrent
default changes, ownership, invalid input/UUIDs, unauthenticated and blocked/deleted
users, and the Prisma User-to-address relation in an isolated test schema.
