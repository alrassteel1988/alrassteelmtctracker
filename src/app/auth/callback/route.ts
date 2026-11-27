import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";

/** Handles invite and password-reset links from Supabase emails. */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const next = url.searchParams.get("next") || "/";
  const code = url.searchParams.get("code");
  const token_hash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const s = await supabaseServer();
  let ok = false;
  if (code) ok = !(await s.auth.exchangeCodeForSession(code)).error;
  else if (token_hash && type) ok = !(await s.auth.verifyOtp({ token_hash, type })).error;
  const dest = url.clone();
  dest.search = "";
  dest.pathname = ok ? next : "/login";
  return NextResponse.redirect(dest);
}
