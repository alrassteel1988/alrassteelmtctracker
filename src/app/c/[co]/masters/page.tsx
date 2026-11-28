import { requireCompany } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Shell } from "@/components/Shell";
import { addMillAlias } from "../actions";

export default async function Masters({ params }: { params: Promise<{ co: string }> }) {
  const { user, co } = await requireCompany((await params).co);
  const db = await supabaseServer();
  const [{ data: mills }, { data: grades }] = await Promise.all([
    db.from("mill_aliases").select("*").order("erp_name"),
    db.from("grade_rules").select("*").order("priority"),
  ]);
  return (
    <Shell user={user} co={co} active="masters">
      <div className="head"><div><h1>Master data</h1><p className="mute">How printed mill names and grades are turned into the names the ERP uses.</p></div></div>
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
