import { requireCompany } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Shell } from "@/components/Shell";
import { addMillAlias } from "../actions";
import { ImportSuppliers } from "@/components/ImportSuppliers";

export default async function Masters({ params }: { params: Promise<{ co: string }> }) {
  const { user, co } = await requireCompany((await params).co);
  const db = await supabaseServer();
  const [{ data: mills }, { data: grades }, { data: suppliers, error: supErr }] = await Promise.all([
    db.from("mill_aliases").select("*").order("erp_name"),
    db.from("grade_rules").select("*").order("priority"),
    db.from("suppliers").select("id, code, name").eq("company_code", co).order("name"),
  ]);
  return (
    <Shell user={user} co={co} active="masters">
      <div className="head"><div><h1>Master data</h1><p className="mute">How printed mill names and grades are turned into the names the ERP uses.</p></div></div>
      <div className="card">
        <div className="head">
          <div><h2>Suppliers ({co})</h2><p className="small mute">Used to fill the supplier code on purchase orders that only carry the supplier name.</p></div>
          <ImportSuppliers co={co} />
        </div>
        {supErr ? (
          <div className="note err">The supplier list is not set up yet. An admin needs to run supabase/migrations/0004_suppliers.sql in the Supabase SQL editor.</div>
        ) : (
          <div className="scroll" style={{ maxHeight: 420 }}>
            <table><thead><tr><th>Supplier code</th><th>Supplier</th></tr></thead>
              <tbody>
                {(suppliers ?? []).map((s) => <tr key={s.id}><td className="mono">{s.code}</td><td>{s.name}</td></tr>)}
                {!suppliers?.length && <tr><td colSpan={2} className="mute">No suppliers yet. Import the list from the ERP.</td></tr>}
              </tbody></table>
          </div>
        )}
        <p className="small mute">{suppliers?.length ?? 0} suppliers.</p>
      </div>
      <div className="grid2">
        <div className="card">
          <h2>Mill names</h2>
          <table><thead><tr><th>Printed on certificate</th><th>ERP MILL Name</th></tr></thead>
            <tbody>{(mills ?? []).map((m) => <tr key={m.id}><td>{m.printed}</td><td className="mono">{m.erp_name}</td></tr>)}</tbody></table>
          <form action={addMillAlias.bind(null, co)} className="grid2">
            <input name="printed" placeholder="As printed, e.g. A P L APOLLO TUBES COMPANY LLC" required />
            <input name="erp_name" placeholder="ERP name, e.g. A P L APOLLO TUBES COMPANY L L C" required />
            <button className="btn sm">Add or update mill</button>
          </form>
        </div>
        <div className="card">
          <h2>Grade rules</h2>
          <p className="small mute">The first matching pattern wins. Admins can change these under Settings.</p>
          <table><thead><tr><th>Pattern</th><th>ERP grade</th></tr></thead>
            <tbody>{(grades ?? []).map((g) => <tr key={g.id}><td className="mono small">{g.pattern}</td><td>{g.erp_grade}</td></tr>)}</tbody></table>
        </div>
      </div>
    </Shell>
  );
}
