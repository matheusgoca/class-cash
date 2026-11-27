-- Reversão da migration 20261127200000_endurecimento_rls_profiles_user_roles.sql (idempotente).
drop trigger if exists profiles_protect_columns on public.profiles;
drop trigger if exists user_roles_protect_admin on public.user_roles;
drop function if exists public.profiles_protect_columns();
drop function if exists public.user_roles_protect_admin();
drop function if exists public.admin_role_loss_reason(uuid);
drop function if exists public.is_school_owner(uuid);
-- Se a migration estiver registrada no histórico: supabase migration repair --status reverted 20261127200000
