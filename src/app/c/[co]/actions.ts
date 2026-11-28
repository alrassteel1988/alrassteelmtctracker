"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompany } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { audit, createBatchExcel, extractMtcs, getSettings, readPo, registerFile, ensurePo, refreshPoFromBatches } from "@/lib/po";
import { headerValues, runChecks, remainingLines, type PoLine } from "@/lib/match";
import { normalisePur, parseCertDate, PUR_RE, purCompanyProblem } from "@/lib/normalize";

export type ActionResult = { ok: boolean; message?: string; pur?: string };

async function ctx(co: string) {
  const { user, co: code } = await requireCompany(co);
  return { user, co: code, db: await supabaseServer() };
}

async function poFor(db: Awaited<ReturnType<typeof supabaseServer>>, co: string, pur: string) {
  const { data } = await db.from("purchase_orders").select("*").eq("company_code", co).eq("pur_no", pur).single();
  if (!data) throw new Error("PO not found");
  return data;
}

const err = (e: unknown): ActionResult => ({ ok: false, message: e instanceof Error ? e.message : String(e) });

/** Explain database errors caused by a migration that has not been run yet. */
function dbHint(message: string) {
  return /column|schema cache|does not exist/i.test(message)
    ? `${message}. The database needs the latest update: an admin should run supabase/migrations/0002_po_list_import.sql and 0003_partial_batches.sql in the Supabase SQL editor, then try again.`
    : message;
}

/** Called by the browser after it has put the files in storage. */
export async function registerUploads(
  co: string,
  pur: string,
  files: { path: string; name: string; sha256: string; size: number; mime: string; kind: "po" | "mtc" }[],
): Promise<ActionResult & { results?: { name: string; duplicate: boolean; duplicateOf: string | null }[] }> {
  try {
    const { db, co: code } = await ctx(co);
    const p = normalisePur(pur);
    if (!PUR_RE.test(p)) return { ok: false, message: code === "ARBM" ? "The PO number should look like LP020491 (local) or IPO#G063 (import)." : "The PO number should look like LP009263 (local) or IPO#01259 (import)." };
    const wrongCo = purCompanyProblem(code, p);
    if (wrongCo) return { ok: false, message: wrongCo };
    await ensurePo(db, code, p);
    const results = [];
    for (const f of files) {
      if (!f.path.startsWith(`${code}/`)) throw new Error("Bad upload path");
      const r = await registerFile(db, { company: code, ...f, source: "manual", pur: p });
      results.push({ name: f.name, duplicate: r.duplicate, duplicateOf: r.duplicateOf });
    }
    revalidatePath(`/c/${code}`, "layout");
    return { ok: true, pur: p, results };
  } catch (e) {
    return err(e);
  }
}

export async function assignFile(co: string, fileId: string, form: FormData) {
  const { db, co: code } = await ctx(co);
  const pur = normalisePur(String(form.get("pur") ?? ""));
  if (!PUR_RE.test(pur) || purCompanyProblem(code, pur)) return;
  const kind = form.get("kind") === "po" ? "po" : "mtc";
  const poId = await ensurePo(db, code, pur);
  await db.from("files").update({ status: "linked", pur_no_hint: pur, kind }).eq("id", fileId).eq("company_code", code);
  await db.from("po_files").upsert({ po_id: poId, file_id: fileId });
  await audit(db, code, poId, "file.assigned", { fileId, pur });
  revalidatePath(`/c/${code}/intake`);
}

export async function linkExistingFile(co: string, pur: string, form: FormData) {
  const { db, co: code } = await ctx(co);
  const po = await poFor(db, code, pur);
  const fileId = String(form.get("file_id") ?? "");
  if (!fileId) return;
  await db.from("po_files").upsert({ po_id: po.id, file_id: fileId });
  await audit(db, code, po.id, "file.linked", { fileId });
  revalidatePath(`/c/${code}/po/${pur}`);
}

export async function unlinkFile(co: string, pur: string, fileId: string) {
  const { db, co: code } = await ctx(co);
  const po = await poFor(db, code, pur);
  await db.from("po_files").delete().eq("po_id", po.id).eq("file_id", fileId);
  await audit(db, code, po.id, "file.unlinked", { fileId });
  revalidatePath(`/c/${code}/po/${pur}`);
}

export async function setFileKind(co: string, pur: string, fileId: string, kind: "po" | "mtc") {
  const { db, co: code } = await ctx(co);
  await db.from("files").update({ kind }).eq("id", fileId).eq("company_code", code);
  revalidatePath(`/c/${code}/po/${pur}`);
}

export async function saveHeader(co: string, pur: string, form: FormData) {
  const { db, co: code } = await ctx(co);
  const po = await poFor(db, code, pur);
  const d = String(form.get("pur_date") ?? "");
  await db
    .from("purchase_orders")
    .update({
      pur_date: d || null,
      shipment_date: String(form.get("shipment_date") ?? "") || null,
      supplier_contract_no: String(form.get("supplier_contract_no") ?? "").trim() || null,
      supplier_code: String(form.get("supplier_code") ?? "").trim().toUpperCase() || null,
      supplier_name: String(form.get("supplier_name") ?? "").trim().toUpperCase() || null,
    })
    .eq("id", po.id);
  revalidatePath(`/c/${code}/po/${pur}`);
}

/** Lines typed or pasted from the ERP grid: one per row, tab or 2+ spaces separated: Stock Code, Stock Desc, Unit, Quantity */
export async function saveLines(co: string, pur: string, lines: { stock_code: string; stock_desc: string; unit: string; qty: number }[]): Promise<ActionResult> {
  try {
    const { db, co: code } = await ctx(co);
    const po = await poFor(db, code, pur);
    const { count: batches } = await db.from("erp_batches").select("id", { count: "exact", head: true }).eq("po_id", po.id);
    if (batches) return { ok: false, message: "Some lines are already approved for the ERP. Re-import the PO list to update quantities instead." };
    const clean = lines.filter((l) => l.stock_code.trim() && Number(l.qty) > 0);
    await db.from("export_lines").delete().eq("po_id", po.id);
    await db.from("po_lines").delete().eq("po_id", po.id);
    if (clean.length) {
      const { error } = await db.from("po_lines").insert(
        clean.map((l, i) => ({ po_id: po.id, line_no: i + 1, stock_code: l.stock_code.trim().toUpperCase(), stock_desc: l.stock_desc.trim(), unit: (l.unit || "PCS").trim().toUpperCase(), qty: Number(l.qty) })),
      );
      if (error) throw new Error(error.message);
    }
    await db.from("purchase_orders").update({ status: "draft", status_note: null }).eq("id", po.id);
    await audit(db, code, po.id, "po.lines_saved", { lines: clean.length });
    revalidatePath(`/c/${code}/po/${pur}`);
    return { ok: true };
  } catch (e) {
    return err(e);
  }
}

export async function readPoAction(co: string, pur: string): Promise<ActionResult> {
  try {
    const { db, co: code, user } = await ctx(co);
    const po = await poFor(db, code, pur);
    const r = await readPo(db, po.id, user.email, true);
    revalidatePath(`/c/${code}/po/${pur}`);
    return { ok: true, message: r.skipped ? "PO lines already present." : `Read ${r.lines} line(s) from the PO copy.${r.warnings?.length ? " " + r.warnings.join(" ") : ""}` };
  } catch (e) {
    return err(e);
  }
}

export async function extractAction(co: string, pur: string): Promise<ActionResult> {
  try {
    const { db, co: code, user } = await ctx(co);
    const po = await poFor(db, code, pur);
    const { count } = await db.from("po_lines").select("id", { count: "exact", head: true }).eq("po_id", po.id);
    if (!count) await readPo(db, po.id, user.email);
    const r = await extractMtcs(db, po.id, user.email);
    revalidatePath(`/c/${code}/po/${pur}`);
    return { ok: true, message: r.blocked ? "Read. Some PO lines have no certificate: see the review." : "Read. Check the yellow fields and approve." };
  } catch (e) {
    return err(e);
  }
}

export type EditRow = {
  id?: string;
  po_line_id: string | null;
  stock_code: string;
  stock_desc: string;
  unit: string;
  qty: number;
  cert_date: string | null;
  cert_no: string | null;
  heat_no: string | null;
  grade: string | null;
  grade_remark: string | null;
  grade_remark_note: string | null;
  mill_name: string | null;
  certificate_id: string | null;
  flags: string[];
};

export async function saveExportLines(co: string, pur: string, rows: EditRow[], approve: boolean): Promise<ActionResult> {
  try {
    const { db, co: code, user } = await ctx(co);
    const po = await poFor(db, code, pur);
    if (["approved", "erp_done"].includes(po.status)) return { ok: false, message: "Every line is already approved." };
    const [{ data: lines }, { data: approvedRows }] = await Promise.all([
      db.from("po_lines").select("*").eq("po_id", po.id),
      db.from("export_lines").select("po_line_id, qty, seq").eq("po_id", po.id).not("batch_id", "is", null),
    ]);
    const pending = remainingLines((lines ?? []) as PoLine[], (approvedRows ?? []).map((r) => ({ po_line_id: r.po_line_id, qty: Number(r.qty) })));
    const startSeq = Math.max(0, ...(approvedRows ?? []).map((r) => r.seq));
    const clean = rows.map((r, i) => ({
      po_id: po.id, seq: startSeq + i + 1, po_line_id: r.po_line_id, stock_code: r.stock_code, stock_desc: r.stock_desc, unit: r.unit,
      qty: Number(r.qty), cert_date: r.cert_date || null, cert_no: r.cert_no?.trim() || null, heat_no: r.heat_no?.trim() || null,
      grade: r.grade?.trim().toUpperCase() || null, grade_remark: r.grade?.trim() ? null : r.grade_remark || null,
      grade_remark_note: r.grade_remark_note || null, mill_name: r.mill_name?.trim().toUpperCase() || null,
      certificate_id: r.certificate_id, flags: r.flags ?? [],
    }));
    if (approve) {
      const bad = runChecks(clean, pending).filter((c) => c.ok === false);
      if (bad.length) return { ok: false, message: `Can't approve yet: ${bad.map((b) => `${b.title} (${b.detail})`).join("; ")}` };
    }
    await db.from("export_lines").delete().eq("po_id", po.id).is("batch_id", null);
    // when approving, rows without a certificate are dropped: those lines simply stay pending
    const toSave = approve ? clean.filter((r) => r.cert_no && r.heat_no).map((r, i) => ({ ...r, seq: startSeq + i + 1 })) : clean;
    if (approve) {
      const s = await getSettings(db);
      const h = headerValues(toSave, s.headerMillRule, s.headerDateRule);
      const { data: last } = await db.from("erp_batches").select("batch_no").eq("po_id", po.id).order("batch_no", { ascending: false }).limit(1).maybeSingle();
      const { data: batch, error: be } = await db
        .from("erp_batches")
        .insert({ po_id: po.id, batch_no: (last?.batch_no ?? 0) + 1, header_mill: h.mill, header_cert_date: h.date, approved_by: user.email })
        .select("id, batch_no")
        .single();
      if (be) throw new Error(be.message);
      const { error } = await db.from("export_lines").insert(toSave.map((r) => ({ ...r, batch_id: batch.id })));
      if (error) throw new Error(error.message);
      await createBatchExcel(db, batch.id);
      const st = await refreshPoFromBatches(db, po.id);
      await audit(db, code, po.id, "po.approved", { batch: batch.batch_no, rows: toSave.length, header: h, pending_lines: st.pendingLines });
      revalidatePath(`/c/${code}/po/${pur}`);
      return { ok: true, message: st.pendingLines ? `Approved ${toSave.length} row(s). ${st.pendingLines} line(s) stay pending for the next shipment.` : "Approved. The Excel is ready." };
    }
    if (toSave.length) {
      const { error } = await db.from("export_lines").insert(toSave);
      if (error) throw new Error(error.message);
    }
    await refreshPoFromBatches(db, po.id);
    await audit(db, code, po.id, "po.draft_saved", { rows: toSave.length });
    revalidatePath(`/c/${code}/po/${pur}`);
    return { ok: true, message: "Draft saved." };
  } catch (e) {
    return err(e);
  }
}

/** Takes back the latest batch (only while it has no ERP MTC No.): its rows return to review. */
export async function reopenBatch(co: string, pur: string, batchId: string) {
  const { db, co: code } = await ctx(co);
  const po = await poFor(db, code, pur);
  const { data: b } = await db.from("erp_batches").select("id, batch_no, erp_mtc_no").eq("id", batchId).eq("po_id", po.id).single();
  const { data: last } = await db.from("erp_batches").select("id").eq("po_id", po.id).order("batch_no", { ascending: false }).limit(1).single();
  if (!b || b.erp_mtc_no || last?.id !== b.id) return;
  await db.from("export_lines").delete().eq("po_id", po.id).is("batch_id", null);
  await db.from("export_lines").update({ batch_id: null }).eq("batch_id", b.id);
  await db.from("erp_batches").delete().eq("id", b.id);
  await refreshPoFromBatches(db, po.id);
  await audit(db, code, po.id, "po.reopened", { batch: b.batch_no });
  revalidatePath(`/c/${code}/po/${pur}`);
}

export async function saveErpNo(co: string, pur: string, batchId: string, form: FormData) {
  const { db, co: code } = await ctx(co);
  const po = await poFor(db, code, pur);
  const no = String(form.get("erp_mtc_no") ?? "").trim();
  const date = String(form.get("erp_mtc_date") ?? "") || new Date().toISOString().slice(0, 10);
  if (!no) return;
  await db.from("erp_batches").update({ erp_mtc_no: no, erp_mtc_date: date }).eq("id", batchId).eq("po_id", po.id);
  await refreshPoFromBatches(db, po.id);
  await audit(db, code, po.id, "po.erp_no", { erp_mtc_no: no, date, batchId });
  revalidatePath(`/c/${code}/po/${pur}`);
}

export async function addReceipt(co: string, pur: string, form: FormData) {
  const { db, co: code } = await ctx(co);
  const po = await poFor(db, code, pur);
  await db.from("receipts").insert({
    po_id: po.id,
    grn_no: String(form.get("grn_no") ?? "").trim() || null,
    received_date: String(form.get("received_date") ?? "") || null,
    warehouse: String(form.get("warehouse") ?? "").trim() || null,
    status: String(form.get("status") ?? "received"),
  });
  revalidatePath(`/c/${code}/po/${pur}`);
}

export async function deleteReceipt(co: string, pur: string, id: string) {
  const { db, co: code } = await ctx(co);
  await db.from("receipts").delete().eq("id", id);
  revalidatePath(`/c/${code}/po/${pur}`);
}

export async function goToPo(co: string, form: FormData) {
  const { co: code } = await requireCompany(co);
  const pur = normalisePur(String(form.get("pur") ?? ""));
  redirect(`/c/${code}/po/${pur}`);
}

/** Load or refresh the company's supplier list from the ERP export (Supplier Code, Supplier). */
export async function importSuppliers(co: string, form: FormData): Promise<ActionResult & { summary?: string[] }> {
  try {
    const { db, co: code } = await ctx(co);
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) return { ok: false, message: "Choose the Excel file first." };
    if (file.size > 4 * 1024 * 1024) return { ok: false, message: "The file is larger than 4 MB." };
    const { parseSupplierList } = await import("@/lib/supplierimport");
    const { suppliers, skipped } = await parseSupplierList(await file.arrayBuffer());
    if (!suppliers.length) return { ok: false, message: skipped[0] ?? "No suppliers found in the file." };
    const { error } = await db.from("suppliers").upsert(
      suppliers.map((s) => ({ company_code: code, code: s.code, name: s.name, updated_at: new Date().toISOString() })),
      { onConflict: "company_code,code" },
    );
    if (error) throw new Error(/suppliers|schema cache|does not exist/i.test(error.message)
      ? `${error.message}. The database needs the supplier table: an admin should run supabase/migrations/0004_suppliers.sql and 0005_supplier_master.sql in the Supabase SQL editor, then try again.`
      : error.message);
    const filled = await fillSupplierCodes(db, code);
    await audit(db, code, null, "suppliers.imported", { file: file.name, suppliers: suppliers.length, filled, skipped: skipped.length });
    revalidatePath(`/c/${code}`, "layout");
    return {
      ok: true,
      summary: [
        `${suppliers.length} suppliers loaded from ${file.name}.`,
        ...(filled ? [`Supplier code filled in on ${filled} purchase order(s).`] : []),
        ...(skipped.length ? [`Skipped ${skipped.length} row(s): ${skipped.slice(0, 5).join("; ")}`] : []),
      ],
    };
  } catch (e) {
    return err(e);
  }
}

/** Set supplier_code on the company's POs that only have a supplier name. Returns how many were filled. */
async function fillSupplierCodes(db: Awaited<ReturnType<typeof supabaseServer>>, code: string) {
  const { supplierKey } = await import("@/lib/supplierimport");
  const [{ data: sup, error }, { data: pos }] = await Promise.all([
    db.from("suppliers").select("code, name_key").eq("company_code", code),
    db.from("purchase_orders").select("id, supplier_name, supplier_code").eq("company_code", code),
  ]);
  if (error || !sup?.length) return 0;
  // a name listed under several codes is ambiguous: leave those POs for a person to set
  const codes = new Map<string, Set<string>>();
  for (const s of sup) codes.set(s.name_key as string, (codes.get(s.name_key as string) ?? new Set()).add(s.code as string));
  const byKey = new Map([...codes].filter(([, c]) => c.size === 1).map(([k, c]) => [k, [...c][0]]));
  const todo = (pos ?? []).filter((p) => !p.supplier_code && byKey.has(supplierKey(p.supplier_name)));
  await Promise.all(todo.map((p) => db.from("purchase_orders").update({ supplier_code: byKey.get(supplierKey(p.supplier_name)) }).eq("id", p.id)));
  return todo.length;
}

export async function addMillAlias(co: string, form: FormData) {
  const { db, co: code } = await ctx(co);
  const printed = String(form.get("printed") ?? "").trim();
  const erp = String(form.get("erp_name") ?? "").trim().toUpperCase();
  if (!printed || !erp) return;
  await db.from("mill_aliases").upsert({ printed, erp_name: erp }, { onConflict: "printed" });
  await audit(db, code, null, "master.mill_alias", { printed, erp });
  revalidatePath(`/c/${code}/masters`);
}

export { parseCertDate };

/** Loads a PO list exported from the ERP (one row per line item). New POs are created; existing ones get their
 *  header and line quantities refreshed. Lines of a PO that already has certificate rows are not replaced. */
export async function importPoList(co: string, form: FormData): Promise<ActionResult & { summary?: string[] }> {
  try {
    const { db, co: code } = await ctx(co);
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) return { ok: false, message: "Choose the Excel file first." };
    if (file.size > 4 * 1024 * 1024) return { ok: false, message: "The file is larger than 4 MB; split it and import in parts." };
    const { parsePoList } = await import("@/lib/poimport");
    const parsed = await parsePoList(await file.arrayBuffer());
    const skipped = [...parsed.skipped];
    const pos = parsed.pos.filter((p) => {
      const why = purCompanyProblem(code, p.pur_no);
      if (why) skipped.push(why);
      return !why;
    });
    if (!pos.length) return { ok: false, message: "No purchase order rows found in the file." };

    const { data: existing, error: exErr } = await db
      .from("purchase_orders")
      .select("id, pur_no, export_lines(id)")
      .eq("company_code", code)
      .in("pur_no", pos.map((p) => p.pur_no));
    if (exErr) throw new Error(dbHint(exErr.message));
    const have = new Map((existing ?? []).map((e) => [e.pur_no, e]));
    const created = pos.filter((p) => !have.has(p.pur_no)).length;
    const updated = pos.length - created;

    // one upsert for every PO header (unique company_code + pur_no)
    const { data: saved, error: upErr } = await db
      .from("purchase_orders")
      .upsert(
        pos.map((p) => ({
          company_code: code, pur_no: p.pur_no,
          pur_date: p.pur_date, supplier_name: p.supplier_name, supplier_contract_no: p.supplier_contract_no,
          shipment_date: p.shipment_date, source: "po_list",
        })),
        { onConflict: "company_code,pur_no" },
      )
      .select("id, pur_no");
    if (upErr) throw new Error(dbHint(upErr.message));
    const idOf = new Map((saved ?? []).map((r) => [r.pur_no, r.id as string]));

    // supplier code is only in some lists: set it where given, never blank it out
    await Promise.all(pos.filter((p) => p.supplier_code && idOf.get(p.pur_no)).map((p) =>
      db.from("purchase_orders").update({ supplier_code: p.supplier_code }).eq("id", idOf.get(p.pur_no)!)));

    const keep = pos.filter((p) => ((have.get(p.pur_no)?.export_lines as unknown[] | undefined) ?? []).length > 0);
    const replace = pos.filter((p) => !keep.includes(p));

    // POs without certificate rows: replace their lines in two calls
    const replaceIds = replace.map((p) => idOf.get(p.pur_no)).filter(Boolean) as string[];
    if (replaceIds.length) {
      const { error: delErr } = await db.from("po_lines").delete().in("po_id", replaceIds);
      if (delErr) throw new Error(dbHint(delErr.message));
    }
    const rows = replace.flatMap((p) => p.lines.map((l, i) => ({ po_id: idOf.get(p.pur_no)!, line_no: i + 1, ...l })));
    if (rows.length) {
      const { error: insErr } = await db.from("po_lines").insert(rows);
      if (insErr) throw new Error(dbHint(insErr.message));
    }
    const linesWritten = rows.length;

    // POs that already have certificate rows: only refresh received / balance quantities
    for (const p of keep) {
      const poId = idOf.get(p.pur_no)!;
      await Promise.all(p.lines.map((l) =>
        db.from("po_lines").update({ purchase_qty: l.purchase_qty, balance_qty: l.balance_qty }).eq("po_id", poId).eq("stock_code", l.stock_code)));
    }
    const kept = keep.length;
    await fillSupplierCodes(db, code).catch(() => 0);
    await audit(db, code, null, "po_list.imported", { file: file.name, pos: pos.length, created, updated, lines: linesWritten, skipped: skipped.length });
    revalidatePath(`/c/${code}`, "layout");
    const summary = [
      `${pos.length} purchase orders read from ${file.name}: ${created} new, ${updated} updated, ${linesWritten} lines loaded.`,
      ...(kept ? [`${kept} PO(s) already had certificate rows, so only their received and balance quantities were refreshed.`] : []),
      ...(skipped.length ? [`Skipped ${skipped.length} row(s): ${skipped.slice(0, 5).join("; ")}${skipped.length > 5 ? "…" : ""}`] : []),
    ];
    return { ok: true, summary };
  } catch (e) {
    return err(e);
  }
}
