/**
 * Cloudflare R2 Storage Types and Interfaces
 */

/**
 * Environment variables for Cloudflare R2 integration
 */
export interface R2Env {
  // R2 bucket binding (Workers API)
  R2_BUCKET: R2Bucket;

  // S3 API credentials for presigned URLs
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;

  // Cloudflare account and bucket identifiers
  CLOUDFLARE_ACCOUNT_ID: string;
  R2_BUCKET_NAME: string;

  // Public access configuration
  PUBLIC_DOMAIN: string;

  // Presigned URL expiration in seconds
  PRESIGNED_URL_EXPIRY: string;
}

/**
 * Metadata stored with each R2 object
 */
export interface ImageMetadata {
  inspectionId: string;
  uploadedBy: string;
  uploadedAt?: string;
  description?: string;
  originalName?: string;
}

/**
 * Image object response from R2
 */
export interface ImageObject {
  key: string;
  size: number;
  etag: string;
  uploaded: Date;
  httpMetadata?: {
    contentType?: string;
    contentDisposition?: string;
    cacheControl?: string;
  };
  customMetadata?: ImageMetadata;
}

/**
 * Image listing response
 */
export interface ImageListResponse {
  images: ImageObject[];
  truncated: boolean;
  cursor?: string;
  prefixes?: string[];
}

/**
 * Presigned URL response
 */
export interface PresignedUrlResponse {
  url: string;
  expiresInSeconds: number;
  operation: "get" | "put" | "delete";
}

/**
 * Image upload response
 */
export interface ImageUploadResponse {
  key: string;
  size: number;
  etag: string;
  url: string;
  uploaded: Date;
  customMetadata?: ImageMetadata;
}

/**
 * Error response
 */
export interface ErrorResponse {
  error: string;
  status: number;
  code?: string;
  message?: string;
}

/**
 * Allowed image MIME types
 */
export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

/**
 * Image upload constraints
 */
export const IMAGE_UPLOAD_CONSTRAINTS = {
  maxSize: 10 * 1024 * 1024, // 10 MB
  allowedTypes: ALLOWED_IMAGE_TYPES,
  cacheControl: "public, max-age=31536000", // 1 year
} as const;
