-- RPCs que fazem o insert em lote de mensalidades/despesas geradas
-- (generateTuitions.ts / generateExpenses.ts) marcando source='generated'
-- no audit_logs. set_config(..., true) é local à transação desta própria
-- chamada RPC — nunca vaza para outra conexão do pool (PgBouncer).
--
-- A checagem de permissão replica a mesma regra das policies de INSERT em
-- tuitions/expenses (admin/financial da própria escola, ou master admin) —
-- necessário porque SECURITY DEFINER bypassa RLS, então sem essa checagem
-- qualquer usuário autenticado poderia inserir em qualquer escola.

create or replace function public.insert_generated_tuitions(p_school_id uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed boolean;
  v_count integer;
begin
  select
    (p_school_id = public.get_user_school_id() and public.get_current_user_role() in ('admin', 'financial'))
    or public.is_master_admin()
  into v_allowed;

  if not coalesce(v_allowed, false) then
    raise exception 'Sem permissão para gerar mensalidades nesta escola';
  end if;

  perform set_config('app.audit_source', 'generated', true);

  insert into public.tuitions (contract_id, student_id, school_id, amount, final_amount, due_date, status, description)
  select r.contract_id, r.student_id, r.school_id, r.amount, r.final_amount, r.due_date, r.status, r.description
  from jsonb_to_recordset(p_rows) as r(
    contract_id uuid, student_id uuid, school_id uuid,
    amount numeric, final_amount numeric, due_date date, status text, description text
  )
  where r.school_id = p_school_id; -- defensivo: ignora qualquer linha fora da escola autorizada

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.insert_generated_tuitions(uuid, jsonb) is
  'Insert em lote de tuitions geradas mensalmente (ver src/lib/generateTuitions.ts). Marca audit_logs.source=generated.';

create or replace function public.insert_generated_expenses(p_school_id uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed boolean;
  v_count integer;
begin
  select
    (p_school_id = public.get_user_school_id() and public.get_current_user_role() in ('admin', 'financial'))
    or public.is_master_admin()
  into v_allowed;

  if not coalesce(v_allowed, false) then
    raise exception 'Sem permissão para gerar despesas nesta escola';
  end if;

  perform set_config('app.audit_source', 'generated', true);

  insert into public.expenses (recurring_expense_id, school_id, category_id, class_id, amount, due_date, status, description)
  select r.recurring_expense_id, r.school_id, r.category_id, r.class_id, r.amount, r.due_date, r.status, r.description
  from jsonb_to_recordset(p_rows) as r(
    recurring_expense_id uuid, school_id uuid, category_id uuid, class_id uuid,
    amount numeric, due_date date, status text, description text
  )
  where r.school_id = p_school_id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.insert_generated_expenses(uuid, jsonb) is
  'Insert em lote de expenses geradas mensalmente (ver src/lib/generateExpenses.ts). Marca audit_logs.source=generated.';
