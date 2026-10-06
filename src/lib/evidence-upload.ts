/**
 * Evidence Upload Utilities
 * Client-side utilities for uploading service update evidence to R2
 */

/**
 * Get presigned URL for evidence upload
 * @param serviceId - Service ID
 * @param token - Public access token
 * @param filename - Name of the file to upload
 * @returns Presigned URL and metadata
 */
export async function getEvidencePresignedUrl(
  serviceId: string,
  token: string,
  filename: string
): Promise<{ presignedUrl: string; key: string; expiresInSeconds: number }> {
  const searchParams = new URLSearchParams({
    serviceId,
    token,
  });

  const response = await fetch(`/api/public/service/upload-evidence?${searchParams}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to get presigned URL");
  }

  return response.json();
}

/**
 * Upload evidence file directly to R2 using presigned URL
 * @param presignedUrl - Presigned PUT URL from the API
 * @param file - File to upload
 * @param onProgress - Optional progress callback
 * @returns Response from R2
 */
export async function uploadEvidenceViaPresigned(
  presignedUrl: string,
  file: File,
  onProgress?: (progress: number) => void
): Promise<{ success: boolean; key: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    // Track progress
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && onProgress) {
        const percentComplete = Math.round((event.loaded / event.total) * 100);
        onProgress(percentComplete);
      }
    });

    // Handle completion
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({
          success: true,
          key: xhr.getResponseHeader("x-amz-object-key") || "",
        });
      } else {
        reject(new Error(`Upload failed: ${xhr.statusText}`));
      }
    });

    // Handle errors
    xhr.addEventListener("error", () => {
      reject(new Error("Upload failed"));
    });

    xhr.addEventListener("abort", () => {
      reject(new Error("Upload cancelled"));
    });

    // Send the file
    xhr.open("PUT", presignedUrl);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.send(file);
  });
}

/**
 * Two-step evidence upload process
 * 1. Get presigned URL from server
 * 2. Upload file directly to R2
 */
export async function uploadEvidence(
  serviceId: string,
  token: string,
  file: File,
  onProgress?: (progress: number) => void
): Promise<{ success: boolean; key: string; url: string }> {
  // Step 1: Get presigned URL
  const { presignedUrl, key } = await getEvidencePresignedUrl(serviceId, token, file.name);

  // Step 2: Upload via presigned URL
  await uploadEvidenceViaPresigned(presignedUrl, file, onProgress);

  // Return success with the public URL
  const publicDomain = process.env.NEXT_PUBLIC_R2_PUBLIC_DOMAIN || "images.inspecoes.com.br";
  const url = `https://${publicDomain}/${key}`;

  return { success: true, key, url };
}

/**
 * Validate evidence file
 */
export function validateEvidenceFile(
  file: File
): { valid: boolean; error?: string } {
  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  const maxSize = 10 * 1024 * 1024; // 10MB

  if (!file) {
    return { valid: false, error: "Nenhum arquivo selecionado" };
  }

  if (!allowedTypes.includes(file.type)) {
    return {
      valid: false,
      error: "Apenas imagens JPEG, PNG, WebP ou GIF são permitidas",
    };
  }

  if (file.size > maxSize) {
    return {
      valid: false,
      error: "A imagem deve ter até 10MB",
    };
  }

  return { valid: true };
}
