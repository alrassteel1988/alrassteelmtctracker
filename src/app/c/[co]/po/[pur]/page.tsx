import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCompany } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Shell, StatusBadge } from "@/components/Shell";
import { UploadForm } from "@/components/UploadForm";
import { LinesEditor } from "@/components/LinesEditor";
import { ReviewGrid } from "@/components/ReviewGrid";
import { AiButton, CopyButton } from "@/components/PoActions";
import { addReceipt, deleteReceipt, linkExistingFile, reopen, saveErpNo, saveHeader, setFileKind, unlinkFile, type EditRow } from "../../actions";
import { dmy, normalisePur } from "@/lib/normalize";
import { excelFileName } from "@/lib/excel";
import { getSettings } from "@/lib/po";
import { dubai } from "@/lib/stats";
import type { PoLine } from "@/lib/match";

export const maxDuration = 300; // AI reading of scanned MTCs can take a minute

type FileRow = { id: string; original_name: string; kind: string; status: string; source: string; created_at: string };

export default async function PoPage({ params }: { params: Promise<{ co: string; pur: string }> }) {
  const p = await params;
  const { user, co } = await requireCompany(p.co);
  const pur = normalisePur(decodeURIComponent(p.pur));
  const db = await supabaseServer();
  const { data: po } = await db
    .from("purchase_orders")
    .select("*, po_files(files(id, original_name, kind, status, source, created_at)), receipts(*)")
    .eq("company_code", co)
    .eq("pur_no", pur)
    .maybeSingle();
  if (!po) {
    return (
      <Shell user={user} co={co} active="shipments">
        <h1>PO {pur}</h1>
        <p className="mute">There is no record for this PUR# yet. Upload its PO copy or MTCs to start one.</p>
        <UploadForm co={co} pur={pur} />
      </Shell>
    );
  }
  if (po.company_code !== co) notFound();
  const files = ((po.po_files ?? []) as { files: FileRow }[]).map((x) => x.files).filter(Boolean);
  const [{ data: lines }, { data: exp }, { data: libraryFiles }, settings] = await Promise.all([
    db.from("po_lines").select("*").eq("po_id", po.id).order("line_no"),
    db.from("export_lines").select("*").eq("po_id", po.id).order("seq"),
    db.from("files").select("id, original_name, pur_no_hint").eq("company_code", co).eq("kind", "mtc").order("created_at", { ascending: false }).limit(100),
    getSettings(db),
  ]);
  const certIds = [...new Set((exp ?? []).map((e) => e.certificate_id).filter(Boolean))];
  const { data: certs } = certIds.length
    ? await db.from("certificates").select("id, cert_no_full, file_id, page").in("id", certIds)
    : { data: [] as { id: string; cert_no_full: string; file_id: string; page: number }[] };
  const { data: deliveries } = await db.from("excel_deliveries").select("delivered_at, excel_version, devices(name, excel_folder)").eq("po_id", po.id).order("delivered_at", { ascending: false }).limit(3);

  const locked = ["approved", "erp_done"].includes(po.status);
  const summary = (po.ai_summary ?? {}) as { warnings?: string[]; ignored_rows?: unknown[]; model?: string; at?: string };
  const hasPo = files.some((f) => f.kind === "po");
  const hasMtc = files.some((f) => f.kind === "mtc");
  const linked = new Set(files.map((f) => f.id));
  const rows: EditRow[] = (exp ?? []).map((e) => ({ ...e, qty: Number(e.qty), flags: (e.flags ?? []) as string[] }));
  const xlFolder = settings.excelFolder.replace("{company}", co);

  return (
    <Shell user={user} co={co} active="shipments">
      <div className="crumb"><Link href={`/c/${co}/shipments`}>Purchase orders</Link> / {pur}</div>
      <div className="head">
        <div>
          <h1>PO {pur}</h1>
          <p className="mute">
            <span className={`tag ${po.po_type === "IMP" ? "imp" : ""}`}>{po.po_type}</span> {po.doctype} · <StatusBadge s={po.status} /> {po.status_note && <span className="small">· {po.status_note}</span>}
          </p>
        </div>
        {!locked && (
          <AiButton co={co} pur={pur} kind="mtc" primary label={rows.length ? "Read MTCs again" : "Read PO and MTCs"} disabled={!hasMtc || (!lines?.length && !hasPo)} />
        )}
      </div>

      {summary.warnings && summary.warnings.length > 0 && !locked && (
        <div className="note"><b>{summary.warnings.length} thing(s) to confirm</b>{summary.warnings.map((w, i) => <div key={i}>{w}</div>)}</div>
      )}

      <div className="grid2">
        <form action={saveHeader.bind(null, co, pur)} className="card">
          <h2>Purchase order</h2>
          <div className="grid3">
            <label className="f">PUR Date<input type="date" name="pur_date" defaultValue={po.pur_date ?? ""} disabled={locked} /></label>
            <label className="f">Supplier code<input name="supplier_code" defaultValue={po.supplier_code ?? ""} disabled={locked} /></label>
            <label className="f">ERP doctype<input value={po.doctype} disabled /></label>
          </div>
          <label className="f">Supplier name<input name="supplier_name" defaultValue={po.supplier_name ?? ""} disabled={locked} /></label>
          {!locked && <div className="row"><button className="btn sm">Save</button><span className="small mute">The supplier comes from the PO, never from the mill.</span></div>}
        </form>

        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}><h2>Files</h2><span className="small mute">Originals stored unchanged</span></div>
          <div className="checks">
            {files.map((f) => (
              <div className="check" key={f.id}>
                <i className={f.kind === "po" ? "info" : "ok"}>{f.kind === "po" ? "PO" : "M"}</i>
                <div style={{ flex: 1 }}>
                  <b><a href={`/api/files/${f.id}`} target="_blank" rel="noreferrer">{f.original_name}</a></b>
                  <span className="small mute">{f.kind === "po" ? "PO copy" : "MTC"} · {f.source === "uploader" ? "from store PC" : "manual"} · {dubai(f.created_at)}</span>
                </div>
                {!locked && (
                  <span className="row">
                    <form action={setFileKind.bind(null, co, pur, f.id, f.kind === "po" ? "mtc" : "po")}><button className="copy">Mark as {f.kind === "po" ? "MTC" : "PO copy"}</button></form>
                    <form action={unlinkFile.bind(null, co, pur, f.id)}><button className="copy">Unlink</button></form>
                  </span>
                )}
              </div>
            ))}
            {!files.length && <p className="mute">No files yet.</p>}
          </div>
          {!locked && (
            <details>
              <summary className="small" style={{ cursor: "pointer" }}>Add another file, or link an MTC already in the library</summary>
              <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
                <UploadForm co={co} pur={pur} compact />
                <form action={linkExistingFile.bind(null, co, pur)} className="row">
                  <select name="file_id" style={{ flex: 1 }}>
                    <option value="">Link an MTC from another PO…</option>
                    {(libraryFiles ?? []).filter((f) => !linked.has(f.id)).map((f) => <option key={f.id} value={f.id}>{f.original_name}{f.pur_no_hint ? ` (${f.pur_no_hint})` : ""}</option>)}
                  </select>
                  <button className="btn sm">Link</button>
                </form>
              </div>
            </details>
          )}
        </div>
      </div>

      <LinesEditor co={co} pur={pur} locked={locked || rows.length > 0} initial={(lines ?? []).map((l) => ({ stock_code: l.stock_code, stock_desc: l.stock_desc, unit: l.unit, qty: Number(l.qty) }))} />
      {!lines?.length && hasPo && <AiButton co={co} pur={pur} kind="po" label="Read lines from the PO copy" />}

      {rows.length > 0 && (
        <>
          <div className="head"><div><h2 style={{ fontSize: 24 }}>{locked ? "Approved rows" : `Review PO ${pur}`}</h2>
            <p className="mute small">{summary.at ? `Read ${dubai(summary.at)}. ` : ""}Check the yellow fields against the certificates{locked ? "" : ", then approve"}. Click View to open a certificate.</p></div></div>
          {hasMtc && (
            <div className="card soft">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <h3>Certificates</h3>
                <span className="row">
                  {files.filter((f) => f.kind === "mtc").map((f) => (
                    <a key={f.id} className="btn sm" href={`/api/files/${f.id}`} target="certview">{f.original_name}</a>
                  ))}
                </span>
              </div>
              <iframe name="certview" title="Certificate" src={`/api/files/${files.find((f) => f.kind === "mtc")!.id}`} style={{ width: "100%", height: 560, border: "1px solid var(--line)", borderRadius: 8, background: "#fff" }} />
              <p className="small mute">Originals stored unchanged. Click View on a row to jump to its certificate page.</p>
            </div>
          )}
          <ReviewGrid
            key={JSON.stringify(rows.map((r) => r.id))}
            co={co} pur={pur} initial={rows} lines={(lines ?? []) as PoLine[]} ignored={summary.ignored_rows?.length ?? 0} locked={locked}
            certs={(certs ?? []).map((c) => ({ id: c.id, no: c.cert_no_full, href: `/api/files/${c.file_id}?page=${c.page ?? 1}` }))}
          />
        </>
      )}

      {locked && (
        <>
          <div className="head">
            <div><h2 style={{ fontSize: 24 }}>ERP Excel · {excelFileName(pur)}</h2><p className="mute small">Approved by {po.approved_by} on {dubai(po.approved_at)}. Same layout as the store&apos;s L0037354 sample.</p></div>
            <a className="btn p" href={`/api/po/${po.id}/excel`}>Download {excelFileName(pur)}</a>
            {po.status === "approved" && <form action={reopen.bind(null, co, pur)}><button className="btn">Reopen for changes</button></form>}
          </div>
          <div className="note info">
            <b>Saved to the store PC</b>
            {deliveries?.length
              ? deliveries.map((d, i) => { const dev = d.devices as unknown as { name: string; excel_folder: string | null } | null; return <div key={i}>{dev?.name} · <span className="mono">{(dev?.excel_folder || xlFolder)}\{excelFileName(pur)}</span> · {dubai(d.delivered_at)}</div>; })
              : <div>Waiting for the uploader on the store PC to pick it up into <span className="mono">{xlFolder}</span>. You can also download it above.</div>}
          </div>
          <div className="grid2">
            <div className="card">
              <h2>In the ERP</h2>
              <div className="steps">
                <div><span className="n">1</span><div><b>New MTC, select PUR# {pur}</b><div className="small mute">The ERP fills supplier and the green columns ({po.doctype}).</div></div></div>
                <div><span className="n">2</span><div><b>Load {excelFileName(pur)} with &quot;Fill&quot;</b><div className="small mute">Fills the yellow columns, nothing to type.</div></div></div>
                <div><span className="n">3</span><div><b>Header</b><div className="small">MILL Name: <b>{po.header_mill}</b><CopyButton text={po.header_mill ?? ""} /></div><div className="small">Certificate Date: <b>{dmy(po.header_cert_date)}</b><CopyButton text={dmy(po.header_cert_date)} /></div></div></div>
                <div><span className="n">4</span><div><b>Save, then type the ERP MTC No. here</b></div></div>
              </div>
            </div>
            <form action={saveErpNo.bind(null, co, pur)} className="card">
              <h2>ERP MTC No. reference</h2>
              <p className="small mute">Typed in by the store team after saving the MTC in the ERP.</p>
              <div className="grid2">
                <label className="f">ERP MTC No. *<input name="erp_mtc_no" required defaultValue={po.erp_mtc_no ?? ""} /></label>
                <label className="f">ERP MTC Date<input type="date" name="erp_mtc_date" defaultValue={po.erp_mtc_date ?? new Date().toISOString().slice(0, 10)} /></label>
              </div>
              <button className="btn p">Save ERP MTC No.</button>
            </form>
          </div>
        </>
      )}

      <div className="card">
        <h2>Receipts (GRN)</h2>
        <table>
          <thead><tr><th>GRN</th><th>Received</th><th>Warehouse</th><th>Status</th><th /></tr></thead>
          <tbody>
            {(po.receipts ?? []).map((r: { id: string; grn_no: string; received_date: string; warehouse: string; status: string }) => (
              <tr key={r.id}><td className="mono">{r.grn_no}</td><td>{dmy(r.received_date)}</td><td>{r.warehouse}</td><td>{r.status}</td>
                <td><form action={deleteReceipt.bind(null, co, pur, r.id)}><button className="copy">Remove</button></form></td></tr>
            ))}
          </tbody>
        </table>
        <form action={addReceipt.bind(null, co, pur)} className="row">
          <input name="grn_no" placeholder="GRN / receipt no." style={{ maxWidth: 200 }} />
          <input type="date" name="received_date" style={{ maxWidth: 170 }} />
          <input name="warehouse" placeholder="Warehouse" style={{ maxWidth: 180 }} />
          <select name="status" style={{ maxWidth: 160 }}><option value="received">Received</option><option value="partial">Partially received</option><option value="expected">Expected</option></select>
          <button className="btn sm">Add receipt</button>
        </form>
      </div>
    </Shell>
  );
}
