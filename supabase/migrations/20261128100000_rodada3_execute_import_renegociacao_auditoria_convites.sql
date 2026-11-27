-- Rodada 3 de endurecimento: permissões de EXECUTE, validação de escola em RPCs, created_by da renegociação,
-- auditoria de profiles e políticas de invitations.
-- Reversão: docs/db/reversao_rodada3.sql

-- A. EXECUTE ----------------------------------------------------------------------------------------------------
do $$
declare
  r record;
begin
  -- usadas pelo app (authenticated) e pelas Edge Functions (service_role)
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.prosecdef
       and p.proname in ('get_active_teachers_salary_sum', 'import_contract', 'import_enrollment', 'import_student',
                         'import_teacher', 'insert_generated_expenses', 'insert_generated_tuitions',
                         'renegotiate_tuitions', 'save_class_with_teachers')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;

  -- só service_role (o cron roda como postgres)
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.prosecdef
       and p.proname in ('get_user_by_email', 'get_user_role', 'has_role', 'promote_overdue_tuitions')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

-- B. import_enrollment ---------------------------------------------------------------------------------------------
create or replace function public.import_enrollment(p_student_id uuid, p_class_id uuid, p_school_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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

  if not exists (select 1 from public.students s where s.id = p_student_id and s.school_id = p_school_id) then
    raise exception 'Aluno não encontrado nesta escola' using errcode = '22023';
  end if;
  if not exists (select 1 from public.classes c where c.id = p_class_id and c.school_id = p_school_id) then
    raise exception 'Turma não encontrada nesta escola' using errcode = '22023';
  end if;

  perform set_config('app.audit_source', 'import', true);

  insert into public.enrollments (student_id, class_id)
  values (p_student_id, p_class_id);
end;
$function$;

-- C. renegotiate_tuitions -------------------------------------------------------------------------------------------
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

  -- created_by é sempre o usuário autenticado; o parâmetro p_created_by é mantido só por compatibilidade e ignorado.
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

    p_installments, p_new_installment_amount * p_installments, p_first_due_date, p_notes, auth.uid()

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

-- D. Auditoria de profiles ---------------------------------------------------------------------------------------------
create or replace function public.profiles_audit_fn()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_changed text[];
  v_school uuid;
  v_home uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old := jsonb_build_object('user_id', old.user_id, 'school_id', old.school_id, 'is_master_admin', old.is_master_admin);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new := jsonb_build_object('user_id', new.user_id, 'school_id', new.school_id, 'is_master_admin', new.is_master_admin);
  end if;

  if tg_op = 'UPDATE' then
    select array_agg(k.key order by k.key) into v_changed
      from jsonb_each(v_new) as k
     where k.key in ('school_id', 'is_master_admin') and k.value is distinct from (v_old -> k.key);
    if v_changed is null then
      return null; -- só nome/e-mail etc.: sem registro
    end if;
  end if;

  v_school := case when tg_op = 'DELETE' then old.school_id else new.school_id end;
  v_home := public.get_user_school_id();

  insert into public.audit_logs (
    school_id, actor_user_id, actor_role, is_master_action,
    table_name, record_id, action, changed_fields, old_data, new_data, source
  ) values (
    v_school, auth.uid(), public.get_current_user_role(),
    coalesce(public.is_master_admin(), false) and (v_home is distinct from v_school),
    'profiles', case when tg_op = 'DELETE' then old.id else new.id end, lower(tg_op), v_changed, v_old, v_new,
    coalesce(nullif(current_setting('app.audit_source', true), ''), 'manual')
  );
  return null;
end $$;
revoke all on function public.profiles_audit_fn() from public, anon, authenticated, service_role;

drop trigger if exists profiles_audit on public.profiles;
create trigger profiles_audit
  after insert or update or delete on public.profiles
  for each row execute function public.profiles_audit_fn();

-- E. invitations ---------------------------------------------------------------------------------------------------
drop policy if exists "invitations_insert" on public.invitations;
create policy "invitations_insert" on public.invitations
  as permissive for insert to public
  with check (
    (school_id = public.get_user_school_id() and public.get_current_user_role() = 'admin')
    or public.is_master_admin()
  );

drop policy if exists "invitations_update" on public.invitations;
create policy "invitations_update" on public.invitations
  as permissive for update to public
  using (
    (school_id = public.get_user_school_id() and public.get_current_user_role() = 'admin')
    or public.is_master_admin()
  );

drop policy if exists "invitations_delete" on public.invitations;
create policy "invitations_delete" on public.invitations
  as permissive for delete to public
  using (
    (school_id = public.get_user_school_id() and public.get_current_user_role() = 'admin')
    or public.is_master_admin()
  );
