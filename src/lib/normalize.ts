/** Rules that turn what is printed on a certificate into the ERP's style. Pure functions, unit-testable. */

export type CertNoMode = "short" | "full";

/** APL/QC/2026/4189 → 4189 in short mode. Keeps the full text when there is no separator. */
export function certNo(printed: string, mode: CertNoMode): string {
  const p = (printed || "").trim().replace(/^(certificate\s*(no\.?|#|number)\s*[:\-]?\s*)/i, "");
  if (mode === "full") return p;
  const parts = p.split(/[\/\\]/).map((s) => s.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : p;
}

export type GradeRule = { pattern: string; erp_grade: string; priority: number };

export function normaliseGrade(printed: string | null | undefined, rules: GradeRule[]): string | null {
  const g = (printed || "").trim();
  if (!g) return null;
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  for (const r of sorted) {
    try {
      if (new RegExp(r.pattern, "i").test(g)) return r.erp_grade;
    } catch {
      /* bad pattern in the master: skip */
    }
  }
  return g.toUpperCase().replace(/\s+/g, " ");
}

export type MillAlias = { printed: string; erp_name: string };

const squash = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Printed mill → agreed ERP name. Matches ignoring spaces and punctuation. */
export function millName(printed: string | null | undefined, aliases: MillAlias[]): { name: string | null; known: boolean } {
  const p = (printed || "").trim();
  if (!p) return { name: null, known: false };
  const key = squash(p);
  const hit = aliases.find((a) => squash(a.printed) === key || squash(a.erp_name) === key);
  return hit ? { name: hit.erp_name, known: true } : { name: p.toUpperCase(), known: false };
}

/** Parses a printed certificate date. Returns ISO (yyyy-mm-dd) and whether it looked month-first or ambiguous. */
export function parseCertDate(printed: string | null | undefined): { iso: string | null; monthFirst: boolean; ambiguous: boolean } {
  const s = (printed || "").trim();
  if (!s) return { iso: null, monthFirst: false, ambiguous: false };
  const iso = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if (iso) return { iso: fmt(+iso[1], +iso[2], +iso[3]), monthFirst: false, ambiguous: false };
  const m = s.match(/^(\d{1,2})[-\/.\s](\d{1,2})[-\/.\s](\d{2,4})/);
  if (m) {
    const a = +m[1], b = +m[2];
    let y = +m[3];
    if (y < 100) y += 2000;
    if (b > 12 && a <= 12) return { iso: fmt(y, a, b), monthFirst: true, ambiguous: false };
    return { iso: fmt(y, b, a), monthFirst: false, ambiguous: a <= 12 && b <= 12 && a !== b };
  }
  const months = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");
  const t = s.match(/^(\d{1,2})[\s\-\/.]*([A-Za-z]{3})[A-Za-z]*[\s\-\/.,]*(\d{2,4})/);
  if (t) {
    const mo = months.indexOf(t[2].toLowerCase()) + 1;
    let y = +t[3];
    if (y < 100) y += 2000;
    if (mo) return { iso: fmt(y, mo, +t[1]), monthFirst: false, ambiguous: false };
  }
  const t2 = s.match(/^([A-Za-z]{3})[A-Za-z]*[\s\-\/.]*(\d{1,2})[\s,\-\/.]*(\d{4})/);
  if (t2) {
    const mo = months.indexOf(t2[1].toLowerCase()) + 1;
    if (mo) return { iso: fmt(+t2[3], mo, +t2[2]), monthFirst: true, ambiguous: false };
  }
  return { iso: null, monthFirst: false, ambiguous: false };
}

function fmt(y: number, m: number, d: number) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null as unknown as string;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** yyyy-mm-dd → dd/mm/yyyy for display */
export function dmy(iso: string | null | undefined) {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** File names start with the PUR#: "L0037354 MTC.pdf" → L0037354; "MP000921-po.pdf" → MP000921; "IPO 01240 MTC.pdf" or "01240 MTC.pdf" → 01240 */
export function purFromFileName(name: string): string | null {
  const n = name.trim();
  const m = n.match(/(?:^|[^A-Za-z0-9])(LP?|MP)\s*-?\s*(\d{5,9})/i);
  if (m) return (m[1].toUpperCase() === "MP" ? "MP" : "L") + m[2];
  // ARBM import: IPO#G063, "IPO G063", or a name starting with G063
  const g = n.match(/(?:^|[^A-Za-z0-9])IPO\s*[-#:]?\s*(G\d{2,4}[A-Z]?)(?![\dA-Z])/i) ?? n.match(/^(G\d{3,4})(?=[\s_\-.]|$)/i);
  if (g) return normalisePur(g[1]);
  // ARST import: IPO#01259, "IPO 1259", or a name starting with 01259
  const ipo = n.match(/(?:^|[^A-Za-z0-9])IPO\s*[-#:]?\s*(\d{4,6})(?!\d)/i) ?? n.match(/^(\d{5})(?![\d\/.,])/);
  return ipo ? ipo[1].padStart(5, "0") : null;
}

/** "L0037354 PO.pdf" is the PO copy; anything else is an MTC. */
export function kindFromFileName(name: string): "po" | "mtc" {
  const base = name.replace(/\.[^.]+$/, "");
  return /(^|[\s_\-\.])(L?PO|PO\s*COPY|LPO)([\s_\-\.]|$)/i.test(base.replace(/(LP?|MP)\s*-?\s*\d{5,9}/gi, " ").replace(/IPO\s*[-#:]?\s*G?\d{2,6}/gi, " ").replace(/^\d{5}/, " ")) ? "po" : "mtc";
}

/**
 * PO numbers as the ERP writes them, per the company coding:
 *   ARST local  LPO#LP00XXXX  (LP009263) -> L009263     ARST import IPO#XXXXX (01259) -> 01259
 *   ARBM local  LPO#LP020XXX  (LP020491) -> L020491     ARBM import IPO#GXX   (G063)  -> G063
 */
export function normalisePur(s: string | number) {
  let t = String(s).trim().toUpperCase().replace(/\s+/g, "");
  t = t.replace(/^(LPO|IPO|PUR|PO)[-#:.]*(?=[A-Z0-9])/, "");
  t = t.replace(/^LP(?=\d)/, "L");
  const g = t.match(/^G(\d{1,4})([A-Z]?)$/);
  if (g) t = `G${g[1].padStart(3, "0")}${g[2]}`;
  return /^\d{1,6}$/.test(t) ? t.padStart(5, "0") : t;
}

export type PurType = "LP" | "IMP";
/** Local purchase (PUR20) when it starts with L, otherwise import (IMP20). Same rule as the database column. */
export const purType = (pur: string): PurType => (/^L/i.test(pur) ? "LP" : "IMP");

/** Explains when a PO number belongs to the other company's numbering, or null when it fits. */
export function purCompanyProblem(co: string, pur: string): string | null {
  if (co === "ARBM") {
    if (/^\d{5,6}$/.test(pur)) return `IPO#${pur} is ARST import numbering. ARBM import POs look like IPO#G063.`;
    if (/^L00/.test(pur)) return `LP${pur.slice(1)} is ARST local numbering (LP00XXXX). ARBM local POs look like LP020491.`;
  }
  if (co === "ARST") {
    if (/^G\d/.test(pur)) return `IPO#${pur} is ARBM import numbering. ARST import POs look like IPO#01259.`;
    if (/^L02/.test(pur)) return `LP${pur.slice(1)} is ARBM local numbering (LP020XXX). ARST local POs look like LP009263.`;
  }
  return null;
}

/** L0037354 / L009263 / L020491 (local), 01259 (ARST IPO#), G063 (ARBM IPO#), MP000921 (older import purchase) */
export const PUR_RE = /^(L\d{5,9}|MP\d{5,9}|\d{5,6}|G\d{3,4}[A-Z]?)$/;
