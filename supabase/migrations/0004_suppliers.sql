-- Supplier master per company (code + name as in the ERP).
-- A code can appear under more than one name (renamed suppliers), so names are unique, not codes.
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  company_code text not null references public.companies(code),
  code text not null,
  name text not null,
  name_key text generated always as (upper(regexp_replace(name, '[^A-Za-z0-9]', '', 'g'))) stored,
  updated_at timestamptz not null default now(),
  unique (company_code, name_key)
);
create index if not exists suppliers_code on public.suppliers (company_code, code);

alter table public.suppliers enable row level security;
drop policy if exists "suppliers by company" on public.suppliers;
create policy "suppliers by company" on public.suppliers for all to authenticated
  using (can_access(company_code)) with check (can_access(company_code));

-- ARST supplier list (60 rows, from the latest ARST SUPPLIER LIST.xlsx)
insert into public.suppliers (company_code, code, name) values
  ('ARST', 'A1109', 'ALSTEEL TRADING COMPANY LIMITED'),
  ('ARST', 'A1075', 'AMNS MIDDLE EAST FZE'),
  ('ARST', 'A1080', 'ARCELORMITTAL COMMERCIAL SECTIONS S.A.'),
  ('ARST', 'A1092', 'ARSEN INTERNATIONAL (HK) LIMITED'),
  ('ARST', 'B1003', 'BAICHANG TRADE PTE. LTD.'),
  ('ARST', 'B1022', 'BAOHUA STEEL INTERNATIONAL PTE.LIMITED'),
  ('ARST', 'B1023', 'BAOSTEEL IRON AND STEEL GROUP CO., LTD'),
  ('ARST', 'C1004', 'CELSA COMPANIA ESPANOLA DE-LAMINACIO S.L'),
  ('ARST', 'C1037', 'CHEONGFULI (HONG KONG) COMPANY LTD.'),
  ('ARST', 'C1025', 'CNBM(HONG KONG)LIMITED'),
  ('ARST', 'C1027', 'COS GATE DMCC'),
  ('ARST', 'C1023', 'CRESCENT RESOURCES HONGKONG CO., LIMITED'),
  ('ARST', 'D1031', 'DAO FORTUNE (HONG KONG) CO., LIMITED'),
  ('ARST', 'E1015', 'EVER FAITH INTERNATIONAL TRADING CO., LIMITED'),
  ('ARST', 'F1021', 'FFE STEEL INTERNATIONAL CO., LIMITED.'),
  ('ARST', 'F1017', 'FITEX INDUSTRIES LIMITED'),
  ('ARST', 'F1013', 'FORTRAN STEEL PVT LTD'),
  ('ARST', 'F1020', 'FORTUNE COMMODITY (HK) LIMITED'),
  ('ARST', 'G1011', 'GUANGDONG GUANGYUN NEW MATERIAL CO., LTD'),
  ('ARST', 'H1002', 'HANGZHOU COGENERATION (HONG'),
  ('ARST', 'H1042', 'HASCELIK SANAYI VE TICARET A.S.'),
  ('ARST', 'H1012', 'HEBEI JIUWANG METAL WIRE MESH CO., LTD'),
  ('ARST', 'H1022', 'HIMALAYA STEEL TRADING FZE'),
  ('ARST', 'H1024', 'HK STEEL LINK INTERNATIONAL CO., LIMITED'),
  ('ARST', 'H1035', 'HONORS COMMODITY HONG KONG COMPANY LIMITED'),
  ('ARST', 'I1010', 'ITG RESOURCES DMCC'),
  ('ARST', 'I1004', 'IZMIR DEMIR CELIK SANAYI A.S.'),
  ('ARST', 'K1003', 'KARDEMIR DIS TICARET A.S'),
  ('ARST', 'K1004', 'KARDEMIR DIS TICARET S.A.'),
  ('ARST', 'K1018', 'KCR DIS TICARET A.S'),
  ('ARST', 'K1014', 'KOCAER CELIK SAN. VE TIC A.S.'),
  ('ARST', 'L1013', 'LANGZO HOLDING LIMITED'),
  ('ARST', 'L1011', 'LUO LIHONG YIWU TRADING FIRM'),
  ('ARST', 'M1041', 'MESCIER DIS TICARET A.S'),
  ('ARST', 'M1043', 'MINAS RESOURCES LIMITED'),
  ('ARST', 'N1004', 'NAMCO INDUSTRIES PVT LTD'),
  ('ARST', 'N1013', 'NEW LINK METAL PTE. LTD'),
  ('ARST', 'N1020', 'NEWLAND UNITED IRON AND STEEL (H.K) CO., LIMITED'),
  ('ARST', 'P1016', 'PANJIN STEEL PIPE CO., LIMITED'),
  ('ARST', 'P1006', 'POSCO INTERNATIONAL CORPORATION'),
  ('ARST', 'R1016', 'RIZHAO STEEL HOLDING GROUP CO., LTD.'),
  ('ARST', 'R1018', 'RIZHAO STEEL YINGKOU MEDIUM PLATE CO., LTD.'),
  ('ARST', 'R1020', 'RUNYING STEEL GROUP CO., LIMITED'),
  ('ARST', 'S1013', 'SENG HOE METAL PTE. LTD.'),
  ('ARST', 'S1086', 'SHANGHAI HONGXIANGHUI STEEL MANUFACTURING CO. LTD.'),
  ('ARST', 'S1020', 'SHARPMAX INTERNATIONAL (HONKONG)CO., LTD'),
  ('ARST', 'S1068', 'SIEMCO CORPORATION LIMITED'),
  ('ARST', 'S1081', 'SINO COMMODITIES INTERNATIONAL PTE. LTD.'),
  ('ARST', 'S1085', 'SINO-KOREA (BEIJING) STEEL CO., LTD'),
  ('ARST', 'S1033', 'SNP LIMITED'),
  ('ARST', 'S1067', 'STEEL SEARCHER MIDDLE EAST DMCC'),
  ('ARST', 'T1062', 'TANGSHAN BINGNUO METAL PRODUCTS CO.,LTD'),
  ('ARST', 'T1019', 'TANGSHAN SHENGCAI STEEL CO., LTD.'),
  ('ARST', 'T1063', 'TANGSHAN WUHENG INDUSTRIAL CO.,LTD.'),
  ('ARST', 'T1054', 'TIANJIN SHENGQIFENG INTERNATIONAL TRADING CO.LTD'),
  ('ARST', 'T1041', 'TIANJIN YOUFA INTL. TRADE CO. LTD.'),
  ('ARST', 'T1064', 'TOP (HK) COMMODITIES INTERNATIONAL LIMITED'),
  ('ARST', 'X1002', 'XIAMEN ITG AI CLOUD SOLUTIONS CO., LTD.'),
  ('ARST', 'Y1001', 'YEW HING (HONGKONG) HOLDINGS CO., LTD.'),
  ('ARST', 'Z1003', 'ZHEJIANG HUADA NEW MATERIALS CO.,LTD')
on conflict (company_code, name_key) do update set code = excluded.code, name = excluded.name, updated_at = now();

-- Fill supplier codes on purchase orders that only have the supplier name
update public.purchase_orders p
   set supplier_code = s.code
  from public.suppliers s
 where s.company_code = p.company_code
   and s.name_key = upper(regexp_replace(coalesce(p.supplier_name, ''), '[^A-Za-z0-9]', '', 'g'))
   and (p.supplier_code is null or p.supplier_code = '');
