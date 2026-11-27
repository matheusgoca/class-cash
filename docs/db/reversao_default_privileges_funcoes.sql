-- Reversão da migration 20261128110000 (idempotente).
alter default privileges for role postgres grant execute on functions to public;
alter default privileges for role postgres in schema public grant execute on functions to anon;
