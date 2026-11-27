"use server";
import { randomBytes, createHash } from "crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireAdmin } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { audit } from "@/lib/po";

export async function saveUser(form: FormData) {
  await requireAdmin();
  const db = await supabaseServer();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const role = form.get("role") === "admin" ? "admin" : "store";
  const company = role === "admin" ? null : String(form.get("company_code") ?? "") || null;
  if (!email || (role === "store" && !company)) return;
  await db.from("app_users").upsert({
    email, full_name: String(form.get("full_name") ?? "").trim() || email, role, company_code: company, active: form.get("active") !== "off",
  });
  await audit(db, company, null, "user.saved", { email, role, company });
  revalidatePath("/admin/users");
}

export async function setActive(email: string, active: boolean) {
  await requireAdmin();
  const db = await supabaseServer();
  await db.from("app_users").update({ active }).eq("email", email);
  await audit(db, null, null, active ? "user.enabled" : "user.disabled", { email });
  revalidatePath("/admin/users");
}

/** Sends a Supabase invite email; the link lands on /auth/set-password. */
export async function invite(email: string): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();
  const h = await headers();
  const origin = process.env.NEXT_PUBLIC_SITE_URL || `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const { error } = await supabaseAdmin().auth.admin.inviteUserByEmail(email, { redirectTo: `${origin}/auth/callback?next=/auth/set-password` });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: `Invite sent to ${email}.` };
}

export async function saveSettings(form: FormData) {
  await requireAdmin();
  const db = await supabaseServer();
  const keys = ["cert_no_mode", "header_mill_rule", "header_date_rule", "excel_folder", "inbox_folder"];
  for (const k of keys) {
    const v = form.get(k);
    if (v !== null) await db.from("settings").upsert({ key: k, value: String(v), updated_at: new Date().toISOString() });
  }
  await audit(db, null, null, "settings.saved", Object.fromEntries(keys.map((k) => [k, form.get(k)])));
  revalidatePath("/admin/settings");
}

export async function addGradeRule(form: FormData) {
  await requireAdmin();
  const db = await supabaseServer();
  const pattern = String(form.get("pattern") ?? "").trim();
  const erp = String(form.get("erp_grade") ?? "").trim().toUpperCase();
  try { new RegExp(pattern, "i"); } catch { return; }
  if (pattern && erp) await db.from("grade_rules").upsert({ pattern, erp_grade: erp, priority: Number(form.get("priority") ?? 50) }, { onConflict: "pattern" });
  revalidatePath("/admin/settings");
}

export async function deleteGradeRule(id: string) {
  await requireAdmin();
  const db = await supabaseServer();
  await db.from("grade_rules").delete().eq("id", id);
  revalidatePath("/admin/settings");
}

/** Creates an uploader key for a store PC. The key is shown once; only its hash is stored. */
export async function createDevice(_: unknown, form: FormData): Promise<{ token?: string; name?: string; error?: string }> {
  await requireAdmin();
  const db = await supabaseServer();
  const company = String(form.get("company_code") ?? "");
  const name = String(form.get("name") ?? "").trim();
  if (!["ARST", "ARBM"].includes(company) || !name) return { error: "Choose a company and a PC name." };
  const token = `mtc_${company.toLowerCase()}_${randomBytes(24).toString("hex")}`;
  const { error } = await db.from("devices").insert({
    company_code: company, name, token_hash: createHash("sha256").update(token).digest("hex"),
    inbox_folder: String(form.get("inbox_folder") ?? "") || `D:\\MTC Inbox\\${company}`,
    excel_folder: String(form.get("excel_folder") ?? "") || `D:\\MTC Excel\\${company}`,
  });
  if (error) return { error: error.message };
  await audit(db, company, null, "device.created", { name });
  revalidatePath("/admin/settings");
  return { token, name };
}

export async function disableDevice(id: string) {
  await requireAdmin();
  const db = await supabaseServer();
  await db.from("devices").update({ active: false }).eq("id", id);
  revalidatePath("/admin/settings");
}
