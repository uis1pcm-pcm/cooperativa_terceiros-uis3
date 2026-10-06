/**
 * Client-side Image Upload and Management Utilities
 * Use in React components for image operations
 */

import type { ImageUploadResponse, PresignedUrlResponse, ErrorResponse } from "@/types/r2";

/**
 * Uploads an image via FormData (multipart/form-data)
 * @param file - The File object to upload
 * @param inspectionId - The inspection ID to associate with the image
 * @param description - Optional description for the image
 * @returns Upload response or error
 */
export async function uploadImageDirect(
  file: File,
  inspectionId: string,
  description?: string
): Promise<ImageUploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("inspectionId", inspectionId);
  if (description) {
    formData.append("description", description);
  }

  const response = await fetch("/api/images", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = (await response.json()) as ErrorResponse;
    throw new Error(error.error || "Upload failed");
  }

  return response.json();
}

/**
 * Gets a presigned URL for direct upload via S3 API
 * Useful for large files or to avoid proxying through the server
 * @param inspectionId - The inspection ID
 * @param filename - The filename for the image
 * @param contentType - MIME type (default: image/jpeg)
 * @param expirySeconds - URL expiry in seconds (default: 3600)
 * @returns Presigned URL response
 */
export async function getPresignedUploadUrl(
  inspectionId: string,
  filename: string,
  contentType: string = "image/jpeg",
  expirySeconds?: number
): Promise<PresignedUrlResponse> {
  const params = new URLSearchParams({
    operation: "put",
    inspectionId,
    filename,
    contentType,
    ...(expirySeconds && { expirySeconds: expirySeconds.toString() }),
  });

  const response = await fetch(`/api/images/presign?${params}`, {
    method: "GET",
  });

  if (!response.ok) {
    const error = (await response.json()) as ErrorResponse;
    throw new Error(error.error || "Failed to generate presigned URL");
  }

  return response.json();
}

/**
 * Uploads an image directly to R2 using a presigned URL
 * @param presignedUrl - The S3 presigned PUT URL
 * @param file - The File object to upload
 * @returns Response from S3
 */
export async function uploadViaPresignedUrl(
  presignedUrl: string,
  file: File
): Promise<Response> {
  const response = await fetch(presignedUrl, {
    method: "PUT",
    body: file,
    headers: {
      "Content-Type": file.type,
    },
  });

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.statusText}`);
  }

  return response;
}

/**
 * Two-step upload: get presigned URL then upload directly
 * Useful for large files
 * @param file - The File object to upload
 * @param inspectionId - The inspection ID
 * @param onProgress - Optional progress callback
 * @returns Upload response with public URL
 */
export async function uploadImageViaPresigned(
  file: File,
  inspectionId: string,
  onProgress?: (event: ProgressEvent) => void
): Promise<{ key: string; url: string; size: number }> {
  // Step 1: Get presigned URL
  const presignedUrlResponse = await getPresignedUploadUrl(
    inspectionId,
    file.name,
    file.type
  );

  // Step 2: Upload via presigned URL with progress tracking
  const xhr = new XMLHttpRequest();

  return new Promise((resolve, reject) => {
    xhr.upload.addEventListener("progress", (event) => {
      if (onProgress) onProgress(event);
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({
          key: `inspections/${inspectionId}/${Date.now()}_${file.name}`,
          url: `https://${window.location.hostname}/${inspectionId}/${Date.now()}_${file.name}`,
          size: file.size,
        });
      } else {
        reject(new Error(`Upload failed: ${xhr.statusText}`));
      }
    });

    xhr.addEventListener("error", () => {
      reject(new Error("Upload error"));
    });

    xhr.open("PUT", presignedUrlResponse.url);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.send(file);
  });
}

/**
 * Lists images for an inspection
 * @param inspectionId - The inspection ID
 * @param cursor - Optional cursor for pagination
 * @returns List of images
 */
export async function listInspectionImages(
  inspectionId: string,
  cursor?: string
): Promise<any> {
  const params = new URLSearchParams({ inspectionId });
  if (cursor) params.append("cursor", cursor);

  const response = await fetch(`/api/images?${params}`, {
    method: "GET",
  });

  if (!response.ok) {
    const error = (await response.json()) as ErrorResponse;
    throw new Error(error.error || "Failed to list images");
  }

  return response.json();
}

/**
 * Deletes a single image
 * @param key - The R2 object key
 */
export async function deleteImage(key: string): Promise<void> {
  const response = await fetch("/api/images", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
  });

  if (!response.ok) {
    const error = (await response.json()) as ErrorResponse;
    throw new Error(error.error || "Failed to delete image");
  }
}

/**
 * Deletes multiple images
 * @param keys - Array of R2 object keys (max 1000)
 */
export async function deleteImages(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  if (keys.length > 1000) {
    throw new Error("Cannot delete more than 1000 images in one request");
  }

  const response = await fetch("/api/images", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keys }),
  });

  if (!response.ok) {
    const error = (await response.json()) as ErrorResponse;
    throw new Error(error.error || "Failed to delete images");
  }
}

/**
 * Gets a presigned URL for downloading an image
 * Useful for time-limited access or to audit downloads
 * @param key - The R2 object key
 * @param expirySeconds - URL expiry in seconds (default: 3600)
 * @returns Presigned URL response
 */
export async function getPresignedDownloadUrl(
  key: string,
  expirySeconds?: number
): Promise<PresignedUrlResponse> {
  const params = new URLSearchParams({
    operation: "get",
    key,
    ...(expirySeconds && { expirySeconds: expirySeconds.toString() }),
  });

  const response = await fetch(`/api/images/presign?${params}`, {
    method: "GET",
  });

  if (!response.ok) {
    const error = (await response.json()) as ErrorResponse;
    throw new Error(error.error || "Failed to generate download URL");
  }

  return response.json();
}

/**
 * Validates file before upload
 * @param file - The File object to validate
 * @param maxSize - Maximum file size in bytes (default: 10MB)
 * @param allowedTypes - Array of allowed MIME types
 * @returns Validation result
 */
export function validateImageFile(
  file: File,
  maxSize: number = 10 * 1024 * 1024,
  allowedTypes: string[] = ["image/jpeg", "image/png", "image/webp", "image/gif"]
): { valid: boolean; error?: string } {
  if (!file) {
    return { valid: false, error: "No file provided" };
  }

  if (!allowedTypes.includes(file.type)) {
    return {
      valid: false,
      error: `Invalid file type: ${file.type}. Allowed: ${allowedTypes.join(", ")}`,
    };
  }

  if (file.size > maxSize) {
    return {
      valid: false,
      error: `File too large. Maximum: ${Math.round(maxSize / 1024 / 1024)}MB`,
    };
  }

  return { valid: true };
}

/**
 * Formats file size for display
 * @param bytes - File size in bytes
 * @returns Formatted string
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}
