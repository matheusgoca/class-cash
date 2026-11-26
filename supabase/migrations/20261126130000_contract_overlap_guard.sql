-- Trava de contrato ativo sobreposto (S6b, bloco C2; ensaio geral de 25/11/2026).
--
-- Dois contratos ATIVOS do mesmo aluno com períodos que se sobrepõem geram cobrança em dobro. O ensaio provou que o banco aceita.
-- Esta migration protege os RPCs de criação e de renovação (a validação do formulário e da importação fica no front):
--   * public.contract_overlaps(escola, aluno, início, fim, excluir): há outro contrato 'active' do aluno, na escola, com período
--     que se sobrepõe (início e fim inclusivos)? 'suspended' e 'cancelled' NÃO contam. Uso interno dos RPCs (sem grant).
--   * import_contract: contrato com status 'active' que se sobrepõe a outro ativo do aluno => OVERLAP (22023). Linha 'suspended'
--     ou 'cancelled' passa (não cobra).
--   * renew_contracts: o sucessor (que começa no dia seguinte ao fim da origem) não pode se sobrepor a outro contrato ativo do
--     aluno, excluindo a própria origem => INVALID_ITEM com detalhe em português.
-- NÃO cria constraint nem trigger: a criação direta pela API segue sem barreira (aceito por ora, dívida registrada no STATUS).
-- A reativação (suspended -> active) é revalidada no front (ContractTable). Nada de dados é alterado.

create or replace function public.contract_overlaps(
  p_school_id uuid, p_student_id uuid, p_start date, p_end date, p_exclude uuid default null
)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1 from public.contracts c
     where c.school_id = p_school_id and c.student_id = p_student_id
       and c.status = 'active'
       and (p_exclude is null or c.id <> p_exclude)
       and c.start_date <= p_end and p_start <= c.end_date
  );
$$;

revoke all on function public.contract_overlaps(uuid, uuid, date, date, uuid) from public, anon, authenticated;

create or replace function public.import_contract(p_contract jsonb, p_school_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed boolean;
  v_id uuid;
  r record;
begin
  perform public.assert_mfa_gate();
  select
    (p_school_id = public.get_user_school_id() and public.get_current_user_role() in ('admin', 'financial'))
    or public.is_master_admin()
  into v_allowed;

  if not coalesce(v_allowed, false) then
    raise exception 'Sem permissão para importar matrículas nesta escola';
  end if;

  perform set_config('app.audit_source', 'import', true);

  select * into r from jsonb_to_record(p_contract) as x(
    student_id uuid, class_id uuid, monthly_amount numeric, discount numeric,
    due_day integer, start_date date, end_date date, status text
  );

  -- Bloco C2: só contrato ativo cobra, então só ele é barrado quando se sobrepõe a outro ativo do mesmo aluno.
  if r.status = 'active' and public.contract_overlaps(p_school_id, r.student_id, r.start_date, r.end_date) then
    raise exception 'OVERLAP' using errcode = '22023',
      detail = 'O aluno já tem um contrato ativo que se sobrepõe a este período.';
  end if;

  insert into public.contracts (student_id, class_id, monthly_amount, discount, due_day, start_date, end_date, status, school_id)
  values (r.student_id, r.class_id, r.monthly_amount, r.discount, r.due_day, r.start_date, r.end_date, r.status, p_school_id)
  returning id into v_id;

  return v_id;
end;
$$;

-- renew_contracts: a mesma função de produção (20261125120000) com UMA checagem nova antes do insert do sucessor.
CREATE OR REPLACE FUNCTION public.renew_contracts(p_school_id uuid, p_items jsonb, p_fee_service_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = 'public'
AS $$
declare
  -- H5: teto da mensalidade. A validação "de verdade" é a prévia do lote no front; o RPC só confirma.
  -- MANTER IGUAL a MAX_MONTHLY_AMOUNT em src/lib/renewal.ts (a prévia mostra a mensagem amigável).
  c_max_monthly  constant numeric := 30000;
  -- H1: 24 meses + o dia final do período = no máximo 25 vencimentos mensais.
  c_max_tuitions constant integer := 25;

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

  -- H3: cada item precisa ser um objeto (jsonb_to_recordset daria erro cru num escalar).
  if exists (select 1 from jsonb_array_elements(p_items) e where jsonb_typeof(e) <> 'object') then
    raise exception 'INVALID_ITEMS' using errcode = '22023', detail = 'O lote precisa ser uma lista de contratos.';
  end if;

  -- H3: leitura de teste dos itens e das mensalidades. Só os casts ficam dentro do bloco, então capturar
  -- 22P02/22007/22008/22003/22023 aqui nunca engole um erro nosso; o erro cru (que ecoa o valor) é trocado
  -- por uma mensagem fixa. Quem sai por aqui aborta a transação inteira, como qualquer item inválido.
  begin
    perform 1
      from jsonb_to_recordset(p_items) as x(
             source_contract_id uuid, class_id uuid, monthly_amount numeric,
             start_date date, end_date date, tuitions jsonb)
      cross join lateral jsonb_to_recordset(case when jsonb_typeof(x.tuitions) = 'array' then x.tuitions else '[]'::jsonb end)
             as r(due_date date, amount numeric, status text, description text);
  exception when sqlstate '22P02' or sqlstate '22007' or sqlstate '22008' or sqlstate '22003' or sqlstate '22023' then
    raise exception 'INVALID_ITEM' using errcode = '22023', detail = 'Algum valor ou data do lote está em formato inválido.';
  end;

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

  -- H4: ordem determinística (source_contract_id, depois a posição no lote). Duas sessões com os mesmos
  -- contratos travam as linhas na mesma ordem e não se bloqueiam em círculo; a duplicata no mesmo lote
  -- continua resolvida pela posição (a primeira ocorrência vence, a segunda é pulada).
  for it in
    select r.source_contract_id, r.class_id, r.monthly_amount, r.start_date, r.end_date, r.tuitions
      from jsonb_array_elements(p_items) with ordinality as e(elem, ord)
      cross join lateral jsonb_to_record(e.elem) as r(
             source_contract_id uuid, class_id uuid, monthly_amount numeric,
             start_date date, end_date date, tuitions jsonb)
     order by r.source_contract_id, e.ord
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
    if it.monthly_amount > c_max_monthly then
      raise exception 'INVALID_ITEM' using errcode = '22023',
        detail = format('Contrato %s: valor mensal acima do limite de R$ 30.000,00.', src.id);
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
    if jsonb_array_length(it.tuitions) > c_max_tuitions then
      raise exception 'INVALID_ITEM' using errcode = '22023',
        detail = format('Contrato %s: no máximo %s mensalidades por contrato.', src.id, c_max_tuitions);
    end if;

    -- Bloco C2: o sucessor não pode se sobrepor a outro contrato ATIVO do mesmo aluno (a origem fica de fora: ela termina antes).
    if public.contract_overlaps(p_school_id, src.student_id, it.start_date, it.end_date, src.id) then
      raise exception 'INVALID_ITEM' using errcode = '22023',
        detail = format('Contrato %s: o aluno já tem outro contrato ativo que se sobrepõe ao novo período.', src.id);
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
      -- H2: 'overdue' com vencimento futuro não faz sentido. Folga de um dia: o servidor roda em UTC e o
      -- cliente decide pelo relógio dele, então 'hoje' (UTC) ainda passa; amanhã não. Vencidas no passado e
      -- 'pending' no passado continuam aceitas (renovar contrato ativo já vencido preserva as vencidas).
      if t.status = 'overdue' and t.due_date > current_date then
        raise exception 'INVALID_ITEM' using errcode = '22023',
          detail = format('Contrato %s: mensalidade marcada como vencida com vencimento no futuro.', src.id);
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
