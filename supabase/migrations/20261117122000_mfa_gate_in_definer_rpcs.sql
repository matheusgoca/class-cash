-- Fase 3 (S2): o gate de 2FA também nas RPCs SECURITY DEFINER.
--
-- Funções SECURITY DEFINER rodam como dono e IGNORAM o RLS, então sem isto elas
-- seriam uma porta lateral ao gate das policies (migration 20261117121000).
-- Cada uma ganhou UMA linha no início do corpo: perform public.assert_mfa_gate();
-- O resto é a definição que está em produção em 17/11/2026, byte a byte
-- (conferido por diff no momento da geração desta migration).
--
-- DE FORA, de propósito:
--   promote_overdue_tuitions → só o cron a chama (sem usuário, o gate passaria),
--       não devolve dados e é idempotente.
--   triggers e helpers (audit_trigger_fn, handle_new_user, ensure_owner_is_admin,
--       get_current_user_role, get_user_school_id, is_master_admin, has_role,
--       get_user_role, get_user_by_email) → rodam dentro de outras operações ou
--       são consultados pelas próprias policies; gateá-los criaria recursão.
--
-- Mesma ORDEM DE ROLLOUT da migration anterior (front no ar + master com 2FA).
-- Função grande: aplicar com `supabase db push`, nunca pelo SQL Editor do Studio
-- (o editor já corrompeu o paste de blocos $$ ... $$ grandes).

-- get_active_teachers_salary_sum (era LANGUAGE sql; vira plpgsql só para poder
-- chamar o gate. Mesma consulta, mesma assinatura, mesmo STABLE/SECURITY DEFINER.)
CREATE OR REPLACE FUNCTION public.get_active_teachers_salary_sum(p_school_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.assert_mfa_gate();
  return (
    SELECT COALESCE(SUM(salary), 0)
    FROM public.teachers
    WHERE school_id = p_school_id
      AND status = 'active'
      AND (p_school_id = public.get_user_school_id() OR public.is_master_admin())
  );
end;
$function$;

-- import_teacher
CREATE OR REPLACE FUNCTION public.import_teacher(p_teacher jsonb, p_school_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_allowed boolean;
  v_id uuid;
begin
  perform public.assert_mfa_gate();
  select
    (p_school_id = public.get_user_school_id() and public.get_current_user_role() in ('admin', 'financial'))
    or public.is_master_admin()
  into v_allowed;

  if not coalesce(v_allowed, false) then
    raise exception 'Sem permissão para importar professores nesta escola';
  end if;

  perform set_config('app.audit_source', 'import', true);

  insert into public.teachers (full_name, email, phone, salary, status, school_id)
  select r.full_name, r.email, r.phone, r.salary, r.status, p_school_id
  from jsonb_to_record(p_teacher) as r(full_name text, email text, phone text, salary numeric, status text)
  returning id into v_id;

  return v_id;
end;
$function$;

-- import_student
CREATE OR REPLACE FUNCTION public.import_student(p_student jsonb, p_school_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_allowed boolean;
  v_id uuid;
begin
  perform public.assert_mfa_gate();
  select
    (p_school_id = public.get_user_school_id() and public.get_current_user_role() in ('admin', 'financial'))
    or public.is_master_admin()
  into v_allowed;

  if not coalesce(v_allowed, false) then
    raise exception 'Sem permissão para importar alunos nesta escola';
  end if;

  perform set_config('app.audit_source', 'import', true);

  insert into public.students (full_name, birth_date, enrollment_date, email, phone, guardian_contact, status, school_id)
  select r.full_name, r.birth_date, r.enrollment_date, r.email, r.phone, r.guardian_contact, r.status, p_school_id
  from jsonb_to_record(p_student) as r(
    full_name text, birth_date date, enrollment_date date,
    email text, phone text, guardian_contact text, status text
  )
  returning id into v_id;

  return v_id;
end;
$function$;

-- import_enrollment
CREATE OR REPLACE FUNCTION public.import_enrollment(p_student_id uuid, p_class_id uuid, p_school_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_allowed boolean;
begin
  perform public.assert_mfa_gate();
  select
    (p_school_id = public.get_user_school_id() and public.get_current_user_role() in ('admin', 'financial'))
    or public.is_master_admin()
  into v_allowed;

  if not coalesce(v_allowed, false) then
    raise exception 'Sem permissão para matricular alunos nesta escola';
  end if;

  perform set_config('app.audit_source', 'import', true);

  insert into public.enrollments (student_id, class_id)
  values (p_student_id, p_class_id);
end;
$function$;

-- import_contract
CREATE OR REPLACE FUNCTION public.import_contract(p_contract jsonb, p_school_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_allowed boolean;
  v_id uuid;
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

  insert into public.contracts (student_id, class_id, monthly_amount, discount, due_day, start_date, end_date, status, school_id)
  select r.student_id, r.class_id, r.monthly_amount, r.discount, r.due_day, r.start_date, r.end_date, r.status, p_school_id
  from jsonb_to_record(p_contract) as r(
    student_id uuid, class_id uuid, monthly_amount numeric, discount numeric,
    due_day integer, start_date date, end_date date, status text
  )
  returning id into v_id;

  return v_id;
end;
$function$;

-- insert_generated_expenses
CREATE OR REPLACE FUNCTION public.insert_generated_expenses(p_school_id uuid, p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_allowed boolean;
  v_count integer;
begin
  perform public.assert_mfa_gate();
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
$function$;

-- insert_generated_tuitions
CREATE OR REPLACE FUNCTION public.insert_generated_tuitions(p_school_id uuid, p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_allowed boolean;
  v_count integer;
begin
  perform public.assert_mfa_gate();
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
$function$;

-- renegotiate_tuitions
CREATE OR REPLACE FUNCTION public.renegotiate_tuitions(p_student_id uuid, p_school_id uuid, p_tuition_ids uuid[], p_new_installment_amount numeric, p_installments integer, p_first_due_date date, p_notes text, p_created_by uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_allowed boolean;
  v_renegotiation_id uuid;
  v_original_amount numeric;
  v_contract_id uuid;
  v_distinct_contracts integer;
  v_locked_count integer;
  i integer;
BEGIN
  perform public.assert_mfa_gate();
  SELECT
    (p_school_id = public.get_user_school_id()
      AND public.get_current_user_role() IN ('admin', 'financial'))
    OR public.is_master_admin()
  INTO v_allowed;

  IF NOT COALESCE(v_allowed, false) THEN
    RAISE EXCEPTION 'Sem permissão para renegociar mensalidades desta escola';
  END IF;

  IF p_tuition_ids IS NULL OR array_length(p_tuition_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Nenhuma mensalidade selecionada';
  END IF;

  -- Trava e revalida as mensalidades — a lista do client pode estar
  -- desatualizada se um pagamento chegou enquanto o modal estava aberto.
  -- FOR UPDATE roda isolado numa subquery porque o Postgres não permite
  -- combiná-lo com count()/sum() na mesma SELECT.
  SELECT count(*), sum(COALESCE(locked.final_amount, locked.amount))
  INTO v_locked_count, v_original_amount
  FROM (
    SELECT final_amount, amount
    FROM public.tuitions
    WHERE id = ANY(p_tuition_ids)
      AND student_id = p_student_id
      AND school_id = p_school_id
      AND status IN ('pending', 'overdue')
    FOR UPDATE
  ) locked;

  IF v_locked_count IS NULL OR v_locked_count <> array_length(p_tuition_ids, 1) THEN
    RAISE EXCEPTION 'Uma ou mais mensalidades já não estão mais pendentes/atrasadas — atualize a tela e tente novamente';
  END IF;

  SELECT count(DISTINCT contract_id) INTO v_distinct_contracts
  FROM public.tuitions WHERE id = ANY(p_tuition_ids);

  IF v_distinct_contracts = 1 THEN
    SELECT contract_id INTO v_contract_id FROM public.tuitions WHERE id = p_tuition_ids[1];
  ELSE
    v_contract_id := NULL;
  END IF;

  INSERT INTO public.renegotiations (
    student_id, school_id, original_amount, new_installment_amount,
    installments, total_renegotiated, first_due_date, notes, created_by
  ) VALUES (
    p_student_id, p_school_id, v_original_amount, p_new_installment_amount,
    p_installments, p_new_installment_amount * p_installments, p_first_due_date, p_notes, p_created_by
  )
  RETURNING id INTO v_renegotiation_id;

  UPDATE public.tuitions
  SET status = 'cancelled', renegotiation_id = v_renegotiation_id
  WHERE id = ANY(p_tuition_ids);

  FOR i IN 0..(p_installments - 1) LOOP
    INSERT INTO public.tuitions (
      student_id, school_id, contract_id, amount, final_amount, due_date,
      status, description, renegotiation_id, category, discount_applied, penalty_amount
    ) VALUES (
      p_student_id, p_school_id, v_contract_id, p_new_installment_amount, p_new_installment_amount,
      (p_first_due_date + (i::text || ' months')::interval)::date,
      'pending',
      'Parcela renegociada ' || (i + 1) || '/' || p_installments,
      v_renegotiation_id, 'tuition', 0, 0
    );
  END LOOP;

  RETURN v_renegotiation_id;
END;
$function$;

-- save_class_with_teachers
CREATE OR REPLACE FUNCTION public.save_class_with_teachers(p_class_id uuid, p_school_id uuid, p_name text, p_grade text, p_description text, p_max_capacity integer, p_monthly_fee numeric, p_monthly_fee_integral numeric, p_color text, p_teacher_ids uuid[], p_teacher_hours numeric[] DEFAULT NULL::numeric[], p_source text DEFAULT 'manual'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_class_id uuid;
  v_allowed boolean;
begin
  perform public.assert_mfa_gate();
  select
    (p_school_id = public.get_user_school_id()
      and public.get_current_user_role() in ('admin', 'financial'))
    or public.is_master_admin()
  into v_allowed;

  if not coalesce(v_allowed, false) then
    raise exception 'Sem permissão para gerenciar turmas desta escola';
  end if;

  perform set_config('app.audit_source', p_source, true);

  if p_class_id is null then
    insert into public.classes (school_id, name, grade, description, max_capacity, monthly_fee, monthly_fee_integral, color)
    values (p_school_id, p_name, p_grade, p_description, p_max_capacity, p_monthly_fee, p_monthly_fee_integral, p_color)
    returning id into v_class_id;
  else
    update public.classes
    set name = p_name,
        grade = p_grade,
        description = p_description,
        max_capacity = p_max_capacity,
        monthly_fee = p_monthly_fee,
        monthly_fee_integral = p_monthly_fee_integral,
        color = p_color
    where id = p_class_id and school_id = p_school_id
    returning id into v_class_id;

    if v_class_id is null then
      raise exception 'Turma não encontrada nesta escola';
    end if;
  end if;

  delete from public.class_teachers where class_id = v_class_id;

  if p_teacher_ids is not null and array_length(p_teacher_ids, 1) > 0 then
    insert into public.class_teachers (class_id, teacher_id, weekly_hours)
    select distinct on (t.teacher_id) v_class_id, t.teacher_id, t.weekly_hours
    from unnest(p_teacher_ids, coalesce(p_teacher_hours, array[]::numeric[])) as t(teacher_id, weekly_hours)
    order by t.teacher_id;
  end if;

  return v_class_id;
end;
$function$;
