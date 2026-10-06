/**
 * Cloudflare R2 Storage Utility Functions
 * Provides methods for all CRUD operations and presigned URL generation
 */

import { AwsClient } from "aws4fetch";
import type {
  R2Env,
  ImageMetadata,
  ImageObject,
  ImageListResponse,
  PresignedUrlResponse,
  ImageUploadResponse,
  AllowedImageType,
} from "@/types/r2";
import { IMAGE_UPLOAD_CONSTRAINTS, ALLOWED_IMAGE_TYPES } from "@/types/r2";

/**
 * Validates if a file type is an allowed image format
 */
export function isAllowedImageType(
  contentType: string
): contentType is AllowedImageType {
  return ALLOWED_IMAGE_TYPES.includes(contentType as AllowedImageType);
}

/**
 * Uploads an image to R2
 */
export async function uploadImage(
  env: R2Env,
  key: string,
  body: ReadableStream<Uint8Array> | Blob,
  metadata: ImageMetadata,
  contentType: string = "image/jpeg",
  options?: {
    cacheControl?: string;
    conditional?: string;
  }
): Promise<ImageUploadResponse> {
  if (!isAllowedImageType(contentType)) {
    throw new Error(
      `Invalid content type: ${contentType}. Allowed types: ${ALLOWED_IMAGE_TYPES.join(", ")}`
    );
  }

  const object = await env.R2_BUCKET.put(key, body, {
    httpMetadata: {
      contentType,
      contentDisposition: "inline",
      cacheControl: options?.cacheControl || IMAGE_UPLOAD_CONSTRAINTS.cacheControl,
    },
    customMetadata: {
      inspectionId: metadata.inspectionId,
      uploadedBy: metadata.uploadedBy,
      uploadedAt: new Date().toISOString(),
      description: metadata.description || "",
      originalName: metadata.originalName || "",
    },
  });

  return {
    key: object.key,
    size: object.size,
    etag: object.httpEtag,
    url: `https://${env.PUBLIC_DOMAIN}/${object.key}`,
    uploaded: object.uploaded,
    customMetadata: object.customMetadata as ImageMetadata,
  };
}

/**
 * Retrieves an image from R2
 */
export async function getImage(
  env: R2Env,
  key: string,
  requestHeaders?: HeadersInit
): Promise<{
  object: R2ObjectBody;
  headers: Headers;
} | null> {
  const object = await env.R2_BUCKET.get(key, {
    onlyIf: requestHeaders,
    range: requestHeaders,
  });

  if (object === null) {
    return null;
  }

  // Check if body exists (304 Not Modified)
  if (!("body" in object)) {
    return {
      object: null as any, // Indicates 304 Not Modified
      headers: new Headers({ "content-type": "text/plain" }),
    };
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000");

  return { object, headers };
}

/**
 * Retrieves image metadata without downloading the full object
 */
export async function getImageMetadata(
  env: R2Env,
  key: string
): Promise<{
  key: string;
  size: number;
  etag: string;
  uploaded: Date;
  httpMetadata?: any;
  customMetadata?: ImageMetadata;
} | null> {
  const object = await env.R2_BUCKET.head(key);

  if (object === null) {
    return null;
  }

  return {
    key: object.key,
    size: object.size,
    etag: object.httpEtag,
    uploaded: object.uploaded,
    httpMetadata: object.httpMetadata,
    customMetadata: object.customMetadata as ImageMetadata,
  };
}

/**
 * Lists images in a folder (inspection) with pagination support
 */
export async function listImages(
  env: R2Env,
  prefix: string,
  options?: {
    limit?: number;
    cursor?: string;
  }
): Promise<ImageListResponse> {
  const listed = await env.R2_BUCKET.list({
    prefix,
    delimiter: "/",
    limit: options?.limit || 50,
    cursor: options?.cursor,
    include: ["httpMetadata", "customMetadata"],
  });

  return {
    images: listed.objects.map((obj) => ({
      key: obj.key,
      size: obj.size,
      etag: obj.httpEtag,
      uploaded: obj.uploaded,
      httpMetadata: obj.httpMetadata,
      customMetadata: obj.customMetadata as ImageMetadata,
    })),
    truncated: listed.truncated,
    cursor: listed.cursor,
    prefixes: listed.delimitedPrefixes,
  };
}

/**
 * Deletes a single image from R2
 */
export async function deleteImage(env: R2Env, key: string): Promise<void> {
  await env.R2_BUCKET.delete(key);
}

/**
 * Deletes multiple images from R2 (up to 1000 in one call)
 */
export async function deleteImages(env: R2Env, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  if (keys.length > 1000) {
    throw new Error("Cannot delete more than 1000 objects in a single call");
  }
  await env.R2_BUCKET.delete(keys);
}

/**
 * Generates a presigned URL for direct upload/download via S3 API
 * Supports GET (download), PUT (upload), and DELETE operations
 */
export async function generatePresignedUrl(
  env: R2Env,
  key: string,
  operation: "get" | "put" | "delete" = "get",
  options?: {
    contentType?: string;
    expirySeconds?: number;
  }
): Promise<PresignedUrlResponse> {
  const r2 = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  });

  const s3Url = `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}/${key}`;
  const expirySeconds = options?.expirySeconds || parseInt(env.PRESIGNED_URL_EXPIRY) || 3600;

  // Validate expiry range (1 second to 7 days)
  if (expirySeconds < 1 || expirySeconds > 604800) {
    throw new Error("Presigned URL expiry must be between 1 and 604,800 seconds (7 days)");
  }

  const method = operation === "delete" ? "DELETE" : operation === "put" ? "PUT" : "GET";

  const requestInit: RequestInit = { method };
  if (operation === "put") {
    requestInit.headers = {
      ...(options?.contentType ? { "Content-Type": options.contentType } : {}),
      "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
    };
  }

  const signed = await r2.sign(
    new Request(`${s3Url}?X-Amz-Expires=${expirySeconds}`, requestInit),
    { aws: { signQuery: true } }
  );

  return {
    url: signed.url,
    expiresInSeconds: expirySeconds,
    operation,
  };
}

/**
 * Copies an image within R2 (read-then-write approach)
 */
export async function copyImage(
  env: R2Env,
  sourceKey: string,
  destKey: string,
  metadata?: ImageMetadata
): Promise<ImageUploadResponse> {
  const source = await env.R2_BUCKET.get(sourceKey);

  if (source === null || !("body" in source)) {
    throw new Error(`Source image not found: ${sourceKey}`);
  }

  const object = await env.R2_BUCKET.put(destKey, source.body, {
    httpMetadata: source.httpMetadata,
    customMetadata: metadata || (source.customMetadata as ImageMetadata),
  });

  return {
    key: object.key,
    size: object.size,
    etag: object.httpEtag,
    url: `https://${env.PUBLIC_DOMAIN}/${object.key}`,
    uploaded: object.uploaded,
    customMetadata: object.customMetadata as ImageMetadata,
  };
}

/**
 * Builds a structured key for image storage
 * Pattern: inspections/{inspectionId}/{timestamp}_{filename}
 */
export function buildImageKey(
  inspectionId: string,
  filename: string,
  timestamp: number = Date.now()
): string {
  // Remove any directory traversal attempts
  const safeName = filename.replace(/[\/\\]/g, "_");
  return `inspections/${inspectionId}/${timestamp}_${safeName}`;
}

/**
 * Parses inspection ID from an image key
 */
export function parseInspectionIdFromKey(key: string): string | null {
  const match = key.match(/^inspections\/([^\/]+)\//);
  return match ? match[1] : null;
}

/**
 * Handles R2 errors and provides meaningful error messages
 */
export function handleR2Error(error: any): { code: string; message: string } {
  if (error?.message) {
    // Extract error code from message, e.g., "(10012)"
    const codeMatch = error.message.match(/\((\d+)\)/);
    const code = codeMatch ? codeMatch[1] : "UNKNOWN";

    const errorMessages: { [key: string]: string } = {
      "10012": "Metadata headers exceed maximum size",
      "10013": "Invalid metadata",
      "10014": "Invalid request",
      "10015": "Access denied",
      "10016": "Object not found",
      "10017": "Bucket not found",
    };

    return {
      code,
      message: errorMessages[code] || error.message,
    };
  }

  return {
    code: "UNKNOWN",
    message: "An unknown error occurred",
  };
}
