-- supabase/migrations/20261119130000_enable_pg_net.sql
-- S4a: pg_net permite ao pg_cron chamar a Edge Function de e-mail (net.http_post).
create extension if not exists pg_net with schema extensions;
