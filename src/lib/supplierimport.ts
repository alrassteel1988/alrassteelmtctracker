/** Reads a supplier list exported from the ERP (Supplier Code, Supplier). */
import ExcelJS from "exceljs";

export type ImportedSupplier = { code: string; name: string };

const CODE = ["supplier code", "party code", "supp. code", "supp code", "a/c code", "ac code", "account code", "code"];
const NAME = ["supplier", "supplier name", "party name", "account name", "name"];
const key = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const text = (v: unknown) => {
  if (v && typeof v === "object" && "result" in v) v = (v as { result: unknown }).result;
  if (v && typeof v === "object" && "richText" in v) v = (v as { richText: { text: string }[] }).richText.map((t) => t.text).join("");
  return String(v ?? "").replace(/\s+/g, " ").trim();
};

/** Same key the database uses (suppliers.name_key): letters and digits only, upper case. */
export const supplierKey = (name: string | null | undefined) => String(name ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export async function parseSupplierList(buf: ArrayBuffer): Promise<{ suppliers: ImportedSupplier[]; skipped: string[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const skipped: string[] = [];
  for (const ws of wb.worksheets) {
    let codeCol = 0, nameCol = 0, headerRow = 0;
    for (let r = 1; r <= Math.min(ws.rowCount, 15) && !headerRow; r++) {
      ws.getRow(r).eachCell((c, col) => {
        const k = key(text(c.value));
        if (!codeCol && CODE.includes(k)) codeCol = col;
        else if (!nameCol && NAME.includes(k)) nameCol = col;
      });
      if (codeCol && nameCol) headerRow = r;
      else { codeCol = 0; nameCol = 0; }
    }
    if (!headerRow) continue;
    const seen = new Map<string, ImportedSupplier>();
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const code = text(row.getCell(codeCol).value), name = text(row.getCell(nameCol).value);
      if (!code && !name) continue;
      if (!code || !name) { skipped.push(`row ${r}: ${code || name} (missing ${code ? "name" : "code"})`); continue; }
      seen.set(code.toUpperCase(), { code, name });
    }
    return { suppliers: [...seen.values()], skipped };
  }
  return { suppliers: [], skipped: ["No sheet with Supplier Code and Supplier columns was found."] };
}
