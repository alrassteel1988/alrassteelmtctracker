/** Turns the AI's reading into the rows of the ERP Excel plus the checks shown on the review screen. Pure. */
import type { MtcRead } from "./ai";
import { certNo, normaliseGrade, millName, parseCertDate, type CertNoMode, type GradeRule, type MillAlias } from "./normalize";

export type PoLine = { id: string; line_no: number; stock_code: string; stock_desc: string; unit: string; qty: number };

export type Flag =
  | "no_certificate"
  | "grade_missing"
  | "date_month_first"
  | "date_ambiguous"
  | "date_missing"
  | "low_confidence"
  | "mill_unknown"
  | "qty_mismatch";

export type BuiltLine = {
  seq: number;
  po_line_id: string;
  stock_code: string;
  stock_desc: string;
  unit: string;
  qty: number;
  cert_date: string | null;
  cert_no: string | null;
  cert_no_full: string | null;
  heat_no: string | null;
  grade: string | null;
  mill_name: string | null;
  flags: Flag[];
  note: string | null;
};

export type BuiltCert = {
  cert_no_full: string;
  cert_no_short: string;
  cert_date: string | null;
  cert_date_printed: string | null;
  mill_printed: string | null;
  mill_name: string | null;
  grade_printed: string | null;
  grade: string | null;
  file_no: number;
  page: number;
  rows: MtcRead["certificates"][number]["rows"];
};

export type Check = { key: string; ok: boolean | null; title: string; detail: string };

export type Settings = { certNoMode: CertNoMode; grades: GradeRule[]; mills: MillAlias[] };

const key = (s: string) => s.replace(/\s+/g, "").toUpperCase();
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function buildExport(read: MtcRead, lines: PoLine[], s: Settings) {
  const certs: BuiltCert[] = read.certificates.map((c) => {
    const d = parseCertDate(c.cert_date_printed);
    return {
      cert_no_full: c.cert_no_printed.trim(),
      cert_no_short: certNo(c.cert_no_printed, "short"),
      cert_date: d.iso,
      cert_date_printed: c.cert_date_printed,
      mill_printed: c.mill_printed,
      mill_name: millName(c.mill_printed, s.mills).name,
      grade_printed: c.grade_printed,
      grade: normaliseGrade(c.grade_printed, s.grades),
      file_no: c.file_no,
      page: c.page,
      rows: c.rows,
    };
  });
  const byNo = new Map(certs.map((c) => [key(c.cert_no_full), c]));
  const findCert = (printed: string) =>
    byNo.get(key(printed)) ?? certs.find((c) => key(c.cert_no_full).endsWith(key(certNo(printed, "short"))));

  const out: BuiltLine[] = [];
  const sorted = [...lines].sort((a, b) => a.line_no - b.line_no);
  for (const line of sorted) {
    const allocs = read.allocations.filter((a) => a.po_line_no === line.line_no && a.qty > 0);
    if (allocs.length === 0) {
      const reason = read.unmatched_po_lines.find((u) => u.po_line_no === line.line_no)?.reason ?? null;
      out.push({
        seq: 0, po_line_id: line.id, stock_code: line.stock_code, stock_desc: line.stock_desc, unit: line.unit,
        qty: Number(line.qty), cert_date: null, cert_no: null, cert_no_full: null, heat_no: null, grade: null,
        mill_name: null, flags: ["no_certificate", "grade_missing"], note: reason,
      });
      continue;
    }
    const total = round3(allocs.reduce((t, a) => t + a.qty, 0));
    for (const a of allocs) {
      const c = findCert(a.cert_no_printed);
      const d = parseCertDate(c?.cert_date_printed);
      const grade = normaliseGrade(a.grade_printed ?? c?.grade_printed, s.grades);
      const mill = millName(c?.mill_printed, s.mills);
      const flags: Flag[] = [];
      if (!grade) flags.push("grade_missing");
      if (!d.iso) flags.push("date_missing");
      if (d.monthFirst) flags.push("date_month_first");
      if (d.ambiguous) flags.push("date_ambiguous");
      if (a.confidence === "low") flags.push("low_confidence");
      if (!mill.known) flags.push("mill_unknown");
      if (total !== round3(Number(line.qty))) flags.push("qty_mismatch");
      out.push({
        seq: 0, po_line_id: line.id, stock_code: line.stock_code, stock_desc: line.stock_desc, unit: line.unit,
        qty: round3(a.qty), cert_date: d.iso, cert_no: certNo(a.cert_no_printed, s.certNoMode),
        cert_no_full: c?.cert_no_full ?? a.cert_no_printed, heat_no: a.heat_no?.trim() ?? null, grade,
        mill_name: mill.name, flags, note: a.note,
      });
    }
  }
  out.forEach((l, i) => (l.seq = i + 1));
  return { lines: out, certs };
}

export type CheckLine = Pick<BuiltLine, "qty" | "cert_no" | "heat_no" | "grade" | "cert_date" | "mill_name"> & {
  po_line_id: string | null;
  grade_remark?: string | null;
};

/** Checks on the current (possibly hand-edited) rows. `ok:false` blocks approval. */
export function runChecks(rows: CheckLine[], lines: PoLine[], ignoredRows = 0): Check[] {
  const covered = lines.filter((l) => rows.some((r) => r.po_line_id === l.id && r.cert_no && r.heat_no));
  const qtyBad = lines.filter((l) => {
    const t = round3(rows.filter((r) => r.po_line_id === l.id).reduce((s, r) => s + Number(r.qty || 0), 0));
    return t !== round3(Number(l.qty));
  });
  const noGrade = rows.filter((r) => !r.grade && !r.grade_remark);
  const noDate = rows.filter((r) => !r.cert_date);
  const noMill = rows.filter((r) => !r.mill_name);
  return [
    {
      key: "coverage",
      ok: covered.length === lines.length && lines.length > 0,
      title: "Every PO line has a certificate",
      detail: `${covered.length} of ${lines.length} lines filled`,
    },
    {
      key: "qty",
      ok: qtyBad.length === 0,
      title: "Quantities match the PO",
      detail: qtyBad.length ? `Check ${qtyBad.map((l) => l.stock_code).join(", ")}` : "Split rows add up to each PO line",
    },
    {
      key: "grade",
      ok: noGrade.length === 0,
      title: "Grade on every line",
      detail: noGrade.length ? `${noGrade.length} line(s) need a grade or a remark` : "Filled or remarked",
    },
    {
      key: "fields",
      ok: noDate.length === 0 && noMill.length === 0,
      title: "Certificate date and mill on every line",
      detail: noDate.length || noMill.length ? `${noDate.length} without date, ${noMill.length} without mill` : "All present",
    },
    {
      key: "extra",
      ok: null,
      title: "Rows for other items ignored",
      detail: ignoredRows ? `${ignoredRows} certificate row(s) are for items not on this PO` : "No certificate rows for items outside this PO",
    },
  ];
}

/** Header MILL Name and Certificate Date for the ERP, per the configured rules. */
export function headerValues(
  rows: { mill_name: string | null; cert_date: string | null }[],
  millRule: "first" | "most",
  dateRule: "latest" | "earliest" | "first",
) {
  const mills = rows.map((r) => r.mill_name).filter(Boolean) as string[];
  let mill: string | null = mills[0] ?? null;
  if (millRule === "most" && mills.length) {
    const count = new Map<string, number>();
    mills.forEach((m) => count.set(m, (count.get(m) ?? 0) + 1));
    mill = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }
  const dates = rows.map((r) => r.cert_date).filter(Boolean) as string[];
  let date: string | null = dates[0] ?? null;
  if (dates.length && dateRule !== "first") {
    const s = [...dates].sort();
    date = dateRule === "latest" ? s[s.length - 1] : s[0];
  }
  return { mill, date, severalMills: new Set(mills).size > 1, severalDates: new Set(dates).size > 1 };
}

export const FLAG_TEXT: Record<Flag, string> = {
  no_certificate: "No certificate found for this line",
  grade_missing: "Grade not on certificate: fill it or choose a remark",
  date_month_first: "Date looked month-first on the certificate; check it",
  date_ambiguous: "Day and month could be swapped; check the date",
  date_missing: "Certificate date not read",
  low_confidence: "AI was unsure about this match",
  mill_unknown: "Mill name not in the master yet",
  qty_mismatch: "Split quantities don't add up to the PO line",
};
