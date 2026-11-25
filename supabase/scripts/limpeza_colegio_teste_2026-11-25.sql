-- supabase/scripts/limpeza_colegio_teste_2026-11-25.sql
-- Limpeza de dados de teste da COLEGIO TESTE, apontados pelo ensaio geral (docs/ENSAIO_GERAL_2026-11-25.md, bloco E do S6b).
-- NÃO é migration. SOMENTE a Colegio Teste: o script aborta se a escola não existir com esse nome ou se qualquer
-- contagem esperada não bater (nada é aplicado pela metade). Não toca a Estrela nem o Pensar.
--
-- DRY-RUN (padrão): termina em ROLLBACK e imprime antes/depois.
--   npx supabase@2.117.0 db query --linked -f supabase/scripts/limpeza_colegio_teste_2026-11-25.sql
-- EXECUÇÃO REAL: só com autorização explícita; troque o "rollback;" do final por "commit;".
--
-- Critérios (explicados em docs/ENSAIO_GERAL_2026-11-25.md):
--  1. Pares duplicados (mesmo contrato + vencimento, ambos não cancelados): fica a parcela da RENEGOCIAÇÃO
--     (renegotiation_id preenchido: é o acordo vigente); a original (sem renegociação) sai. Por padrão ela é CANCELADA
--     (é o que a RPC renegotiate_tuitions faz: some de todos os cálculos e o histórico fica). Para exclusão física,
--     troque v_modo_duplicatas por 'excluir' (a auditoria guarda o old_data).
--  2. Mensalidade cancelada com paid_date: o paid_date é limpo.
--  3. Contrato cancelado ou encerrado não deixa mensalidade aberta (pending/overdue): elas são canceladas.
--  4. Contratos ativos com fim vencido são encerrados (status 'cancelled': é o único estado terminal que a tela conhece).
--     Isso também resolve o aluno com 2 contratos ativos (origem encerrada + sucessor ativo).
--  5. Fixtures: turma "Teste Capacidade" e o professor de teste (sem nenhuma dependência), excluídos.

begin;

create temp table t_cnt (n serial, fase text, k text, v text);
create temp table t_exp (n serial, k text, v text);

do $$
declare
  v_modo_duplicatas constant text := 'cancelar';   -- 'cancelar' | 'excluir'
  s uuid; n int; fase text;
  v_turma uuid; v_prof uuid;
begin
  select id into s from public.schools where name = 'Colegio Teste';
  if s is null then raise exception 'escola Colegio Teste nao encontrada: abortando'; end if;

  -- ---------- contagens ANTES
  fase := '1 antes';
  insert into t_cnt (fase, k, v)
  select fase, k, v from (
    select 'contratos ' || status k, count(*)::text v from public.contracts where school_id = s group by status
    union all select 'mensalidades ' || status, count(*)::text from public.tuitions where school_id = s group by status
    union all select 'turmas', count(*)::text from public.classes where school_id = s
    union all select 'professores', count(*)::text from public.teachers where school_id = s
    union all select 'salários ativos', coalesce(sum(salary), 0)::text from public.teachers where school_id = s and status = 'active'
    union all select 'ANOMALIA pares duplicados (contrato+vencimento)', count(*)::text from (
        select 1 from public.tuitions where school_id = s and status <> 'cancelled' group by contract_id, due_date having count(*) > 1) d
    union all select 'ANOMALIA mensalidade cancelada com paid_date', count(*)::text from public.tuitions where school_id = s and status = 'cancelled' and paid_date is not null
    union all select 'ANOMALIA contrato cancelado com mensalidade aberta', count(distinct c.id)::text from public.contracts c join public.tuitions t on t.contract_id = c.id
        where c.school_id = s and c.status = 'cancelled' and t.status in ('pending', 'overdue')
    union all select 'ANOMALIA contrato ativo com fim vencido', count(*)::text from public.contracts where school_id = s and status = 'active' and end_date < current_date
    union all select 'ANOMALIA aluno com 2+ contratos ativos', count(*)::text from (
        select 1 from public.contracts where school_id = s and status = 'active' group by student_id having count(*) > 1) d
  ) z;

  -- ---------- 1. duplicatas: a original (sem renegociação) sai; fica a parcela da renegociação
  create temp table t_dup on commit drop as
    select o.id from public.tuitions o join public.tuitions p
      on p.contract_id = o.contract_id and p.due_date = o.due_date and p.id <> o.id and p.school_id = s
     where o.school_id = s and o.renegotiation_id is null and p.renegotiation_id is not null
       and o.status <> 'cancelled' and p.status <> 'cancelled';
  select count(*) into n from t_dup;
  if n <> 5 then raise exception 'esperava 5 duplicatas a remover, achei %', n; end if;
  if v_modo_duplicatas = 'excluir' then
    delete from public.tuitions where id in (select id from t_dup);
  else
    update public.tuitions set status = 'cancelled' where id in (select id from t_dup);
  end if;
  insert into t_exp (k, v) values ('duplicatas tratadas (' || v_modo_duplicatas || ')', n::text);

  -- ---------- 2. cancelada com paid_date
  update public.tuitions set paid_date = null where school_id = s and status = 'cancelled' and paid_date is not null;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'esperava 1 mensalidade cancelada com paid_date, tratei %', n; end if;
  insert into t_exp (k, v) values ('paid_date limpo em cancelada', n::text);

  -- ---------- 4. encerrar contratos ativos com fim vencido (antes do 3, que vale para todos os cancelados)
  update public.contracts set status = 'cancelled' where school_id = s and status = 'active' and end_date < current_date;
  get diagnostics n = row_count;
  if n <> 3 then raise exception 'esperava encerrar 3 contratos, encerrei %', n; end if;
  insert into t_exp (k, v) values ('contratos encerrados (fim vencido)', n::text);

  -- ---------- 3. contrato cancelado/encerrado não deixa mensalidade aberta
  update public.tuitions t set status = 'cancelled'
    from public.contracts c where c.id = t.contract_id and c.school_id = s and t.school_id = s
     and c.status = 'cancelled' and t.status in ('pending', 'overdue');
  get diagnostics n = row_count;
  if n <> 11 then raise exception 'esperava cancelar 11 mensalidades abertas (8 + 3), cancelei %', n; end if;
  insert into t_exp (k, v) values ('mensalidades abertas de contratos cancelados, canceladas', n::text);

  -- ---------- 5. fixtures
  select id into v_turma from public.classes where school_id = s and name = 'Teste Capacidade';
  if v_turma is null then raise exception 'turma fixture nao encontrada'; end if;
  if exists (select 1 from public.contracts where class_id = v_turma) or exists (select 1 from public.enrollments where class_id = v_turma)
     or exists (select 1 from public.class_teachers where class_id = v_turma) or exists (select 1 from public.expenses where class_id = v_turma)
     or exists (select 1 from public.recurring_expenses where class_id = v_turma) then
    raise exception 'turma fixture tem dependencias: abortando';
  end if;
  delete from public.classes where id = v_turma;

  select count(*) into n from public.teachers where school_id = s and full_name ~* '(teste|test|qa |fixture|seed)';
  if n <> 1 then raise exception 'esperava 1 professor de teste, achei %', n; end if;
  select id into v_prof from public.teachers where school_id = s and full_name ~* '(teste|test|qa |fixture|seed)';
  if exists (select 1 from public.class_teachers where teacher_id = v_prof) then raise exception 'professor fixture tem vinculos: abortando'; end if;
  delete from public.teachers where id = v_prof;
  insert into t_exp (k, v) values ('fixtures removidas (turma + professor)', '2');

  -- ---------- contagens DEPOIS
  fase := '2 depois';
  insert into t_cnt (fase, k, v)
  select fase, k, v from (
    select 'contratos ' || status k, count(*)::text v from public.contracts where school_id = s group by status
    union all select 'mensalidades ' || status, count(*)::text from public.tuitions where school_id = s group by status
    union all select 'turmas', count(*)::text from public.classes where school_id = s
    union all select 'professores', count(*)::text from public.teachers where school_id = s
    union all select 'salários ativos', coalesce(sum(salary), 0)::text from public.teachers where school_id = s and status = 'active'
    union all select 'ANOMALIA pares duplicados (contrato+vencimento)', count(*)::text from (
        select 1 from public.tuitions where school_id = s and status <> 'cancelled' group by contract_id, due_date having count(*) > 1) d
    union all select 'ANOMALIA mensalidade cancelada com paid_date', count(*)::text from public.tuitions where school_id = s and status = 'cancelled' and paid_date is not null
    union all select 'ANOMALIA contrato cancelado com mensalidade aberta', count(distinct c.id)::text from public.contracts c join public.tuitions t on t.contract_id = c.id
        where c.school_id = s and c.status = 'cancelled' and t.status in ('pending', 'overdue')
    union all select 'ANOMALIA contrato ativo com fim vencido', count(*)::text from public.contracts where school_id = s and status = 'active' and end_date < current_date
    union all select 'ANOMALIA aluno com 2+ contratos ativos', count(*)::text from (
        select 1 from public.contracts where school_id = s and status = 'active' group by student_id having count(*) > 1) d
  ) z;

  -- Salvaguarda: nenhuma outra escola mudou nesta transação (contagens simples; a Estrela e o Pensar não são tocados)
  if exists (select 1 from public.audit_logs a where a.created_at >= now() and a.school_id <> s) then
    raise exception 'a transacao tocou outra escola: abortando';
  end if;
end $$;

-- Uma única consulta (o CLI devolve só o último resultado): 1 = antes x depois; 2 = o que foi tratado;
-- 3 = linhas financeiras da escola DEPOIS da limpeza, para reconciliar o dashboard (dash.ts do ensaio)
select 1 as sec, a.k, a.v as antes, d.v as depois
  from t_cnt a left join t_cnt d on d.k = a.k and d.fase = '2 depois' where a.fase = '1 antes'
union all
select 2, k, v, null from t_exp
union all
select 3, 'export_pos_limpeza', jsonb_build_object(
  'tuitions', (select coalesce(jsonb_agg(jsonb_build_object('amount', t.amount, 'final_amount', t.final_amount, 'status', t.status, 'due_date', t.due_date, 'paid_date', t.paid_date)), '[]') from public.tuitions t join public.schools sc on sc.id = t.school_id where sc.name = 'Colegio Teste'),
  'expenses', (select coalesce(jsonb_agg(jsonb_build_object('amount', e.amount, 'status', e.status, 'due_date', e.due_date, 'paid_date', e.paid_date)), '[]') from public.expenses e join public.schools sc on sc.id = e.school_id where sc.name = 'Colegio Teste'),
  'service_charges', (select coalesce(jsonb_agg(jsonb_build_object('amount', c.amount, 'status', c.status, 'due_date', c.due_date, 'paid_date', c.paid_date)), '[]') from public.service_charges c join public.schools sc on sc.id = c.school_id where sc.name = 'Colegio Teste'),
  'salary', (select coalesce(sum(t.salary), 0) from public.teachers t join public.schools sc on sc.id = t.school_id where sc.name = 'Colegio Teste' and t.status = 'active')
)::text, null
order by 1, 2;

rollback;  -- DRY-RUN. Troque por "commit;" SOMENTE com autorização explícita.
