-- RPCs usadas pela importação de planilha (src/lib/import/execute.ts),
-- marcando source='import' no audit_logs. Uma RPC por linha (não em lote):
-- a importação já insere linha a linha de propósito — um erro de constraint
-- numa linha não derruba as outras (ver comentário no topo de execute.ts).
-- Cada chamada RPC é sua própria transação, então set_config(..., true)
-- aqui dentro nunca vaza para a chamada da próxima linha.
--
-- Nomes de coluna usados abaixo vêm dos tipos ValidatedTeacherRow/
-- ValidatedStudentRow/ValidatedContractRow (src/lib/import/types.ts), que já
-- são os mesmos nomes usados pelos INSERT diretos de hoje em produção — não
-- os do histórico de migrations, que tem drift conhecido (ver CLAUDE.md).

create or replace function public.import_teacher(p_teacher jsonb, p_school_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed boolean;
  v_id uuid;
begin
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
$$;

create or replace function public.import_student(p_student jsonb, p_school_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed boolean;
  v_id uuid;
begin
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
$$;

-- Separada de import_student de propósito: se o vínculo à turma falhar, o
-- aluno criado continua existindo (mesmo comportamento do insert direto
-- de hoje em execute.ts) — juntar os dois na mesma function reverteria o
-- aluno também, mudando esse comportamento.
create or replace function public.import_enrollment(p_student_id uuid, p_class_id uuid, p_school_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed boolean;
begin
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
$$;

create or replace function public.import_contract(p_contract jsonb, p_school_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed boolean;
  v_id uuid;
begin
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
$$;
