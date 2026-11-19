-- supabase/migrations/20261119140200_renew_contracts.sql
-- S4c: renovação em lote, atômica (spec R8). O cliente calcula as mensalidades com a função pura da Etapa 2;
-- o servidor valida tudo e grava contratos, mensalidades e taxa de rematrícula numa transação só.
-- Qualquer item inválido aborta o lote inteiro. Origem que já tem sucessor é PULADA e listada.

create or replace function public.renew_contracts(
  p_school_id      uuid,
  p_items          jsonb,
  p_fee_service_id uuid default null
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  it         record;
  src        record;
  v_fee_id    uuid;
  v_fee_name  text;
  v_fee_price numeric;
  t          record;
  v_new_id   uuid;
  v_final    numeric;
  v_n        integer;
  v_cnt      integer;
  v_distinct integer;
  v_renewed  integer := 0;
  v_tuitions integer := 0;
  v_skipped  jsonb   := '[]'::jsonb;
begin
  perform public.assert_mfa_gate();

  -- Null-safe: usuário sem papel (get_current_user_role() nulo) é negado, não liberado.
  if not (coalesce(p_school_id = public.get_user_school_id() and public.get_current_user_role() in ('admin', 'financial'), false)
          or coalesce(public.is_master_admin(), false)) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'INVALID_ITEMS' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(p_items);
  if v_n < 1 or v_n > 100 then
    raise exception 'INVALID_ITEMS' using errcode = '22023', detail = 'O lote precisa ter de 1 a 100 contratos.';
  end if;

  if p_fee_service_id is not null then
    select s.id, s.name, s.price into v_fee_id, v_fee_name, v_fee_price
      from public.school_services s
     where s.id = p_fee_service_id and s.school_id = p_school_id and s.type = 'avulso' and s.active;
    if not found then
      raise exception 'INVALID_SERVICE' using errcode = '22023';
    end if;
  end if;

  -- Marca a origem na auditoria; local à transação desta chamada (nunca vaza no pool).
  perform set_config('app.audit_source', 'generated'::text, true);

  for it in
    select * from jsonb_to_recordset(p_items) as x(
      source_contract_id uuid, class_id uuid, monthly_amount numeric,
      start_date date, end_date date, tuitions jsonb)
  loop
    if it.source_contract_id is null or it.monthly_amount is null or it.start_date is null
       or it.end_date is null or it.tuitions is null or jsonb_typeof(it.tuitions) <> 'array' then
      raise exception 'INVALID_ITEM' using errcode = '22023', detail = 'Item incompleto no lote.';
    end if;

    -- Trava a origem: duas renovações simultâneas do mesmo contrato se serializam aqui.
    select c.* into src from public.contracts c
     where c.id = it.source_contract_id and c.school_id = p_school_id for update;
    if not found then
      raise exception 'INVALID_ITEM' using errcode = '22023',
        detail = format('Contrato %s não encontrado nesta escola.', it.source_contract_id);
    end if;

    -- Já tem sucessor (não cancelado, inclusive um criado antes neste mesmo lote): pula e informa.
    if exists (select 1 from public.contracts r
                where r.renewed_from_id = src.id and r.school_id = p_school_id and r.status <> 'cancelled') then
      v_skipped := v_skipped || jsonb_build_object('source_contract_id', src.id, 'reason', 'ALREADY_RENEWED');
      continue;
    end if;

    if src.status <> 'active' then
      raise exception 'INVALID_ITEM' using errcode = '22023',
        detail = format('Contrato %s não está ativo.', src.id);
    end if;
    if it.monthly_amount <= 0 then
      raise exception 'INVALID_ITEM' using errcode = '22023',
        detail = format('Contrato %s: valor mensal inválido.', src.id);
    end if;
    if it.class_id is not null
       and not exists (select 1 from public.classes cl where cl.id = it.class_id and cl.school_id = p_school_id) then
      raise exception 'INVALID_ITEM' using errcode = '22023',
        detail = format('Contrato %s: turma de destino não pertence à escola.', src.id);
    end if;
    if it.start_date <> src.end_date + 1 then
      raise exception 'INVALID_ITEM' using errcode = '22023',
        detail = format('Contrato %s: o novo contrato deve começar no dia seguinte ao fim do atual.', src.id);
    end if;
    if it.end_date < it.start_date or it.end_date > (it.start_date + interval '24 months')::date then
      raise exception 'INVALID_ITEM' using errcode = '22023',
        detail = format('Contrato %s: período do novo contrato inválido (máximo 24 meses).', src.id);
    end if;
    if jsonb_array_length(it.tuitions) < 1 then
      raise exception 'INVALID_ITEM' using errcode = '22023',
        detail = format('Contrato %s: nenhuma mensalidade informada.', src.id);
    end if;

    insert into public.contracts
      (student_id, class_id, school_id, period, start_date, end_date, monthly_amount, discount, due_day, status, renewed_from_id)
    values
      (src.student_id, it.class_id, p_school_id, src.period, it.start_date, it.end_date,
       it.monthly_amount, src.discount, src.due_day, 'active', src.id)
    returning id, final_amount into v_new_id, v_final;

    -- Mensalidades: o servidor manda no valor (final_amount do contrato novo); o cliente só é conferido.
    for t in
      select * from jsonb_to_recordset(it.tuitions) as r(due_date date, amount numeric, status text, description text)
    loop
      if t.due_date is null or t.due_date < it.start_date or t.due_date > it.end_date then
        raise exception 'INVALID_ITEM' using errcode = '22023',
          detail = format('Contrato %s: mensalidade fora do período do contrato.', src.id);
      end if;
      if t.status is null or t.status not in ('pending', 'overdue') then
        raise exception 'INVALID_ITEM' using errcode = '22023',
          detail = format('Contrato %s: status de mensalidade inválido.', src.id);
      end if;
      if t.description is null or btrim(t.description) = '' then
        raise exception 'INVALID_ITEM' using errcode = '22023',
          detail = format('Contrato %s: mensalidade sem descrição.', src.id);
      end if;
      if t.amount is not null and abs(t.amount - v_final) > 0.01 then
        raise exception 'INVALID_ITEM' using errcode = '22023',
          detail = format('Contrato %s: valor da mensalidade não confere com o do contrato.', src.id);
      end if;
    end loop;

    select count(distinct (r.due_date)) into v_distinct
      from jsonb_to_recordset(it.tuitions) as r(due_date date);
    if v_distinct <> jsonb_array_length(it.tuitions) then
      raise exception 'INVALID_ITEM' using errcode = '22023',
        detail = format('Contrato %s: mensalidades com a mesma data de vencimento.', src.id);
    end if;

    insert into public.tuitions (contract_id, student_id, school_id, amount, final_amount, due_date, status, description)
    select v_new_id, src.student_id, p_school_id, v_final, null, r.due_date, r.status, r.description
      from jsonb_to_recordset(it.tuitions) as r(due_date date, status text, description text);
    get diagnostics v_cnt = row_count;
    v_tuitions := v_tuitions + v_cnt;

    if v_fee_id is not null then
      insert into public.service_charges (school_id, student_id, service_id, description, amount, due_date, status)
      values (p_school_id, src.student_id, v_fee_id, v_fee_name, v_fee_price, it.start_date, 'pending');
    end if;

    v_renewed := v_renewed + 1;
  end loop;

  return jsonb_build_object('renewed', v_renewed, 'tuitions', v_tuitions, 'skipped', v_skipped);
end $$;

revoke all on function public.renew_contracts(uuid, jsonb, uuid) from public, anon;
grant execute on function public.renew_contracts(uuid, jsonb, uuid) to authenticated;
