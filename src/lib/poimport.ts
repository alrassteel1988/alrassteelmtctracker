/** Reads a purchase order list exported from the ERP (one row per line item) into POs with lines. */
import ExcelJS from "exceljs";
import { normalisePur, PUR_RE } from "./normalize";

export type ImportedLine = { stock_code: string; stock_desc: string; unit: string; qty: number; purchase_qty: number | null; balance_qty: number | null };
export type ImportedPo = {
  pur_no: string; pur_date: string | null; supplier_code: string | null; supplier_name: string | null;
  supplier_contract_no: string | null; shipment_date: string | null; lines: ImportedLine[];
};

const ALIASES: Record<string, string[]> = {
  pur: ["ipo#", "ipo no", "pur#", "pur no", "lpo#", "po#", "po no", "purchase order", "purchase order#"],
  date: ["doc date", "pur date", "po date", "date"],
  supplier_code: ["party code", "supplier code", "supp. code", "supp code"],
  supplier_name: ["party name", "supplier name", "supplier"],
  contract: ["supp. contract no", "supp contract no", "contract no", "supplier contract no"],
  shipment: ["shipment date", "eta", "expected date", "expected arrival"],
  code: ["stock code", "item code"],
  desc: ["stock desc", "stock description", "description"],
  unit: ["unit"],
  qty: ["ipo qty", "po qty", "lpo qty", "order qty", "quantity", "qty"],
  purchase_qty: ["purchase qty", "received qty"],
  balance_qty: ["balance qty", "pending qty"],
};

const key = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

function toIso(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v ?? "").trim();
  const m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const iso = s.match(/^\d{4}-\d{2}-\d{2}/);
  return iso ? iso[0] : null;
}
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "object" && v && "result" in v) return num((v as { result: unknown }).result);
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}
function text(v: unknown): string {
  if (v && typeof v === "object" && "richText" in v) return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join("");
  if (v && typeof v === "object" && "result" in v) return text((v as { result: unknown }).result);
  return String(v ?? "").trim();
}

export async function parsePoList(buf: ArrayBuffer): Promise<{ pos: ImportedPo[]; skipped: string[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("The file has no sheet.");
  // find the header row in the first 10 rows
  let headerRow = 0;
  const col: Record<string, number> = {};
  for (let r = 1; r <= Math.min(10, ws.rowCount) && !headerRow; r++) {
    const names = new Map<string, number>();
    ws.getRow(r).eachCell((c, i) => names.set(key(text(c.value)), i));
    for (const [field, list] of Object.entries(ALIASES)) {
      const hit = list.find((a) => names.has(a));
      if (hit) col[field] = names.get(hit)!;
    }
    if (col.pur && col.code && col.qty) headerRow = r;
    else Object.keys(col).forEach((k) => delete col[k]);
  }
  if (!headerRow) throw new Error("Could not find the header row. It needs at least IPO#/PUR#, Stock Code and a quantity column.");

  const byPo = new Map<string, ImportedPo>();
  const skipped: string[] = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const get = (f: string) => (col[f] ? row.getCell(col[f]).value : null);
    const rawPur = text(get("pur"));
    const code = text(get("code"));
    if (!rawPur && !code) continue;
    if (!rawPur || !code) continue; // totals row
    const pur = normalisePur(rawPur);
    if (!PUR_RE.test(pur)) {
      skipped.push(`Row ${r}: "${rawPur}" is not a PO number`);
      continue;
    }
    const qty = num(get("qty"));
    if (!qty || qty <= 0) {
      skipped.push(`Row ${r}: ${pur} ${code} has no quantity`);
      continue;
    }
    let po = byPo.get(pur);
    if (!po) {
      po = {
        pur_no: pur,
        pur_date: toIso(get("date")),
        supplier_code: text(get("supplier_code")) || null,
        supplier_name: text(get("supplier_name")) || null,
        supplier_contract_no: text(get("contract")) || null,
        shipment_date: toIso(get("shipment")),
        lines: [],
      };
      byPo.set(pur, po);
    }
    po.lines.push({
      stock_code: code.toUpperCase(),
      stock_desc: text(get("desc")),
      unit: text(get("unit")).toUpperCase() || "PCS",
      qty,
      purchase_qty: num(get("purchase_qty")),
      balance_qty: num(get("balance_qty")),
    });
  }
  return { pos: [...byPo.values()], skipped };
}
