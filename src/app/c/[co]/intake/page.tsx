import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Shell } from "@/components/Shell";
import { UploadForm } from "@/components/UploadForm";
import { assignFile } from "../actions";
import { ago, dubai } from "@/lib/stats";

const FILE_STATUS: Record<string, [string, string]> = {
  new: ["New", "blue"], linked: ["Linked to PO", "green"], needs_po: ["Needs a PUR#", "amber"], read: ["Read", "green"], error: ["Error", "red"],
};

export default async function Intake({ params }: { params: Promise<{ co: string }> }) {
  const { user, co } = await requireCompany((await params).co);
  const db = await supabaseServer();
  const [{ data: files }, { data: devices }, { data: pos }] = await Promise.all([
    db.from("files").select("id, original_name, kind, pur_no_hint, status, source, created_at, devices(name)").eq("company_code", co).order("created_at", { ascending: false }).limit(40),
    db.from("devices").select("name, last_seen_at, inbox_folder").eq("company_code", co).eq("active", true),
    // POs already in the tracker, open ones first, for the PUR# pick list
    db.from("purchase_orders").select("pur_no, supplier_name, po_type, status, shipment_date").eq("company_code", co).neq("status", "erp_done").order("pur_no", { ascending: false }).limit(1000),
  ]);
  return (
    <Shell user={user} co={co} active="intake">
      <div className="head">
        <div>
          <h1>New MTC intake</h1>
          <p className="mute">Work is per purchase order: attach the PO copy and every MTC that covers it. The AI reads the PO lines, then fills certificate details for those lines only.</p>
        </div>
      </div>
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <h2>Picked up from the store PC</h2>
            <p className="small mute">
              {devices?.length
                ? devices.map((d) => <span key={d.name}><span className={`badge ${d.last_seen_at && Date.now() - new Date(d.last_seen_at).getTime() < 15 * 60e3 ? "green" : "amber"}`}>{d.name}</span> folder <span className="mono">{d.inbox_folder}</span> · last sync {ago(d.last_seen_at)} </span>)
                : "No uploader set up for this company yet. An admin can add one under Settings and uploaders."}
            </p>
          </div>
        </div>
        <div className="scroll">
          <table>
            <thead><tr><th>File</th><th>Read as</th><th>Source</th><th>Purchase order</th><th>Status</th><th>Received</th><th /></tr></thead>
            <tbody>
              {(files ?? []).map((f) => {
                const [t, c] = FILE_STATUS[f.status] ?? [f.status, ""];
                return (
                  <tr key={f.id}>
                    <td className="mono">{f.original_name}</td>
                    <td>{f.kind === "po" ? "PO copy" : "MTC"}</td>
                    <td className="small">{f.source === "uploader" ? (f.devices as unknown as { name: string } | null)?.name ?? "Uploader" : "Manual"}</td>
                    <td className="mono">{f.pur_no_hint ?? <span className="mute">No PO in file name</span>}</td>
                    <td><span className={`badge ${c}`}>{t}</span></td>
                    <td className="small nowrap">{dubai(f.created_at)}</td>
                    <td>
                      {f.status === "needs_po" ? (
                        <form action={assignFile.bind(null, co, f.id)} className="row" style={{ flexWrap: "nowrap" }}>
                          <input name="pur" placeholder="PUR#" required style={{ width: 120, minHeight: 32 }} />
                          <select name="kind" defaultValue={f.kind} style={{ width: 90, minHeight: 32 }}><option value="mtc">MTC</option><option value="po">PO</option></select>
                          <button className="btn sm">Assign</button>
                        </form>
                      ) : f.pur_no_hint ? (
                        <Link className="btn sm" href={`/c/${co}/po/${f.pur_no_hint}`}>Open</Link>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {!files?.length && <tr><td colSpan={7} className="mute">No files yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="small mute">Name files starting with the PUR#. A file with &quot;PO&quot; in its name is read as the purchase order; anything else as an MTC. Re-saved copies are skipped automatically.</p>
      </div>
      <UploadForm co={co} pos={pos ?? []} />
    </Shell>
  );
}
