# Media API

Day 9 adds local image storage for Category images and Brand logos. All mutations require an authenticated `ADMIN` role in a `STAFF` session with verified MFA, plus the normal CSRF header and trusted Origin.

## Upload

`POST /api/admin/media` uses `multipart/form-data` with exactly:

- `file`: one JPEG, PNG, or WebP image
- `purpose`: `CATEGORY_IMAGE` or `BRAND_LOGO`

Required browser headers are `X-CSRF-Protection: 1` and `Origin: <FRONTEND_ORIGIN>`. Do not manually set `Content-Type`; the browser must add the multipart boundary.

Successful response (`201`):

```json
{
  "success": true,
  "data": {
    "media": {
      "id": "uuid",
      "purpose": "CATEGORY_IMAGE",
      "mimeType": "image/webp",
      "sizeBytes": 1834,
      "width": 800,
      "height": 600,
      "url": "http://localhost:5000/uploads/categories/uuid.webp",
      "createdAt": "2026-09-28T08:00:00.000Z"
    }
  }
}
```

Images are content-validated, auto-oriented, stripped of metadata, and converted to WebP. The defaults are 5 MiB and 20 million pixels. Uploads are limited to 20 per admin per 15 minutes.

## Attach

Use `imageMediaId` in admin Category create/update, or `logoMediaId` in admin Brand create/update. The ID must have the matching purpose. Send `null` to detach. A request cannot contain both the direct URL and media ID fields.

```json
{ "imageMediaId": "uuid" }
```

Category and Brand responses continue to use `imageUrl` and `logoUrl`. Attached media takes precedence; after detachment, any stored direct URL becomes visible again.

## Delete

`DELETE /api/admin/media/:mediaId` returns `204` for unused media and `409 MEDIA_IN_USE` while a Category or Brand references it. Missing files are tolerated. Database foreign keys use `RESTRICT` to prevent concurrent attachment from producing a broken reference.

Common errors include `INVALID_IMAGE`, `UNSUPPORTED_IMAGE_TYPE`, `IMAGE_TOO_LARGE`, `IMAGE_PIXEL_LIMIT_EXCEEDED`, `MEDIA_PURPOSE_MISMATCH`, `MEDIA_IN_USE`, `CSRF_REJECTED`, and `MEDIA_UPLOAD_RATE_LIMITED`.
