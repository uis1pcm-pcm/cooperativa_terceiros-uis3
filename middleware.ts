import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/terceiro")) {
    const token = req.cookies.get("access_token")?.value;
    if (!token) {
      const url = req.nextUrl.clone();
      url.pathname = "/acesso";
      url.search = ""; // limpa query
      return NextResponse.redirect(url);
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/terceiro/:path*"],
};
