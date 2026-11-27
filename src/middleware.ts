import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = ["/login", "/auth", "/api/uploader", "/downloads"];

export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const missing = [!url && "NEXT_PUBLIC_SUPABASE_URL", !key && "NEXT_PUBLIC_SUPABASE_ANON_KEY"].filter(Boolean);
  if (missing.length) {
    // Explain the setup problem instead of failing with a bare 500
    return new NextResponse(
      `MTC Tracker setup: ${missing.join(" and ")} not set for this deployment. Add them in Vercel > Settings > Environment Variables (all environments), then redeploy.`,
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    url!,
    key!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );
  let user = null;
  try {
    user = (await supabase.auth.getUser()).data.user;
  } catch (e) {
    console.error("middleware getUser failed", e);
  }
  const path = request.nextUrl.pathname;
  if (!user && !PUBLIC.some((p) => path.startsWith(p))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico)$).*)"],
};
