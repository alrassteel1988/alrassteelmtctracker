import { NextResponse } from "next/server";
import { deviceFrom } from "@/lib/uploader";
import { excelFileName } from "@/lib/excel";

/** Approved Excel files this PC has not saved yet (latest version of each). */
export async function GET(req: Request) {
  const r = await deviceFrom(req);
  if (r instanceof NextResponse) return r;
  const { device, db } = r;
  const since = new Date(Date.now() - 45 * 86400e3).toISOString();
  const { data: pos } = await db
    .from("purchase_orders")
    .select("id, pur_no, excel_version, excel_path")
    .eq("company_code", device.company_code)
    .in("status", ["approved", "erp_done"])
    .not("excel_path", "is", null)
    .gte("approved_at", since);
  const { data: done } = await db.from("excel_deliveries").select("po_id, excel_version").eq("device_id", device.id);
  const have = new Set((done ?? []).map((d) => `${d.po_id}:${d.excel_version}`));
  const items = (pos ?? [])
    .filter((p) => !have.has(`${p.id}:${p.excel_version}`))
    .map((p) => ({ po_id: p.id, pur_no: p.pur_no, version: p.excel_version, file_name: excelFileName(p.pur_no) }));
  return NextResponse.json({ items });
}
