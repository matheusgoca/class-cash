-- supabase/migrations/20261119130200_email_claim_rpcs.sql
-- S4a: reivindicação e resultado de envios. Chamados só pela Edge Function (service_role).
-- Regras (spec E3, E6, E7): aviso do próprio dia, a partir das 08:00 locais, canal e-mail ligado,
-- tela confirmada (confirmed_at), destinatário atual, e-mail confirmado.

create or replace function public.claim_notification_emails(
  p_now         timestamptz default now(),
  p_limit       integer     default 40,
  p_only_emails text[]      default null
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'INVALID_LIMIT' using errcode = '22023';
  end if;

  with cand as (
    select n.user_id, n.school_id, n.event, n.reference_date, n.created_at as n_created,
           n.offset_days, n.item_count, n.total_amount, n.details,
           u.email as to_email, sc.name as school_name
      from public.notifications n
      join public.profiles p                 on p.user_id = n.user_id and p.school_id = n.school_id
      join auth.users u                      on u.id = n.user_id
      join public.schools sc                 on sc.id = n.school_id
      join public.notification_settings s    on s.user_id = n.user_id and s.school_id = n.school_id
      join public.notification_preferences np on np.user_id = n.user_id and np.school_id = n.school_id and np.event = n.event
      join public.notification_event_defaults() d on d.event = n.event
     where s.confirmed_at is not null
       and np.email
       and u.email is not null and u.email_confirmed_at is not null
       and (p_only_emails is null
            or lower(u.email) = any (select lower(x) from unnest(p_only_emails) x))
       and n.reference_date = (p_now at time zone coalesce(s.timezone, 'America/Sao_Paulo'))::date
       and extract(hour from (p_now at time zone coalesce(s.timezone, 'America/Sao_Paulo'))) >= 8
       and (public.mfa_is_admin_or_owner(n.user_id, n.school_id)
            or (not d.admin_only
                and exists (select 1 from public.user_roles r where r.user_id = n.user_id and r.role = 'financial')))
  ),
  eligible as (
    select c.*
      from cand c
      left join public.email_outbox o
        on o.user_id = c.user_id and o.school_id = c.school_id
       and o.event = c.event and o.reference_date = c.reference_date
     where o.id is null
        or (o.status = 'failed'  and o.attempts < 3)
        or (o.status = 'sending' and o.attempts < 3 and o.updated_at < now() - interval '30 minutes')
     order by c.n_created, c.user_id, c.event
     limit p_limit
  ),
  claimed as (
    insert into public.email_outbox as o (school_id, user_id, event, reference_date, status, attempts)
    select school_id, user_id, event, reference_date, 'sending', 1 from eligible
    on conflict (user_id, school_id, event, reference_date) do update
      set status = 'sending', attempts = o.attempts + 1
      where o.attempts < 3
        and (o.status = 'failed'
             or (o.status = 'sending' and o.updated_at < now() - interval '30 minutes'))
    returning o.id, o.user_id, o.school_id, o.event, o.reference_date
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'outbox_id',      cl.id,
           'to_email',       e.to_email,
           'school_name',    e.school_name,
           'event',          e.event,
           'reference_date', e.reference_date,
           'offset_days',    e.offset_days,
           'item_count',     e.item_count,
           'total_amount',   e.total_amount,
           'details',        e.details
         ) order by e.n_created, e.user_id, e.event), '[]'::jsonb)
    into v_result
    from claimed cl
    join eligible e
      on e.user_id = cl.user_id and e.school_id = cl.school_id
     and e.event = cl.event and e.reference_date = cl.reference_date;

  return v_result;
end $$;

create or replace function public.mark_email_result(
  p_outbox_id   uuid,
  p_status      text,
  p_provider_id text default null,
  p_error       text default null
) returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if p_status is null or p_status not in ('sent', 'failed') then
    raise exception 'INVALID_STATUS' using errcode = '22023';
  end if;
  -- Só uma linha em 'sending' recebe resultado: um aviso tardio não sobrescreve um reenvio.
  update public.email_outbox
     set status              = p_status,
         provider_message_id = case when p_status = 'sent'   then p_provider_id else provider_message_id end,
         sent_at             = case when p_status = 'sent'   then now() else sent_at end,
         last_error          = case when p_status = 'failed' then left(coalesce(p_error, 'erro desconhecido'), 500) else null end
   where id = p_outbox_id and status = 'sending';
end $$;

revoke all on function public.claim_notification_emails(timestamptz, integer, text[]) from public, anon, authenticated;
revoke all on function public.mark_email_result(uuid, text, text, text)               from public, anon, authenticated;
grant execute on function public.claim_notification_emails(timestamptz, integer, text[]) to service_role;
grant execute on function public.mark_email_result(uuid, text, text, text)               to service_role;
