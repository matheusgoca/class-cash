-- S4c: o aviso de rematrícula passa a descontar quem "não vai renovar" e só é gerado se ainda houver pendentes.
-- Spec: docs/superpowers/specs/2026-11-19-s4c-rematricula-design.md (seção "Aviso de rematrícula").
-- details do evento reenrollment: { renewed_count, declined_count }. Pendentes = item_count - renewed_count - declined_count.
-- Únicas mudanças na função: os dois trechos marcados "MUDANÇA (S4c)". O resto é a definição de
-- 20261119120000_notifications_renewed_count_exclude_cancelled.sql, sem alterações.
-- Permissões: CREATE OR REPLACE preserva os GRANT/REVOKE existentes.
-- Requer public.renewal_decisions (20261119140000).

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
             jsonb_build_object(
               'renewed_count', count(*) filter (where exists (
                 select 1 from public.contracts r2
                  where r2.renewed_from_id = c.id and r2.school_id = c.school_id
                    and r2.status <> 'cancelled')),
               -- MUDANÇA (S4c): "não vai renovar" (sem sucessor) sai dos pendentes
               'declined_count', count(*) filter (where not exists (
                   select 1 from public.contracts r2
                    where r2.renewed_from_id = c.id and r2.school_id = c.school_id
                      and r2.status <> 'cancelled')
                 and exists (
                   select 1 from public.renewal_decisions d
                    where d.contract_id = c.id and d.school_id = c.school_id
                      and d.status = 'will_not_renew')))
        from public.contracts c
       where t.event = 'reenrollment' and c.school_id = t.school_id
         and c.status = 'active' and c.end_date = t.today + t.n
    ) x
   where x.item_count > 0
     -- MUDANÇA (S4c): rematrícula só avisa quando ainda há pendentes
     and not (x.event = 'reenrollment'
              and x.item_count - (x.details->>'renewed_count')::integer - (x.details->>'declined_count')::integer <= 0);

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

  -- Atraso é um lembrete acumulado (G3): para cada destinatário, o aviso de hoje
  -- substitui os de dias anteriores ainda não lidos. Se hoje não há mais atraso,
  -- os antigos não lidos também saem (deixaram de valer). Lidos ficam.
  delete from public.notifications n
   using _notif_recipients r
   where n.user_id = r.user_id and n.school_id = r.school_id
     and n.event = 'tuition_overdue'
     and n.reference_date < r.today
     and n.read_at is null;

  -- Quem deixou de ser destinatário (ex.: virou professor): apaga os não lidos de hoje (hoje em São Paulo).
  delete from public.notifications n
   where n.read_at is null
     and n.reference_date = (p_now at time zone 'America/Sao_Paulo')::date
     and not exists (select 1 from _notif_recipients r where r.user_id = n.user_id and r.school_id = n.school_id);

  return v_rows;
end $$;
