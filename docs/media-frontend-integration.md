# Frontend Media Integration

1. Create a `FormData` object with `file` and the required `purpose`.
2. Upload it to `POST /api/admin/media` with credentials, `X-CSRF-Protection: 1`, and the configured frontend Origin.
3. Read `data.media.id` from the response.
4. Send that ID as `imageMediaId` when creating/updating a Category, or `logoMediaId` for a Brand.
5. Render the `imageUrl` or `logoUrl` returned by Category and Brand APIs. Do not build an upload URL from the media ID.

```ts
const form = new FormData();
form.set("file", file);
form.set("purpose", "CATEGORY_IMAGE");

const upload = await fetch(`${apiBase}/api/admin/media`, {
  method: "POST",
  credentials: "include",
  headers: { "X-CSRF-Protection": "1" },
  body: form,
});
const { data } = await upload.json();

await fetch(`${apiBase}/api/admin/categories/${categoryId}`, {
  method: "PATCH",
  credentials: "include",
  headers: { "Content-Type": "application/json", "X-CSRF-Protection": "1" },
  body: JSON.stringify({ imageMediaId: data.media.id }),
});
```

To detach, patch the media ID to `null`. Uploading or replacing an attachment does not delete old media; explicitly delete unused media through the media DELETE endpoint.
