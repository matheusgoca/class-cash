-- ================================================================
-- MIGRATION: owner role backfill + atomic class+teachers save
-- Fixes QA item #9 ("turma criada sem professor") and its root cause
-- ================================================================

-- 1. Backfill: every school owner should have an explicit 'admin' row in
--    user_roles. handle_new_user() has always inserted a default 'teacher'
--    role for every new signup — including the owner during their own
--    onboarding — and nothing in the app ever promoted them afterwards.
--    The frontend has always treated the owner as admin (by comparing
--    schools.owner_user_id to the logged-in user), but the database's
--    get_current_user_role() has no concept of ownership at all — it only
--    reads user_roles. So an owner whose only user_roles row says 'teacher'
--    could get silently denied by any RLS policy gated on role = 'admin',
--    even though every screen in the app lets them act as one.
INSERT INTO public.user_roles (user_id, role)
SELECT owner_user_id, 'admin'::app_role
FROM public.schools
WHERE owner_user_id IS NOT NULL
ON CONFLICT (user_id, role) DO NOTHING;

-- 2. Keep it that way going forward: promote to admin automatically whenever
--    a school is created, covering owners created after this migration too.
CREATE OR REPLACE FUNCTION public.ensure_owner_is_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.owner_user_id, 'admin'::app_role)
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ensure_owner_is_admin_trigger ON public.schools;
CREATE TRIGGER ensure_owner_is_admin_trigger
AFTER INSERT ON public.schools
FOR EACH ROW
EXECUTE FUNCTION public.ensure_owner_is_admin();

-- 3. Atomic class + teacher-links save. Creating/editing a class used to be
--    two separate writes from the client (insert/update `classes`, then a
--    delete+insert on `class_teachers`) — if the second failed for any
--    reason, the first had already committed, leaving a class with no
--    teacher and a generic error toast implying nothing was saved at all.
--    SECURITY DEFINER makes both writes happen inside one function call
--    (one transaction: any exception rolls back everything), while still
--    checking the caller's permission explicitly before touching anything.
CREATE OR REPLACE FUNCTION public.save_class_with_teachers(
  p_class_id uuid,
  p_school_id uuid,
  p_name text,
  p_grade text,
  p_description text,
  p_max_capacity integer,
  p_monthly_fee numeric,
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
    INSERT INTO public.classes (school_id, name, grade, description, max_capacity, monthly_fee, color)
    VALUES (p_school_id, p_name, p_grade, p_description, p_max_capacity, p_monthly_fee, p_color)
    RETURNING id INTO v_class_id;
  ELSE
    UPDATE public.classes
    SET name = p_name,
        grade = p_grade,
        description = p_description,
        max_capacity = p_max_capacity,
        monthly_fee = p_monthly_fee,
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
    SELECT v_class_id, unnest(p_teacher_ids);
  END IF;

  RETURN v_class_id;
END;
$$;
