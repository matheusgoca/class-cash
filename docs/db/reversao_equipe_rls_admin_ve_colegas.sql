-- Reversão da migration 20261127210000_equipe_rls_admin_ve_colegas.sql (idempotente).
drop policy if exists "profiles_select_school_admin" on public.profiles;
drop policy if exists "user_roles_select_school_admin" on public.user_roles;
drop function if exists public.is_school_member(uuid);
-- Se a migration estiver registrada no histórico: supabase migration repair --status reverted 20261127210000
