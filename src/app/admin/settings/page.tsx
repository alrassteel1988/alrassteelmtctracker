import { requireAdmin } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Shell } from "@/components/Shell";
import { getSettings } from "@/lib/po";
import { saveSettings, addGradeRule, deleteGradeRule, disableDevice } from "../actions";
import { DeviceForm } from "./DeviceForm";
import { ago } from "@/lib/stats";

export default async function Settings() {
  const user = await requireAdmin();
  const db = await supabaseServer();
  const s = await getSettings(db);
  const [{ data: grades }, { data: devices }] = await Promise.all([
    db.from("grade_rules").select("*").order("priority"),
    db.from("devices").select("*").order("company_code"),
  ]);
  return (
    <Shell user={user} active="settings">
      <div className="head"><div><h1>Settings and uploaders</h1><p className="mute">Rules for the ERP Excel and the store PC uploaders.</p></div></div>
      <form action={saveSettings} className="card">
        <h2>ERP Excel rules</h2>
        <div className="grid3">
          <label className="f">Certificate #
            <select name="cert_no_mode" defaultValue={s.certNoMode}>
              <option value="short">Short, ERP style (APL/QC/2026/4189 → 4189)</option>
              <option value="full">Full, as printed</option>
            </select>
          </label>
          <label className="f">Header MILL Name when a PO has several
            <select name="header_mill_rule" defaultValue={s.headerMillRule}><option value="first">First line&apos;s mill</option><option value="most">Mill with most lines</option></select>
          </label>
          <label className="f">Header Certificate Date when a PO has several
            <select name="header_date_rule" defaultValue={s.headerDateRule}><option value="latest">Latest date</option><option value="earliest">Earliest date</option><option value="first">First line&apos;s date</option></select>
          </label>
        </div>
        <div className="grid2">
          <label className="f">Default MTC inbox folder on store PCs<input name="inbox_folder" defaultValue={s.inboxFolder} /></label>
          <label className="f">Default Excel folder on store PCs<input name="excel_folder" defaultValue={s.excelFolder} /></label>
        </div>
        <p className="small mute">The full printed certificate number is always kept in the certificate library for search. Changes apply to POs read after saving.</p>
        <div><button className="btn p">Save settings</button></div>
      </form>

      <div className="card">
        <h2>Store PC uploaders</h2>
        <table>
          <thead><tr><th>PC</th><th>Company</th><th>Inbox</th><th>Excel folder</th><th>Last sync</th><th /></tr></thead>
          <tbody>
            {(devices ?? []).map((d) => (
              <tr key={d.id}>
                <td>{d.name}</td><td>{d.company_code}</td><td className="mono small">{d.inbox_folder}</td><td className="mono small">{d.excel_folder}</td>
                <td>{d.active ? ago(d.last_seen_at) : <span className="badge">Disabled</span>}</td>
                <td>{d.active && <form action={disableDevice.bind(null, d.id)}><button className="btn sm d">Disable</button></form>}</td>
              </tr>
            ))}
            {!devices?.length && <tr><td colSpan={6} className="mute">None yet.</td></tr>}
          </tbody>
        </table>
        <DeviceForm />
        <p className="small">Download the uploader: <a href="/downloads/MTC-Uploader.zip">MTC-Uploader.zip</a> (Windows, PowerShell, starts with Windows).</p>
      </div>

      <div className="card">
        <h2>Grade rules</h2>
        <table>
          <thead><tr><th>Priority</th><th>Pattern (case-insensitive)</th><th>ERP grade</th><th /></tr></thead>
          <tbody>
            {(grades ?? []).map((g) => (
              <tr key={g.id}><td>{g.priority}</td><td className="mono small">{g.pattern}</td><td>{g.erp_grade}</td>
                <td><form action={deleteGradeRule.bind(null, g.id)}><button className="copy">Delete</button></form></td></tr>
            ))}
          </tbody>
        </table>
        <form action={addGradeRule} className="row">
          <input name="priority" type="number" defaultValue={50} style={{ width: 90 }} />
          <input name="pattern" placeholder="Regex, e.g. A\s*106.*GR(ADE)?[\s.\-]*B" required style={{ flex: 2 }} />
          <input name="erp_grade" placeholder="ASTM A106 GR.B" required style={{ flex: 1 }} />
          <button className="btn sm">Add rule</button>
        </form>
      </div>
    </Shell>
  );
}
