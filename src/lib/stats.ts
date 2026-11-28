import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function companyStats(db: SupabaseClient, co: string) {
  const { data } = await db.from("purchase_orders").select("status").eq("company_code", co);
  const by: Record<string, number> = {};
  (data ?? []).forEach((r) => (by[r.status] = (by[r.status] ?? 0) + 1));
  const { count: needsPo } = await db.from("files").select("id", { count: "exact", head: true }).eq("company_code", co).eq("status", "needs_po");
  const { data: devices } = await db.from("devices").select("name, last_seen_at, active").eq("company_code", co).eq("active", true);
  return { by, total: data?.length ?? 0, needsPo: needsPo ?? 0, devices: devices ?? [] };
}

export function ago(iso: string | null) {
  if (!iso) return "never";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 2) return "just now";
  if (m < 60) return `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hours ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function dubai(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Dubai", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
