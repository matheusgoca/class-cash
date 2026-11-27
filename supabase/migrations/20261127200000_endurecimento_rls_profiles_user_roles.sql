-- Endurecimento de profiles e user_roles: o que o cliente (JWT authenticated) pode alterar.
--
-- Regras (valem para chamadas diretas do cliente de quem NÃO é master; service role, funções SECURITY DEFINER
-- e ações em cascata do banco não são afetados, porque nelas current_user não é authenticated/anon):
--  * profiles: is_master_admin e user_id não mudam; school_id, uma vez definido, não muda; school_id só pode
--    ser definido (de NULL) para uma escola da qual o próprio usuário é owner; um perfil novo não nasce master.
--  * user_roles: o owner da escola não perde o papel admin; a escola não fica sem admin; user_id não muda.
-- Reversão: docs/db/reversao_endurecimento_rls_profiles_user_roles.sql (idempotente).

-- Escola da qual o usuário é owner (definer: não depende do RLS de schools).
create or replace function public.is_school_owner(p_school uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.schools s
     where s.id = p_school and s.owner_user_id = auth.uid()
  );
$$;
revoke all on function public.is_school_owner(uuid) from public, anon, service_role;
grant execute on function public.is_school_owner(uuid) to authenticated;

-- Motivo de negar a saída do papel admin de p_user ('owner', 'ultimo_admin') ou NULL se pode.
create or replace function public.admin_role_loss_reason(p_user uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_school uuid;
begin
  select p.school_id into v_school from public.profiles p where p.user_id = p_user;
  if v_school is null then
    return null;
  end if;
  if exists (select 1 from public.schools s where s.id = v_school and s.owner_user_id = p_user) then
    return 'owner';
  end if;
  if not exists (
    select 1
      from public.user_roles r
      join public.profiles p on p.user_id = r.user_id
     where p.school_id = v_school and r.role = 'admin' and r.user_id <> p_user
  ) then
    return 'ultimo_admin';
  end if;
  return null;
end $$;
revoke all on function public.admin_role_loss_reason(uuid) from public, anon, service_role;
grant execute on function public.admin_role_loss_reason(uuid) to authenticated;

-- profiles
create or replace function public.profiles_protect_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') or public.is_master_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.is_master_admin, false)
       or (new.school_id is not null and not public.is_school_owner(new.school_id)) then
      raise exception 'Operação não permitida.' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.is_master_admin is distinct from old.is_master_admin
     or new.user_id is distinct from old.user_id then
    raise exception 'Operação não permitida.' using errcode = '42501';
  end if;
  if new.school_id is distinct from old.school_id then
    if old.school_id is not null
       or (new.school_id is not null and not public.is_school_owner(new.school_id)) then
      raise exception 'Operação não permitida.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.profiles_protect_columns() from public, anon, authenticated, service_role;

drop trigger if exists profiles_protect_columns on public.profiles;
create trigger profiles_protect_columns
  before insert or update on public.profiles
  for each row execute function public.profiles_protect_columns();

-- user_roles
create or replace function public.user_roles_protect_admin()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_reason text;
begin
  if current_user not in ('authenticated', 'anon') or public.is_master_admin() then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception 'Operação não permitida.' using errcode = '42501';
  end if;

  if old.role = 'admin' and (tg_op = 'DELETE' or new.role is distinct from 'admin') then
    v_reason := public.admin_role_loss_reason(old.user_id);
    if v_reason = 'owner' then
      raise exception 'O owner da escola não pode perder o papel de admin.' using errcode = '42501';
    elsif v_reason = 'ultimo_admin' then
      raise exception 'A escola precisa ter ao menos um admin.' using errcode = '42501';
    end if;
  end if;
  return coalesce(new, old);
end $$;
revoke all on function public.user_roles_protect_admin() from public, anon, authenticated, service_role;

drop trigger if exists user_roles_protect_admin on public.user_roles;
create trigger user_roles_protect_admin
  before update or delete on public.user_roles
  for each row execute function public.user_roles_protect_admin();
