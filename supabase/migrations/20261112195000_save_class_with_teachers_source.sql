-- save_class_with_teachers é usada tanto pelo form manual "Nova Turma"
-- (Classes.tsx) quanto pela importação de planilha (execute.ts) — adiciona
-- p_source com default 'manual' para não marcar turmas criadas manualmente
-- como 'import'. Só a chamada de execute.ts passa p_source := 'import'.
--
-- Assinatura muda (novo parâmetro), então precisa dropar a função antiga
-- antes: CREATE OR REPLACE não substitui uma função com lista de parâmetros
-- diferente, cria uma sobrecarga nova e deixa as duas convivendo.
drop function if exists public.save_class_with_teachers(uuid, uuid, text, text, text, integer, numeric, numeric, text, uuid[], numeric[]);

create or replace function public.save_class_with_teachers(
  p_class_id uuid,
  p_school_id uuid,
  p_name text,
  p_grade text,
  p_description text,
  p_max_capacity integer,
  p_monthly_fee numeric,
  p_monthly_fee_integral numeric,
  p_color text,
  p_teacher_ids uuid[],
  p_teacher_hours numeric[] default null::numeric[],
  p_source text default 'manual'
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_class_id uuid;
  v_allowed boolean;
begin
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
