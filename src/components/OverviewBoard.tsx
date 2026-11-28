import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dmy } from "@/lib/normalize";
import { excelFileName } from "@/lib/excel";

const batchName = (pur: string, n: number) => (n > 1 ? excelFileName(`${pur}-${n}`) : excelFileName(pur));

type Receipt = { status: string; received_date: string | null };
type Po = {
  id: string; company_code: string; pur_no: string; po_type: "IMP" | "LP"; status: string;
  excel_path: string | null; erp_mtc_no: string | null; created_at: string; shipment_date: string | null; receipts: Receipt[]; erp_batches: { id: string; batch_no: number; excel_path: string | null }[];
};

const complete = (p: Po) => p.status === "approved" || p.status === "erp_done";

/** Latest actual receipt date, else the expected date, else nothing. */
function arrival(p: Po): { label: string; date: string | null } {
  const actual = p.receipts.filter((r) => r.status !== "expected" && r.received_date).map((r) => r.received_date!).sort();
  if (actual.length) return { label: "Actual", date: actual[actual.length - 1] };
  const exp = p.receipts.filter((r) => r.status === "expected" && r.received_date).map((r) => r.received_date!).sort();
  if (exp.length) return { label: "Expected", date: exp[0] };
  if (p.shipment_date) return { label: "Shipment", date: p.shipment_date };
  return { label: "", date: null };
}

/** Overview: Import/Local totals with complete vs pending MTC, then one row per PO. Shows only the companies passed in. */
export async function OverviewBoard({ db, companies, type, status }: { db: SupabaseClient; companies: string[]; type?: string; status?: string }) {
  // The PO list must never come back empty just because an optional part (batches from 0003,
  // shipment date from 0002) is missing in the database, so those are read separately.
  const { data, error } = await db
    .from("purchase_orders")
    .select("id, company_code, pur_no, po_type, status, excel_path, erp_mtc_no, created_at, receipts(status, received_date)")
    .in("company_code", companies)
    .order("created_at", { ascending: false })
    .limit(2000);
  const base = (data ?? []) as Omit<Po, "shipment_date" | "erp_batches">[];
  const ids = base.map((p) => p.id);
  const [ship, batches] = ids.length
    ? await Promise.all([
        db.from("purchase_orders").select("id, shipment_date").in("company_code", companies).limit(2000),
        db.from("erp_batches").select("id, po_id, batch_no, excel_path").limit(5000),
      ])
    : [{ data: [] }, { data: [] }];
  const shipOf = new Map(((ship.data ?? []) as { id: string; shipment_date: string | null }[]).map((r) => [r.id, r.shipment_date]));
  const batchesOf = new Map<string, Po["erp_batches"]>();
  for (const b of (batches.data ?? []) as (Po["erp_batches"][number] & { po_id: string })[]) {
    batchesOf.set(b.po_id, [...(batchesOf.get(b.po_id) ?? []), b]);
  }
  const all: Po[] = base.map((p) => ({ ...p, receipts: p.receipts ?? [], shipment_date: shipOf.get(p.id) ?? null, erp_batches: batchesOf.get(p.id) ?? [] }));
  const sum = (t: "IMP" | "LP") => {
    const list = all.filter((p) => p.po_type === t);
    const done = list.filter(complete).length;
    return { total: list.length, done, pending: list.length - done };
  };
  const imp = sum("IMP");
  const loc = sum("LP");
  const rows = all.filter(
    (p) => (!type || p.po_type === type) && (!status || (status === "complete" ? complete(p) : !complete(p))),
  );
  const many = companies.length > 1;
  const href = (t?: string, s?: string) => `?${new URLSearchParams({ ...(t ? { type: t } : {}), ...(s ? { status: s } : {}) })}`;

  const Box = ({ title, t, s }: { title: string; t: "IMP" | "LP"; s: ReturnType<typeof sum> }) => (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2>{title}</h2>
        <Link className="stat" href={href(t)} style={{ border: 0, padding: 0 }}><b>{s.total}</b></Link>
      </div>
      <div className="grid2">
        <Link className="stat" href={href(t, "complete")}><span className="mute small">PO with complete MTC</span><b style={{ color: "var(--green)" }}>{s.done}</b></Link>
        <Link className={`stat ${s.pending ? "warn" : ""}`} href={href(t, "pending")}><span className="mute small">PO with pending MTC</span><b>{s.pending}</b></Link>
      </div>
    </div>
  );

  return (
    <>
      <div className="grid2">
        <Box title="Total import purchase orders" t="IMP" s={imp} />
        <Box title="Total local purchase orders" t="LP" s={loc} />
      </div>
      <div className="row">
        <span className="small mute">Show:</span>
        <Link className={`btn sm ${!type && !status ? "p" : ""}`} href="?">All</Link>
        <Link className={`btn sm ${type === "IMP" ? "p" : ""}`} href={href("IMP", status)}>Import</Link>
        <Link className={`btn sm ${type === "LP" ? "p" : ""}`} href={href("LP", status)}>Local</Link>
        <Link className={`btn sm ${status === "complete" ? "p" : ""}`} href={href(type, "complete")}>Complete</Link>
        <Link className={`btn sm ${status === "pending" ? "p" : ""}`} href={href(type, "pending")}>Pending</Link>
      </div>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              {many && <th>Company</th>}
              <th>PO type</th><th>Expected / actual date of arrival</th><th>Purchase order #</th><th>MTC documentation</th><th>Status</th><th>MTC ERP source file</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const a = arrival(p);
              const ok = complete(p);
              return (
                <tr key={p.id}>
                  {many && <td>{p.company_code}</td>}
                  <td><span className={`tag ${p.po_type === "IMP" ? "imp" : ""}`}>{p.po_type === "IMP" ? "Import" : "Local"}</span></td>
                  <td>{a.date ? <>{dmy(a.date)} <span className="small mute">{a.label}</span></> : <span className="mute">Not set</span>}</td>
                  <td className="mono"><Link href={`/c/${p.company_code}/po/${p.pur_no}`}>{p.pur_no}</Link></td>
                  <td className="mono"><Link href={`/c/${p.company_code}/po/${p.pur_no}`}>MTC-{p.pur_no}</Link>{p.erp_mtc_no && <div className="small mute">ERP MTC {p.erp_mtc_no}</div>}</td>
                  <td><span className={`badge ${ok ? "complete" : "pending"}`}>{ok ? "Complete" : p.status === "partial" ? "Partly pending" : "Pending"}</span></td>
                  <td>{p.erp_batches?.filter((b) => b.excel_path).length
                    ? [...p.erp_batches].filter((b) => b.excel_path).sort((a, b) => a.batch_no - b.batch_no).map((b) => <div key={b.id}><a href={`/api/batch/${b.id}/excel`}>{batchName(p.pur_no, b.batch_no)}</a></div>)
                    : <span className="mute">Not created yet</span>}</td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={many ? 7 : 6} className="mute">{error ? `Purchase orders could not be loaded: ${error.message}` : "No purchase orders yet."}</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="small mute">Complete means the MTC is approved and its ERP Excel is ready. Arrival dates come from the receipts on each PO, or the PO&apos;s shipment date until a receipt is added.</p>
    </>
  );
}
