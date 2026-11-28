import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BUCKET } from "./supabase/admin";
import { kindFromFileName, normalisePur, purFromFileName, parseCertDate } from "./normalize";
import { readMtcsForPo, readPoCopy, type AiFile, AI_MODEL } from "./ai";
import { buildExport, runChecks, remainingLines, type PoLine } from "./match";
import { buildMtcWorkbook, excelFileName } from "./excel";

type Db = SupabaseClient;

export async function audit(db: Db, company: string | null, poId: string | null, action: string, detail?: unknown, actor?: string) {
  await db.from("audit_log").insert({ company_code: company, po_id: poId, action, detail: detail ?? null, ...(actor ? { actor } : {}) });
}

export async function getSettings(db: Db) {
  const [{ data: s }, { data: grades }, { data: mills }] = await Promise.all([
    db.from("settings").select("key, value"),
    db.from("grade_rules").select("pattern, erp_grade, priority"),
    db.from("mill_aliases").select("printed, erp_name"),
  ]);
  const v = Object.fromEntries((s ?? []).map((r) => [r.key, r.value]));
  return {
    certNoMode: (v.cert_no_mode ?? "short") as "short" | "full",
    headerMillRule: (v.header_mill_rule ?? "first") as "first" | "most",
    headerDateRule: (v.header_date_rule ?? "latest") as "latest" | "earliest" | "first",
    excelFolder: (v.excel_folder ?? "D:\\MTC Excel\\{company}") as string,
    inboxFolder: (v.inbox_folder ?? "D:\\MTC Inbox\\{company}") as string,
    grades: grades ?? [],
    mills: mills ?? [],
  };
}

/** Finds or creates the PO record for a PUR#. */
export async function ensurePo(db: Db, company: string, purRaw: string, actor?: string) {
  const pur = normalisePur(purRaw);
  const { data: found } = await db.from("purchase_orders").select("id").eq("company_code", company).eq("pur_no", pur).maybeSingle();
  if (found) return found.id as string;
  const { data, error } = await db
    .from("purchase_orders")
    .insert({ company_code: company, pur_no: pur, ...(actor ? { created_by: actor } : {}) })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  await audit(db, company, data.id, "po.created", { pur_no: pur }, actor);
  return data.id as string;
}

export type RegisterInput = {
  company: string;
  path: string;
  name: string;
  sha256: string;
  size: number;
  mime: string;
  source: "manual" | "uploader";
  deviceId?: string | null;
  kind?: "po" | "mtc";
  pur?: string | null;
  actor?: string;
};

/** Records an uploaded file, skips duplicates by hash, and links it to its PO (from the form or the file name). */
export async function registerFile(db: Db, f: RegisterInput) {
  const { data: dup } = await db
    .from("files")
    .select("id, original_name, storage_path")
    .eq("company_code", f.company)
    .eq("sha256", f.sha256)
    .maybeSingle();
  const pur = f.pur ? normalisePur(f.pur) : purFromFileName(f.name);
  const kind = f.kind ?? kindFromFileName(f.name);
  let fileId: string;
  let duplicate = false;
  if (dup) {
    fileId = dup.id;
    duplicate = true;
    if (f.path && f.path !== dup.storage_path) await db.storage.from(BUCKET).remove([f.path]).catch(() => null);
  } else {
    const { data, error } = await db
      .from("files")
      .insert({
        company_code: f.company, kind, storage_path: f.path, original_name: f.name, mime_type: f.mime,
        size_bytes: f.size, sha256: f.sha256, pur_no_hint: pur, source: f.source, device_id: f.deviceId ?? null,
        status: pur ? "linked" : "needs_po", ...(f.actor ? { uploaded_by: f.actor } : {}),
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    fileId = data.id;
  }
  let poId: string | null = null;
  if (pur) {
    poId = await ensurePo(db, f.company, pur, f.actor);
    await db.from("po_files").upsert({ po_id: poId, file_id: fileId });
    if (dup) await db.from("files").update({ status: "linked" }).eq("id", fileId).eq("status", "needs_po");
  }
  await audit(db, f.company, poId, duplicate ? "file.duplicate" : "file.uploaded", { name: f.name, kind, source: f.source, pur }, f.actor);
  return { fileId, poId, pur, kind, duplicate, duplicateOf: dup?.original_name ?? null };
}

async function loadFile(db: Db, path: string, name: string, mime: string | null): Promise<AiFile> {
  const { data, error } = await db.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`Could not open ${name}: ${error?.message ?? "missing"}`);
  const type = mime || (name.toLowerCase().endsWith(".pdf") ? "application/pdf" : data.type);
  return { name, mime: type, data: Buffer.from(await data.arrayBuffer()) };
}

/** Reads the PO copy with AI and fills header + lines (only when the PO has no lines yet, unless forced). */
export async function readPo(db: Db, poId: string, actor: string, force = false) {
  const { data: po } = await db.from("purchase_orders").select("*, po_files(files(*))").eq("id", poId).single();
  if (!po) throw new Error("PO not found");
  const files = (po.po_files as { files: Record<string, string> }[]).map((x) => x.files).filter((f) => f.kind === "po");
  if (!files.length) throw new Error("No PO copy attached. Upload the PO copy, or type the PO lines.");
  const { count } = await db.from("po_lines").select("id", { count: "exact", head: true }).eq("po_id", poId);
  if (count && !force) return { skipped: true };
  const f = files[0];
  const res = await readPoCopy(await loadFile(db, f.storage_path, f.original_name, f.mime_type));
  const r = res.data;
  if (r.pur_no && normalisePur(r.pur_no) !== po.pur_no) {
    r.warnings.push(`The PO copy shows ${r.pur_no}, not ${po.pur_no}. Check the file.`);
  }
  await db.from("po_lines").delete().eq("po_id", poId);
  if (r.lines.length) {
    const { error } = await db.from("po_lines").insert(
      r.lines.map((l, i) => ({ po_id: poId, line_no: i + 1, stock_code: l.stock_code.trim(), stock_desc: l.stock_desc.trim(), unit: l.unit.trim() || "PCS", qty: l.qty })),
    );
    if (error) throw new Error(error.message);
  }
  await db
    .from("purchase_orders")
    .update({
      pur_date: po.pur_date ?? parseCertDate(r.pur_date_printed).iso,
      supplier_code: po.supplier_code ?? r.supplier_code,
      supplier_name: po.supplier_name ?? r.supplier_name,
    })
    .eq("id", poId);
  await db.from("files").update({ status: "read" }).eq("id", f.id);
  await audit(db, po.company_code, poId, "po.read", { lines: r.lines.length, warnings: r.warnings, model: res.model }, actor);
  return { skipped: false, lines: r.lines.length, warnings: r.warnings };
}

/** Reads the PO's MTCs (except files already used by approved batches), matches them to the quantities still pending,
 *  and stores the rows for review. Rows already approved in a batch are never touched. */
export async function extractMtcs(db: Db, poId: string, actor: string) {
  const { data: po } = await db.from("purchase_orders").select("*, po_files(files(*))").eq("id", poId).single();
  if (!po) throw new Error("PO not found");
  if (["approved", "erp_done"].includes(po.status)) throw new Error("Every line of this PO is already approved.");
  const { data: lines } = await db.from("po_lines").select("*").eq("po_id", poId).order("line_no");
  if (!lines?.length) throw new Error("This PO has no lines yet. Read the PO copy or type the lines first.");
  const { data: approvedRows } = await db.from("export_lines").select("po_line_id, qty, seq, certificates(file_id)").eq("po_id", poId).not("batch_id", "is", null);
  const pending = remainingLines(lines as PoLine[], (approvedRows ?? []).map((r) => ({ po_line_id: r.po_line_id, qty: Number(r.qty) })));
  if (!pending.length) throw new Error("Every line of this PO is already approved.");
  const usedFiles = new Set((approvedRows ?? []).map((r) => (r.certificates as unknown as { file_id: string } | null)?.file_id).filter(Boolean));
  const files = (po.po_files as { files: Record<string, string> }[])
    .map((x) => x.files)
    .filter((f) => f.kind === "mtc" && !usedFiles.has(f.id));
  if (!files.length) throw new Error(usedFiles.size ? "No new MTC attached since the last approval. Attach the next shipment's MTC." : "No MTC attached to this PO yet.");

  await db.from("purchase_orders").update({ status: "reading", status_note: null }).eq("id", poId);
  try {
    const aiFiles = await Promise.all(files.map((f) => loadFile(db, f.storage_path, f.original_name, f.mime_type)));
    const res = await readMtcsForPo(aiFiles, po.pur_no, pending.map((l) => ({ ...l, qty: Number(l.qty) })));
    const settings = await getSettings(db);
    const built = buildExport(res.data, pending, settings);

    // Certificates: stored once per file + number, reused by every PO that links the file
    const certIds = new Map<string, string>();
    for (const c of built.certs) {
      const file = files[c.file_no - 1] ?? files[0];
      const row = {
        company_code: po.company_code, file_id: file.id, page: c.page, cert_no_full: c.cert_no_full, cert_no_short: c.cert_no_short,
        cert_date: c.cert_date, cert_date_printed: c.cert_date_printed, mill_printed: c.mill_printed, mill_name: c.mill_name,
        grade_printed: c.grade_printed, grade: c.grade, rows: c.rows,
      };
      const { data: existing } = await db.from("certificates").select("id").eq("file_id", file.id).eq("cert_no_full", c.cert_no_full).maybeSingle();
      if (existing) {
        await db.from("certificates").update(row).eq("id", existing.id);
        certIds.set(c.cert_no_full, existing.id);
      } else {
        const { data } = await db.from("certificates").insert(row).select("id").single();
        if (data) certIds.set(c.cert_no_full, data.id);
      }
    }
    await db.from("export_lines").delete().eq("po_id", poId).is("batch_id", null);
    const startSeq = Math.max(0, ...(approvedRows ?? []).map((r) => r.seq));
    const { error } = await db.from("export_lines").insert(
      built.lines.map((l) => ({
        po_id: poId, seq: startSeq + l.seq, po_line_id: l.po_line_id, stock_code: l.stock_code, stock_desc: l.stock_desc, unit: l.unit, qty: l.qty,
        cert_date: l.cert_date, cert_no: l.cert_no, heat_no: l.heat_no, grade: l.grade, mill_name: l.mill_name,
        certificate_id: l.cert_no_full ? certIds.get(l.cert_no_full) ?? null : null,
        flags: l.note ? [...l.flags, `note:${l.note}`] : l.flags,
      })),
    );
    if (error) throw new Error(error.message);
    const checks = runChecks(built.lines, pending, res.data.ignored_rows.length);
    const none = checks.find((c) => c.key === "coverage")?.ok === false;
    const unmatched = res.data.unmatched_po_lines.map((u) => `Line ${u.po_line_no}: ${u.reason}`).join("; ");
    await db
      .from("purchase_orders")
      .update({
        status: none ? "blocked" : "review",
        status_note: none ? unmatched || "No PO line matched the certificates" : unmatched ? `Pending: ${unmatched}` : null,
        ai_summary: {
          model: res.model, at: new Date().toISOString(), warnings: res.data.warnings, ignored_rows: res.data.ignored_rows,
          unmatched: res.data.unmatched_po_lines, certificates: built.certs.map((c) => ({ no: c.cert_no_full, file_no: c.file_no, page: c.page, file: (files[c.file_no - 1] ?? files[0]).original_name })),
          usage: res.usage,
        },
      })
      .eq("id", poId);
    await db.from("files").update({ status: "read" }).in("id", files.map((f) => f.id));
    await audit(db, po.company_code, poId, "mtc.read", { certificates: built.certs.length, lines: built.lines.length, pending_lines: pending.length, model: AI_MODEL }, actor);
    return { ok: true, blocked: none };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const back = (approvedRows ?? []).length ? "partial" : "draft";
    await db.from("purchase_orders").update({ status: back, status_note: `AI reading failed: ${msg}` }).eq("id", poId);
    await audit(db, po.company_code, poId, "mtc.read_failed", { error: msg }, actor);
    throw e;
  }
}

export const batchFileName = (pur: string, batchNo: number) => (batchNo > 1 ? excelFileName(`${pur}-${batchNo}`) : excelFileName(pur));

/** Builds the Excel for one approved batch and stores it in the bucket. */
export async function createBatchExcel(db: Db, batchId: string) {
  const { data: b } = await db.from("erp_batches").select("id, batch_no, excel_version, excel_path, purchase_orders(company_code, pur_no)").eq("id", batchId).single();
  if (!b) throw new Error("Batch not found");
  const po = b.purchase_orders as unknown as { company_code: string; pur_no: string };
  const { data: rows } = await db.from("export_lines").select("*").eq("batch_id", batchId).order("seq");
  const buf = await buildMtcWorkbook((rows ?? []).map((r) => ({ ...r, qty: Number(r.qty) })));
  const path = `${po.company_code}/excel/${batchFileName(po.pur_no, b.batch_no)}`;
  const { error } = await db.storage.from(BUCKET).upload(path, buf, {
    upsert: true,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  if (error) throw new Error(error.message);
  await db.from("erp_batches").update({ excel_path: path, excel_version: b.excel_path ? (b.excel_version ?? 1) + 1 : 1 }).eq("id", batchId);
  return path;
}

/** Recomputes PO status and the summary columns shown in lists from its batches. */
export async function refreshPoFromBatches(db: Db, poId: string) {
  const [{ data: lines }, { data: approved }, { data: batches }, { count: pendingRows }] = await Promise.all([
    db.from("po_lines").select("id, line_no, stock_code, stock_desc, unit, qty").eq("po_id", poId),
    db.from("export_lines").select("po_line_id, qty").eq("po_id", poId).not("batch_id", "is", null),
    db.from("erp_batches").select("*").eq("po_id", poId).order("batch_no"),
    db.from("export_lines").select("id", { count: "exact", head: true }).eq("po_id", poId).is("batch_id", null),
  ]);
  const left = remainingLines((lines ?? []) as PoLine[], (approved ?? []).map((a) => ({ po_line_id: a.po_line_id, qty: Number(a.qty) })));
  const bs = batches ?? [];
  const last = bs[bs.length - 1];
  let status: string;
  if (!bs.length) status = pendingRows ? "review" : "draft";
  else if (left.length) status = pendingRows ? "review" : "partial";
  else status = bs.every((b) => b.erp_mtc_no) ? "erp_done" : "approved";
  await db
    .from("purchase_orders")
    .update({
      status,
      status_note: left.length && bs.length ? `${left.length} line(s) pending the next shipment's MTC` : null,
      header_mill: last?.header_mill ?? null,
      header_cert_date: last?.header_cert_date ?? null,
      erp_mtc_no: bs.map((b) => b.erp_mtc_no).filter(Boolean).join(", ") || null,
      erp_mtc_date: last?.erp_mtc_date ?? null,
      excel_path: last?.excel_path ?? null,
      approved_by: last?.approved_by ?? null,
      approved_at: last?.approved_at ?? null,
    })
    .eq("id", poId);
  return { status, pendingLines: left.length };
}
