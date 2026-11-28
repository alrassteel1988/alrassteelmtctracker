import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { BUCKET } from "@/lib/supabase/admin";
import { excelFileName } from "@/lib/excel";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await supabaseServer();
  const { data: po } = await db.from("purchase_orders").select("pur_no, excel_path").eq("id", id).maybeSingle();
  if (!po?.excel_path) return new NextResponse("Excel not created yet", { status: 404 });
  const { data, error } = await db.storage.from(BUCKET).download(po.excel_path);
  if (error || !data) return new NextResponse(error?.message ?? "Not found", { status: 404 });
  return new NextResponse(Buffer.from(await data.arrayBuffer()), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${excelFileName(po.pur_no)}"`,
      "Cache-Control": "no-store",
    },
  });
}
