import { NextResponse } from "next/server";
import { deviceFrom } from "@/lib/uploader";
import { BUCKET } from "@/lib/supabase/admin";

export async function GET(req: Request) {
  const r = await deviceFrom(req);
  if (r instanceof NextResponse) return r;
  const { device, db } = r;
  const id = new URL(req.url).searchParams.get("po") ?? "";
  const { data: po } = await db.from("purchase_orders").select("excel_path, company_code").eq("id", id).maybeSingle();
  if (!po?.excel_path || po.company_code !== device.company_code) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { data, error } = await db.storage.from(BUCKET).download(po.excel_path);
  if (error || !data) return NextResponse.json({ error: error?.message ?? "missing" }, { status: 404 });
  return new NextResponse(Buffer.from(await data.arrayBuffer()), {
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  });
}
