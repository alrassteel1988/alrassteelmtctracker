import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Shell } from "@/components/Shell";
import { dmy } from "@/lib/normalize";

export default async function Library({ params, searchParams }: { params: Promise<{ co: string }>; searchParams: Promise<{ q?: string }> }) {
  const { user, co } = await requireCompany((await params).co);
  const { q } = await searchParams;
  const db = await supabaseServer();
  let query = db
    .from("certificates")
    .select("id, cert_no_full, cert_no_short, cert_date, mill_name, grade, rows, page, file_id, files(original_name), export_lines(heat_no, stock_code, purchase_orders(pur_no, erp_mtc_no))")
    .eq("company_code", co)
    .order("created_at", { ascending: false })
    .limit(200);
  const term = (q ?? "").trim();
  if (term) query = query.or(`cert_no_full.ilike.%${term.replace(/[%,()]/g, "")}%,mill_name.ilike.%${term.replace(/[%,()]/g, "")}%`);
  const { data } = await query;
  // heat numbers live in rows/export lines: also search those client-side
  let rows = data ?? [];
  if (term && rows.length === 0) {
    const { data: all } = await db.from("certificates").select("id, cert_no_full, cert_no_short, cert_date, mill_name, grade, rows, page, file_id, files(original_name), export_lines(heat_no, stock_code, purchase_orders(pur_no, erp_mtc_no))").eq("company_code", co).limit(1000);
    rows = (all ?? []).filter((c) => JSON.stringify(c).toUpperCase().includes(term.toUpperCase()));
  }
  return (
    <Shell user={user} co={co} active="library">
      <div className="head"><div><h1>Certificate library</h1><p className="mute">Every certificate read, stored once and linked to each PO it covers. Search by certificate #, heat, mill or PUR#.</p></div></div>
      <form className="row"><input name="q" defaultValue={q} placeholder="Certificate #, heat, mill, PUR#" style={{ maxWidth: 420 }} /><button className="btn">Search</button></form>
      <div className="scroll">
        <table>
          <thead><tr><th>Certificate #</th><th>Date</th><th>Mill</th><th>Grade</th><th>Heats</th><th>Used on PO</th><th>File</th></tr></thead>
          <tbody>
            {rows.map((c) => {
              const heats = [...new Set(((c.rows ?? []) as { heat_no: string | null }[]).map((r) => r.heat_no).filter(Boolean))];
              const pos = [...new Map(((c.export_lines ?? []) as unknown as { purchase_orders: { pur_no: string; erp_mtc_no: string | null } }[]).map((e) => [e.purchase_orders?.pur_no, e.purchase_orders])).values()].filter(Boolean);
              return (
                <tr key={c.id}>
                  <td className="mono">{c.cert_no_full}</td>
                  <td>{dmy(c.cert_date)}</td>
                  <td className="small">{c.mill_name}</td>
                  <td className="small">{c.grade}</td>
                  <td className="mono small">{heats.join(", ")}</td>
                  <td className="small">{pos.map((p) => <div key={p.pur_no}><Link href={`/c/${co}/po/${p.pur_no}`}>{p.pur_no}</Link>{p.erp_mtc_no ? ` · ERP ${p.erp_mtc_no}` : ""}</div>)}</td>
                  <td className="small"><a href={`/api/files/${c.file_id}?page=${c.page ?? 1}`} target="_blank" rel="noreferrer">{(c.files as unknown as { original_name: string } | null)?.original_name ?? "Open"}</a></td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={7} className="mute">No certificates {term ? "match" : "yet"}.</td></tr>}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
