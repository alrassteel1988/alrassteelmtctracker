import { requireAdmin } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Shell } from "@/components/Shell";
import { OverviewBoard } from "@/components/OverviewBoard";
import { companyStats, ago } from "@/lib/stats";

export default async function Group({ searchParams }: { searchParams: Promise<{ type?: string; status?: string }> }) {
  const user = await requireAdmin();
  const sp = await searchParams;
  const db = await supabaseServer();
  const stats = await Promise.all((["ARST", "ARBM"] as const).map(async (c) => ({ c, s: await companyStats(db, c) })));
  const stale = stats.flatMap(({ s }) => s.devices.filter((d) => !d.last_seen_at || Date.now() - new Date(d.last_seen_at).getTime() > 24 * 3600e3));
  return (
    <Shell user={user} active="group">
      <div className="head"><div><h1>Group overview</h1><p className="mute">ARST and ARBM purchase orders and their MTC status.</p></div></div>
      {stale.length > 0 && <div className="note err"><b>Uploader not synced for 24 hours</b>{stale.map((d) => `${d.name} (last sync ${ago(d.last_seen_at)})`).join(", ")}: check the store PC is on and online.</div>}
      <OverviewBoard db={db} companies={["ARST", "ARBM"]} type={sp.type} status={sp.status} />
    </Shell>
  );
}
