-- Add return_date column to packages table for "Tanggal Pulang" feature.
-- Existing rows keep NULL; UI computes duration from departure_date when both set.
alter table public.packages
  add column if not exists return_date text;

-- Force PostgREST to reload its schema cache immediately after the column is
-- added. Without this, the JS client throws:
--   "Could not find the 'return_date' column of 'packages' in the schema cache"
-- until the Supabase server is manually restarted or cache TTL expires.
notify pgrst, 'reload schema';
