/**
 * Offline check of the matching + Excel pipeline using the L0037354 sample.
 * The AI reading is simulated with what the two APL certificates show; everything after it is the real code.
 * Run: npx tsx tests/l0037354.test.ts [path-to-sample.xlsx]
 */
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { buildExport, runChecks, headerValues } from "../src/lib/match";
import { buildMtcWorkbook } from "../src/lib/excel";
import { certNo, normaliseGrade, millName, parseCertDate, purFromFileName, kindFromFileName } from "../src/lib/normalize";
import type { MtcRead } from "../src/lib/ai";

const grades = [{ pattern: "A\\s*500.*(GR(ADE)?[\\s\\.\\-]*B\\b)", erp_grade: "ASTM A500 GR.B", priority: 10 }];
const mills = [{ printed: "A P L APOLLO TUBES COMPANY LLC", erp_name: "A P L APOLLO TUBES COMPANY L L C" }];

// normalisation rules
assert.equal(certNo("APL/QC/2026/4189", "short"), "4189");
assert.equal(certNo("APL/QC/2026/4189", "full"), "APL/QC/2026/4189");
assert.equal(certNo("240113Z00253", "short"), "240113Z00253");
assert.equal(normaliseGrade("ASTM A500:2023, GRADE-B", grades), "ASTM A500 GR.B");
assert.equal(normaliseGrade("", grades), null);
assert.equal(millName("A P L APOLLO TUBES COMPANY LLC", mills).name, "A P L APOLLO TUBES COMPANY L L C");
assert.equal(millName("JSW Steel", mills).known, false);
assert.deepEqual(parseCertDate("25.11.2026"), { iso: "2026-11-25", monthFirst: false, ambiguous: false });
assert.equal(parseCertDate("11/24/2026").monthFirst, true);
assert.equal(parseCertDate("05/06/2026").ambiguous, true);
assert.equal(parseCertDate("13-Jan-2024").iso, "2024-01-13");
assert.equal(purFromFileName("L0037354 MTC.pdf"), "L0037354");
assert.equal(purFromFileName("MTC - LP0037354.pdf"), "L0037354");
assert.equal(purFromFileName("MP000921-po.pdf"), "MP000921");
assert.equal(purFromFileName("scan_0042.pdf"), null);
assert.equal(kindFromFileName("L0037354 PO.pdf"), "po");
assert.equal(kindFromFileName("L0037354 LPO copy.pdf"), "po");
assert.equal(kindFromFileName("L0037354 MTC.pdf"), "mtc");
assert.equal(kindFromFileName("MTC - LP0037354.pdf"), "mtc");

const lines = [
  { id: "a", line_no: 1, stock_code: "T120060040B", stock_desc: "RT. TUBE 120 X 60 X 4.0MM X 6MTR (A500 GR. B)", unit: "PCS", qty: 648 },
  { id: "b", line_no: 2, stock_code: "T120060040B", stock_desc: "RT. TUBE 120 X 60 X 4.0MM X 6MTR (A500 GR. B)", unit: "PCS", qty: 144 },
  { id: "c", line_no: 3, stock_code: "T120060040B", stock_desc: "RT. TUBE 120 X 60 X 4.0MM X 6MTR (A500 GR. B)", unit: "PCS", qty: 528 },
  { id: "d", line_no: 4, stock_code: "T120060060", stock_desc: "RT. TUBE 120 X 60 X 6.0MM X 6MTR", unit: "PCS", qty: 72 },
];
const cert = (no: string, rows: MtcRead["certificates"][number]["rows"], page: number) => ({
  file_no: 1, page, cert_no_printed: no, cert_date_printed: "25.11.2026", mill_printed: "A P L APOLLO TUBES COMPANY LLC",
  grade_printed: "ASTM A500:2023, GRADE-B", consignee: "M/S AL RAS BUILDING MATERIAL", rows,
});
const read: MtcRead = {
  certificates: [
    cert("APL/QC/2026/4189", [
      { description: "RHST 120X60X4.00", qty: 648, qty_unit: "Pcs", heat_no: "263357", grade_printed: null },
      { description: "RHST 120X60X6.00", qty: 72, qty_unit: "Pcs", heat_no: "148288", grade_printed: null },
    ], 1),
    cert("APL/QC/2026/4190", [{ description: "RHST 120X60X4.00", qty: 672, qty_unit: "Pcs", heat_no: "263357", grade_printed: null }], 2),
  ],
  allocations: [
    { po_line_no: 1, cert_no_printed: "APL/QC/2026/4189", heat_no: "263357", qty: 648, grade_printed: null, confidence: "high", note: null },
    { po_line_no: 2, cert_no_printed: "APL/QC/2026/4190", heat_no: "263357", qty: 144, grade_printed: null, confidence: "high", note: null },
    { po_line_no: 3, cert_no_printed: "APL/QC/2026/4190", heat_no: "263357", qty: 528, grade_printed: null, confidence: "high", note: null },
    { po_line_no: 4, cert_no_printed: "APL/QC/2026/4189", heat_no: "148288", qty: 72, grade_printed: null, confidence: "high", note: null },
  ],
  unmatched_po_lines: [], ignored_rows: [], warnings: [],
};

const built = buildExport(read, lines, { certNoMode: "short", grades, mills });
assert.equal(built.lines.length, 4);
assert.ok(built.lines.every((l) => l.flags.length === 0), JSON.stringify(built.lines.map((l) => l.flags)));
assert.ok(runChecks(built.lines, lines).every((c) => c.ok !== false));
const h = headerValues(built.lines, "first", "latest");
assert.equal(h.mill, "A P L APOLLO TUBES COMPANY L L C");
assert.equal(h.date, "2026-11-25");

// a PO line without a certificate blocks the PO and a missing grade is flagged
const partial = buildExport({ ...read, allocations: read.allocations.slice(0, 3), unmatched_po_lines: [{ po_line_no: 4, reason: "6.0 mm not on any certificate" }] }, lines, { certNoMode: "short", grades, mills });
assert.deepEqual(partial.lines[3].flags, ["no_certificate", "grade_missing"]);
assert.equal(runChecks(partial.lines, lines).find((c) => c.key === "coverage")!.ok, false);

async function cells(buf: Buffer | ArrayBuffer | string) {
  const wb = new ExcelJS.Workbook();
  if (typeof buf === "string") await wb.xlsx.readFile(buf); else await wb.xlsx.load(buf as ArrayBuffer);
  const ws = wb.getWorksheet("Sheet")!;
  const out: string[] = [];
  ws.eachRow((row, r) => row.eachCell({ includeEmpty: false }, (c, col) => {
    const v = c.value instanceof Date ? c.value.toISOString().slice(0, 10) : c.value;
    out.push(`${r}:${col} ${JSON.stringify(v)} ${c.numFmt} ${(c.fill as ExcelJS.FillPattern)?.fgColor?.argb} ${c.font?.name} ${c.font?.size}`);
  }));
  return out;
}

(async () => {
  const ours = await buildMtcWorkbook(built.lines);
  const sample = process.argv[2];
  if (sample) {
    const a = await cells(sample);
    const b = await cells(ours);
    assert.deepEqual(b, a);
    console.log(`Excel matches the sample cell for cell (${a.length} cells).`);
  }
  console.log("All checks passed.");
})();
