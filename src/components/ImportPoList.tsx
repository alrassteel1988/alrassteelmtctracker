"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { importPoList } from "@/app/c/[co]/actions";

export function ImportPoList({ co }: { co: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [res, setRes] = useState<{ ok: boolean; lines: string[] } | null>(null);
  if (!open) return <button className="btn" onClick={() => setOpen(true)}>Import PO list (Excel)</button>;
  return (
    <form
      className="card soft"
      style={{ width: "100%" }}
      action={(fd) => start(async () => {
        try {
          const r = await importPoList(co, fd);
          setRes({ ok: r.ok, lines: r.ok ? r.summary ?? [] : [r.message ?? "Import failed"] });
          if (r.ok) router.refresh();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setRes({
            ok: false,
            lines: [/Server Action|deployment/i.test(msg)
              ? "The app was updated while this page was open. Reload the page (Ctrl+F5) and import again."
              : `The import did not finish: ${msg}. Reload the page and try again.`],
          });
        }
      })}
    >
      <h3>Import purchase orders from the ERP</h3>
      <p className="small mute">One row per line item, with the columns IPO# (or PUR#), Doc Date, Party Name, Supp. Contract No, Shipment Date, Stock Code, Stock Desc, Unit, IPO Qty, Purchase Qty, Balance Qty. Importing the same list again updates it.</p>
      <div className="row">
        <input type="file" name="file" accept=".xlsx" required style={{ maxWidth: 360 }} />
        <button className="btn p" disabled={pending}>{pending ? "Importing…" : `Import into ${co}`}</button>
        <button type="button" className="btn" onClick={() => { setOpen(false); setRes(null); }}>Close</button>
      </div>
      {res && <div className={`note ${res.ok ? "ok" : "err"}`}>{res.lines.map((l, i) => <div key={i}>{l}</div>)}</div>}
    </form>
  );
}
