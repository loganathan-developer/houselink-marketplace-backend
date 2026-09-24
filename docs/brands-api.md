# Brand API

Official brands are platform-managed master data. Public visibility does not grant sellers permission to sell a brand; seller brand requests are outside Day 7.

## Public endpoints

Public reads expose only `id`, `name`, `slug`, `description` and `logoUrl`. They include only brands where `status=APPROVED` and `isActive=true`; hidden details return `404`.

| Method | Endpoint | Notes |
| --- | --- | --- |
| GET | `/api/brands?page=1&limit=20&q=nike` | Stable order by name, then id. |
| GET | `/api/brands/slug/:slug` | Slug is lowercase ASCII segments separated by single hyphens. |

## Admin endpoints

All admin routes require an active authenticated `ADMIN` user in a STAFF session with MFA verified. Mutations also require the existing CSRF header/origin checks.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/admin/brands` | List all brands; optional `status`, `isActive`, `q`, `page`, `limit`. |
| GET | `/api/admin/brands/:brandId` | Full internal detail. |
| POST | `/api/admin/brands` | Create PENDING or directly APPROVED brand. |
| PATCH | `/api/admin/brands/:brandId` | Update safe fields only. |
| PATCH | `/api/admin/brands/:brandId/approve` | Approve a PENDING brand. |
| PATCH | `/api/admin/brands/:brandId/reject` | Reject a PENDING brand with a reason. |

Create body:

```json
{
  "name": "Nike",
  "slug": "nike",
  "status": "PENDING",
  "isActive": true
}
```

Update accepts only `name`, `slug`, `description`, `logoUrl`, and `isActive`. Approve accepts `{}` or an empty body. Reject requires:

```json
{
  "reason": "Brand information could not be verified."
}
```

Only PENDING records can be approved or rejected. Repeated or reversed decisions return `409`. Duplicate normalized names or slugs return `409`.

Real staff login remains pending in the auth roadmap, so Postman admin verification requires test or fixture-created STAFF sessions until that flow exists.
