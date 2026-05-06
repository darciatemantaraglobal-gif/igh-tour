# IGH Tour

Aplikasi manajemen Umrah & Haji untuk travel agency — kelola trip, jamaah, paket, kalkulasi biaya HPP, dokumen paspor/visa, dan ekspor PDF.

## Run & Operate

- **Dev server**: `npm run dev` (port 5000)
- **Build**: `npm run build`
- **Preview prod build**: `npm run preview`
- **Test**: `npm test`
- **Required env vars** (set in Replit Secrets/Env Vars):
  - `VITE_SUPABASE_URL` — Supabase project URL
  - `VITE_SUPABASE_ANON_KEY` — Supabase anon/public key (safe to expose, protected by RLS)
  - `VITE_OPENAI_API_KEY` — (optional) enables direct browser OCR via gpt-4o-mini

## Stack

- **Runtime**: Node 20, browser SPA (no server)
- **Framework**: React 18 + Vite 5 + TypeScript
- **UI**: Tailwind CSS + shadcn/ui (Radix UI)
- **State**: Zustand stores with localStorage write-through cache
- **Backend**: Supabase (PostgreSQL + Auth + Storage + Realtime + Edge Functions)
- **PDF**: pdf-lib + pdfjs-dist
- **OCR**: Tesseract.js (local) + OpenAI gpt-4o-mini (AI fallback)
- **PWA**: vite-plugin-pwa with Workbox

## Where things live

- `src/store/` — Zustand stores (auth, packages, trips, rates, regional, calculator)
- `src/features/` — data repos (trips, packages, payments, portal, audit, calculator)
- `src/lib/` — supabase client, cloud sync, storage, OCR, PDF generation
- `src/pages/` — route pages (Dashboard, Login, Auth/Bootstrap, Packages, TripDetail, etc.)
- `src/components/` — shared UI components
- `supabase/schema.sql` — full DB schema (run in Supabase SQL Editor)
- `supabase/functions/` — Deno Edge Functions (bootstrap, invite-member, remove-member, ocr-passport)
- `supabase/migrations/` — incremental SQL migrations

## Architecture decisions

- **Pure frontend SPA**: All data access goes directly from browser → Supabase via anon key + RLS policies. No intermediary server needed.
- **Multi-tenant via RLS**: `is_member(agency_id)` helper function enforces row-level isolation. Each agency only sees its own data.
- **Write-through localStorage cache**: Repos write to both Supabase and localStorage. On load, localStorage serves as instant cache while Supabase fetch completes.
- **Edge Functions for privileged ops**: Bootstrap, invite/remove member use Supabase `service_role` key (server-side only). OCR also falls back to Edge Function if no `VITE_OPENAI_API_KEY`.
- **Supabase Realtime**: Live sync across devices/tabs via postgres_changes subscriptions.

## Product

- **Authentication**: Email/password login with Supabase Auth. PIN-based 2FA stored locally.
- **Multi-tenancy**: One agency per deployment; owner invites staff via Edge Function.
- **Trip & Jamaah management**: CRUD trips (paket perjalanan) and pilgrims (jamaah) with passport details.
- **Package calculator**: HPP (Harga Pokok Penjualan) cost calculator for Umrah/Haji packages.
- **Document management**: Upload & view passport, visa, ticket, medical docs per jamaah.
- **PDF export**: Customizable PDF layout with template editor (PdfLayoutTuner).
- **Notes**: Agency-wide sticky notes synced to cloud.
- **Public check**: `/cek/:code` for pilgrims to check their own booking status.
- **PWA**: Installable, works offline with service worker caching.

## User preferences

- Indonesian language UI (Bahasa Indonesia)
- Keep Supabase as the backend — do not migrate to another database

## Gotchas

- Supabase schema must be applied via `supabase/schema.sql` in Supabase SQL Editor before first use
- Bootstrap flow (`/bootstrap`) must be run once to create the first owner account and agency
- Service worker disabled in dev mode to prevent Vite HMR cache conflicts
- `VITE_` prefix vars are intentionally browser-exposed; security relies on Supabase RLS
- Delete operations use `.select("id")` chained after `.delete()` to detect RLS-blocked silent failures

## Pointers

- Supabase docs: https://supabase.com/docs
- RLS policy reference: `supabase/schema.sql` lines 220–395
- Edge Function deploy instructions: `supabase/functions/README.md`
