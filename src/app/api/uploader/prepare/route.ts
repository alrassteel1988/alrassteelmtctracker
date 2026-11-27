import { NextResponse } from "next/server";
import { deviceFrom, safeName } from "@/lib/uploader";
import { BUCKET } from "@/lib/supabase/admin";

/** Step 1: the PC sends name + hash. Duplicates are skipped; otherwise it gets a one-time upload link. */
export async function POST(req: Request) {
  const r = await deviceFrom(req);
  if (r instanceof NextResponse) return r;
  const { device, db } = r;
  const body = await req.json().catch(() => null);
  const name = String(body?.name ?? "");
  const sha = String(body?.sha256 ?? "").toLowerCase();
  if (!name || !/^[a-f0-9]{64}$/.test(sha)) return NextResponse.json({ error: "name and sha256 required" }, { status: 400 });
  if (!/\.(pdf|png|jpe?g|webp|gif)$/i.test(name)) return NextResponse.json({ skip: true, reason: "not a PDF or image" });
  const { data: dup } = await db.from("files").select("original_name").eq("company_code", device.company_code).eq("sha256", sha).maybeSingle();
  if (dup) return NextResponse.json({ skip: true, reason: `duplicate of ${dup.original_name}` });
  const path = `${device.company_code}/inbox/${sha.slice(0, 16)}-${safeName(name)}`;
  const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true });
  if (error || !data) return NextResponse.json({ error: error?.message ?? "could not create upload link" }, { status: 500 });
  return NextResponse.json({ skip: false, path, upload_url: data.signedUrl });
}
