import { NextResponse } from "next/server";
import { deviceFrom } from "@/lib/uploader";
import { BUCKET } from "@/lib/supabase/admin";

export async function GET(req: Request) {
  const r = await deviceFrom(req);
  if (r instanceof NextResponse) return r;
  const { device, db } = r;
  const id = new URL(req.url).searchParams.get("batch") ?? "";
  const { data: b } = await db.from("erp_batches").select("excel_path, purchase_orders(company_code)").eq("id", id).maybeSingle();
  const co = (b?.purchase_orders as unknown as { company_code: string } | null)?.company_code;
  if (!b?.excel_path || co !== device.company_code) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { data, error } = await db.storage.from(BUCKET).download(b.excel_path);
  if (error || !data) return NextResponse.json({ error: error?.message ?? "missing" }, { status: 404 });
  return new NextResponse(Buffer.from(await data.arrayBuffer()), {
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  });
}
