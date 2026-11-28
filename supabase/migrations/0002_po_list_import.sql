-- Import purchase orders (IPO#, e.g. 01240) and PO list uploads from the ERP.
-- Run in the Supabase SQL editor after 0001.

-- PO type: PUR# starting with L is local (PUR20); everything else (MP..., IPO numbers like 01240) is import (IMP20)
alter table public.purchase_orders drop column po_type;
alter table public.purchase_orders drop column doctype;
alter table public.purchase_orders
  add column doctype text generated always as (case when pur_no ilike 'L%' then 'PUR20' else 'IMP20' end) stored,
  add column po_type text generated always as (case when pur_no ilike 'L%' then 'LP' else 'IMP' end) stored,
  add column shipment_date date,
  add column supplier_contract_no text,
  add column source text not null default 'manual';

alter table public.po_lines
  add column purchase_qty numeric(14,3),
  add column balance_qty numeric(14,3);
