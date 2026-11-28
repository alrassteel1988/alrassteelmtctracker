"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { registerUploads } from "@/app/c/[co]/actions";

async function sha256(file: File) {
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const safe = (n: string) => n.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-120);

function purFromName(name: string) {
  const m = name.match(/(?:^|[^A-Za-z0-9])(LP?|MP)\s*-?\s*(\d{5,9})/i);
  if (m) return (m[1].toUpperCase() === "MP" ? "MP" : "L") + m[2];
  const ipo = name.match(/(?:^|[^A-Za-z0-9])IPO\s*[-#:]?\s*(\d{4,6})(?!\d)/i) ?? name.match(/^(\d{5})(?![\d\/.,])/);
  return ipo ? ipo[1].padStart(5, "0") : "";
}

/** Upload a PO copy and its MTCs straight to private storage, then register them against the PUR#. */
export function UploadForm({ co, pur: fixedPur, compact }: { co: string; pur?: string; compact?: boolean }) {
  const router = useRouter();
  const [pur, setPur] = useState(fixedPur ?? "");
  const [po, setPo] = useState<File | null>(null);
  const [mtcs, setMtcs] = useState<File[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ t: string; err?: boolean } | null>(null);
  const [drag, setDrag] = useState(false);

  function addMtcs(list: FileList | null) {
    if (!list) return;
    const arr = [...list];
    setMtcs((m) => [...m, ...arr]);
    if (!pur) setPur(purFromName(arr[0]?.name ?? ""));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!pur.trim()) return setMsg({ t: "Type the PUR# first.", err: true });
    const all = [...(po ? [{ f: po, kind: "po" as const }] : []), ...mtcs.map((f) => ({ f, kind: "mtc" as const }))];
    if (!all.length) return setMsg({ t: "Choose at least one file.", err: true });
    const sb = supabaseBrowser();
    const uploaded = [];
    try {
      for (const { f, kind } of all) {
        if (f.size > 45 * 1024 * 1024) throw new Error(`${f.name} is larger than 45 MB.`);
        setBusy(`Uploading ${f.name}…`);
        const hash = await sha256(f);
        const path = `${co}/inbox/${hash.slice(0, 16)}-${safe(f.name)}`;
        const { error } = await sb.storage.from("mtc-files").upload(path, f, { upsert: true, contentType: f.type || "application/pdf" });
        if (error) throw new Error(`${f.name}: ${error.message}`);
        uploaded.push({ path, name: f.name, sha256: hash, size: f.size, mime: f.type || "application/pdf", kind });
      }
      setBusy("Linking to the PO…");
      const r = await registerUploads(co, pur, uploaded);
      if (!r.ok) throw new Error(r.message);
      const dups = r.results?.filter((x) => x.duplicate) ?? [];
      setPo(null);
      setMtcs([]);
      setMsg({ t: dups.length ? `Saved. Already uploaded before, so skipped: ${dups.map((d) => `${d.name} (same as ${d.duplicateOf})`).join(", ")}` : "Saved." });
      router.push(`/c/${co}/po/${r.pur}`);
      router.refresh();
    } catch (e) {
      setMsg({ t: e instanceof Error ? e.message : String(e), err: true });
    } finally {
      setBusy(null);
    }
  }

  return (
    <form onSubmit={submit} className="card" style={compact ? { padding: 16 } : undefined}>
      {!compact && <h2>Upload manually</h2>}
      {!fixedPur && (
        <div className="grid2">
          <label className="f">PUR# <input value={pur} onChange={(e) => setPur(e.target.value)} placeholder="L0037354 or IPO# 01240" required /></label>
          <label className="f">Company <input value={co} disabled /></label>
        </div>
      )}
      <label className="f">PO copy (LPO), optional
        <input type="file" accept="application/pdf,image/*" onChange={(e) => setPo(e.target.files?.[0] ?? null)} />
      </label>
      <div
        className={`drop ${drag ? "on" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); addMtcs(e.dataTransfer.files); }}
      >
        <b>MTC files</b>
        <span className="small mute">Drop PDFs or photos here, or choose them. One file can hold several certificates.</span>
        <input type="file" multiple accept="application/pdf,image/*" onChange={(e) => addMtcs(e.target.files)} style={{ maxWidth: 320 }} />
        {mtcs.length > 0 && (
          <div className="small" style={{ textAlign: "left" }}>
            {mtcs.map((f, i) => (
              <div key={i}>{f.name} <button type="button" className="copy" onClick={() => setMtcs(mtcs.filter((_, j) => j !== i))}>Remove</button></div>
            ))}
          </div>
        )}
      </div>
      {msg && <div className={`note ${msg.err ? "err" : "ok"}`}>{msg.t}</div>}
      <button className="btn p" disabled={!!busy}>{busy ?? "Upload and open PO"}</button>
    </form>
  );
}
