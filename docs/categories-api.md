# Category and Subcategory API

Categories use a self-referencing hierarchy. A root has `parentId: null`; all other
categories reference their parent UUID. Names may repeat; slugs are globally unique.
There is no hard-delete endpoint. Deactivate categories with PATCH instead.

## Public endpoints

No login is required. Existing origin/CORS policy still applies.

| Method | Route | Success |
| --- | --- | --- |
| GET | `/api/categories` | 200, paginated visible categories |
| GET | `/api/categories/tree` | 200, `data.categories` nested roots with children arrays |
| GET | `/api/categories/slug/:slug` | 200, `data.category` with breadcrumbs |
| GET | `/api/categories/:categoryId` | 200, `data.category` with breadcrumbs |

Example: `GET /api/categories?rootOnly=true&page=1&limit=20`.

```json
{
  "success": true,
  "data": {
    "categories": [
      {
        "id": "d5000000-0000-4000-8000-000000000001",
        "name": "Men",
        "slug": "men",
        "description": null,
        "imageUrl": null,
        "parentId": null,
        "isActive": true,
        "sortOrder": 0,
        "createdAt": "2026-09-23T00:00:00.000Z",
        "updatedAt": "2026-09-23T00:00:00.000Z"
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
  }
}
```

List query parameters:

| Parameter | Meaning |
| --- | --- |
| page | Positive integer, default 1, maximum 1000000 |
| limit | Positive integer, default 20, maximum 100 |
| parentId | UUID; direct children only |
| rootOnly | Literal `true` or `false`; true selects roots |
| isActive | Admin list only; literal `true` or `false` |

`rootOnly=true` with `parentId` is rejected. Unknown parameters, duplicate parameters,
invalid UUIDs, and invalid pagination are rejected. Tree/detail routes accept no query
parameters. All lists use `sortOrder ASC, id ASC`; tree siblings use the same order.
An empty list has total 0, totalPages 0; pages beyond the end have an empty array.

A public category is visible only when it and every ancestor are active. Filtering
and counting happen after this rule. Inactive/missing categories return the same 404
for ID and slug lookups. Deactivating a parent does not change child isActive values;
reactivation restores visibility only for descendants whose entire branch is active.

Tree responses use `{ "success": true, "data": { "categories": [] } }` when empty.
Each visible node has its category fields plus `children`, recursively. Detail responses
contain category fields plus root-to-current breadcrumbs:

```json
{
  "breadcrumbs": [
    { "id": "d5000000-0000-4000-8000-000000000001", "name": "Men", "slug": "men" },
    { "id": "d5000000-0000-4000-8000-000000000002", "name": "Topwear", "slug": "men-topwear" }
  ]
}
```

## Admin endpoints

| Method | Route | Success |
| --- | --- | --- |
| GET | `/api/admin/categories` | 200, same pagination envelope; includes active/inactive |
| GET | `/api/admin/categories/:categoryId` | 200, `data.category` with breadcrumbs, including inactive |
| POST | `/api/admin/categories` | 201, `data.category` |
| PATCH | `/api/admin/categories/:categoryId` | 200, updated `data.category` |

All admin routes use existing authentication and `requireRole("ADMIN")`. This requires
an active user/session, ADMIN role, STAFF session context and verified MFA. A customer
OTP session with ADMIN assigned still cannot access these routes. Staff login is not
implemented yet; no debug admin login or public privilege-escalation route was added.
Integration tests provision independent staff accounts/sessions only in the isolated
test database. They do not promote OTP buyers or convert customer sessions to staff.
SELLER fixtures are also denied every admin endpoint; OTP buyer roles remain unchanged.

Pending prerequisite: real staff login/MFA provisioning is not yet implemented.
Category admin APIs are implemented and authorization-tested with controlled fixtures,
but manual Postman testing with a real staff account remains pending until that module exists.

Mutations require cookie credentials, `X-CSRF-Protection: 1`, and trusted Origin/Referer.
Browser clients use `credentials: "include"`. For local Postman requests send
`Origin: http://localhost:3000` and `Content-Type: application/json`.

Example POST (root):

```json
{
  "name": "Men",
  "slug": "men",
  "description": "Men category",
  "imageUrl": null,
  "parentId": null,
  "sortOrder": 1
}
```

For a child, set `parentId` to the returned parent UUID. `name` and `slug` are required
on POST; `isActive` defaults true, `sortOrder` defaults 0, nullable fields default null.
PATCH accepts any nonempty subset of these fields. Omitted parentId stays unchanged;
explicit null moves to root. Renaming does not regenerate the slug.

Example move/reorder/deactivation:

```json
{ "parentId": null, "sortOrder": 4, "isActive": false }
```

Validation: name is trimmed, 1-120 characters; slug is 1-160 lowercase ASCII letters,
digits and single separating hyphens. Description is optional/null, max 5000 characters.
Image URL is optional/null, HTTPS only, max 2048 characters. sortOrder must be an integer
between 0 and 2147483647. isActive must be a boolean. Unknown fields are rejected.

## Hierarchy and concurrency

Self-parenting, nonexistent parents and moves below descendants return 400. Create/move
validates the entire resulting hierarchy under a shared PostgreSQL transaction advisory
lock. All category API writers and the development seed take that lock. Concurrent
opposing moves cannot create a cycle. Slug uniqueness is additionally enforced by the
database and duplicate races return 409.

The maximum depth is 64 levels including the root. This protects nested response
serialization; moving a subtree checks its resulting depth too. Tree construction and
hierarchy validation are iterative. Direct database writers must honor these rules and
the same lock; do not modify parentId with ad hoc SQL.

## Errors

All use `{ "success": false, "error": { "code": "...", "message": "..." }, "requestId": "..." }`.

| Status | Code/condition |
| --- | --- |
| 400 | VALIDATION_ERROR: invalid body, UUID, slug or query |
| 400 | INVALID_CATEGORY_HIERARCHY: missing parent, cycle, or depth limit |
| 401 | Existing authentication error: missing/expired session or blocked/deleted user |
| 403 | FORBIDDEN for insufficient admin authorization; existing CSRF/origin errors |
| 404 | CATEGORY_NOT_FOUND: missing or publicly hidden category |
| 409 | CATEGORY_SLUG_EXISTS |

## Migration, seed and verification

Migration: `20260923000000_category_management`. Adds only Category, its indexes and
constraints; preserves existing user/auth/address data.

```sh
npx prisma migrate deploy
npx prisma generate
npm run seed:categories
npm run typecheck
npm run build
npm test
```

The sample seed rejects production. It adds Men/Topwear/T-Shirts/Shirts,
Women/Western Wear/Tops/Dresses, Kids/Boys Clothing/T-Shirts,
Home/Bath/Bath Towels and Beauty/Makeup/Lipstick. Stable IDs make it repeatable even
after admin slug changes. Existing rows are never updated. Conflicting existing slugs
are skipped with their unseedable descendants rather than repurposed.

Category integration scenarios reuse the existing test server, login helper, test
schema/migration setup and database concurrency helper. They cover CRUD without delete,
hierarchy and concurrent cycles, visibility, pagination, ordering, tree/breadcrumbs,
validation, admin permissions/CSRF and seed repeatability.

Limitations: full-tree reads and mutation hierarchy validation scale with category count;
consider caching or a closure table if the taxonomy grows substantially. No products,
attributes, variants, seller rules, hard deletion or admin login are included.

## Postman test order

Import [the category collection](../postman/categories.postman_collection.json).
Set `baseUrl` and `frontendOrigin`. Start the backend using `npm run dev`.
Optional local samples: `npm run seed:categories`. No user or role is created by that seed.

### A. Public tests

These collection requests disable cookie sending to verify guest access.

1. GET `/api/categories?page=1&limit=20`: expect 200. The test script stores the first
   visible category's ID and slug. If empty, seed development data or supply an existing
   visible category before the following ID/slug requests.
2. GET `/api/categories?rootOnly=true`: expect 200.
3. GET `/api/categories?parentId={{categoryId}}`: expect 200 and only direct children.
4. GET `/api/categories/tree`: expect 200 and nested `data.categories`.
5. GET `/api/categories/slug/{{categorySlug}}`: expect 200 with breadcrumbs.
6. GET `/api/categories/{{categoryId}}`: expect 200 with breadcrumbs.

### B. Buyer access-denied tests

Use the normal cookie jar for this folder. Use a dedicated ordinary buyer phone.

1. POST `/api/auth/otp/request` with `{"phone":"{{buyerPhone}}"}`; the script stores challengeId.
2. POST `/api/auth/otp/verify` with `{"challengeId":"{{challengeId}}","otp":"{{otp}}"}`.
   The default 123456 works only with the existing development/mock/allow-any settings;
   otherwise enter the valid OTP from the configured provider. Preserve the returned cookies.
3. GET `/api/admin/categories`: expect 403.
4. GET `/api/admin/categories/{{categoryId}}`: expect 403.
5. POST `/api/admin/categories` with the supplied example: expect 403.
6. PATCH `/api/admin/categories/{{categoryId}}` with the supplied example: expect 403.

To check guest denial, clear cookies and repeat admin requests: expect 401 with valid
CSRF/Origin headers. Missing CSRF may return 403 before authentication, by design.
POST/PATCH requests in the collection already contain the required headers.

### C. Admin tests - pending

Do not promote the buyer above. This folder is skipped by default. After a separate
staff-authentication module legitimately provisions an ADMIN STAFF session with MFA,
use its real cookies in a separate Postman cookie jar/workspace, set
`enableAdminRequests=true`, and run:

1. GET admin list: expect 200, including inactive categories.
2. GET admin detail: expect 200 for the selected existing category.
3. POST create: expect 201; the script stores `adminCategoryId`.
4. PATCH the newly created category: expect 200, changing description/order/status.

The collection flag only permits requests to execute; it cannot grant server authorization.
No role headers, hardcoded credentials, tokens or fake admin login are supplied.
