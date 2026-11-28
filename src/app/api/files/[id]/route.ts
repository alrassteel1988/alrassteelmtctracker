import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { BUCKET } from "@/lib/supabase/admin";

/** Opens an original file through a short-lived signed link (access checked by row level security). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await supabaseServer();
  const { data: f } = await db.from("files").select("storage_path").eq("id", id).maybeSingle();
  if (!f) return new NextResponse("Not found", { status: 404 });
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(f.storage_path, 300);
  if (error || !data) return new NextResponse(error?.message ?? "Not found", { status: 404 });
  const page = req.nextUrl.searchParams.get("page");
  return NextResponse.redirect(data.signedUrl + (page ? `#page=${page}` : ""));
}
