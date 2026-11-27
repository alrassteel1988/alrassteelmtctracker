import { NextResponse } from "next/server";
import { deviceFrom } from "@/lib/uploader";

export async function POST(req: Request) {
  const r = await deviceFrom(req);
  if (r instanceof NextResponse) return r;
  const { device, db } = r;
  const b = await req.json().catch(() => null);
  const { data: po } = await db.from("purchase_orders").select("id, company_code").eq("id", b?.po_id ?? "").maybeSingle();
  if (!po || po.company_code !== device.company_code) return NextResponse.json({ error: "not found" }, { status: 404 });
  await db.from("excel_deliveries").upsert({ po_id: po.id, device_id: device.id, excel_version: Number(b.version) });
  await db.from("audit_log").insert({ company_code: po.company_code, po_id: po.id, actor: `uploader:${device.name}`, action: "excel.saved_to_pc", detail: { path: b.saved_path ?? null } });
  return NextResponse.json({ ok: true });
}
