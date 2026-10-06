# Cloudflare R2 Image Storage Integration

Complete integration guide for managing inspection images using Cloudflare R2 Storage with S3-compatible API and presigned URLs.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Next.js Application                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  React Components          API Routes                       │
│  ├─ ImageUpload    ────→  GET/POST /api/images             │
│  ├─ ImageViewer    ────→  GET /api/images/[...path]        │
│  └─ ImageDelete    ────→  DELETE /api/images               │
│                           GET /api/images/presign           │
│                                                              │
└──────────────────────────┬──────────────────────────────────┘
                           │
                 ┌─────────┴─────────┐
                 │                   │
         Primary Path         Secondary Path
      (Workers Binding)       (S3-compatible)
         via env.R2_BUCKET   via aws4fetch
                 │                   │
                 ▼                   ▼
        ┌────────────────────────────────┐
        │   Cloudflare R2 Storage        │
        │   Bucket: inspecoes-lar        │
        │   ├─ Workers Binding API       │
        │   ├─ S3-compatible API         │
        │   └─ Custom Domain (Public)    │
        └────────────────────────────────┘
                 │
                 ▼
        ┌────────────────────┐
        │  Cloudflare Cache  │
        │  WAF, Bot Mgmt     │
        └────────────────────┘
```

## Setup Instructions

### 1. Install Dependencies

The `aws4fetch` package is required for presigned URL generation:

```bash
npm install aws4fetch --save
```

Update `functions/package.json` if using with Workers:

```bash
cd functions && npm install aws4fetch --save && cd ..
```

### 2. Configure Wrangler

The `wrangler.jsonc` file has been created with R2 bucket binding configuration:

```jsonc
{
  "r2_buckets": [
    {
      "binding": "R2_BUCKET",
      "bucket_name": "inspecoes-lar"
    }
  ]
}
```

### 3. Create Cloudflare API Token

Generate an API token for the S3-compatible API:

1. Go to **Cloudflare Dashboard** → **Account Settings** → **API Tokens**
2. Click **Create Token**
3. Use template: **R2 - Edit** (or create custom with `storage:write`, `storage:read` permissions)
4. Scope to **R2 bucket**: `inspecoes-lar`
5. Copy the **Access Key ID** and **Secret Access Key**

### 4. Configure Environment Variables

#### Local Development (`.dev.vars`)

```bash
# Created at project root
R2_ACCESS_KEY_ID=your_access_key_id
R2_SECRET_ACCESS_KEY=your_secret_access_key
CLOUDFLARE_ACCOUNT_ID=your_account_id
R2_BUCKET_NAME=inspecoes-lar
PUBLIC_DOMAIN=localhost:8787
PRESIGNED_URL_EXPIRY=3600
```

#### Production (Wrangler Secrets)

```bash
# Set secrets in Wrangler
npx wrangler secret put R2_ACCESS_KEY_ID
# Paste: your_access_key_id

npx wrangler secret put R2_SECRET_ACCESS_KEY
# Paste: your_secret_access_key
```

Update `wrangler.jsonc` with production values:

```jsonc
{
  "env": {
    "production": {
      "vars": {
        "CLOUDFLARE_ACCOUNT_ID": "your_account_id",
        "PUBLIC_DOMAIN": "images.yourdomain.com"
      }
    }
  }
}
```

### 5. Configure Public Domain (Optional but Recommended)

For serving images publicly without proxying through the API:

1. **R2 Dashboard** → `inspecoes-lar` bucket → **Settings** → **Custom Domains**
2. Click **Connect Domain**
3. Enter your custom domain (e.g., `images.yourdomain.com`)
4. Cloudflare adds a CNAME record automatically

> **Benefits**: Enables Cloudflare Cache, WAF, bot management, and custom headers

### 6. Configure CORS (If Using Presigned URLs from Browser)

If users upload directly via presigned URLs from the browser:

1. **R2 Dashboard** → `inspecoes-lar` bucket → **Settings** → **CORS Settings**
2. Add CORS configuration:

```json
[
  {
    "AllowedOrigins": ["https://yourdomain.com", "https://www.yourdomain.com"],
    "AllowedMethods": ["GET", "PUT", "DELETE", "HEAD"],
    "AllowedHeaders": ["Content-Type", "x-amz-*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

---

## API Endpoints

### Upload Image

**Endpoint:** `POST /api/images`

**Content-Type:** `multipart/form-data`

**Body:**
```
file: File                    (required) - Image file (JPG, PNG, WebP, GIF, max 10MB)
inspectionId: string          (required) - Inspection ID to associate with image
description: string           (optional) - Image description
```

**Example (JavaScript):**
```typescript
const formData = new FormData();
formData.append('file', imageFile);
formData.append('inspectionId', '123');
formData.append('description', 'Kitchen wall');

const response = await fetch('/api/images', {
  method: 'POST',
  body: formData
});
const result = await response.json();
// {
//   "key": "inspections/123/1705123456789_photo.jpg",
//   "size": 245678,
//   "etag": "d41d8cd98f00b204e9800998ecf8427e",
//   "url": "https://images.example.com/inspections/123/...",
//   "uploaded": "2024-01-13T12:34:56.789Z"
// }
```

### List Images

**Endpoint:** `GET /api/images?inspectionId=123&cursor=...`

**Query Parameters:**
- `inspectionId` (required) - Inspection ID
- `cursor` (optional) - Pagination cursor from previous response

**Response:**
```typescript
{
  "images": [
    {
      "key": "inspections/123/1705123456789_photo.jpg",
      "size": 245678,
      "etag": "d41d8cd98f00b204e9800998ecf8427e",
      "uploaded": "2024-01-13T12:34:56.789Z",
      "url": "https://images.example.com/inspections/123/...",
      "customMetadata": {
        "inspectionId": "123",
        "uploadedBy": "user-456",
        "description": "Kitchen wall"
      }
    }
  ],
  "truncated": false,
  "cursor": "page-token-for-next-results"
}
```

### Retrieve Image

**Endpoint:** `GET /api/images/inspections/123/1705123456789_photo.jpg`

**Supports:**
- Conditional requests: `If-None-Match`, `If-Modified-Since`
- Range requests: `Range: bytes=0-1023`
- Returns: `304 Not Modified` if conditions match

### Retrieve Image Metadata (HEAD)

**Endpoint:** `HEAD /api/images/inspections/123/1705123456789_photo.jpg`

**Returns headers:**
- `Content-Type` - MIME type
- `Content-Length` - File size
- `ETag` - Entity tag
- `Last-Modified` - Upload time

### Delete Image

**Endpoint:** `DELETE /api/images`

**Body (JSON):**
```json
{
  "key": "inspections/123/1705123456789_photo.jpg"
}
```

Or multiple:
```json
{
  "keys": ["inspections/123/photo1.jpg", "inspections/123/photo2.jpg"]
}
```

### Generate Presigned URL (GET)

**Endpoint:** `GET /api/images/presign?operation=put&inspectionId=123&filename=photo.jpg`

**Query Parameters:**
- `operation` - `"get"`, `"put"`, or `"delete"` (default: `"get"`)
- Either:
  - `key` - Full R2 object key, OR
  - `inspectionId` + `filename` - Build key automatically
- `contentType` (optional) - For PUT, restrict upload to this MIME type
- `expirySeconds` (optional) - URL expiry (1-604800, default: 3600)

**Response:**
```json
{
  "url": "https://7557f574a748c2b1ba07ace2a9ccc8a7.r2.cloudflarestorage.com/inspecoes-lar/inspections/123/photo.jpg?X-Amz-...",
  "expiresInSeconds": 3600,
  "operation": "put"
}
```

### Generate Presigned URL (POST)

**Endpoint:** `POST /api/images/presign`

**Body (JSON):**
```json
{
  "operation": "put",
  "inspectionId": "123",
  "filename": "photo.jpg",
  "contentType": "image/jpeg",
  "expirySeconds": 1800
}
```

---

## Client-Side Usage

### React Component Example

```tsx
import { ImageUpload } from '@/components/ImageUpload';

export default function InspectionPage({ inspectionId }: { inspectionId: string }) {
  return (
    <ImageUpload inspectionId={inspectionId} />
  );
}
```

### Direct API Calls

```typescript
import {
  uploadImageDirect,
  uploadImageViaPresigned,
  listInspectionImages,
  deleteImage,
  getPresignedDownloadUrl
} from '@/lib/r2-client';

// Upload directly
const result = await uploadImageDirect(file, inspectionId, 'Kitchen wall');

// Upload via presigned URL (for large files)
const result = await uploadImageViaPresigned(file, inspectionId);

// List images
const { images, truncated, cursor } = await listInspectionImages(inspectionId);

// Delete image
await deleteImage('inspections/123/photo.jpg');

// Get download URL
const { url } = await getPresignedDownloadUrl('inspections/123/photo.jpg');
```

---

## Best Practices

### 1. **File Validation**
```typescript
import { validateImageFile } from '@/lib/r2-client';

const validation = validateImageFile(file);
if (!validation.valid) {
  console.error(validation.error);
  return;
}
```

### 2. **Presigned URLs for Large Files**
```typescript
// Better than uploading through the server for files > 5MB
const result = await uploadImageViaPresigned(
  largeFile,
  inspectionId,
  (event) => {
    console.log(`Progress: ${Math.round((event.loaded / event.total) * 100)}%`);
  }
);
```

### 3. **Error Handling**
```typescript
try {
  await uploadImageDirect(file, inspectionId);
} catch (error) {
  if (error.message.includes('Invalid file type')) {
    // Handle invalid type
  } else if (error.message.includes('too large')) {
    // Handle size error
  } else {
    // Generic error
  }
}
```

### 4. **Cache-Control Headers**
Images use `public, max-age=31536000` (1 year cache) by default. For images that may change:

Edit `src/lib/r2.ts` in `uploadImage()`:
```typescript
cacheControl: "public, max-age=86400" // 1 day
```

### 5. **Key Naming Convention**
Keys follow the pattern: `inspections/{inspectionId}/{timestamp}_{filename}.jpg`

This ensures:
- Easy organization by inspection
- Unique filenames (timestamps prevent collisions)
- Efficient listing with prefix queries

### 6. **Metadata Usage**
Custom metadata is attached to each object:
- `inspectionId` - For filtering and organization
- `uploadedBy` - Audit trail
- `uploadedAt` - Upload timestamp
- `description` - User-provided description
- `originalName` - Original filename

Query metadata without downloading the file:
```typescript
import { getImageMetadata } from '@/lib/r2';

const metadata = await getImageMetadata(env, key);
console.log(metadata.customMetadata.uploadedBy);
```

### 7. **Presigned URL Security**
- Use short expiry times (1 hour by default)
- Restrict operations (PUT, GET, DELETE)
- Restrict content types (for PUT)
- Never expose presigned URLs in logs or error messages

### 8. **Public Domain vs R2 Direct**
- **Public Domain** (`images.example.com`) - For serving public images, leverages Cloudflare Cache & WAF
- **R2 Direct** (`{ACCOUNT_ID}.r2.cloudflarestorage.com`) - For presigned URLs and S3 API access only

---

## Troubleshooting

### "Environment variable not set"
Ensure all variables are configured in `.dev.vars` (local) or via `wrangler secret put` (production).

### "Metadata headers exceed maximum size" (Error 10012)
R2 has a 8KB limit on custom metadata. Reduce metadata size or move data to the object key.

### "Access denied" (Error 10015)
Verify API token has `storage:write` and `storage:read` permissions for the `inspecoes-lar` bucket.

### Presigned URLs not working in browser
Configure CORS on the bucket (see Setup step 6).

### Large file uploads timing out
Use presigned URL upload instead:
```typescript
await uploadImageViaPresigned(largeFile, inspectionId);
```

### Images not showing on custom domain
1. Verify domain is connected in R2 Settings → Custom Domains
2. Check DNS CNAME record points to Cloudflare
3. Wait for DNS propagation (typically < 5 minutes)

---

## Performance Optimization

### 1. **Presigned URLs for Large Uploads**
- Avoid proxying large files through Node.js
- Use presigned PUT URLs for direct uploads
- Reduces bandwidth costs and improves speed

### 2. **Batch Deletes**
```typescript
// Good: Delete multiple images in one call
await deleteImages(keys); // Up to 1000 keys

// Avoid: Multiple calls
for (const key of keys) {
  await deleteImage(key); // Inefficient
}
```

### 3. **Pagination**
```typescript
// Always handle pagination for large inspection image counts
let cursor: string | undefined;
let allImages = [];

do {
  const result = await listInspectionImages(inspectionId, cursor);
  allImages.push(...result.images);
  cursor = result.cursor;
} while (result.truncated);
```

### 4. **Caching**
- Images use 1-year cache by default
- Browser caches images by ETag
- Use custom domain to leverage Cloudflare Cache

---

## Files Created

```
/workspaces/cooperativa-terceiros/
├── wrangler.jsonc                        # Wrangler configuration
├── .dev.vars                              # Local environment variables
├── src/
│   ├── types/
│   │   └── r2.ts                          # R2 types and interfaces
│   ├── lib/
│   │   ├── r2.ts                          # Server-side R2 utilities
│   │   └── r2-client.ts                   # Client-side utilities
│   ├── components/
│   │   └── ImageUpload.tsx                # React image upload component
│   └── app/api/images/
│       ├── route.ts                       # POST/GET/DELETE /api/images
│       ├── [...path]/route.ts             # GET/HEAD /api/images/[...path]
│       └── presign/route.ts               # GET/POST /api/images/presign
└── R2_INTEGRATION.md                      # This file
```

---

## Next Steps

1. ✅ Install `aws4fetch` dependency
2. ✅ Configure `.dev.vars` with your credentials
3. ✅ Test local development: `npm run dev`
4. ✅ Set production secrets: `wrangler secret put ...`
5. ✅ Configure custom domain (optional)
6. ✅ Configure CORS (if using browser presigned uploads)
7. ✅ Integrate `ImageUpload` component into your application

---

## Resources

- [Cloudflare R2 Documentation](https://developers.cloudflare.com/r2/)
- [R2 API Reference](https://developers.cloudflare.com/r2/api/s3/api/)
- [Presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [aws4fetch](https://github.com/mhart/aws4fetch)
- [S3 Compatibility](https://developers.cloudflare.com/r2/api/s3/compatibility/)
