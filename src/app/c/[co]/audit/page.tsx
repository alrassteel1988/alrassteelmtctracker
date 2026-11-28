import { requireCompany } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Shell } from "@/components/Shell";
import { dubai } from "@/lib/stats";

export default async function Audit({ params }: { params: Promise<{ co: string }> }) {
  const { user, co } = await requireCompany((await params).co);
  const db = await supabaseServer();
  const { data } = await db.from("audit_log").select("*, purchase_orders(pur_no)").eq("company_code", co).order("created_at", { ascending: false }).limit(200);
  return (
    <Shell user={user} co={co} active="audit">
      <div className="head"><div><h1>Audit history</h1><p className="mute">Who did what, newest first.</p></div></div>
      <div className="scroll">
        <table>
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>PO</th><th>Detail</th></tr></thead>
          <tbody>
            {(data ?? []).map((a) => (
              <tr key={a.id}>
                <td className="nowrap small">{dubai(a.created_at)}</td><td className="small">{a.actor}</td><td className="mono small">{a.action}</td>
                <td className="mono small">{(a.purchase_orders as { pur_no: string } | null)?.pur_no}</td>
                <td className="small mono" style={{ maxWidth: 480, wordBreak: "break-word" }}>{a.detail ? JSON.stringify(a.detail).slice(0, 300) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
