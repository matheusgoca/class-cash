-- Preferências de notificação: o e-mail só pode ficar ligado com "No sistema"
-- ligado no mesmo evento (decisão de produto de 19/11).
--
-- Por quê: o e-mail (S4a) nasce da linha em `notifications`, que o gerador só
-- cria quando o canal "no sistema" está ligado. Sem esta regra, quem desligasse
-- "No sistema" e ligasse e-mail não receberia nada. O gerador não muda.
--
-- Única mudança: a verificação EMAIL_REQUIRES_IN_APP antes do insert. O resto é a
-- definição em produção em 2026-11-23 (pg_get_functiondef), sem alterações.
-- CREATE OR REPLACE preserva os GRANT/REVOKE existentes.
-- Dados: em 2026-11-23 nenhuma linha tinha email = true com in_app = false.

CREATE OR REPLACE FUNCTION public.save_notification_preferences(p_prefs jsonb, p_digest_enabled boolean, p_digest_time time without time zone, p_timezone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    -- Regra de produto (19/11): o e-mail acompanha o aviso no sistema.
    if coalesce((v_item->>'email')::boolean, false) and not coalesce((v_item->>'in_app')::boolean, false) then
      raise exception 'EMAIL_REQUIRES_IN_APP' using errcode = '22023';
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
end $function$;
