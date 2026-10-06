/**
 * Presigned URL Generation API Route
 * Generates S3-compatible presigned URLs for direct upload/download
 * Route: /api/images/presign
 */

import { NextRequest, NextResponse } from "next/server";
import { generatePresignedUrl, buildImageKey, handleR2Error } from "@/lib/r2";
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
 * GET /api/images/presign?operation=put&inspectionId=123&filename=photo.jpg&contentType=image/jpeg
 * Generate a presigned URL for direct upload/download via S3 API
 *
 * Query parameters:
 * - operation: "get" | "put" | "delete" (default: "get")
 * - key: (optional) Full image key. If not provided, key is built from inspectionId and filename
 * - inspectionId: (optional) Inspection ID for building the key
 * - filename: (optional) Filename for building the key
 * - contentType: (optional) For PUT operations, the content type to restrict the upload
 * - expirySeconds: (optional) URL expiry in seconds (1-604800, default: 3600)
 */
export async function GET(request: NextRequest) {
  try {
    const env = getEnv();
    const searchParams = request.nextUrl.searchParams;

    const operation = (searchParams.get("operation") || "get") as
      | "get"
      | "put"
      | "delete";
    let key = searchParams.get("key") || "";

    // If key is not provided, build it from inspectionId and filename
    if (!key) {
      const inspectionId = searchParams.get("inspectionId");
      const filename = searchParams.get("filename");

      if (!inspectionId || !filename) {
        return NextResponse.json<ErrorResponse>(
          {
            error: 'Must provide either "key" or both "inspectionId" and "filename"',
            status: 400,
          },
          { status: 400 }
        );
      }

      key = buildImageKey(inspectionId, filename);
    }

    const contentType = searchParams.get("contentType") || undefined;
    const expirySeconds = searchParams.get("expirySeconds")
      ? parseInt(searchParams.get("expirySeconds")!)
      : undefined;

    const result = await generatePresignedUrl(env, key, operation, {
      contentType,
      expirySeconds,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Presign error:", error);
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
 * POST /api/images/presign
 * Alternative endpoint using POST body for presigned URL generation
 * Useful for complex scenarios or to avoid URL length limits
 */
export async function POST(request: NextRequest) {
  try {
    const env = getEnv();
    const body = await request.json();

    const {
      operation = "get",
      key,
      inspectionId,
      filename,
      contentType,
      expirySeconds,
    } = body;

    let finalKey = key || "";

    if (!finalKey && (inspectionId || filename)) {
      if (!inspectionId || !filename) {
        return NextResponse.json<ErrorResponse>(
          {
            error: 'Must provide either "key" or both "inspectionId" and "filename"',
            status: 400,
          },
          { status: 400 }
        );
      }
      finalKey = buildImageKey(inspectionId, filename);
    }

    if (!finalKey) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Missing "key" parameter', status: 400 },
        { status: 400 }
      );
    }

    const result = await generatePresignedUrl(env, finalKey, operation, {
      contentType,
      expirySeconds,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Presign POST error:", error);
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
