/**
 * Image Management API Routes
 * Handles: POST (upload), GET (list), DELETE (delete)
 */

import { NextRequest, NextResponse } from "next/server";
import {
  uploadImage,
  listImages,
  deleteImage,
  deleteImages,
  buildImageKey,
  parseInspectionIdFromKey,
  handleR2Error,
  isAllowedImageType,
} from "@/lib/r2";
import { IMAGE_UPLOAD_CONSTRAINTS } from "@/types/r2";
import type { R2Env, ErrorResponse } from "@/types/r2";

// Get environment variables
function getEnv(): R2Env {
  return {
    R2_BUCKET: process.env.R2_BUCKET as any,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID!,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY!,
    CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID!,
    R2_BUCKET_NAME: process.env.R2_BUCKET_NAME!,
    PUBLIC_DOMAIN: process.env.PUBLIC_DOMAIN!,
    PRESIGNED_URL_EXPIRY: process.env.PRESIGNED_URL_EXPIRY || "3600",
  };
}

/**
 * POST /api/images
 * Upload an image
 * Body: FormData with file, inspectionId, (optional) description
 */
export async function POST(request: NextRequest) {
  try {
    const env = getEnv();

    const formData = await request.formData();
    const file = formData.get("file") as File;
    const inspectionId = formData.get("inspectionId") as string;
    const description = (formData.get("description") as string) || "";
    const userId = (request.headers.get("x-user-id") as string) || "unknown";

    // Validation
    if (!file) {
      return NextResponse.json<ErrorResponse>(
        { error: "Missing file", status: 400 },
        { status: 400 }
      );
    }

    if (!inspectionId) {
      return NextResponse.json<ErrorResponse>(
        { error: "Missing inspectionId", status: 400 },
        { status: 400 }
      );
    }

    if (!isAllowedImageType(file.type)) {
      return NextResponse.json<ErrorResponse>(
        {
          error: `Invalid file type: ${file.type}. Allowed types: ${IMAGE_UPLOAD_CONSTRAINTS.allowedTypes.join(", ")}`,
          status: 400,
        },
        { status: 400 }
      );
    }

    if (file.size > IMAGE_UPLOAD_CONSTRAINTS.maxSize) {
      return NextResponse.json<ErrorResponse>(
        {
          error: `File too large. Maximum size: ${IMAGE_UPLOAD_CONSTRAINTS.maxSize / 1024 / 1024}MB`,
          status: 400,
        },
        { status: 400 }
      );
    }

    // Build key and upload
    const key = buildImageKey(inspectionId, file.name);

    const result = await uploadImage(env, key, file.stream(), {
      inspectionId,
      uploadedBy: userId,
      description,
      originalName: file.name,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error: any) {
    console.error("Upload error:", error);
    const { code, message } = handleR2Error(error);

    return NextResponse.json<ErrorResponse>(
      {
        error: message,
        status: 500,
        code,
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/images?inspectionId=123&cursor=...
 * List images for an inspection
 */
export async function GET(request: NextRequest) {
  try {
    const env = getEnv();
    const searchParams = request.nextUrl.searchParams;
    const inspectionId = searchParams.get("inspectionId");
    const cursor = searchParams.get("cursor") || undefined;

    if (!inspectionId) {
      return NextResponse.json<ErrorResponse>(
        { error: "Missing inspectionId", status: 400 },
        { status: 400 }
      );
    }

    const prefix = `inspections/${inspectionId}/`;
    const result = await listImages(env, prefix, { cursor });

    // Add public URLs to each image
    const images = result.images.map((img) => ({
      ...img,
      url: `https://${env.PUBLIC_DOMAIN}/${img.key}`,
    }));

    return NextResponse.json({ ...result, images });
  } catch (error: any) {
    console.error("List error:", error);
    const { code, message } = handleR2Error(error);

    return NextResponse.json<ErrorResponse>(
      {
        error: message,
        status: 500,
        code,
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/images
 * Delete one or more images
 * Body: JSON with key(s)
 * - { key: string } - delete single image
 * - { keys: string[] } - delete multiple images
 */
export async function DELETE(request: NextRequest) {
  try {
    const env = getEnv();
    const body = await request.json() as { key?: string; keys?: string[] };

    if (!body.key && !body.keys) {
      return NextResponse.json<ErrorResponse>(
        { error: "Missing key or keys", status: 400 },
        { status: 400 }
      );
    }

    if (body.key) {
      await deleteImage(env, body.key);
    } else if (body.keys && body.keys.length > 0) {
      await deleteImages(env, body.keys);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Delete error:", error);
    const { code, message } = handleR2Error(error);

    return NextResponse.json<ErrorResponse>(
      {
        error: message,
        status: 500,
        code,
      },
      { status: 500 }
    );
  }
}
