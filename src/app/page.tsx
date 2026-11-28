import { redirect } from "next/navigation";
import { requireUser, homeFor } from "@/lib/auth";

export default async function Home() {
  const u = await requireUser();
  redirect(homeFor(u));
}
