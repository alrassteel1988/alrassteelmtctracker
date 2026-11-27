import { NextResponse } from "next/server";
import { deviceFrom } from "@/lib/uploader";

export async function GET(req: Request) {
  const r = await deviceFrom(req);
  if (r instanceof NextResponse) return r;
  const { device } = r;
  return NextResponse.json({ name: device.name, company: device.company_code, inbox_folder: device.inbox_folder, excel_folder: device.excel_folder });
}
