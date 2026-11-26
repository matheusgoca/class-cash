-- supabase/scripts/estrela_final_amount_pagas_2026-11-26.sql
-- Consistência de final_amount no Colégio ESTRELA: mensalidades PAGAS com final_amount nulo (1.895, achado do ensaio geral de
-- 25/11/2026) passam a ter final_amount = amount. NÃO é migration. SOMENTE a Estrela: o script aborta se a escola não existir,
-- se a contagem não for a esperada ou se alguma dessas mensalidades tiver desconto/multa aplicados (aí final <> amount).
-- Não toca a Colegio Teste nem o Pensar.
--
-- Por que é seguro: todo leitor de valor de mensalidade usa coalesce(final_amount, amount) (getTuitionValue no front;
-- coalesce nas notificações e na renegociação), então para estas linhas o valor lido NÃO muda (final = amount).
-- A trava de baixa (migration 20261126100000) barra mudar final_amount de mensalidade paga; o script usa o escape explícito
-- set_config('app.allow_paid_edit', 'on', true), válido só dentro desta transação.
--
-- DRY-RUN (padrão): termina em ROLLBACK e imprime antes/depois.
--   npx supabase@2.117.0 db query --linked -f supabase/scripts/estrela_final_amount_pagas_2026-11-26.sql
-- EXECUÇÃO REAL: só com autorização explícita; troque o "rollback;" do final por "commit;".

begin;

create temp table t_cnt (n serial, fase text, k text, v text);

do $$
declare
  s uuid; n int; fase text;
  c_esperado constant int := 1895;
begin
  select id into s from public.schools where name like 'Col%gio Estrela';
  if s is null then raise exception 'escola Estrela nao encontrada: abortando'; end if;

  fase := '1 antes';
  insert into t_cnt (fase, k, v)
  select fase, k, v from (
    select 'pagas total' k, count(*)::text v from public.tuitions where school_id = s and status = 'paid'
    union all select 'pagas com final_amount nulo', count(*)::text from public.tuitions where school_id = s and status = 'paid' and final_amount is null
    union all select 'pagas com final_amount preenchido', count(*)::text from public.tuitions where school_id = s and status = 'paid' and final_amount is not null
    union all select 'soma de final_amount (só preenchidos)', coalesce(sum(final_amount), 0)::text from public.tuitions where school_id = s and status = 'paid'
    union all select 'soma do valor lido das pagas (final ?? amount): o que o app soma', coalesce(sum(coalesce(final_amount, amount)), 0)::text from public.tuitions where school_id = s and status = 'paid'
    union all select 'nao pagas com final_amount preenchido (não mexe)', count(*)::text from public.tuitions where school_id = s and status <> 'paid' and final_amount is not null
    union all select 'mensalidades total (todas as escolas fora da Estrela não entram)', count(*)::text from public.tuitions where school_id = s
  ) z;

  select count(*) into n from public.tuitions where school_id = s and status = 'paid' and final_amount is null;
  if n <> c_esperado then raise exception 'esperava % pagas sem final_amount, achei %: abortando', c_esperado, n; end if;
  if exists (select 1 from public.tuitions where school_id = s and status = 'paid' and final_amount is null
              and (coalesce(discount_applied, 0) <> 0 or coalesce(penalty_amount, 0) <> 0)) then
    raise exception 'ha pagas sem final_amount com desconto ou multa aplicados (final <> amount): abortando';
  end if;

  perform set_config('app.allow_paid_edit', 'on', true);
  update public.tuitions set final_amount = amount where school_id = s and status = 'paid' and final_amount is null;
  get diagnostics n = row_count;
  perform set_config('app.allow_paid_edit', '', true);
  if n <> c_esperado then raise exception 'esperava corrigir %, corrigi %: abortando', c_esperado, n; end if;

  fase := '2 depois';
  insert into t_cnt (fase, k, v)
  select fase, k, v from (
    select 'pagas total' k, count(*)::text v from public.tuitions where school_id = s and status = 'paid'
    union all select 'pagas com final_amount nulo', count(*)::text from public.tuitions where school_id = s and status = 'paid' and final_amount is null
    union all select 'pagas com final_amount preenchido', count(*)::text from public.tuitions where school_id = s and status = 'paid' and final_amount is not null
    union all select 'soma de final_amount (só preenchidos)', coalesce(sum(final_amount), 0)::text from public.tuitions where school_id = s and status = 'paid'
    union all select 'soma do valor lido das pagas (final ?? amount): o que o app soma', coalesce(sum(coalesce(final_amount, amount)), 0)::text from public.tuitions where school_id = s and status = 'paid'
    union all select 'nao pagas com final_amount preenchido (não mexe)', count(*)::text from public.tuitions where school_id = s and status <> 'paid' and final_amount is not null
    union all select 'mensalidades total (todas as escolas fora da Estrela não entram)', count(*)::text from public.tuitions where school_id = s
  ) z;

  -- Salvaguarda: só a Estrela foi tocada nesta transação
  if exists (select 1 from public.audit_logs a where a.created_at >= now() and a.school_id <> s) then
    raise exception 'a transacao tocou outra escola: abortando';
  end if;
  insert into t_cnt (fase, k, v)
    select '3 auditoria', 'eventos de auditoria desta transação (esperado ' || c_esperado || ' updates em tuitions da Estrela)',
           count(*)::text from public.audit_logs a where a.created_at >= now() and a.school_id = s and a.table_name = 'tuitions' and a.action = 'update';
end $$;

-- Uma única consulta: 1 = antes x depois; 3 = linhas financeiras da Estrela DEPOIS, para reconciliar o dashboard (dash.ts do ensaio)
select 1 as sec, a.k, a.v as antes, d.v as depois
  from t_cnt a left join t_cnt d on d.k = a.k and d.fase = '2 depois' where a.fase = '1 antes'
union all
select 2, k, v, null from t_cnt where fase = '3 auditoria'
union all
select 3, 'export_pos', jsonb_build_object(
  'tuitions', (select coalesce(jsonb_agg(jsonb_build_object('amount', t.amount, 'final_amount', t.final_amount, 'status', t.status, 'due_date', t.due_date, 'paid_date', t.paid_date, 'payment_method', t.payment_method)), '[]') from public.tuitions t join public.schools sc on sc.id = t.school_id where sc.name like 'Col%gio Estrela'),
  'expenses', (select coalesce(jsonb_agg(jsonb_build_object('amount', e.amount, 'status', e.status, 'due_date', e.due_date, 'paid_date', e.paid_date)), '[]') from public.expenses e join public.schools sc on sc.id = e.school_id where sc.name like 'Col%gio Estrela'),
  'service_charges', (select coalesce(jsonb_agg(jsonb_build_object('amount', c.amount, 'status', c.status, 'due_date', c.due_date, 'paid_date', c.paid_date)), '[]') from public.service_charges c join public.schools sc on sc.id = c.school_id where sc.name like 'Col%gio Estrela'),
  'salary', (select coalesce(sum(t.salary), 0) from public.teachers t join public.schools sc on sc.id = t.school_id where sc.name like 'Col%gio Estrela' and t.status = 'active')
)::text, null
order by 1, 2;

rollback;  -- DRY-RUN. Troque por "commit;" SOMENTE com autorização explícita.
