import { NextResponse } from "next/server";
import { deviceFrom } from "@/lib/uploader";
import { registerFile } from "@/lib/po";

/** Step 2: after uploading, the PC confirms. The file is linked to its PO from the PUR# in the file name. */
export async function POST(req: Request) {
  const r = await deviceFrom(req);
  if (r instanceof NextResponse) return r;
  const { device, db } = r;
  const b = await req.json().catch(() => null);
  if (!b?.path || !String(b.path).startsWith(`${device.company_code}/inbox/`)) return NextResponse.json({ error: "bad path" }, { status: 400 });
  const name = String(b.name);
  const mime = /\.pdf$/i.test(name) ? "application/pdf" : /\.png$/i.test(name) ? "image/png" : /\.webp$/i.test(name) ? "image/webp" : /\.gif$/i.test(name) ? "image/gif" : "image/jpeg";
  try {
    const res = await registerFile(db, {
      company: device.company_code, path: b.path, name, sha256: String(b.sha256).toLowerCase(), size: Number(b.size ?? 0), mime,
      source: "uploader", deviceId: device.id, actor: `uploader:${device.name}`,
    });
    return NextResponse.json({ ok: true, pur: res.pur, kind: res.kind, duplicate: res.duplicate });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
