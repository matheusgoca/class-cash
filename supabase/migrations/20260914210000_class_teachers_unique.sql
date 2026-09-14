-- ================================================================
-- Trava contra duplicidade turma-professor: nada impedia o mesmo par
-- (class_id, teacher_id) aparecer duas vezes em class_teachers, o que
-- desalocaria o rateio de salário em classCost.ts (o professor pareceria
-- lecionar em mais turmas do que de fato leciona). Sem duplicatas
-- existentes hoje (confirmado antes de aplicar).
-- ================================================================

ALTER TABLE public.class_teachers
  ADD CONSTRAINT class_teachers_class_id_teacher_id_key UNIQUE (class_id, teacher_id);

-- save_class_with_teachers já limpa os vínculos da turma antes de reinserir,
-- então a única forma de duplicata agora é o próprio array p_teacher_ids
-- vindo com o mesmo professor duas vezes — SELECT DISTINCT evita que isso
-- vire um erro de constraint em vez de simplesmente ser ignorado.
CREATE OR REPLACE FUNCTION public.save_class_with_teachers(
  p_class_id uuid,
  p_school_id uuid,
  p_name text,
  p_grade text,
  p_description text,
  p_max_capacity integer,
  p_monthly_fee numeric,
  p_monthly_fee_integral numeric,
  p_color text,
  p_teacher_ids uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_class_id uuid;
  v_allowed boolean;
BEGIN
  SELECT
    p_school_id = public.get_user_school_id()
    AND public.get_current_user_role() IN ('admin', 'financial')
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

  IF p_teacher_ids IS NOT NULL AND array_length(p_teacher_ids, 1) > 0 THEN
    INSERT INTO public.class_teachers (class_id, teacher_id)
    SELECT DISTINCT v_class_id, unnest(p_teacher_ids);
  END IF;

  RETURN v_class_id;
END;
$$;
