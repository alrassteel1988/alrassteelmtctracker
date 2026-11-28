import Link from "next/link";
import { requireCompany, COMPANIES } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Shell } from "@/components/Shell";
import { OverviewBoard } from "@/components/OverviewBoard";

export default async function Overview({ params, searchParams }: { params: Promise<{ co: string }>; searchParams: Promise<{ type?: string; status?: string }> }) {
  const { user, co } = await requireCompany((await params).co);
  const sp = await searchParams;
  const db = await supabaseServer();
  return (
    <Shell user={user} co={co} active="overview">
      <div className="head">
        <div><h1>{co} overview</h1><p className="mute">{COMPANIES[co].name}: purchase orders and their MTC status.</p></div>
        <Link className="btn p" href={`/c/${co}/intake`}>New MTC intake</Link>
      </div>
      <OverviewBoard db={db} companies={[co]} type={sp.type} status={sp.status} />
    </Shell>
  );
}
