"use server";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

export async function signOut() {
  const s = await supabaseServer();
  await s.auth.signOut();
  redirect("/login");
}
