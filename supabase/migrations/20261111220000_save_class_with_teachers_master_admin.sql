-- Mesmo gap do debug_reports (ver migration 20261111210000): a checagem de
-- permissão só aceitava p_school_id == get_user_school_id(), que é sempre a
-- escola "de casa" do perfil — nunca a escola que o master admin está
-- visualizando no momento. Bloqueava importação/criação de turma em
-- qualquer escola que não fosse a do próprio perfil do master admin.
-- Usa o helper public.is_master_admin() já existente (ver
-- get_active_teachers_salary_sum), em vez de inline EXISTS.

CREATE OR REPLACE FUNCTION public.save_class_with_teachers(p_class_id uuid, p_school_id uuid, p_name text, p_grade text, p_description text, p_max_capacity integer, p_monthly_fee numeric, p_monthly_fee_integral numeric, p_color text, p_teacher_ids uuid[], p_teacher_hours numeric[] DEFAULT NULL::numeric[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_class_id uuid;
  v_allowed boolean;
BEGIN
  SELECT
    (p_school_id = public.get_user_school_id()
      AND public.get_current_user_role() IN ('admin', 'financial'))
    OR public.is_master_admin()
  INTO v_allowed;

  IF NOT COALESCE(v_allowed, false) THEN
    RAISE EXCEPTION 'Sem permissão para gerenciar turmas desta escola';
  END IF;

  IF p_class_id IS NULL THEN
    INSERT INTO public.classes (school_id, name, grade, description, max_capacity, monthly_fee, monthly_fee_integral, color)
    VALUES (p_school_id, p_name, p_grade, p_description, p_max_capacity, p_monthly_fee, p_monthly_fee_integral, p_color)
    RETURNING id INTO v_class_id;
  ELSE
    UPDATE public.classes
    SET name = p_name,
        grade = p_grade,
        description = p_description,
        max_capacity = p_max_capacity,
        monthly_fee = p_monthly_fee,
        monthly_fee_integral = p_monthly_fee_integral,
        color = p_color
    WHERE id = p_class_id AND school_id = p_school_id
    RETURNING id INTO v_class_id;

    IF v_class_id IS NULL THEN
      RAISE EXCEPTION 'Turma não encontrada nesta escola';
    END IF;
  END IF;

  DELETE FROM public.class_teachers WHERE class_id = v_class_id;

  -- unnest de duas arrays em paralelo: linhas sem par em p_teacher_hours
  -- (array mais curto, ou NULL) ficam com weekly_hours NULL.
  IF p_teacher_ids IS NOT NULL AND array_length(p_teacher_ids, 1) > 0 THEN
    INSERT INTO public.class_teachers (class_id, teacher_id, weekly_hours)
    SELECT DISTINCT ON (t.teacher_id) v_class_id, t.teacher_id, t.weekly_hours
    FROM unnest(p_teacher_ids, COALESCE(p_teacher_hours, ARRAY[]::numeric[])) AS t(teacher_id, weekly_hours)
    ORDER BY t.teacher_id;
  END IF;

  RETURN v_class_id;
END;
$function$;
