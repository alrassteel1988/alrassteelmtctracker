/**
 * AI accuracy test, run before go-live on real POs + MTCs (no database needed).
 *
 *   ANTHROPIC_API_KEY=... npm run try-ai -- --pur L0037354 --lines lines.tsv [--expect MTC-L0037354.xlsx] MTC1.pdf [MTC2.pdf ...]
 *
 * lines.tsv: the PO lines copied from the ERP (Stock Code <tab> Stock Desc <tab> Unit <tab> Quantity).
 *   Or pass --expect with the Excel the store keyed by hand, and the PO lines are taken from its green columns.
 * Prints the rows the app would put in the Excel, and with --expect compares the yellow fields.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import ExcelJS from "exceljs";
import { readMtcsForPo } from "../src/lib/ai";
import { buildExport, runChecks } from "../src/lib/match";

const grades = [
  { pattern: "A\\s*500.*(GR(ADE)?[\\s\\.\\-]*B\\b)", erp_grade: "ASTM A500 GR.B", priority: 10 },
  { pattern: "A\\s*500.*(GR(ADE)?[\\s\\.\\-]*C\\b)", erp_grade: "ASTM A500 GR.C", priority: 10 },
  { pattern: "A\\s*36\\b", erp_grade: "ASTM A36", priority: 20 },
  { pattern: "S\\s*275\\s*JR", erp_grade: "S275JR", priority: 20 },
  { pattern: "S\\s*355\\s*JR", erp_grade: "S355JR", priority: 20 },
];
const mills = [{ printed: "A P L APOLLO TUBES COMPANY LLC", erp_name: "A P L APOLLO TUBES COMPANY L L C" }];

const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(k); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const pur = opt("--pur") ?? "UNKNOWN";
const linesPath = opt("--lines");
const expectPath = opt("--expect");
const files = args;
if (!files.length || (!linesPath && !expectPath)) {
  console.error("Usage: npm run try-ai -- --pur L0037354 (--lines lines.tsv | --expect keyed.xlsx) file.pdf [...]");
  process.exit(1);
}

type Row = { stock_code: string; stock_desc: string; unit: string; qty: number; cert_date: string; cert_no: string; heat_no: string; grade: string; mill_name: string };

async function readExpected(path: string): Promise<Row[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.worksheets[0];
  const out: Row[] = [];
  ws.eachRow((r, i) => {
    if (i === 1) return;
    const v = (c: number) => { const x = r.getCell(c).value; return x instanceof Date ? x.toISOString().slice(0, 10) : String(x ?? "").trim(); };
    if (!v(1)) return;
    out.push({ stock_code: v(1), stock_desc: v(2), unit: v(3), qty: Number(v(4)), cert_date: v(5), cert_no: v(6), heat_no: v(7), grade: v(8), mill_name: v(9) });
  });
  return out;
}

(async () => {
  const expected = expectPath ? await readExpected(expectPath) : null;
  const src = linesPath
    ? readFileSync(linesPath, "utf8").split(/\r?\n/).filter(Boolean).map((l) => l.split("\t")).map((c) => ({ stock_code: c[0], stock_desc: c[1], unit: c[2], qty: Number(c[3].replace(/,/g, "")) }))
    : expected!.map((e) => ({ stock_code: e.stock_code, stock_desc: e.stock_desc, unit: e.unit, qty: e.qty }));
  const lines = src.map((l, i) => ({ id: `L${i + 1}`, line_no: i + 1, ...l }));
  const aiFiles = files.map((f) => ({
    name: basename(f),
    mime: /\.pdf$/i.test(f) ? "application/pdf" : /\.png$/i.test(f) ? "image/png" : "image/jpeg",
    data: readFileSync(f),
  }));
  const t = Date.now();
  const res = await readMtcsForPo(aiFiles, pur, lines);
  const built = buildExport(res.data, lines, { certNoMode: "short", grades, mills });
  console.log(`Read ${res.data.certificates.length} certificate(s) in ${((Date.now() - t) / 1000).toFixed(1)}s with ${res.model}. Tokens in/out: ${res.usage.input_tokens}/${res.usage.output_tokens}`);
  console.table(built.lines.map((l) => ({ code: l.stock_code, qty: l.qty, date: l.cert_date, cert: l.cert_no, heat: l.heat_no, grade: l.grade, mill: l.mill_name, flags: l.flags.join(",") })));
  for (const c of runChecks(built.lines, lines, res.data.ignored_rows.length)) console.log(`${c.ok === false ? "✗" : "✓"} ${c.title}: ${c.detail}`);
  if (res.data.warnings.length) console.log("AI warnings:\n - " + res.data.warnings.join("\n - "));
  if (expected) {
    let diffs = 0;
    const fields = ["qty", "cert_date", "cert_no", "heat_no", "grade", "mill_name"] as const;
    expected.forEach((e, i) => {
      const g = built.lines[i];
      for (const f of fields) {
        const a = String(e[f] ?? ""), b = String(g?.[f] ?? "");
        if (a.toUpperCase() !== b.toUpperCase()) { diffs++; console.log(`Row ${i + 1} ${f}: keyed "${a}" vs AI "${b}"`); }
      }
    });
    if (built.lines.length !== expected.length) console.log(`Row count: keyed ${expected.length} vs AI ${built.lines.length}`);
    console.log(diffs === 0 && built.lines.length === expected.length ? "MATCH: identical to the keyed Excel." : `${diffs} field difference(s).`);
  }
})().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
