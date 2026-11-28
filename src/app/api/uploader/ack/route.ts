import { NextResponse } from "next/server";
import { deviceFrom } from "@/lib/uploader";

export async function POST(req: Request) {
  const r = await deviceFrom(req);
  if (r instanceof NextResponse) return r;
  const { device, db } = r;
  const b = await req.json().catch(() => null);
  const { data: batch } = await db.from("erp_batches").select("id, po_id, purchase_orders(company_code)").eq("id", b?.batch_id ?? "").maybeSingle();
  const co = (batch?.purchase_orders as unknown as { company_code: string } | null)?.company_code;
  if (!batch || co !== device.company_code) return NextResponse.json({ error: "not found" }, { status: 404 });
  await db.from("batch_deliveries").upsert({ batch_id: batch.id, device_id: device.id, excel_version: Number(b.version) });
  await db.from("audit_log").insert({ company_code: co, po_id: batch.po_id, actor: `uploader:${device.name}`, action: "excel.saved_to_pc", detail: { path: b.saved_path ?? null } });
  return NextResponse.json({ ok: true });
}
