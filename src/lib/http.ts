import { NextRequest } from "next/server";

// Defense-in-depth CSRF check for state-changing routes.
//
// The AuthKit session cookie is SameSite=Lax, which already stops a cross-site
// page from driving an authenticated POST/PATCH/DELETE. As a second layer,
// when the browser sends an `Origin` header we require it to match the host we
// were actually reached on. A missing Origin (e.g. same-origin GET) is allowed;
// an unparseable one is treated as cross-origin.
export function isCrossOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== request.headers.get("host");
  } catch {
    return true;
  }
}
