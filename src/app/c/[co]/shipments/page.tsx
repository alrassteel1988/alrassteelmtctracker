import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Shell, StatusBadge, STATUS_LABELS } from "@/components/Shell";
import { dmy } from "@/lib/normalize";

type SP = { q?: string; status?: string; type?: string };

export default async function Shipments({ params, searchParams }: { params: Promise<{ co: string }>; searchParams: Promise<SP> }) {
  const { user, co } = await requireCompany((await params).co);
  const sp = await searchParams;
  const db = await supabaseServer();
  let q = db
    .from("purchase_orders")
    .select("id, pur_no, po_type, doctype, pur_date, supplier_code, supplier_name, status, status_note, header_mill, header_cert_date, erp_mtc_no, created_at, receipts(grn_no, status, received_date), export_lines(cert_no, heat_no)")
    .eq("company_code", co)
    .order("created_at", { ascending: false })
    .limit(300);
  if (sp.status) q = q.eq("status", sp.status);
  if (sp.type === "LP" || sp.type === "IMP") q = q.eq("po_type", sp.type);
  const { data } = await q;
  const term = (sp.q ?? "").trim().toUpperCase();
  const rows = (data ?? []).filter((p) => {
    if (!term) return true;
    const hay = [p.pur_no, p.supplier_code, p.supplier_name, p.erp_mtc_no, p.header_mill,
      ...(p.receipts ?? []).map((r) => r.grn_no), ...(p.export_lines ?? []).flatMap((e) => [e.cert_no, e.heat_no])]
      .filter(Boolean).join(" ").toUpperCase();
    return hay.includes(term);
  });
  const title = sp.status === "review" ? "Review queue" : sp.status === "approved" ? "ERP exports" : "Purchase orders";
  return (
    <Shell user={user} co={co} active={sp.status === "review" ? "review" : sp.status === "approved" ? "erp" : "shipments"}>
      <div className="head">
        <div><h1>{title}</h1><p className="mute">One row per purchase order. Receipts (GRN) and certificates are listed inside each PO.</p></div>
        <Link className="btn p" href={`/c/${co}/intake`}>New MTC intake</Link>
      </div>
      <form className="row">
        <input name="q" defaultValue={sp.q} placeholder="Search PO, GRN, heat, certificate, supplier" style={{ maxWidth: 380 }} />
        <select name="type" defaultValue={sp.type ?? ""} style={{ maxWidth: 160 }}>
          <option value="">PO type: All</option><option value="LP">Local (PUR20)</option><option value="IMP">Import (IMP20)</option>
        </select>
        <select name="status" defaultValue={sp.status ?? ""} style={{ maxWidth: 200 }}>
          <option value="">Status: All</option>
          {Object.entries(STATUS_LABELS).map(([k, [t]]) => <option key={k} value={k}>{t}</option>)}
        </select>
        <button className="btn">Filter</button>
      </form>
      <div className="scroll">
        <table>
          <thead><tr><th>Logged</th><th>PO type</th><th>PUR#</th><th>Supplier code</th><th>Supplier name</th><th>Receipt</th><th>Cert. date</th><th>Mill</th><th>ERP MTC #</th><th>Status</th><th /></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td className="nowrap">{dmy(p.created_at)}</td>
                <td><span className={`tag ${p.po_type === "IMP" ? "imp" : ""}`}>{p.po_type}</span><div className="small mute">{p.doctype}</div></td>
                <td className="mono">{p.pur_no}</td>
                <td className="mono">{p.supplier_code}</td>
                <td>{p.supplier_name}</td>
                <td className="small">{(p.receipts ?? []).map((r, i) => <div key={i}>{r.grn_no || "GRN"} · {r.status}</div>)}</td>
                <td className="nowrap">{dmy(p.header_cert_date)}</td>
                <td className="small">{p.header_mill}</td>
                <td>{p.erp_mtc_no ?? <span className="badge">Pending</span>}</td>
                <td><StatusBadge s={p.status} />{p.status_note && <div className="small mute" style={{ maxWidth: 220 }}>{p.status_note}</div>}</td>
                <td><Link className="btn sm" href={`/c/${co}/po/${p.pur_no}`}>Open</Link></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={11} className="mute">No purchase orders match.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="small mute">Showing {rows.length} purchase orders.</p>
    </Shell>
  );
}
