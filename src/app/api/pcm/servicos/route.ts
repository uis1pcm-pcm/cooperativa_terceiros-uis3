import { NextResponse, type NextRequest } from "next/server";

import { listServicesPCM } from "@/lib/data";
import type { PCMListResponse, PCMServiceListItem } from "@/types/pcm";

function parseLimit(param: string | null, fallback: number): number {
  if (!param) return fallback;
  const parsed = Number(param);
  if (!Number.isFinite(parsed)) return fallback;
  const safe = Math.max(1, Math.min(Math.floor(parsed), 50));
  return safe;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const searchParams = url.searchParams;
  const limit = parseLimit(searchParams.get("limit"), 15);
  const cursor = searchParams.get("cursor");
  const status = searchParams.get("status");
  const empresa = searchParams.get("empresa");
  const search = searchParams.get("q") ?? searchParams.get("search");

  const result = await listServicesPCM({
    limit,
    cursor: cursor ? cursor : null,
    status: status ? status : undefined,
    empresa: empresa ? empresa : undefined,
    search: search ? search : undefined,
  });

  return NextResponse.json(result as PCMListResponse<PCMServiceListItem>);
}
