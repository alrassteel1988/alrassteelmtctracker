import "server-only";
import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "./supabase/admin";

export type Device = { id: string; company_code: string; name: string; inbox_folder: string | null; excel_folder: string | null };

/** Authenticates a store PC by its uploader key (Bearer token). Only the key's hash is stored. */
export async function deviceFrom(req: Request): Promise<{ device: Device; db: ReturnType<typeof supabaseAdmin> } | NextResponse> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return NextResponse.json({ error: "missing key" }, { status: 401 });
  const db = supabaseAdmin();
  const { data } = await db
    .from("devices")
    .select("id, company_code, name, inbox_folder, excel_folder")
    .eq("token_hash", createHash("sha256").update(token).digest("hex"))
    .eq("active", true)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: "unknown or disabled key" }, { status: 401 });
  await db.from("devices").update({ last_seen_at: new Date().toISOString() }).eq("id", data.id);
  return { device: data, db };
}

export const safeName = (n: string) => n.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-120);
