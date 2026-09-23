# Category Attributes & Filter Configuration API

Day 6 adds reusable category attributes for future seller product creation, variants,
buyer filters and search. Products, variants, inventory, brands and buyer search are
intentionally out of scope.

Brand is intentionally **not** an Attribute. Brand management will be implemented as a
separate module.

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

## Access rules

Public category attribute reads require no login. Admin attribute, value and mapping
management uses the existing cookie session, CSRF protection and `ADMIN` role policy.
In this project, ADMIN requires a STAFF session with MFA.

Guest admin requests return `401`. BUYER and SELLER sessions return `403`.

## Public API

```http
GET /api/categories/:categoryId/attributes
```

Returns only active category configuration: the category must be publicly visible, the
mapping must be active, the attribute must be active, and only active values are included.
Attributes are ordered by mapping `sortOrder`; values are ordered by value `sortOrder`.

Example response:

```json
{
  "success": true,
  "data": {
    "categoryId": "uuid",
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

## Admin Attribute APIs

```http
GET   /api/admin/attributes?page=1&limit=20
POST  /api/admin/attributes
PATCH /api/admin/attributes/:attributeId
```

Create example:

```json
{ "name": "Fabric", "code": "fabric", "type": "SELECT" }
```

Patch example:

```json
{ "name": "Fabric Type", "isActive": true }
```

Admin listing may include inactive attributes and includes values for management.

## Admin AttributeValue APIs

```http
POST  /api/admin/attributes/:attributeId/values
PATCH /api/admin/attributes/:attributeId/values/:valueId
```

Create example:

```json
{ "value": "cotton", "label": "Cotton", "sortOrder": 1 }
```

Patch example:

```json
{ "label": "Pure Cotton", "sortOrder": 2, "isActive": true }
```

The `valueId` must belong to the specified `attributeId`.

## Admin Category Mapping APIs

```http
GET    /api/admin/categories/:categoryId/attributes
POST   /api/admin/categories/:categoryId/attributes
PATCH  /api/admin/categories/:categoryId/attributes/:attributeId
DELETE /api/admin/categories/:categoryId/attributes/:attributeId
```

Mapping example:

```json
{
  "attributeId": "uuid",
  "isRequired": true,
  "isFilterable": true,
  "isVariantOption": false,
  "sortOrder": 3
}
```

Attributes can be newly mapped only when both category and attribute are active. If a
matching inactive mapping already exists, POST reactivates and updates it predictably.
DELETE deactivates the mapping; it never deletes the shared category, attribute or values.

## Validation and errors

Schemas are strict. Unknown fields are rejected. PATCH bodies must contain at least one
valid field. UUID route parameters must be valid UUIDs. Booleans must be real JSON booleans.

Common errors use the existing envelope:

```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "..." }, "requestId": "..." }
```

Status codes: `400` validation/business-rule failures, `401` unauthenticated, `403`
forbidden, `404` missing resources and `409` duplicates.

## Seeded T-Shirt configuration

`npm run seed:categories` also seeds `Men > Topwear > T-Shirts` with:

- Size: S, M, L, XL
- Color: Black, White, Blue, Red
- Fabric: Cotton, Polyester, Linen
- Fit: Slim, Regular, Oversized
- Pattern: Solid, Printed, Striped, Checked
- Sleeve Length: Half Sleeve, Full Sleeve, Sleeveless

The seed is idempotent and does not delete existing administrative customizations.
