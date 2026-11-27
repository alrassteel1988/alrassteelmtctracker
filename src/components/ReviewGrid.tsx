"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveExportLines, type EditRow } from "@/app/c/[co]/actions";
import { runChecks, FLAG_TEXT, type PoLine, type Flag } from "@/lib/match";

const REMARKS: [string, string][] = [
  ["", "Grade remark…"],
  ["not_stated", "Not stated on certificate"],
  ["unreadable", "Unreadable scan"],
  ["delivery_note", "From delivery note"],
  ["other", "Other"],
];

export type CertLink = { id: string; no: string; href: string };

export function ReviewGrid({ co, pur, initial, lines, ignored, locked, certs }: {
  co: string; pur: string; initial: EditRow[]; lines: PoLine[]; ignored: number; locked: boolean; certs: CertLink[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<EditRow[]>(initial);
  const [msg, setMsg] = useState<{ t: string; err?: boolean } | null>(null);
  const [pending, start] = useTransition();
  const checks = useMemo(() => runChecks(rows, lines, ignored), [rows, lines, ignored]);
  const blocking = checks.some((c) => c.ok === false);
  const set = (i: number, k: keyof EditRow, v: string | number | null) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v, flags: r.flags.filter((f) => f.startsWith("note:") || !touches(k, f)) } : r)));

  function save(approve: boolean) {
    start(async () => {
      const r = await saveExportLines(co, pur, rows, approve);
      setMsg({ t: r.message ?? (r.ok ? "Saved" : "Failed"), err: !r.ok });
      if (r.ok) router.refresh();
    });
  }

  return (
    <div className="split">
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>Certificate rows for the ERP</h2>
          <span className="row">
            <span className="legend"><i style={{ background: "var(--xlgreen)" }} />From the PO</span>
            <span className="legend"><i style={{ background: "var(--xlyellow)" }} />Read by AI from the MTC</span>
          </span>
        </div>
        <div className="scroll">
          <table style={{ minWidth: 980 }}>
            <thead><tr><th>#</th><th>Stock Code</th><th className="num">Qty</th><th>Cert. Date</th><th>Cert #</th><th>Heat#</th><th>Grade</th><th>MILL Name</th>{!locked && <th />}</tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const flags = r.flags.filter((f) => !f.startsWith("note:")) as Flag[];
                const note = r.flags.find((f) => f.startsWith("note:"))?.slice(5);
                const cert = certs.find((c) => c.id === r.certificate_id);
                const needGrade = !r.grade;
                return (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td className="g"><span className="mono">{r.stock_code}</span><div className="small mute" style={{ maxWidth: 220 }}>{r.stock_desc}</div></td>
                    <td className="g num">{locked ? r.qty : <input type="number" step="0.001" value={r.qty} onChange={(e) => set(i, "qty", Number(e.target.value))} style={{ width: 90, textAlign: "right" }} />}</td>
                    <td className={`y ${flags.some((f) => f.startsWith("date")) ? "flag" : ""}`}>{locked ? r.cert_date : <input type="date" value={r.cert_date ?? ""} onChange={(e) => set(i, "cert_date", e.target.value || null)} />}</td>
                    <td className="y">{locked ? r.cert_no : <input value={r.cert_no ?? ""} onChange={(e) => set(i, "cert_no", e.target.value)} style={{ width: 90 }} />}{cert && <div><a className="small" href={cert.href} target="_blank" rel="noreferrer">View</a></div>}</td>
                    <td className={`y ${!r.heat_no ? "flag" : ""}`}>{locked ? r.heat_no : <input value={r.heat_no ?? ""} onChange={(e) => set(i, "heat_no", e.target.value)} style={{ width: 100 }} />}</td>
                    <td className={`y ${needGrade && !r.grade_remark ? "flag" : ""}`}>
                      {locked ? r.grade || REMARKS.find((x) => x[0] === r.grade_remark)?.[1] : (
                        <>
                          <input value={r.grade ?? ""} onChange={(e) => set(i, "grade", e.target.value)} style={{ width: 130 }} />
                          {needGrade && (
                            <select value={r.grade_remark ?? ""} onChange={(e) => set(i, "grade_remark", e.target.value || null)}>
                              {REMARKS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                            </select>
                          )}
                        </>
                      )}
                    </td>
                    <td className={`y ${flags.includes("mill_unknown") ? "flag" : ""}`}>{locked ? r.mill_name : <input value={r.mill_name ?? ""} onChange={(e) => set(i, "mill_name", e.target.value)} style={{ minWidth: 200 }} />}
                      {(flags.length > 0 || note) && <div className="small" style={{ color: "var(--amberink)" }}>{[...flags.map((f) => FLAG_TEXT[f] ?? f), note].filter(Boolean).join(" · ")}</div>}
                    </td>
                    {!locked && (
                      <td className="nowrap">
                        <button type="button" className="copy" title="Split this line across another certificate" onClick={() => setRows([...rows.slice(0, i + 1), { ...r, id: undefined, qty: 0, cert_no: "", heat_no: "", flags: [] }, ...rows.slice(i + 1)])}>Split</button>
                        <button type="button" className="copy" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {msg && <div className={`note ${msg.err ? "err" : "ok"}`}>{msg.t}</div>}
        {!locked && (
          <div className="row">
            <button className="btn" disabled={pending} onClick={() => save(false)}>Save draft</button>
            <button className="btn p" disabled={pending || blocking} onClick={() => save(true)}>{pending ? "Saving…" : "Approve and create Excel"}</button>
            {blocking && <span className="small mute">Fix the red checks to approve.</span>}
          </div>
        )}
      </div>
      <div className="card">
        <h2>Checks</h2>
        <div className="checks">
          {checks.map((c) => (
            <div className="check" key={c.key}>
              <i className={c.ok === null ? "info" : c.ok ? "ok" : "bad"}>{c.ok === null ? "i" : c.ok ? "✓" : "!"}</i>
              <div><b>{c.title}</b><span className="small mute">{c.detail}</span></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function touches(k: keyof EditRow, f: string) {
  if (k === "grade" || k === "grade_remark") return f === "grade_missing";
  if (k === "cert_date") return f.startsWith("date");
  if (k === "mill_name") return f === "mill_unknown";
  if (k === "qty") return f === "qty_mismatch";
  if (k === "cert_no" || k === "heat_no") return f === "no_certificate" || f === "low_confidence";
  return false;
}
