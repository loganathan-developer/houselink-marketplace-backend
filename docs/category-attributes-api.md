# Public Category Attributes API

Day 6 adds reusable category attributes for future seller product creation, variants,
buyer filters and search. Public users can read active category attributes. Protected
admin routes manage attribute configuration using ADMIN authorization; real staff login
is still pending, so manual ADMIN Postman testing requires a future staff auth flow.

## Data model

- `Attribute`: reusable definition with `name`, unique machine `code`, `type`, and `isActive`.
- `AttributeValue`: selectable values under one attribute. `(attributeId, value)` is unique.
- `CategoryAttribute`: maps one attribute to one category. `(categoryId, attributeId)` is unique.

Supported `AttributeType` values:

```text
SELECT
MULTI_SELECT
TEXT
NUMBER
BOOLEAN
```

Current T-Shirt seed attributes all use `SELECT`.

## Public API

```http
GET /api/categories/:categoryId/attributes
```

No login is required. A logged-in BUYER can call the same endpoint.

The category must be publicly visible. The response includes only:

- active category-attribute mappings
- active attributes
- active attribute values

Attributes are ordered by `CategoryAttribute.sortOrder ASC`, then `attributeId ASC`.
Values are ordered by `AttributeValue.sortOrder ASC`, then `id ASC`.

Example response:

```json
{
  "success": true,
  "data": {
    "categoryId": "d5000000-0000-4000-8000-000000000003",
    "attributes": [
      {
        "id": "uuid",
        "name": "Size",
        "code": "size",
        "type": "SELECT",
        "isRequired": true,
        "isFilterable": true,
        "isVariantOption": true,
        "sortOrder": 1,
        "values": [
          { "id": "uuid", "value": "s", "label": "S", "sortOrder": 1 }
        ]
      }
    ]
  }
}
```

Invalid UUID parameters return `400 VALIDATION_ERROR`. Missing or inactive categories
return `404 CATEGORY_NOT_FOUND`.

## Admin API

All admin endpoints require authenticated active ADMIN authorization and CSRF headers:

```http
GET /api/admin/attributes
POST /api/admin/attributes
PATCH /api/admin/attributes/:attributeId
POST /api/admin/attributes/:attributeId/values
PATCH /api/admin/attributes/:attributeId/values/:valueId
GET /api/admin/categories/:categoryId/attributes
POST /api/admin/categories/:categoryId/attributes
PATCH /api/admin/categories/:categoryId/attributes/:attributeId
DELETE /api/admin/categories/:categoryId/attributes/:attributeId
```

Guest admin requests return `401`. BUYER/SELLER admin requests return `403`.

## Seeded T-Shirt configuration

`npm run seed:categories` seeds `Men > Topwear > T-Shirts` with:

- Size: S, M, L, XL
- Brand: HouseLink, Urban Stitch, Dailywear
- Color: Black, White, Blue, Red
- Fabric: Cotton, Polyester, Linen
- Fit: Slim, Regular, Oversized
- Pattern: Solid, Printed, Striped, Checked
- Sleeve Length: Half Sleeve, Full Sleeve, Sleeveless

The seed is idempotent and does not delete existing customizations.
