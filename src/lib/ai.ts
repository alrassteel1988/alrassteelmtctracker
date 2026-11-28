import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

export const AI_MODEL = process.env.AI_MODEL || "claude-opus-5-5";

export type AiFile = { name: string; mime: string; data: Buffer };

function client() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set in the server environment.");
  return new Anthropic();
}

function fileBlocks(files: AiFile[]): Anthropic.Beta.BetaContentBlockParam[] {
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
  files.forEach((f, i) => {
    blocks.push({ type: "text", text: `File ${i + 1}: ${f.name}` });
    const data = f.data.toString("base64");
    if (f.mime === "application/pdf") {
      blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data } });
    } else if (/^image\/(png|jpeg|gif|webp)$/.test(f.mime)) {
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: f.mime as "image/png" | "image/jpeg" | "image/gif" | "image/webp", data },
      });
    } else {
      throw new Error(`${f.name}: only PDF and image files can be read (got ${f.mime || "unknown type"}).`);
    }
  });
  return blocks;
}

async function run<T extends z.ZodType>(schema: T, system: string, content: Anthropic.Beta.BetaContentBlockParam[]) {
  const res = await client().beta.messages.parse({
    model: AI_MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: betaZodOutputFormat(schema) },
    system,
    messages: [{ role: "user", content }],
  });
  if (res.stop_reason === "refusal") throw new Error("The AI declined to read these files.");
  if (res.stop_reason === "max_tokens") throw new Error("The AI output was cut off; try fewer files at once.");
  if (!res.parsed_output) throw new Error("The AI reply could not be read.");
  return { data: res.parsed_output as z.infer<T>, usage: res.usage, model: res.model };
}

// ───────────── PO copy ─────────────
export const PoSchema = z.object({
  pur_no: z.string().nullable().describe("Purchase order number as printed, e.g. L0037354 or MP000921"),
  pur_date_printed: z.string().nullable(),
  supplier_code: z.string().nullable(),
  supplier_name: z.string().nullable(),
  lines: z.array(
    z.object({
      line_no: z.number().int(),
      stock_code: z.string(),
      stock_desc: z.string(),
      unit: z.string(),
      qty: z.number(),
    }),
  ),
  warnings: z.array(z.string()),
});
export type PoRead = z.infer<typeof PoSchema>;

export async function readPoCopy(file: AiFile) {
  return run(
    PoSchema,
    `You read purchase order copies (LPO / import PO) issued by Al Ras Steel (ARST or ARBM, UAE steel traders).
Return the PO header and every item line exactly as printed: stock code, stock description, unit (e.g. PCS, MT, KG) and ordered quantity as a number.
Never invent a stock code. If a value is not printed, return null (header) or explain in warnings (lines).`,
    [...fileBlocks([file]), { type: "text", text: "Read this purchase order." }],
  );
}

// ───────────── MTCs for a PO ─────────────
export const MtcSchema = z.object({
  certificates: z.array(
    z.object({
      file_no: z.number().int().describe("File number as labelled before each file, starting at 1"),
      page: z.number().int().describe("Page within that file where the certificate starts, starting at 1"),
      cert_no_printed: z.string().describe("Certificate number exactly as printed, e.g. APL/QC/2026/4189"),
      cert_date_printed: z.string().nullable().describe("Certificate date exactly as printed, e.g. 25.11.2026"),
      mill_printed: z.string().nullable().describe("Name of the mill / manufacturer that issued the certificate, as printed"),
      grade_printed: z.string().nullable().describe("Steel grade / specification as printed for the whole certificate, e.g. ASTM A500:2023, GRADE-B"),
      consignee: z.string().nullable(),
      rows: z.array(
        z.object({
          description: z.string().describe("Product and size as printed, e.g. RHST 120X60X4.00 x 6.000m"),
          qty: z.number().nullable(),
          qty_unit: z.string().nullable(),
          heat_no: z.string().nullable().describe("Heat number exactly as printed, including ranges like X-4,5,11"),
          grade_printed: z.string().nullable().describe("Grade printed on this row, if it differs per row"),
        }),
      ),
    }),
  ),
  allocations: z.array(
    z.object({
      po_line_no: z.number().int(),
      cert_no_printed: z.string(),
      heat_no: z.string().nullable(),
      qty: z.number().describe("Quantity of this PO line covered by this certificate row, in the PO line's unit"),
      grade_printed: z.string().nullable(),
      confidence: z.enum(["high", "medium", "low"]),
      note: z.string().nullable(),
    }),
  ),
  unmatched_po_lines: z.array(z.object({ po_line_no: z.number().int(), reason: z.string() })),
  ignored_rows: z.array(z.object({ cert_no_printed: z.string(), description: z.string(), reason: z.string() })),
  warnings: z.array(z.string()),
});
export type MtcRead = z.infer<typeof MtcSchema>;

export type PoLineIn = { line_no: number; stock_code: string; stock_desc: string; unit: string; qty: number };

const MTC_SYSTEM = `You read mill test certificates (MTCs) for steel received by Al Ras Steel, a UAE steel trader, and match them to the lines of one purchase order.

The store's ERP already knows each PO line's stock code, description, unit and quantity. Your job is only to supply, for each PO line: certificate number, certificate date, heat number, grade and mill name.

Rules:
- Read every certificate in the files (one file can hold several certificates, one per page or more). Report each with all its product rows.
- Match certificate rows to PO lines by product type and size (e.g. RHST 120X60X4.00 = rectangular tube 120 x 60 x 4.0 mm = stock code T120060040B). Thickness, size and length must agree.
- One PO line can be covered by several certificate rows (split by quantity). One certificate row can cover several PO lines with the same item (e.g. 672 pcs on the certificate covering PO lines of 144 + 528). Allocate quantities so each PO line's total equals its ordered quantity when the certificates allow it; never allocate more than a certificate row's quantity in total.
- Rows for items that are not on this PO are not allocated; list them in ignored_rows.
- If a PO line has no certificate row, put it in unmatched_po_lines with the reason. Never copy a heat number, grade or certificate from a similar line or guess one.
- Keep heat numbers, certificate numbers and dates exactly as printed. Do not reformat them.
- Grade: take it from the row if printed per row, otherwise from the certificate's specification line. If no grade is printed anywhere, return null.
- Mill: the company that manufactured and certified the steel (the certificate issuer), not the supplier or consignee.
- Add a warning for anything the store should check: unreadable digits, a date that could be month-first, quantities that don't reconcile, a consignee that is not Al Ras.`;

export async function readMtcsForPo(files: AiFile[], purNo: string, lines: PoLineIn[]) {
  const table = lines
    .map((l) => `${l.line_no}\t${l.stock_code}\t${l.stock_desc}\t${l.unit}\t${l.qty}`)
    .join("\n");
  return run(MtcSchema, MTC_SYSTEM, [
    ...fileBlocks(files),
    {
      type: "text",
      text: `Purchase order ${purNo}. PO lines (line no, stock code, description, unit, quantity):\n${table}\n\nRead every certificate in the files above and allocate their rows to these PO lines.`,
    },
  ]);
}
