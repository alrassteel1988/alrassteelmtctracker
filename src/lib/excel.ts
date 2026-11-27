import ExcelJS from "exceljs";

export type ExcelRow = {
  stock_code: string;
  stock_desc: string;
  unit: string;
  qty: number;
  cert_date: string | null; // yyyy-mm-dd
  cert_no: string | null;
  heat_no: string | null;
  grade: string | null;
  mill_name: string | null;
};

const HEADERS = ["Stock Code", "Stock Desc", "Unit ", "Quantity", "Certificate Date", "Certificate #", "Heat#", "Grade", "MILL Name"];
// Column widths copied from the store's L0037354 sample
const WIDTHS = [10.44140625, 35.109375, 4.109375, 7.0, 11.88671875, 9.6640625, 6.109375, 12.6640625, 26.44140625];
const GREY = "FFD3D3D3";
const GREEN = "FF92D050"; // from the PO (ERP fills these)
const YELLOW = "FFFFFF00"; // read from the MTC
const thin = { style: "thin" as const, color: { argb: "FF000000" } };
const border = { top: thin, left: thin, bottom: thin, right: thin };

/** Builds MTC-{PUR#}.xlsx in the exact layout of the store's sample: sheet "Sheet", 9 columns. */
export async function buildMtcWorkbook(rows: ExcelRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Al Ras Steel MTC Tracker";
  const ws = wb.addWorksheet("Sheet");
  WIDTHS.forEach((w, i) => (ws.getColumn(i + 1).width = w));

  const head = ws.getRow(1);
  HEADERS.forEach((h, i) => {
    const c = head.getCell(i + 1);
    c.value = h;
    c.numFmt = "@";
    c.font = { name: "Tahoma", size: 8.25 };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREY } };
    c.alignment = { horizontal: "center" };
    c.border = border;
  });

  rows.forEach((r, idx) => {
    const row = ws.getRow(idx + 2);
    const values: (string | number | Date | null)[] = [
      r.stock_code,
      r.stock_desc,
      r.unit,
      Number(r.qty),
      r.cert_date ? isoToExcelDate(r.cert_date) : null,
      r.cert_no ?? "",
      r.heat_no ?? "",
      r.grade ?? "",
      r.mill_name ?? "",
    ];
    values.forEach((v, i) => {
      const c = row.getCell(i + 1);
      c.value = v;
      c.font = { name: "Tahoma", size: 8.5 };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: i < 4 ? GREEN : YELLOW } };
      c.border = border;
      if (i === 3) {
        c.numFmt = "#,##0.000";
        c.alignment = { horizontal: "right" };
      } else if (i === 4) {
        c.numFmt = "dd/mm/yyyy";
        c.alignment = { horizontal: "left" };
      } else {
        c.numFmt = "@";
        c.alignment = { horizontal: "left" };
      }
    });
  });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/** Excel stores dates without a time zone; build a UTC midnight so it never shifts a day. */
function isoToExcelDate(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export const excelFileName = (pur: string) => `MTC-${pur}.xlsx`;
