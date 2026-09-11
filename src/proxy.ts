import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "dot_session";

/** Pages that must render for signed-out visitors. */
const PUBLIC_PREFIXES = ["/sign-in", "/sign-up", "/embed", "/docs"];

/**
 * Optimistic navigation gate.
 *
 * The cookie's presence is checked only to avoid rendering a protected shell
 * for an obviously signed-out visitor. Real verification happens in the Data
 * Access Layer (`src/server/auth/dal.ts`) on every request.
 *
 * Two things this deliberately does NOT do:
 *
 * 1. It never bounces a visitor away from the auth pages. A cookie can outlive
 *    its session row (revocation is a row delete), and redirecting on presence
 *    alone would trap such a browser in /sign-in ↔ / forever, with no way to
 *    recover because the cookie is HttpOnly. The auth pages redirect only after
 *    the DAL confirms a real session.
 * 2. It never redirects API requests. An API caller must get a JSON 401 from
 *    the route handler, not an HTML sign-in page, which a fetch client cannot
 *    parse.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api")) return NextResponse.next();

  const isPublic = PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (isPublic || pathname === "/") return NextResponse.next();

  if (!request.cookies.get(SESSION_COOKIE)?.value) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = "";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Skip static assets and Next internals.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|js|css|map|txt|woff2?)$).*)",
  ],
};
