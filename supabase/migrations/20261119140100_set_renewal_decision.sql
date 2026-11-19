-- supabase/migrations/20261119140100_set_renewal_decision.sql
-- S4c: registra/atualiza/apaga a decisão da família sobre um contrato (spec R3, R4, R6).

create or replace function public.set_renewal_decision(
  p_contract_id uuid,
  p_status      text,
  p_reason      text default null,
  p_note        text default null
) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_school uuid;
  v_status text;
  v_reason text;
begin
  perform public.assert_mfa_gate();

  -- Papel primeiro (não depende do contrato): professor nunca chega a consultar nada.
  if not (public.get_current_user_role() in ('admin', 'financial') or public.is_master_admin()) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  if p_status is null or p_status not in ('contacted', 'will_renew', 'will_not_renew', 'none') then
    raise exception 'INVALID_STATUS' using errcode = '22023';
  end if;

  select c.school_id, c.status into v_school, v_status
    from public.contracts c where c.id = p_contract_id;

  -- Contrato inexistente ou de outra escola respondem igual (sem revelar existência).
  if v_school is null or not (v_school = public.get_user_school_id() or public.is_master_admin()) then
    raise exception 'INVALID_CONTRACT' using errcode = '22023';
  end if;
  if v_status <> 'active' then
    raise exception 'INVALID_CONTRACT' using errcode = '22023';
  end if;
  -- Já renovado (sucessor não cancelado): não há mais o que decidir.
  if exists (select 1 from public.contracts r
              where r.renewed_from_id = p_contract_id and r.school_id = v_school and r.status <> 'cancelled') then
    raise exception 'INVALID_CONTRACT' using errcode = '22023';
  end if;

  if p_status = 'none' then
    delete from public.renewal_decisions where contract_id = p_contract_id and school_id = v_school;
    return;
  end if;

  if p_status = 'will_not_renew' then
    if p_reason is null or p_reason not in ('moved_city', 'price', 'changed_school', 'other') then
      raise exception 'REASON_REQUIRED' using errcode = '22023';
    end if;
    v_reason := p_reason;
  else
    v_reason := null;   -- motivo só existe para "não vai renovar"; qualquer outro é ignorado
  end if;

  insert into public.renewal_decisions (school_id, contract_id, status, reason, note, decided_by)
  values (v_school, p_contract_id, p_status, v_reason, nullif(btrim(p_note), ''), auth.uid())
  on conflict (contract_id) do update
    set status     = excluded.status,
        reason     = excluded.reason,
        note       = excluded.note,
        decided_by = excluded.decided_by;
end $$;

revoke all on function public.set_renewal_decision(uuid, text, text, text) from public, anon;
grant execute on function public.set_renewal_decision(uuid, text, text, text) to authenticated;
