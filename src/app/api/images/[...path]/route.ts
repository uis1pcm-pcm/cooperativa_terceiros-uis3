/**
 * Image Retrieval API Route
 * Handles: GET (retrieve image), HEAD (metadata)
 * Route: /api/images/[...path]
 */

import { NextRequest, NextResponse } from "next/server";
import { getImage, getImageMetadata, handleR2Error } from "@/lib/r2";
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
 * GET /api/images/[...path]
 * Retrieve and stream an image
 * Supports conditional requests (If-None-Match, If-Modified-Since)
 * Supports range requests for partial content
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const env = getEnv();
    const { path } = await params;

    if (!path || path.length === 0) {
      return NextResponse.json<ErrorResponse>(
        { error: "Missing image key", status: 400 },
        { status: 400 }
      );
    }

    const key = path.join("/");

    const result = await getImage(env, key, {
      "if-none-match": request.headers.get("if-none-match"),
      "if-modified-since": request.headers.get("if-modified-since"),
      range: request.headers.get("range"),
    });

    if (result === null) {
      return NextResponse.json<ErrorResponse>(
        { error: "Image not found", status: 404 },
        { status: 404 }
      );
    }

    // 304 Not Modified
    if (!result.object) {
      return new Response(null, { status: 304 });
    }

    return new Response(result.object.body, {
      status: 200,
      headers: result.headers,
    });
  } catch (error: any) {
    console.error("Get image error:", error);
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
 * HEAD /api/images/[...path]
 * Retrieve image metadata without downloading the full object
 */
export async function HEAD(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const env = getEnv();
    const { path } = await params;

    if (!path || path.length === 0) {
      return new Response(null, { status: 400 });
    }

    const key = path.join("/");
    const metadata = await getImageMetadata(env, key);

    if (metadata === null) {
      return new Response(null, { status: 404 });
    }

    const headers = new Headers();
    if (metadata.httpMetadata?.contentType) {
      headers.set("content-type", metadata.httpMetadata.contentType);
    }
    headers.set("content-length", metadata.size.toString());
    headers.set("etag", metadata.etag);
    headers.set("last-modified", new Date(metadata.uploaded).toUTCString());

    return new Response(null, { status: 200, headers });
  } catch (error: any) {
    console.error("Head image error:", error);
    return new Response(null, { status: 500 });
  }
}
