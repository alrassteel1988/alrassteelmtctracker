-- KCR DIS TICARET A.S is supplier K1018 (K1003 is KARDEMIR DIS TICARET A.S only).
-- Fixes databases where an earlier copy of 0004 put KCR under K1003. Safe to run more than once.
do $$
begin
  if to_regclass('public.suppliers') is not null then
    delete from public.suppliers where name_key = 'KCRDISTICARETAS' and code <> 'K1018';
    insert into public.suppliers (company_code, code, name)
      select 'ARST', 'K1018', 'KCR DIS TICARET A.S'
       where not exists (select 1 from public.suppliers where company_code = 'ARST' and code = 'K1018');
    insert into public.suppliers (company_code, code, name)
      select 'ARST', 'K1003', 'KARDEMIR DIS TICARET A.S'
       where not exists (select 1 from public.suppliers where company_code = 'ARST' and code = 'K1003');
  end if;
end $$;

update public.purchase_orders
   set supplier_code = 'K1018'
 where upper(regexp_replace(coalesce(supplier_name, ''), '[^A-Za-z0-9]', '', 'g')) = 'KCRDISTICARETAS'
   and supplier_code is distinct from 'K1018';
