-- Nothing in this project is meant to be reachable with the publishable/anon key.
-- Supabase's defaults grant anon and authenticated full rights on every new table,
-- sequence and function in public, so a future table created without RLS would be
-- world-readable. Drop those defaults for objects created by postgres (migrations
-- and the dashboard SQL editor). A future object that should be public needs
-- explicit grants (and, for tables, RLS policies).
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated, public;
