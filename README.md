# Al Ras Steel MTC Tracker

Per purchase order, the store uploads the PO copy and its mill test certificates (or the store PC uploader sends them from a folder). The AI reads the certificates and fills Certificate Date, Certificate #, Heat#, Grade and MILL Name for the PO's lines only. After review, the app produces `MTC-{PUR#}.xlsx` in the exact layout of the store's L0037354 sample, ready for the ERP's **Fill** button, and the uploader saves it to the store PC.

Stack: Next.js (App Router) on Vercel, Supabase (Postgres + Auth + private Storage), Claude (Anthropic API) for reading scans.

## Phase 1 scope
- Sign-in (Supabase Auth, invite links, password reset). Admins see ARST + ARBM; store users see only their company (enforced by row level security in the database, not only the UI).
- Purchase orders list with filters and search (PUR#, GRN, heat, certificate, supplier). Receipts (GRN) per PO.
- MTC intake: manual upload (browser uploads straight to private storage, duplicates skipped by SHA-256) and files from the store PC uploader. Files are linked to the PO by the PUR# in the file name; files without one wait under "Needs a PUR#".
- PO lines: read from the PO copy by AI, typed, or pasted from the ERP grid.
- AI review: certificate rows matched to PO lines (with quantity splits), checks (coverage, quantities, grade, date/mill), flags (month-first dates, unknown mills, low confidence). Grade is required: an empty grade needs a remark before approval.
- ERP export: Excel per PO, header MILL Name / Certificate Date with copy buttons, ERP MTC No. typed back.
- Certificate library, master data (mill names, grade rules), audit history, users, settings, uploader keys.

Later phases: invoice lookup, customer requests.

## Configurable decisions (Settings and uploaders)
| Setting | Default |
|---|---|
| Certificate # in the Excel | Short ERP style: `APL/QC/2026/4189` → `4189` (full number always kept in the library) |
| Header MILL Name when several | First line's mill |
| Header Certificate Date when several | Latest date |
| Store PC folders | `D:\MTC Inbox\{company}` and `D:\MTC Excel\{company}` |

## Setup

### 1. Supabase
1. Create a project at supabase.com.
2. SQL editor → paste and run `supabase/migrations/0001_init.sql`. It creates tables, row level security, the private `mtc-files` bucket and the four users' access entries.
3. Authentication → URL configuration: set Site URL to the Vercel address and add `https://<your-app>/auth/callback` to Redirect URLs.
4. Authentication → Providers → Email: keep enabled; turn **off** "Allow new users to sign up" (people get in by invite only).
5. Project settings → API: note the project URL, the anon (publishable) key and the service role key. Do not share them in chat or email.

### 2. Vercel
1. Import the GitHub repository.
2. Settings → Environment Variables: add the values from `.env.example` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_SITE_URL`).
3. Deploy. The PO page allows up to 300 s for AI reading of large scans.

### 3. First sign-in
In Supabase → Authentication → Users → "Invite user" for your own email (or create a user with a password). After that, use **Users and access → Invite / resend** in the app for everyone else.

### 4. Store PC uploader
Admin: Settings and uploaders → Add a store PC uploader → copy the key (shown once). On the store PC: download `MTC-Uploader.zip` from the same page, unzip, run `Install.ps1`, paste the web address and key. See `uploader/README.txt`.

## Development
```
cp .env.example .env.local   # fill in values
npm install
npm run dev
npm test                      # offline check of matching + Excel against the L0037354 sample
```

## Layout
- `src/lib/excel.ts` - Excel in the sample layout (column widths, Tahoma, grey/green/yellow fills, text cells, `#,##0.000`, `dd/mm/yyyy`).
- `src/lib/ai.ts` - Claude prompts and output schemas (PO copy, MTCs for a PO).
- `src/lib/match.ts` - AI result → ERP rows, checks, header values.
- `src/lib/normalize.ts` - certificate #, grade, mill, date and file-name rules.
- `src/lib/po.ts` - file registration, AI runs, Excel creation.
- `src/app/api/uploader/*` - endpoints for the store PC uploader (key-authenticated).
- `uploader/` - Windows PowerShell uploader and installer.

## AI accuracy test (before go-live)
Run the AI on real POs without the database, comparing with what the store keyed by hand:
```
ANTHROPIC_API_KEY=... npm run try-ai -- --pur L0037354 --expect "mtc - l0037354.xlsx" "MTC - LP0037354.pdf"
```
It prints the rows the app would export, the checks, and every field that differs from the keyed Excel.
