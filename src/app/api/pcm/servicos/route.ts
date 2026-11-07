import { NextResponse, type NextRequest } from "next/server";

import { listServicesPCM } from "@/lib/data";
import { dateOnlyToMillis, parseDateOnly } from "@/lib/dateOnly";
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
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");

  if (Boolean(dateFrom) !== Boolean(dateTo)) {
    return NextResponse.json({ error: "Informe as datas inicial e final do período." }, { status: 400 });
  }
  if (dateFrom && dateTo) {
    const start = parseDateOnly(dateFrom);
    const end = parseDateOnly(dateTo);
    if (!start || !end || dateOnlyToMillis(start) > dateOnlyToMillis(end)) {
      return NextResponse.json({ error: "Período de datas inválido." }, { status: 400 });
    }
  }

  const result = await listServicesPCM({
    limit,
    cursor: cursor ? cursor : null,
    status: status ? status : undefined,
    empresa: empresa ? empresa : undefined,
    search: search ? search : undefined,
    dateFrom: dateFrom ? dateFrom : undefined,
    dateTo: dateTo ? dateTo : undefined,
  });

  return NextResponse.json(result as PCMListResponse<PCMServiceListItem>);
}
