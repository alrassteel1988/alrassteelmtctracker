import "server-only";
import { redirect, notFound } from "next/navigation";
import { supabaseServer } from "./supabase/server";

export type Company = "ARST" | "ARBM";
export const COMPANIES: Record<Company, { name: string; location: string }> = {
  ARST: { name: "Al Ras Steel Trading FZCO", location: "Free Zone | JAFZA South" },
  ARBM: { name: "Al Ras Building Material", location: "Mainland | Umm Al Quwain" },
};

export type AppUser = {
  email: string;
  name: string;
  role: "admin" | "store";
  company: Company | null;
  companies: Company[];
};

/** The signed-in person, from Supabase Auth + the app_users allow-list. Redirects to /login if missing. */
export async function requireUser(): Promise<AppUser> {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user?.email) redirect("/login");
  const email = data.user.email.toLowerCase();
  const { data: row } = await supabase
    .from("app_users")
    .select("email, full_name, role, company_code, active")
    .eq("email", email)
    .maybeSingle();
  if (!row || !row.active) redirect("/login?error=no-access");
  const companies: Company[] = row.role === "admin" ? ["ARST", "ARBM"] : [row.company_code as Company];
  return { email, name: row.full_name, role: row.role, company: row.company_code, companies };
}

export async function requireAdmin() {
  const u = await requireUser();
  if (u.role !== "admin") redirect("/");
  return u;
}

/** Checks the URL company is one this person may see. */
export async function requireCompany(co: string) {
  const user = await requireUser();
  const code = co.toUpperCase() as Company;
  if (!(code in COMPANIES)) notFound();
  if (!user.companies.includes(code)) redirect(`/c/${user.companies[0]}`);
  return { user, co: code };
}

export function homeFor(u: AppUser) {
  return u.role === "admin" ? "/group" : `/c/${u.company}`;
}
