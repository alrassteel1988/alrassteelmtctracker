import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Shell, StatusBadge } from "@/components/Shell";
import { companyStats, ago, dubai } from "@/lib/stats";

export default async function Overview({ params }: { params: Promise<{ co: string }> }) {
  const { user, co } = await requireCompany((await params).co);
  const db = await supabaseServer();
  const s = await companyStats(db, co);
  const { data: recent } = await db
    .from("purchase_orders")
    .select("id, pur_no, supplier_name, status, status_note, updated_at")
    .eq("company_code", co)
    .in("status", ["review", "blocked", "approved", "draft"])
    .order("updated_at", { ascending: false })
    .limit(10);
  return (
    <Shell user={user} co={co} active="overview">
      <div className="head">
        <div><h1>{co} overview</h1><p className="mute">What needs your attention today.</p></div>
        <Link className="btn p" href={`/c/${co}/intake`}>New MTC intake</Link>
      </div>
      <div className="grid4">
        <Link className={`stat ${s.by.review ? "warn" : ""}`} href={`/c/${co}/shipments?status=review`}><span className="mute small">Ready to review</span><b>{s.by.review ?? 0}</b></Link>
        <Link className={`stat ${s.by.blocked ? "warn" : ""}`} href={`/c/${co}/shipments?status=blocked`}><span className="mute small">Blocked</span><b>{s.by.blocked ?? 0}</b></Link>
        <Link className={`stat ${s.by.approved ? "warn" : ""}`} href={`/c/${co}/shipments?status=approved`}><span className="mute small">Excel ready, ERP MTC No. to type</span><b>{s.by.approved ?? 0}</b></Link>
        <Link className={`stat ${s.needsPo ? "warn" : ""}`} href={`/c/${co}/intake`}><span className="mute small">Files without a PUR#</span><b>{s.needsPo}</b></Link>
      </div>
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>Needs attention</h2>
          <span className="small mute">
            Uploader: {s.devices.length ? s.devices.map((d) => `${d.name}, last sync ${ago(d.last_seen_at)}`).join(" · ") : "not set up yet"}
          </span>
        </div>
        <div className="scroll">
          <table>
            <thead><tr><th>PUR#</th><th>Supplier</th><th>Status</th><th>Note</th><th>Updated</th><th /></tr></thead>
            <tbody>
              {(recent ?? []).map((p) => (
                <tr key={p.id}>
                  <td className="mono">{p.pur_no}</td>
                  <td>{p.supplier_name ?? <span className="mute">Not read yet</span>}</td>
                  <td><StatusBadge s={p.status} /></td>
                  <td className="small">{p.status_note}</td>
                  <td className="small nowrap">{dubai(p.updated_at)}</td>
                  <td><Link className="btn sm" href={`/c/${co}/po/${p.pur_no}`}>Open</Link></td>
                </tr>
              ))}
              {!recent?.length && <tr><td colSpan={6} className="mute">Nothing waiting. New files from the store PC appear here.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}
