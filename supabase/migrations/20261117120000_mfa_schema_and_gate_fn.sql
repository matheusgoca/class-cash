-- Fase 3 (S2): exigir 2FA. Esta migration só cria a infraestrutura; NENHUMA
-- tabela usa o gate ainda (isso é a migration 20261117130000). Rodar sozinha
-- não bloqueia ninguém.
--
-- Quem é exigido: owner e admin de escola com require_2fa = true, e o master
-- admin SEMPRE (ele pode ter school_id ou não — o master é checado primeiro).

-- 1. Flag por escola ---------------------------------------------------------
alter table public.schools
  add column if not exists require_2fa boolean not null default false;

-- 2. Carência por usuário ----------------------------------------------------
-- Tabela própria (e não coluna em profiles): profiles é auto-editável pelo
-- usuário, então ele poderia estender a própria carência. Aqui só funções
-- SECURITY DEFINER escrevem.
create table if not exists public.mfa_grace (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  started_at  timestamptz not null default now(),
  grace_until timestamptz not null
);
alter table public.mfa_grace enable row level security;

drop policy if exists mfa_grace_select_own on public.mfa_grace;
create policy mfa_grace_select_own on public.mfa_grace
  for select to authenticated using (user_id = auth.uid());
-- sem policies de insert/update/delete de propósito.

-- 3. Owner ou admin? ---------------------------------------------------------
-- user_roles tem UNIQUE(user_id) em produção (confirmado), então o papel é do
-- usuário, não da escola. Owner não precisa de linha em user_roles.
create or replace function public.mfa_is_admin_or_owner(p_user uuid, p_school uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.schools s where s.id = p_school and s.owner_user_id = p_user)
      or exists (select 1 from public.user_roles r where r.user_id = p_user and r.role = 'admin');
$$;

-- 4. O gate ------------------------------------------------------------------
create or replace function public.mfa_gate_ok()
returns boolean
language plpgsql stable security definer
set search_path = public, auth
as $$
declare
  v_uid    uuid := auth.uid();
  v_school uuid;
  v_master boolean;
  v_req    boolean;
begin
  -- service role / contexto sem usuário: as demais policies decidem.
  if v_uid is null then return true; end if;
  if coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2' then return true; end if;

  select p.school_id, coalesce(p.is_master_admin, false)
    into v_school, v_master
    from public.profiles p
   where p.user_id = v_uid;

  if not coalesce(v_master, false) then
    if v_school is null then return true; end if;       -- ainda sem escola (onboarding)
    select s.require_2fa into v_req from public.schools s where s.id = v_school;
    if not coalesce(v_req, false) then return true; end if;
    if not public.mfa_is_admin_or_owner(v_uid, v_school) then return true; end if;
  end if;                                               -- master: sempre exigido

  -- usuário exigido, sessão aal1:
  if exists (select 1 from auth.mfa_factors f where f.user_id = v_uid and f.status = 'verified') then
    return false;                                       -- tem fator → precisa do desafio (aal2)
  end if;
  return exists (select 1 from public.mfa_grace g where g.user_id = v_uid and g.grace_until > now());
end $$;

create or replace function public.assert_mfa_gate()
returns void
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.mfa_gate_ok() then
    raise exception 'MFA_REQUIRED'
      using errcode = '42501', hint = 'Esta conta precisa da verificação em duas etapas (2FA).';
  end if;
end $$;

-- 5. Início da carência (idempotente) ----------------------------------------
-- Só cria a linha se o usuário é exigido e ainda não tem fator verificado.
create or replace function public.start_mfa_grace()
returns timestamptz
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_uid    uuid := auth.uid();
  v_school uuid;
  v_master boolean;
  v_until  timestamptz;
begin
  if v_uid is null then
    raise exception 'não autenticado' using errcode = '28000';
  end if;

  select p.school_id, coalesce(p.is_master_admin, false)
    into v_school, v_master
    from public.profiles p
   where p.user_id = v_uid;

  if exists (select 1 from auth.mfa_factors f where f.user_id = v_uid and f.status = 'verified') then
    return null;                                        -- já tem fator: não precisa de carência
  end if;

  if not coalesce(v_master, false) and (
       v_school is null
    or not coalesce((select s.require_2fa from public.schools s where s.id = v_school), false)
    or not public.mfa_is_admin_or_owner(v_uid, v_school)
  ) then
    return null;                                        -- não é exigido
  end if;

  insert into public.mfa_grace (user_id, grace_until)
  values (v_uid, now() + interval '7 days')
  on conflict (user_id) do nothing;

  select g.grace_until into v_until from public.mfa_grace g where g.user_id = v_uid;
  return v_until;
end $$;

-- 6. Guarda do toggle --------------------------------------------------------
-- Mudar require_2fa exige sessão aal2 (master também, mas o master já é sempre
-- aal2 pelo próprio gate). Ao LIGAR, zera as carências antigas da escola:
-- religar = recomeçar o relógio, em vez de bloquear na hora quem já estourou.
create or replace function public.schools_require_2fa_guard()
returns trigger
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
begin
  if new.require_2fa is not distinct from old.require_2fa then
    return new;
  end if;

  if v_uid is not null and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'Confirme o seu 2FA antes de alterar esta política.'
      using errcode = '42501';
  end if;

  if new.require_2fa then
    delete from public.mfa_grace g
     using public.profiles p
     where g.user_id = p.user_id and p.school_id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists schools_require_2fa_guard on public.schools;
create trigger schools_require_2fa_guard
  before update on public.schools
  for each row execute function public.schools_require_2fa_guard();

-- 7. Permissões --------------------------------------------------------------
-- No Supabase, funções novas em public nascem executáveis por anon/authenticated.
revoke all on function public.mfa_is_admin_or_owner(uuid, uuid) from public, anon, authenticated;
revoke all on function public.mfa_gate_ok()                      from public, anon;
revoke all on function public.assert_mfa_gate()                  from public, anon;
revoke all on function public.start_mfa_grace()                  from public, anon;
revoke all on function public.schools_require_2fa_guard()        from public, anon, authenticated;

-- authenticated precisa executar o gate porque a policy RESTRICTIVE o chama com
-- os privilégios de quem consulta.
grant execute on function public.mfa_gate_ok()     to authenticated;
grant execute on function public.assert_mfa_gate() to authenticated;
grant execute on function public.start_mfa_grace() to authenticated;
