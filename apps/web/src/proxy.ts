import { NextResponse, type NextRequest } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { frameAncestors } from "@/lib/embed";
import { findMerchantById } from "@/lib/merchants";
import { findPayment } from "@/lib/payments";

/**
 * Clickjacking protection. No page may be framed by other sites, except an embedded checkout
 * (/pay/:id?embed=1), which only the merchant's allowed domains may frame. Browsers enforce
 * this through the frame-ancestors directive.
 */
export async function proxy(request: NextRequest) {
  const response = NextResponse.next();
  let ancestors = "'none'";

  const { pathname, searchParams } = request.nextUrl;
  const pay = /^\/pay\/([^/]+)$/.exec(pathname);
  if (pay?.[1] && searchParams.get("embed") === "1") {
    ancestors = "'self'";
    if (isDatabaseConfigured()) {
      try {
        const payment = await findPayment(decodeURIComponent(pay[1]));
        const merchant = payment ? await findMerchantById(payment.merchantId) : null;
        if (merchant) ancestors = frameAncestors(merchant);
      } catch (error) {
        console.warn("[proxy] Couldn't load embed settings:", error);
      }
    }
  }

  response.headers.set("Content-Security-Policy", `frame-ancestors ${ancestors}`);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return response;
}

export const config = {
  // Pages only: not API routes or static assets.
  matcher: ["/((?!api/|_next/static|_next/image|favicon.svg).*)"],
};
