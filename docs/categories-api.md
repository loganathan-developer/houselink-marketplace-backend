# Public Category API

Base URL for local development: `http://localhost:5000`.

The current buyer-side runtime exposes public category browsing only. Admin category
management routes are intentionally not mounted until a legitimate staff/admin login
and portal are implemented.

## Endpoints

```http
GET /api/categories
GET /api/categories/tree
GET /api/categories/slug/:slug
GET /api/categories/:categoryId
GET /api/categories/:categoryId/attributes
```

All responses use the standard `{ "success": true, "data": ... }` envelope. Errors use
`{ "success": false, "error": { "code": "...", "message": "..." }, "requestId": "..." }`.

## Listing

Example:

```http
GET /api/categories?rootOnly=true&page=1&limit=20
```

Supported query parameters:

| Parameter | Meaning |
| --- | --- |
| page | Positive integer, default 1, maximum 1000000 |
| limit | Positive integer, default 20, maximum 100 |
| parentId | UUID; direct children only |
| rootOnly | Literal `true` or `false`; true selects roots |

`rootOnly=true` with `parentId` is rejected. Unknown parameters, duplicate parameters,
invalid UUIDs and invalid pagination are rejected.

Public visibility requires the category and every ancestor to be active. Inactive or
missing categories return `404 CATEGORY_NOT_FOUND`.

## Tree and detail

`GET /api/categories/tree` returns visible root categories with nested `children`.

`GET /api/categories/:categoryId` and `GET /api/categories/slug/:slug` return category
details with root-to-current breadcrumbs.

## Category attributes

`GET /api/categories/:categoryId/attributes` returns active attribute configuration for
the selected visible category. See [category attributes API](category-attributes-api.md).

## Seed

Run:

```sh
npm run seed:categories
```

The development seed creates repeatable public samples including:

```text
Men > Topwear > T-Shirts
Women > Western Wear
Kids > Boys Clothing
Home > Bath
Beauty > Makeup
```

It also seeds the T-Shirt attributes used by the buyer-facing attribute endpoint.
