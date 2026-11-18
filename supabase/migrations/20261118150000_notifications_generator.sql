-- S3, etapa 1: notificações no sistema geradas diariamente (sem e-mail; S4).
-- Spec: docs/superpowers/specs/2026-11-18-gerador-notificacoes-design.md (G1–G12).
-- Escrita só pelo gerador (cron) e por mark_notifications_read; sem policies de escrita.

-- 1. Tabela --------------------------------------------------------------------
create table if not exists public.notifications (
  id             uuid primary key default gen_random_uuid(),
  school_id      uuid not null references public.schools(id) on delete cascade,
  user_id        uuid not null references auth.users(id)     on delete cascade,
  event          text not null
                 check (event in ('tuition_due','tuition_overdue','renegotiation_installment','expense_due','reenrollment')),
  reference_date date not null,                -- o "hoje" do usuário no momento da geração
  offset_days    integer not null,
  item_count     integer not null check (item_count > 0),
  total_amount   numeric,                      -- nulo em reenrollment
  details        jsonb not null default '{}'::jsonb,
  read_at        timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint notifications_user_school_event_day_key unique (user_id, school_id, event, reference_date)
);
create index if not exists idx_notifications_user_school_created
  on public.notifications (user_id, school_id, created_at desc);
create index if not exists idx_notifications_unread
  on public.notifications (user_id, school_id) where read_at is null;

drop trigger if exists update_notifications_updated_at on public.notifications;
create trigger update_notifications_updated_at
  before update on public.notifications
  for each row execute function public.set_updated_at();

-- 2. RLS -----------------------------------------------------------------------
alter table public.notifications enable row level security;

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated
  using ((user_id = auth.uid() and school_id = public.get_user_school_id()) or public.is_master_admin());

drop policy if exists mfa_gate on public.notifications;
create policy mfa_gate on public.notifications as restrictive for all to authenticated
  using ((select public.mfa_gate_ok())) with check ((select public.mfa_gate_ok()));

-- 3. Gerador -------------------------------------------------------------------
-- Roda pelo cron (sem usuário), por isso sem assert_mfa_gate (mesmo motivo de
-- promote_overdue_tuitions). p_now existe para os testes fixarem o "agora".
-- Regras por evento (N = antecedência do usuário, "hoje" no fuso dele):
--   tuition_due               pending, sem renegociação, due_date = hoje + N
--   tuition_overdue           overdue, due_date < hoje - N   (acumulado: repete todo dia)
--   renegotiation_installment pending, com renegociação, due_date = hoje + N
--   expense_due               pending/overdue, due_date = hoje + N
--   reenrollment              contrato active, end_date = hoje + N
create or replace function public.generate_daily_notifications(p_now timestamptz default now())
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  drop table if exists pg_temp._notif_recipients;
  drop table if exists pg_temp._notif_daily;

  -- Destinatários: papel e vínculo ATUAIS (owner/admin ou financeiro).
  create temp table _notif_recipients on commit drop as
  select p.user_id,
         p.school_id,
         public.mfa_is_admin_or_owner(p.user_id, p.school_id) as is_admin,
         (p_now at time zone coalesce(s.timezone, 'America/Sao_Paulo'))::date as today
    from public.profiles p
    left join public.notification_settings s on s.user_id = p.user_id and s.school_id = p.school_id
   where p.school_id is not null
     and (public.mfa_is_admin_or_owner(p.user_id, p.school_id)
          or exists (select 1 from public.user_roles r where r.user_id = p.user_id and r.role = 'financial'));

  create temp table _notif_daily on commit drop as
  with targets as (
    select r.user_id, r.school_id, r.today, d.event,
           coalesce(np.offset_days, d.offset_days) as n
      from _notif_recipients r
      cross join public.notification_event_defaults() d
      left join public.notification_preferences np
        on np.user_id = r.user_id and np.school_id = r.school_id and np.event = d.event
     where coalesce(np.in_app, d.in_app)
       and (r.is_admin or not d.admin_only)
  )
  select t.user_id, t.school_id, t.event, t.today, t.n, x.item_count, x.total_amount, x.details
    from targets t
    cross join lateral (
      select count(*)::integer as item_count,
             sum(coalesce(tu.final_amount, tu.amount)) as total_amount,
             jsonb_build_object('class_count', count(distinct c.class_id)) as details
        from public.tuitions tu
        left join public.contracts c on c.id = tu.contract_id and c.school_id = tu.school_id
       where t.event = 'tuition_due' and tu.school_id = t.school_id
         and tu.status = 'pending' and tu.renegotiation_id is null and tu.due_date = t.today + t.n
      union all
      select count(*)::integer,
             sum(coalesce(tu.final_amount, tu.amount)),
             jsonb_build_object('class_count', count(distinct c.class_id))
        from public.tuitions tu
        left join public.contracts c on c.id = tu.contract_id and c.school_id = tu.school_id
       where t.event = 'tuition_overdue' and tu.school_id = t.school_id
         and tu.status = 'overdue' and tu.due_date < t.today - t.n
      union all
      select count(*)::integer, sum(coalesce(tu.final_amount, tu.amount)), '{}'::jsonb
        from public.tuitions tu
       where t.event = 'renegotiation_installment' and tu.school_id = t.school_id
         and tu.status = 'pending' and tu.renegotiation_id is not null and tu.due_date = t.today + t.n
      union all
      select count(*)::integer, sum(e.amount),
             case when count(*) = 1 then jsonb_build_object('description', min(e.description)) else '{}'::jsonb end
        from public.expenses e
       where t.event = 'expense_due' and e.school_id = t.school_id
         and e.status in ('pending', 'overdue') and e.due_date = t.today + t.n
      union all
      select count(*)::integer, null::numeric,
             jsonb_build_object('renewed_count', count(*) filter (where exists (
               select 1 from public.contracts r2
                where r2.renewed_from_id = c.id and r2.school_id = c.school_id)))
        from public.contracts c
       where t.event = 'reenrollment' and c.school_id = t.school_id
         and c.status = 'active' and c.end_date = t.today + t.n
    ) x
   where x.item_count > 0;

  insert into public.notifications (school_id, user_id, event, reference_date, offset_days, item_count, total_amount, details)
  select school_id, user_id, event, today, n, item_count, total_amount, details
    from _notif_daily
  on conflict (user_id, school_id, event, reference_date) do update
    set offset_days  = excluded.offset_days,
        item_count   = excluded.item_count,
        total_amount = excluded.total_amount,
        details      = excluded.details;          -- read_at preservado
  get diagnostics v_rows = row_count;

  -- Aviso NÃO LIDO de hoje que deixou de valer (zerou, preferência desligada, papel mudou): apaga.
  delete from public.notifications n
   using _notif_recipients r
   where n.user_id = r.user_id and n.school_id = r.school_id and n.reference_date = r.today
     and n.read_at is null
     and not exists (select 1 from _notif_daily dd
                      where dd.user_id = n.user_id and dd.school_id = n.school_id and dd.event = n.event);

  -- Quem deixou de ser destinatário (ex.: virou professor): apaga os não lidos de hoje (hoje em São Paulo).
  delete from public.notifications n
   where n.read_at is null
     and n.reference_date = (p_now at time zone 'America/Sao_Paulo')::date
     and not exists (select 1 from _notif_recipients r where r.user_id = n.user_id and r.school_id = n.school_id);

  return v_rows;
end $$;

-- 4. RPCs para o front ---------------------------------------------------------
create or replace function public.list_notifications(
  p_offset integer default 0, p_limit integer default 20,
  p_category text default null, p_unread_only boolean default false)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_school uuid;
  v_events text[];
begin
  perform public.assert_mfa_gate();
  if v_uid is null then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  v_school := public.get_user_school_id();
  if v_school is null then
    raise exception 'NO_SCHOOL' using errcode = 'P0001';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 or p_offset is null or p_offset < 0 then
    raise exception 'INVALID_LIMIT' using errcode = '22023';
  end if;
  if p_category is null then
    v_events := null;
  elsif p_category = 'cobranca' then
    v_events := array['tuition_due', 'tuition_overdue'];
  elsif p_category = 'renegociacao' then
    v_events := array['renegotiation_installment'];
  elsif p_category = 'despesas' then
    v_events := array['expense_due'];
  elsif p_category = 'rematricula' then
    v_events := array['reenrollment'];
  else
    raise exception 'INVALID_CATEGORY' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', q.id, 'event', q.event, 'reference_date', q.reference_date,
               'offset_days', q.offset_days, 'item_count', q.item_count,
               'total_amount', q.total_amount, 'details', q.details,
               'read_at', q.read_at, 'created_at', q.created_at)
             order by q.reference_date desc, q.sort_order, q.id)
        from (
          select n.*, d.sort_order
            from public.notifications n
            join public.notification_event_defaults() d on d.event = n.event
           where n.user_id = v_uid and n.school_id = v_school
             and (v_events is null or n.event = any (v_events))
             and (not coalesce(p_unread_only, false) or n.read_at is null)
           order by n.reference_date desc, d.sort_order, n.id
           offset p_offset limit p_limit) q), '[]'::jsonb),
    'filtered_total', (select count(*) from public.notifications n
                        where n.user_id = v_uid and n.school_id = v_school
                          and (v_events is null or n.event = any (v_events))
                          and (not coalesce(p_unread_only, false) or n.read_at is null)),
    'total',  (select count(*) from public.notifications n where n.user_id = v_uid and n.school_id = v_school),
    'unread', (select count(*) from public.notifications n
                where n.user_id = v_uid and n.school_id = v_school and n.read_at is null));
end $$;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_school uuid;
  v_count  integer;
begin
  perform public.assert_mfa_gate();
  if v_uid is null then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  v_school := public.get_user_school_id();
  if v_school is null then
    raise exception 'NO_SCHOOL' using errcode = 'P0001';
  end if;
  update public.notifications
     set read_at = now()
   where user_id = v_uid and school_id = v_school and read_at is null
     and (p_ids is null or id = any (p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- 5. Permissões ----------------------------------------------------------------
revoke all on function public.generate_daily_notifications(timestamptz)          from public, anon, authenticated;
revoke all on function public.list_notifications(integer, integer, text, boolean) from public, anon;
revoke all on function public.mark_notifications_read(uuid[])                     from public, anon;
grant execute on function public.list_notifications(integer, integer, text, boolean) to authenticated;
grant execute on function public.mark_notifications_read(uuid[])                     to authenticated;

-- 6. Job diário: 08:00 UTC = 05:00 em Brasília (depois de promote-overdue-tuitions às 03:00 UTC,
--    antes do resumo mais cedo da S4, 06:00).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'generate-daily-notifications') then
    perform cron.unschedule('generate-daily-notifications');
  end if;
  perform cron.schedule('generate-daily-notifications', '0 8 * * *',
                        'select public.generate_daily_notifications();');
end $$;
