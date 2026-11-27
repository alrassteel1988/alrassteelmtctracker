"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompany } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { audit, createExcel, extractMtcs, getSettings, readPo, registerFile, ensurePo } from "@/lib/po";
import { headerValues, runChecks, type PoLine } from "@/lib/match";
import { normalisePur, parseCertDate } from "@/lib/normalize";

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

/** Called by the browser after it has put the files in storage. */
export async function registerUploads(
  co: string,
  pur: string,
  files: { path: string; name: string; sha256: string; size: number; mime: string; kind: "po" | "mtc" }[],
): Promise<ActionResult & { results?: { name: string; duplicate: boolean; duplicateOf: string | null }[] }> {
  try {
    const { db, co: code } = await ctx(co);
    const p = normalisePur(pur);
    if (!/^(L|MP)\d{5,9}$/.test(p)) return { ok: false, message: "PUR# should look like L0037354 or MP000921." };
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
  if (!/^(L|MP)\d{5,9}$/.test(pur)) return;
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
    if (["approved", "erp_done"].includes(po.status)) return { ok: false, message: "Reopen the PO before changing its lines." };
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
    if (["approved", "erp_done"].includes(po.status)) return { ok: false, message: "Already approved. Reopen it to edit." };
    const { data: lines } = await db.from("po_lines").select("*").eq("po_id", po.id);
    const clean = rows.map((r, i) => ({
      po_id: po.id, seq: i + 1, po_line_id: r.po_line_id, stock_code: r.stock_code, stock_desc: r.stock_desc, unit: r.unit,
      qty: Number(r.qty), cert_date: r.cert_date || null, cert_no: r.cert_no?.trim() || null, heat_no: r.heat_no?.trim() || null,
      grade: r.grade?.trim().toUpperCase() || null, grade_remark: r.grade?.trim() ? null : r.grade_remark || null,
      grade_remark_note: r.grade_remark_note || null, mill_name: r.mill_name?.trim().toUpperCase() || null,
      certificate_id: r.certificate_id, flags: r.flags ?? [],
    }));
    if (approve) {
      const checks = runChecks(clean, (lines ?? []) as PoLine[]);
      const bad = checks.filter((c) => c.ok === false);
      if (bad.length) return { ok: false, message: `Can't approve yet: ${bad.map((b) => `${b.title} (${b.detail})`).join("; ")}` };
    }
    await db.from("export_lines").delete().eq("po_id", po.id);
    if (clean.length) {
      const { error } = await db.from("export_lines").insert(clean);
      if (error) throw new Error(error.message);
    }
    if (approve) {
      const s = await getSettings(db);
      const h = headerValues(clean, s.headerMillRule, s.headerDateRule);
      await db
        .from("purchase_orders")
        .update({ status: "approved", status_note: null, header_mill: h.mill, header_cert_date: h.date, approved_by: user.email, approved_at: new Date().toISOString() })
        .eq("id", po.id);
      await createExcel(db, po.id);
      await audit(db, code, po.id, "po.approved", { rows: clean.length, header: h });
    } else {
      const coverage = runChecks(clean, (lines ?? []) as PoLine[]).find((c) => c.key === "coverage");
      await db.from("purchase_orders").update({ status: coverage?.ok ? "review" : "blocked" }).eq("id", po.id);
      await audit(db, code, po.id, "po.draft_saved", { rows: clean.length });
    }
    revalidatePath(`/c/${code}/po/${pur}`);
    return { ok: true, message: approve ? "Approved. The Excel is ready." : "Draft saved." };
  } catch (e) {
    return err(e);
  }
}

export async function reopen(co: string, pur: string) {
  const { db, co: code } = await ctx(co);
  const po = await poFor(db, code, pur);
  await db.from("purchase_orders").update({ status: "review", approved_at: null, approved_by: null }).eq("id", po.id);
  await audit(db, code, po.id, "po.reopened", null);
  revalidatePath(`/c/${code}/po/${pur}`);
}

export async function saveErpNo(co: string, pur: string, form: FormData) {
  const { db, co: code } = await ctx(co);
  const po = await poFor(db, code, pur);
  const no = String(form.get("erp_mtc_no") ?? "").trim();
  const date = String(form.get("erp_mtc_date") ?? "") || new Date().toISOString().slice(0, 10);
  if (!no) return;
  await db.from("purchase_orders").update({ erp_mtc_no: no, erp_mtc_date: date, status: "erp_done" }).eq("id", po.id);
  await audit(db, code, po.id, "po.erp_no", { erp_mtc_no: no, date });
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
