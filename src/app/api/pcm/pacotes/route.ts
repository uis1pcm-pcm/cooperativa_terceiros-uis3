import { NextResponse, type NextRequest } from "next/server";

import { listPackagesPCM } from "@/lib/data";
import type { PCMPackageListItem, PCMListResponse } from "@/types/pcm";

function parseLimit(param: string | null, fallback: number): number {
  if (!param) return fallback;
  const parsed = Number(param);
  if (!Number.isFinite(parsed)) return fallback;
  const safe = Math.max(1, Math.min(Math.floor(parsed), 50));
  return safe;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"), 15);
  const cursor = url.searchParams.get("cursor");

  const result = await listPackagesPCM({
    limit,
    cursor: cursor ? cursor : null,
  });

  return NextResponse.json(result as PCMListResponse<PCMPackageListItem>);
}
