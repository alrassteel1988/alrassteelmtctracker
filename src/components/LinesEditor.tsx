"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveLines } from "@/app/c/[co]/actions";

type L = { stock_code: string; stock_desc: string; unit: string; qty: number; purchase_qty?: number | null; balance_qty?: number | null };

/** Parses rows copied from the ERP grid or Excel: Stock Code, Stock Desc, Unit, Quantity (tab separated). */
function parsePaste(text: string): L[] {
  return text
    .split(/\r?\n/)
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => (r.includes("\t") ? r.split("\t") : r.split(/\s{2,}/)).map((c) => c.trim()))
    .filter((c) => c.length >= 4 && !/^stock\s*code$/i.test(c[0]))
    .map((c) => ({ stock_code: c[0], stock_desc: c[1], unit: c[2], qty: Number(c[3].replace(/,/g, "")) }))
    .filter((l) => l.stock_code && l.qty > 0);
}

const fmt = (n: number) => Number(n).toLocaleString("en", { minimumFractionDigits: 3 });

export function LinesEditor({ co, pur, initial, locked, certs }: { co: string; pur: string; initial: L[]; locked: boolean; certs?: string[][] }) {
  const hasRecv = initial.some((l) => l.purchase_qty != null || l.balance_qty != null);
  const router = useRouter();
  const [rows, setRows] = useState<L[]>(initial.length ? initial : []);
  const [edit, setEdit] = useState(initial.length === 0 && !locked);
  const [paste, setPaste] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (i: number, k: keyof L, v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: k === "qty" ? Number(v) : v } : r)));

  if (!edit) {
    return (
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>PO lines</h2>
          {!locked && <button className="btn sm" onClick={() => setEdit(true)}>Edit lines</button>}
        </div>
        <div className="scroll">
          <table>
            <thead><tr><th>#</th><th>Stock Code</th><th>Stock Desc</th><th>Unit</th><th className="num">Quantity</th>{hasRecv && <><th className="num">Purchased</th><th className="num">Balance</th></>}<th>MTC</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}><td>{i + 1}</td><td className="mono g">{r.stock_code}</td><td className="g">{r.stock_desc}</td><td className="g">{r.unit}</td><td className="num g">{fmt(r.qty)}</td>
                  {hasRecv && <><td className="num">{r.purchase_qty == null ? "" : fmt(r.purchase_qty)}</td><td className="num">{r.balance_qty == null ? "" : fmt(r.balance_qty)}</td></>}
                  <td className="small">{certs?.[i]?.length ? certs[i].join(", ") : <span className="mute">Not yet</span>}</td></tr>
              ))}
              {!rows.length && <tr><td colSpan={8} className="mute">No lines yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
  return (
    <div className="card">
      <h2>PO lines</h2>
      <p className="small mute">Read them from the PO copy, or copy the lines from the ERP (select the rows after choosing the PUR#, Ctrl+C) and paste below. Columns: Stock Code, Stock Desc, Unit, Quantity.</p>
      <textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"T120060040B\tRT. TUBE 120 X 60 X 4.0MM X 6MTR (A500 GR. B)\tPCS\t1320"} />
      <div className="row"><button type="button" className="btn sm" onClick={() => { const p = parsePaste(paste); if (!p.length) setMsg("Nothing recognised in the pasted text."); else { setRows(p); setPaste(""); setMsg(`${p.length} line(s) taken from the paste.`); } }}>Use pasted lines</button>
        <button type="button" className="btn sm" onClick={() => setRows([...rows, { stock_code: "", stock_desc: "", unit: "PCS", qty: 0 }])}>Add a line</button></div>
      <div className="scroll">
        <table>
          <thead><tr><th>#</th><th>Stock Code</th><th>Stock Desc</th><th>Unit</th><th>Quantity</th><th /></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td><input value={r.stock_code} onChange={(e) => set(i, "stock_code", e.target.value)} /></td>
                <td><input value={r.stock_desc} onChange={(e) => set(i, "stock_desc", e.target.value)} style={{ minWidth: 260 }} /></td>
                <td><input value={r.unit} onChange={(e) => set(i, "unit", e.target.value)} style={{ width: 70 }} /></td>
                <td><input type="number" step="0.001" value={r.qty} onChange={(e) => set(i, "qty", e.target.value)} style={{ width: 110 }} /></td>
                <td><button type="button" className="copy" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {msg && <div className="note info">{msg}</div>}
      <div className="row">
        <button className="btn p" disabled={pending} onClick={() => start(async () => { const r = await saveLines(co, pur, rows); if (!r.ok) setMsg(r.message ?? "Failed"); else { setEdit(false); router.refresh(); } })}>{pending ? "Saving…" : "Save lines"}</button>
        {initial.length > 0 && <button className="btn" onClick={() => { setRows(initial); setEdit(false); }}>Cancel</button>}
        <span className="small mute">Saving lines clears any certificate rows already read, so read the MTCs again after.</span>
      </div>
    </div>
  );
}
