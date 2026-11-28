import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { BUCKET } from "@/lib/supabase/admin";
import { batchFileName } from "@/lib/po";

/** Downloads one approved batch's ERP Excel (access checked by row level security). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await supabaseServer();
  const { data: b } = await db.from("erp_batches").select("batch_no, excel_path, purchase_orders(pur_no)").eq("id", id).maybeSingle();
  if (!b?.excel_path) return new NextResponse("Excel not created yet", { status: 404 });
  const { data, error } = await db.storage.from(BUCKET).download(b.excel_path);
  if (error || !data) return new NextResponse(error?.message ?? "Not found", { status: 404 });
  const pur = (b.purchase_orders as unknown as { pur_no: string }).pur_no;
  return new NextResponse(Buffer.from(await data.arrayBuffer()), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${batchFileName(pur, b.batch_no)}"`,
      "Cache-Control": "no-store",
    },
  });
}
