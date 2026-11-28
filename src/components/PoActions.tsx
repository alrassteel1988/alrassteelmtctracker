"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { extractAction, readPoAction, type ActionResult } from "@/app/c/[co]/actions";

export function AiButton({ co, pur, kind, label, primary, disabled }: { co: string; pur: string; kind: "po" | "mtc"; label: string; primary?: boolean; disabled?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [res, setRes] = useState<ActionResult | null>(null);
  return (
    <span className="row">
      <button
        type="button"
        className={`btn ${primary ? "p" : ""}`}
        disabled={pending || disabled}
        onClick={() =>
          start(async () => {
            setRes(null);
            const r = await (kind === "po" ? readPoAction(co, pur) : extractAction(co, pur));
            setRes(r);
            router.refresh();
          })
        }
      >
        {pending ? (kind === "po" ? "Reading PO copy…" : "Reading certificates… (up to a minute)") : label}
      </button>
      {res && <span className={`small ${res.ok ? "" : "note err"}`} style={{ padding: res.ok ? 0 : "6px 10px" }}>{res.message}</span>}
    </span>
  );
}

export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="copy" onClick={() => { navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}>
      {done ? "Copied" : "Copy"}
    </button>
  );
}
