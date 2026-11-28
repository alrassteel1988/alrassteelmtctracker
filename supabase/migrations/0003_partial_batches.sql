-- Partial approval: each approval creates an ERP MTC batch (one Excel) for the lines whose certificates have arrived.
-- Remaining lines stay pending until the next shipment's MTCs are read. Run after 0002.

alter table public.purchase_orders drop constraint if exists purchase_orders_status_check;
alter table public.purchase_orders add constraint purchase_orders_status_check
  check (status in ('draft','reading','review','blocked','partial','approved','erp_done'));

create table public.erp_batches (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  batch_no int not null,
  excel_path text,
  excel_version int not null default 1,
  header_mill text,
  header_cert_date date,
  erp_mtc_no text,
  erp_mtc_date date,
  approved_by text default public.my_email(),
  approved_at timestamptz not null default now(),
  unique (po_id, batch_no)
);
alter table public.erp_batches enable row level security;
create policy "batches by po" on public.erp_batches for all to authenticated
  using (exists(select 1 from purchase_orders p where p.id = po_id and can_access(p.company_code)))
  with check (exists(select 1 from purchase_orders p where p.id = po_id and can_access(p.company_code)));

alter table public.export_lines add column batch_id uuid references public.erp_batches(id) on delete set null;

create table public.batch_deliveries (
  batch_id uuid not null references public.erp_batches(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  excel_version int not null,
  delivered_at timestamptz not null default now(),
  primary key (batch_id, device_id, excel_version)
);
alter table public.batch_deliveries enable row level security;
create policy "batch deliveries read" on public.batch_deliveries for select to authenticated
  using (exists(select 1 from devices d where d.id = device_id and can_access(d.company_code)));

-- Move POs approved before this change into batch 1
insert into public.erp_batches (po_id, batch_no, excel_path, excel_version, header_mill, header_cert_date, erp_mtc_no, erp_mtc_date, approved_by, approved_at)
  select id, 1, excel_path, greatest(excel_version, 1), header_mill, header_cert_date, erp_mtc_no, erp_mtc_date, approved_by, coalesce(approved_at, now())
  from public.purchase_orders where status in ('approved','erp_done');
update public.export_lines e set batch_id = b.id from public.erp_batches b where b.po_id = e.po_id and b.batch_no = 1;
