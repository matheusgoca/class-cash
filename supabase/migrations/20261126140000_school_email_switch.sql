-- Interruptor de e-mail POR ESCOLA (S6, bloco 1; portão obrigatório de 25/11 antes de abrir o e-mail a mais de uma escola).
--
-- Antes: nenhum freio por escola; só o interruptor global da função (EMAIL_SENDING_ENABLED), a allowlist e as preferências dos usuários.
-- Agora cada escola tem schools.email_enabled (padrão FALSE para todas, inclusive Teste e Pensar). Só o master liga ou desliga,
-- pelo RPC set_school_email_enabled. A trigger schools_email_enabled_guard impede que admin ou financeiro (ou qualquer sessão que não seja
-- master) altere email_enabled, email_enabled_at ou email_enabled_by por UPDATE direto na API: migrations, scripts e service_role
-- (auth.uid() nulo) continuam podendo. Mesmo molde de schools_require_2fa_guard; o master precisa de sessão aal2.
--
-- Efeito no envio (todas as travas anteriores continuam valendo; esta é MAIS UMA):
--   * claim_notification_emails só reivindica avisos de escolas com email_enabled = true (checagem no enfileiramento);
--   * a Edge Function chama email_may_send(outbox_id) imediatamente antes de cada envio (checagem no envio): se a escola foi
--     desligada depois da reivindicação, o item vira 'skipped' em vez de sair;
--   * desligar a escola marca como 'skipped' (motivo school_email_disabled) os itens da fila ainda não enviados ('sending' e 'failed'),
--     sem apagar nada; 'sent' fica como está. Um item 'skipped' do dia não é reenviado se a escola for religada no mesmo dia.
-- Auditoria: a trigger genérica de schools registra a mudança (old_data/new_data); como a ação é do master, a tela de auditoria a mostra
-- como "Suporte Class Cash". NÃO liga o envio global, não altera secrets, não mexe em nenhum dado de escola além da coluna nova.

alter table public.schools
  add column if not exists email_enabled boolean not null default false,
  add column if not exists email_enabled_at timestamptz,
  add column if not exists email_enabled_by uuid references auth.users(id) on delete set null;

comment on column public.schools.email_enabled is
  'Freio por escola do e-mail de avisos. Só o master altera (RPC set_school_email_enabled). Padrão false.';

-- Fila: novo estado 'skipped' (com motivo), sem apagar linhas.
alter table public.email_outbox add column if not exists skip_reason text;
alter table public.email_outbox drop constraint if exists email_outbox_status_check;
alter table public.email_outbox add constraint email_outbox_status_check
  check (status in ('sending', 'sent', 'failed', 'skipped'));

-- Guarda: só o master altera os campos do interruptor pela API.
create or replace function public.schools_email_enabled_guard()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_changed boolean;
begin
  if tg_op = 'INSERT' then
    v_changed := new.email_enabled or new.email_enabled_at is not null or new.email_enabled_by is not null;
  else
    v_changed := new.email_enabled is distinct from old.email_enabled
              or new.email_enabled_at is distinct from old.email_enabled_at
              or new.email_enabled_by is distinct from old.email_enabled_by;
  end if;
  if not v_changed then
    return new;
  end if;

  -- v_uid nulo = migration, script ou service_role: liberado (não há sessão de usuário).
  if v_uid is not null then
    if not coalesce(public.is_master_admin(), false) then
      raise exception 'Somente o suporte Class Cash altera o e-mail de avisos.' using errcode = '42501';
    end if;
    if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
      raise exception 'Confirme o seu 2FA antes de alterar o e-mail de avisos.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists schools_email_enabled_guard on public.schools;
create trigger schools_email_enabled_guard
  before insert or update on public.schools
  for each row execute function public.schools_email_enabled_guard();

-- RPC do master: liga/desliga e, ao desligar, pula o que está na fila.
create or replace function public.set_school_email_enabled(p_school_id uuid, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_skipped integer := 0;
begin
  perform public.assert_mfa_gate();
  if not coalesce(public.is_master_admin(), false) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'INVALID_VALUE' using errcode = '22023';
  end if;

  update public.schools
     set email_enabled = p_enabled,
         email_enabled_at = case when p_enabled then now() else null end,
         email_enabled_by = case when p_enabled then auth.uid() else null end
   where id = p_school_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = '22023';
  end if;

  if not p_enabled then
    update public.email_outbox
       set status = 'skipped', skip_reason = 'school_email_disabled'
     where school_id = p_school_id and status in ('sending', 'failed');
    get diagnostics v_skipped = row_count;
  end if;

  return jsonb_build_object('school_id', p_school_id, 'email_enabled', p_enabled, 'skipped', v_skipped);
end;
$$;

revoke all on function public.set_school_email_enabled(uuid, boolean) from public, anon;
grant execute on function public.set_school_email_enabled(uuid, boolean) to authenticated;

-- Checagem no envio (Edge Function, service_role): o item ainda está 'sending' e a escola continua ligada?
create or replace function public.email_may_send(p_outbox_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok boolean;
begin
  select (o.status = 'sending' and s.email_enabled)
    into v_ok
    from public.email_outbox o join public.schools s on s.id = o.school_id
   where o.id = p_outbox_id;
  if coalesce(v_ok, false) then
    return true;
  end if;
  -- escola desligada depois da reivindicação: o item não sai e fica registrado como pulado
  update public.email_outbox o
     set status = 'skipped', skip_reason = 'school_email_disabled'
    from public.schools s
   where o.id = p_outbox_id and o.school_id = s.id and o.status = 'sending' and not s.email_enabled;
  return false;
end;
$$;

revoke all on function public.email_may_send(uuid) from public, anon, authenticated;
grant execute on function public.email_may_send(uuid) to service_role;

-- mark_email_result passa a aceitar 'skipped' (com motivo), sem sobrescrever o que não está em 'sending'.
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
  if p_status is null or p_status not in ('sent', 'failed', 'skipped') then
    raise exception 'INVALID_STATUS' using errcode = '22023';
  end if;
  update public.email_outbox
     set status              = p_status,
         provider_message_id = case when p_status = 'sent'    then p_provider_id else provider_message_id end,
         sent_at             = case when p_status = 'sent'    then now() else sent_at end,
         last_error          = case when p_status = 'failed'  then left(coalesce(p_error, 'erro desconhecido'), 500) else null end,
         skip_reason         = case when p_status = 'skipped' then left(coalesce(p_error, 'sem motivo'), 200) else skip_reason end
   where id = p_outbox_id and status = 'sending';
end $$;

revoke all on function public.mark_email_result(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.mark_email_result(uuid, text, text, text) to service_role;

-- claim_notification_emails: a mesma função de produção com UMA condição nova no CTE cand (sc.email_enabled).
CREATE OR REPLACE FUNCTION public.claim_notification_emails(p_now timestamp with time zone DEFAULT now(), p_limit integer DEFAULT 40, p_only_emails text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = 'public'
AS $$
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
     where sc.email_enabled                      -- S6 bloco 1: freio por escola (só o master liga)
       and s.confirmed_at is not null
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

revoke all on function public.claim_notification_emails(timestamptz, integer, text[]) from public, anon, authenticated;
grant execute on function public.claim_notification_emails(timestamptz, integer, text[]) to service_role;
