-- S3: preferências de notificação (tela + dados; nada é gerado nem enviado ainda).
-- Spec: docs/superpowers/specs/2026-11-18-preferencias-notificacao-design.md (D1–D10).
-- Escrita só pelos RPCs ensure/save; sem policies de INSERT/UPDATE/DELETE.

-- 1. Tabelas -------------------------------------------------------------------
create table if not exists public.notification_preferences (
  id          uuid primary key default uuid_generate_v4(),
  school_id   uuid not null references public.schools(id) on delete cascade,
  user_id     uuid not null references auth.users(id)     on delete cascade,
  event       text not null
              check (event in ('tuition_due','tuition_overdue','renegotiation_installment','expense_due','reenrollment')),
  in_app      boolean not null,
  email       boolean not null,
  offset_days integer not null check (offset_days between 0 and 120), -- lista fina validada no save
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint notification_preferences_user_school_event_key unique (user_id, school_id, event)
);
create index if not exists idx_notification_preferences_school_event
  on public.notification_preferences (school_id, event);

create table if not exists public.notification_settings (
  id             uuid primary key default uuid_generate_v4(),
  school_id      uuid not null references public.schools(id) on delete cascade,
  user_id        uuid not null references auth.users(id)     on delete cascade,
  digest_enabled boolean not null default false,
  digest_time    time not null default '07:00',
  timezone       text not null default 'America/Sao_Paulo',  -- IANA; sobrescrito pelo navegador a cada save
  confirmed_at   timestamptz,                                -- 1º save; a S4 só envia e-mail se não nulo (D3)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint notification_settings_user_school_key unique (user_id, school_id),
  constraint notification_settings_digest_time_check
    check (digest_time between time '06:00' and time '20:00'
           and extract(minute from digest_time) = 0 and extract(second from digest_time) = 0)
);

drop trigger if exists update_notification_preferences_updated_at on public.notification_preferences;
create trigger update_notification_preferences_updated_at
  before update on public.notification_preferences
  for each row execute function public.set_updated_at();

drop trigger if exists update_notification_settings_updated_at on public.notification_settings;
create trigger update_notification_settings_updated_at
  before update on public.notification_settings
  for each row execute function public.set_updated_at();

-- 2. RLS -----------------------------------------------------------------------
alter table public.notification_preferences enable row level security;
alter table public.notification_settings    enable row level security;

drop policy if exists notification_preferences_select on public.notification_preferences;
create policy notification_preferences_select on public.notification_preferences
  for select to authenticated
  using ((user_id = auth.uid() and school_id = public.get_user_school_id()) or public.is_master_admin());

drop policy if exists notification_settings_select on public.notification_settings;
create policy notification_settings_select on public.notification_settings
  for select to authenticated
  using ((user_id = auth.uid() and school_id = public.get_user_school_id()) or public.is_master_admin());

-- Gate de 2FA (convenção do CLAUDE.md): RESTRICTIVE, combinada com AND.
drop policy if exists mfa_gate on public.notification_preferences;
create policy mfa_gate on public.notification_preferences as restrictive for all to authenticated
  using ((select public.mfa_gate_ok())) with check ((select public.mfa_gate_ok()));
drop policy if exists mfa_gate on public.notification_settings;
create policy mfa_gate on public.notification_settings as restrictive for all to authenticated
  using ((select public.mfa_gate_ok())) with check ((select public.mfa_gate_ok()));

-- 3. Padrões: ÚNICA fonte de padrões, opções, direção e recomendados ------------
-- direction:
--   'before' = N dias ANTES da data de referência (vencimento da mensalidade,
--              parcela da renegociação, vencimento da despesa, fim do contrato);
--   'after'  = N dias DEPOIS do vencimento (mensalidade em atraso).
--   offset_days = 0 significa "no próprio dia".
-- email = false em todos: e-mail só liga quando o usuário salva a tela (D3).
-- email_recommended: selo "Recomendado" na tela (o mockup mostrava e-mail ligado).
-- O gerador da S3 usa esta função para quem nunca abriu a tela (só canal sistema).
create or replace function public.notification_event_defaults()
returns table (event text, direction text, in_app boolean, email boolean, email_recommended boolean,
               offset_days integer, allowed_offsets integer[], admin_only boolean, sort_order integer)
language sql immutable
set search_path = public
as $$
  values
    ('tuition_due',               'before', true, false, false,  3, array[1,3,5,7],      false, 1),
    ('tuition_overdue',           'after',  true, false, true,   5, array[1,3,5,10,15],  false, 2),
    ('renegotiation_installment', 'before', true, false, true,   1, array[0,1,2,3],      false, 3),
    ('expense_due',               'before', true, false, false,  2, array[0,1,2,3,5,7],  false, 4),
    ('reenrollment',              'before', true, false, true,  45, array[30,45,60,90],  true,  5)
$$;

-- 4. Quem pode ter preferências: owner/admin ou financeiro da escola ------------
create or replace function public.notification_actor(out o_uid uuid, out o_school uuid, out o_admin boolean)
language plpgsql stable security definer
set search_path = public
as $$
begin
  o_uid := auth.uid();
  if o_uid is null then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  o_school := public.get_user_school_id();
  if o_school is null then
    raise exception 'NO_SCHOOL' using errcode = 'P0001';
  end if;
  o_admin := public.mfa_is_admin_or_owner(o_uid, o_school);
  if not o_admin and not exists (
       select 1 from public.user_roles r where r.user_id = o_uid and r.role = 'financial') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';   -- professor e sem papel
  end if;
end $$;

-- 5. Payload devolvido pelos dois RPCs -----------------------------------------
-- Só eventos visíveis ao papel ATUAL: linha antiga de reenrollment de quem foi
-- rebaixado a financeiro fica no banco, mas não volta para a tela.
create or replace function public.notification_preferences_payload(p_uid uuid, p_school uuid, p_admin boolean)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'preferences', coalesce((
      select jsonb_agg(jsonb_build_object(
               'event', d.event, 'direction', d.direction,
               'in_app', p.in_app, 'email', p.email, 'offset_days', p.offset_days,
               'allowed_offsets', to_jsonb(d.allowed_offsets), 'email_recommended', d.email_recommended)
             order by d.sort_order)
        from public.notification_event_defaults() d
        join public.notification_preferences p
          on p.event = d.event and p.user_id = p_uid and p.school_id = p_school
       where p_admin or not d.admin_only), '[]'::jsonb),
    'settings', (
      select jsonb_build_object(
               'digest_enabled', s.digest_enabled,
               'digest_time', to_char(s.digest_time, 'HH24:MI'),
               'timezone', s.timezone,
               'confirmed_at', s.confirmed_at)
        from public.notification_settings s
       where s.user_id = p_uid and s.school_id = p_school));
$$;

-- 6. RPC: cria o que falta e devolve o estado -----------------------------------
create or replace function public.ensure_notification_preferences()
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  a record;
begin
  perform public.assert_mfa_gate();
  select * into a from public.notification_actor();

  insert into public.notification_preferences (school_id, user_id, event, in_app, email, offset_days)
  select a.o_school, a.o_uid, d.event, d.in_app, d.email, d.offset_days
    from public.notification_event_defaults() d
   where a.o_admin or not d.admin_only
  on conflict (user_id, school_id, event) do nothing;

  insert into public.notification_settings (school_id, user_id)
  values (a.o_school, a.o_uid)
  on conflict (user_id, school_id) do nothing;

  return public.notification_preferences_payload(a.o_uid, a.o_school, a.o_admin);
end $$;

-- 7. RPC: grava tudo numa transação e confirma ----------------------------------
create or replace function public.save_notification_preferences(
  p_prefs jsonb, p_digest_enabled boolean, p_digest_time time, p_timezone text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  a      record;
  v_item jsonb;
  v_def  record;
  v_off  integer;
begin
  perform public.assert_mfa_gate();
  select * into a from public.notification_actor();

  if p_prefs is null or jsonb_typeof(p_prefs) <> 'array' then
    raise exception 'INVALID_PREFERENCES' using errcode = '22023';
  end if;
  if p_timezone is null or not exists (select 1 from pg_timezone_names t where t.name = p_timezone) then
    raise exception 'INVALID_TIMEZONE' using errcode = '22023';
  end if;
  if p_digest_time is null or p_digest_time < time '06:00' or p_digest_time > time '20:00'
     or extract(minute from p_digest_time) <> 0 or extract(second from p_digest_time) <> 0 then
    raise exception 'INVALID_DIGEST_TIME' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_prefs) loop
    select * into v_def from public.notification_event_defaults() d where d.event = v_item->>'event';
    if not found then
      raise exception 'INVALID_EVENT' using errcode = '22023';
    end if;
    if v_def.admin_only and not a.o_admin then
      raise exception 'EVENT_NOT_ALLOWED' using errcode = '42501';
    end if;
    if jsonb_typeof(v_item->'offset_days') <> 'number' then
      raise exception 'INVALID_OFFSET' using errcode = '22023';
    end if;
    v_off := (v_item->>'offset_days')::integer;
    if not (v_off = any (v_def.allowed_offsets)) then
      raise exception 'INVALID_OFFSET' using errcode = '22023';
    end if;

    insert into public.notification_preferences (school_id, user_id, event, in_app, email, offset_days)
    values (a.o_school, a.o_uid, v_def.event,
            coalesce((v_item->>'in_app')::boolean, false),
            coalesce((v_item->>'email')::boolean, false),
            v_off)
    on conflict (user_id, school_id, event) do update
      set in_app = excluded.in_app, email = excluded.email, offset_days = excluded.offset_days;
  end loop;

  insert into public.notification_settings (school_id, user_id, digest_enabled, digest_time, timezone, confirmed_at)
  values (a.o_school, a.o_uid, coalesce(p_digest_enabled, false), p_digest_time, p_timezone, now())
  on conflict (user_id, school_id) do update
    set digest_enabled = excluded.digest_enabled,
        digest_time    = excluded.digest_time,
        timezone       = excluded.timezone,  -- o navegador de quem salvou define o fuso (nota S4)
        confirmed_at   = coalesce(public.notification_settings.confirmed_at, now());

  return public.notification_preferences_payload(a.o_uid, a.o_school, a.o_admin);
end $$;

-- 8. Permissões ----------------------------------------------------------------
-- Funções novas em public nascem executáveis por anon/authenticated no Supabase.
revoke all on function public.notification_event_defaults()                      from public, anon, authenticated;
revoke all on function public.notification_actor()                               from public, anon, authenticated;
revoke all on function public.notification_preferences_payload(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.ensure_notification_preferences()                  from public, anon;
revoke all on function public.save_notification_preferences(jsonb, boolean, time, text) from public, anon;
grant execute on function public.ensure_notification_preferences()                  to authenticated;
grant execute on function public.save_notification_preferences(jsonb, boolean, time, text) to authenticated;
