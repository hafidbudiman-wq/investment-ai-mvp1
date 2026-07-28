import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === "/api/pdf-extractions" && request.method === "POST") {
    const target = request.nextUrl.clone();
    target.pathname = "/api/pdf-extraction-jobs";
    return NextResponse.rewrite(target);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/pdf-extractions"],
};
