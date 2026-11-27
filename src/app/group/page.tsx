import Link from "next/link";
import { requireAdmin, COMPANIES, type Company } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Shell } from "@/components/Shell";
import { companyStats, ago } from "@/lib/stats";

export default async function Group() {
  const user = await requireAdmin();
  const db = await supabaseServer();
  const cos: Company[] = ["ARST", "ARBM"];
  const stats = await Promise.all(cos.map((c) => companyStats(db, c)));
  return (
    <Shell user={user} active="group">
      <div className="head"><div><h1>Group overview</h1><p className="mute">Both companies at a glance. Open a workspace to work on its purchase orders.</p></div></div>
      <div className="grid2">
        {cos.map((c, i) => {
          const s = stats[i];
          const stale = s.devices.filter((d) => !d.last_seen_at || Date.now() - new Date(d.last_seen_at).getTime() > 24 * 3600e3);
          return (
            <div className="card" key={c}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div><h2>{c} · {COMPANIES[c].name}</h2><p className="mute small">{COMPANIES[c].location}</p></div>
                <Link className="btn p" href={`/c/${c}`}>Open workspace</Link>
              </div>
              <div className="grid3">
                <Link className={`stat ${s.by.review ? "warn" : ""}`} href={`/c/${c}/shipments?status=review`}><span className="mute small">To review</span><b>{s.by.review ?? 0}</b></Link>
                <Link className={`stat ${s.by.blocked ? "warn" : ""}`} href={`/c/${c}/shipments?status=blocked`}><span className="mute small">Blocked</span><b>{s.by.blocked ?? 0}</b></Link>
                <Link className="stat" href={`/c/${c}/shipments?status=approved`}><span className="mute small">Excel ready, ERP No. missing</span><b>{s.by.approved ?? 0}</b></Link>
              </div>
              <p className="small mute">
                {s.total} purchase orders · {s.needsPo} file(s) waiting for a PUR# ·{" "}
                {s.devices.length ? s.devices.map((d) => `${d.name} synced ${ago(d.last_seen_at)}`).join(", ") : "no uploader set up"}
              </p>
              {stale.length > 0 && <div className="note err"><b>Uploader not synced for 24 hours</b>{stale.map((d) => d.name).join(", ")}: check the store PC is on and online.</div>}
            </div>
          );
        })}
      </div>
    </Shell>
  );
}
