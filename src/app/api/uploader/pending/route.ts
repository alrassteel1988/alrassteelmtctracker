import { NextResponse } from "next/server";
import { deviceFrom } from "@/lib/uploader";
import { batchFileName } from "@/lib/po";

/** Approved Excel files (one per ERP batch) this PC has not saved yet, latest version of each. */
export async function GET(req: Request) {
  const r = await deviceFrom(req);
  if (r instanceof NextResponse) return r;
  const { device, db } = r;
  const since = new Date(Date.now() - 45 * 86400e3).toISOString();
  const { data: batches } = await db
    .from("erp_batches")
    .select("id, batch_no, excel_version, excel_path, purchase_orders!inner(id, pur_no, company_code)")
    .eq("purchase_orders.company_code", device.company_code)
    .not("excel_path", "is", null)
    .gte("approved_at", since);
  const { data: done } = await db.from("batch_deliveries").select("batch_id, excel_version").eq("device_id", device.id);
  const have = new Set((done ?? []).map((d) => `${d.batch_id}:${d.excel_version}`));
  const items = (batches ?? [])
    .filter((b) => !have.has(`${b.id}:${b.excel_version}`))
    .map((b) => {
      const po = b.purchase_orders as unknown as { id: string; pur_no: string };
      return { batch_id: b.id, po_id: po.id, pur_no: po.pur_no, version: b.excel_version, file_name: batchFileName(po.pur_no, b.batch_no) };
    });
  return NextResponse.json({ items });
}
