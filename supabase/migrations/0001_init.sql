-- Al Ras Steel MTC Tracker: phase 1 schema
-- Run in the Supabase SQL editor (or `supabase db push`).

create extension if not exists pgcrypto;

-- ───────────── Companies and users ─────────────
create table public.companies (
  code text primary key check (code in ('ARST','ARBM')),
  name text not null,
  location text
);
insert into public.companies (code, name, location) values
  ('ARST','Al Ras Steel Trading FZCO','Free Zone | JAFZA South'),
  ('ARBM','Al Ras Building Material','Mainland | Umm Al Quwain');

-- Allow-list of people who may use the app. Sign-in accounts live in Supabase Auth;
-- a row here (matched by email) decides role and company.
create table public.app_users (
  email text primary key check (email = lower(email)),
  full_name text not null,
  role text not null check (role in ('admin','store')),
  company_code text references public.companies(code),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (role = 'admin' or company_code is not null)
);
insert into public.app_users (email, full_name, role, company_code) values
  ('glory@alrassteel.com','Glory','admin',null),
  ('chiraag@alrassteel.com','Chiraag','admin',null),
  ('murugan@alrassteel.com','Murugan Pillai','store','ARST'),
  ('shafi@alrassteel.com','Mohammad Shafi','store','ARBM');

create or replace function public.my_email() returns text
language sql stable as $$ select lower(coalesce(auth.jwt()->>'email','')) $$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from app_users where email = my_email() and active and role = 'admin')
$$;

create or replace function public.can_access(company text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from app_users
    where email = my_email() and active
      and (role = 'admin' or company_code = company)
  )
$$;

-- ───────────── Settings and masters ─────────────
create table public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.settings (key, value) values
  ('cert_no_mode', '"short"'),          -- 'short' = last segment (APL/QC/2026/4189 → 4189), 'full' = as printed
  ('header_mill_rule', '"first"'),       -- 'first' line's mill, or 'most' common
  ('header_date_rule', '"latest"'),      -- 'latest' | 'earliest' | 'first'
  ('excel_folder', '"D:\\MTC Excel\\{company}"'),
  ('inbox_folder', '"D:\\MTC Inbox\\{company}"');

-- Printed mill name → agreed ERP mill name
create table public.mill_aliases (
  id uuid primary key default gen_random_uuid(),
  printed text not null unique,
  erp_name text not null,
  created_at timestamptz not null default now()
);
insert into public.mill_aliases (printed, erp_name) values
  ('A P L APOLLO TUBES COMPANY LLC','A P L APOLLO TUBES COMPANY L L C');

-- Grade normalisation: regex pattern (case-insensitive) → ERP grade
create table public.grade_rules (
  id uuid primary key default gen_random_uuid(),
  pattern text not null unique,
  erp_grade text not null,
  priority int not null default 100
);
insert into public.grade_rules (pattern, erp_grade, priority) values
  ('A\s*500.*(GR(ADE)?[\s\.\-]*B\b)', 'ASTM A500 GR.B', 10),
  ('A\s*500.*(GR(ADE)?[\s\.\-]*C\b)', 'ASTM A500 GR.C', 10),
  ('A\s*36\b', 'ASTM A36', 20),
  ('S\s*275\s*JR', 'S275JR', 20),
  ('S\s*355\s*JR', 'S355JR', 20),
  ('S\s*235\s*JR', 'S235JR', 20);

-- ───────────── Purchase orders ─────────────
create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  company_code text not null references public.companies(code),
  pur_no text not null,
  doctype text generated always as (case when pur_no ilike 'MP%' then 'IMP20' else 'PUR20' end) stored,
  po_type text generated always as (case when pur_no ilike 'MP%' then 'IMP' else 'LP' end) stored,
  pur_date date,
  supplier_code text,
  supplier_name text,
  status text not null default 'draft'
    check (status in ('draft','reading','review','blocked','approved','erp_done')),
  status_note text,
  header_mill text,
  header_cert_date date,
  erp_mtc_no text,
  erp_mtc_date date,
  ai_summary jsonb,           -- last AI run: checks, warnings, raw output
  approved_by text,
  approved_at timestamptz,
  excel_path text,
  excel_version int not null default 0,
  created_by text default public.my_email(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_code, pur_no)
);
create index on public.purchase_orders (company_code, status);

create table public.po_lines (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  line_no int not null,
  stock_code text not null,
  stock_desc text not null default '',
  unit text not null default 'PCS',
  qty numeric(14,3) not null,
  unique (po_id, line_no)
);

-- Receipts (GRN) against a PO: a PO can arrive in several receipts
create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  grn_no text,
  received_date date,
  warehouse text,
  status text not null default 'received' check (status in ('expected','partial','received')),
  note text,
  created_at timestamptz not null default now()
);

-- ───────────── Files and certificates ─────────────
create table public.files (
  id uuid primary key default gen_random_uuid(),
  company_code text not null references public.companies(code),
  kind text not null default 'mtc' check (kind in ('po','mtc')),
  storage_path text not null,
  original_name text not null,
  mime_type text,
  size_bytes bigint,
  sha256 text not null,
  pur_no_hint text,
  source text not null default 'manual' check (source in ('manual','uploader')),
  device_id uuid,
  status text not null default 'new' check (status in ('new','linked','needs_po','read','error')),
  uploaded_by text default public.my_email(),
  created_at timestamptz not null default now(),
  unique (company_code, sha256)
);

create table public.po_files (
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  file_id uuid not null references public.files(id) on delete cascade,
  primary key (po_id, file_id)
);

-- One row per certificate found in an MTC file (stored once, linked to many POs via export_lines)
create table public.certificates (
  id uuid primary key default gen_random_uuid(),
  company_code text not null references public.companies(code),
  file_id uuid references public.files(id) on delete set null,
  page int,
  cert_no_full text not null,
  cert_no_short text,
  cert_date date,
  cert_date_printed text,
  mill_printed text,
  mill_name text,
  grade_printed text,
  grade text,
  rows jsonb not null default '[]',   -- every product row read from the certificate
  created_at timestamptz not null default now()
);
create index on public.certificates (company_code, cert_no_full);

-- The rows of the ERP Excel for a PO (a PO line can be split across certificates)
create table public.export_lines (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  seq int not null,
  po_line_id uuid references public.po_lines(id) on delete set null,
  stock_code text not null,
  stock_desc text not null default '',
  unit text not null default 'PCS',
  qty numeric(14,3) not null,
  cert_date date,
  cert_no text,
  heat_no text,
  grade text,
  grade_remark text check (grade_remark in ('not_stated','unreadable','delivery_note','other')),
  grade_remark_note text,
  mill_name text,
  certificate_id uuid references public.certificates(id) on delete set null,
  flags jsonb not null default '[]',
  unique (po_id, seq)
);

-- ───────────── Store PC uploader ─────────────
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  company_code text not null references public.companies(code),
  name text not null,
  token_hash text not null unique,
  inbox_folder text,
  excel_folder text,
  last_seen_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.excel_deliveries (
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  excel_version int not null,
  delivered_at timestamptz not null default now(),
  primary key (po_id, device_id, excel_version)
);

-- ───────────── Audit ─────────────
create table public.audit_log (
  id bigint generated always as identity primary key,
  company_code text,
  po_id uuid,
  actor text default public.my_email(),
  action text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);

-- ───────────── Row level security ─────────────
alter table public.companies enable row level security;
alter table public.app_users enable row level security;
alter table public.settings enable row level security;
alter table public.mill_aliases enable row level security;
alter table public.grade_rules enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.po_lines enable row level security;
alter table public.receipts enable row level security;
alter table public.files enable row level security;
alter table public.po_files enable row level security;
alter table public.certificates enable row level security;
alter table public.export_lines enable row level security;
alter table public.devices enable row level security;
alter table public.excel_deliveries enable row level security;
alter table public.audit_log enable row level security;

create policy "read companies" on public.companies for select to authenticated using (can_access(code));
create policy "see self or admin" on public.app_users for select to authenticated using (email = my_email() or is_admin());
create policy "admin manage users" on public.app_users for all to authenticated using (is_admin()) with check (is_admin());

create policy "read settings" on public.settings for select to authenticated using (true);
create policy "admin settings" on public.settings for all to authenticated using (is_admin()) with check (is_admin());
create policy "read mills" on public.mill_aliases for select to authenticated using (true);
create policy "write mills" on public.mill_aliases for all to authenticated using (can_access('ARST') or can_access('ARBM')) with check (true);
create policy "read grades" on public.grade_rules for select to authenticated using (true);
create policy "admin grades" on public.grade_rules for all to authenticated using (is_admin()) with check (is_admin());

create policy "po by company" on public.purchase_orders for all to authenticated
  using (can_access(company_code)) with check (can_access(company_code));
create policy "lines by po" on public.po_lines for all to authenticated
  using (exists(select 1 from purchase_orders p where p.id = po_id and can_access(p.company_code)))
  with check (exists(select 1 from purchase_orders p where p.id = po_id and can_access(p.company_code)));
create policy "receipts by po" on public.receipts for all to authenticated
  using (exists(select 1 from purchase_orders p where p.id = po_id and can_access(p.company_code)))
  with check (exists(select 1 from purchase_orders p where p.id = po_id and can_access(p.company_code)));
create policy "export by po" on public.export_lines for all to authenticated
  using (exists(select 1 from purchase_orders p where p.id = po_id and can_access(p.company_code)))
  with check (exists(select 1 from purchase_orders p where p.id = po_id and can_access(p.company_code)));
create policy "files by company" on public.files for all to authenticated
  using (can_access(company_code)) with check (can_access(company_code));
create policy "po_files by po" on public.po_files for all to authenticated
  using (exists(select 1 from purchase_orders p where p.id = po_id and can_access(p.company_code)))
  with check (exists(select 1 from purchase_orders p where p.id = po_id and can_access(p.company_code)));
create policy "certs by company" on public.certificates for all to authenticated
  using (can_access(company_code)) with check (can_access(company_code));
create policy "devices read" on public.devices for select to authenticated using (can_access(company_code));
create policy "devices admin" on public.devices for all to authenticated using (is_admin()) with check (is_admin());
create policy "deliveries read" on public.excel_deliveries for select to authenticated
  using (exists(select 1 from devices d where d.id = device_id and can_access(d.company_code)));
create policy "audit read" on public.audit_log for select to authenticated using (is_admin() or can_access(company_code));
create policy "audit insert" on public.audit_log for insert to authenticated with check (company_code is null or can_access(company_code));

-- ───────────── Storage: private bucket, path = {company}/... ─────────────
insert into storage.buckets (id, name, public) values ('mtc-files','mtc-files', false)
  on conflict (id) do nothing;
create policy "mtc files read" on storage.objects for select to authenticated
  using (bucket_id = 'mtc-files' and can_access((storage.foldername(name))[1]));
create policy "mtc files write" on storage.objects for insert to authenticated
  with check (bucket_id = 'mtc-files' and can_access((storage.foldername(name))[1]));

-- updated_at
create or replace function public.touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger po_touch before update on public.purchase_orders for each row execute function public.touch();

create policy "mtc files update" on storage.objects for update to authenticated
  using (bucket_id = 'mtc-files' and can_access((storage.foldername(name))[1]));
create policy "mtc files delete" on storage.objects for delete to authenticated
  using (bucket_id = 'mtc-files' and can_access((storage.foldername(name))[1]));
