-- ================================================================
-- MIGRATION: fontes de receita além da mensalidade
-- Serviços extras (molde → lançamento, espelha recurring_expenses →
-- expenses) + período integral/meio período no contrato. Ver
-- docs/superpowers/specs/2026-09-13-extra-revenue-streams-design.md
-- ================================================================

-- 1. CATÁLOGO DE SERVIÇOS (livre por escola)
CREATE TABLE public.school_services (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid        NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  name       text        NOT NULL,
  price      numeric     NOT NULL CHECK (price > 0),
  active     boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, name)
);

-- 2. ASSINATURA DO ALUNO (molde)
CREATE TABLE public.student_services (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid        NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id  uuid        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  service_id  uuid        NOT NULL REFERENCES public.school_services(id) ON DELETE RESTRICT,
  price       numeric     NOT NULL CHECK (price > 0),
  due_day     integer     NOT NULL CHECK (due_day BETWEEN 1 AND 28),
  start_date  date        NOT NULL,
  end_date    date,
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date > start_date)
);

-- 3. COBRANÇA MENSAL (lançamento)
CREATE TABLE public.service_charges (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id          uuid        NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_service_id uuid        REFERENCES public.student_services(id) ON DELETE SET NULL,
  service_id         uuid        NOT NULL REFERENCES public.school_services(id) ON DELETE RESTRICT,
  student_id         uuid        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  description        text        NOT NULL,
  amount             numeric     NOT NULL CHECK (amount > 0),
  due_date           date        NOT NULL,
  paid_date          date,
  status             text        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending', 'paid', 'overdue', 'cancelled')),
  payment_method     text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.school_services (school_id);
CREATE INDEX ON public.student_services (school_id);
CREATE INDEX ON public.student_services (student_id);
CREATE INDEX ON public.service_charges (school_id);
CREATE INDEX ON public.service_charges (student_id);
CREATE INDEX ON public.service_charges (status);

ALTER TABLE public.school_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_charges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and financial can view school services"
  ON public.school_services FOR SELECT
  USING (school_id = public.get_user_school_id() AND public.get_current_user_role() IN ('admin', 'financial'));

CREATE POLICY "Admin and financial can manage school services"
  ON public.school_services FOR ALL
  USING (school_id = public.get_user_school_id() AND public.get_current_user_role() IN ('admin', 'financial'))
  WITH CHECK (school_id = public.get_user_school_id() AND public.get_current_user_role() IN ('admin', 'financial'));

CREATE POLICY "Admin and financial can view student services"
  ON public.student_services FOR SELECT
  USING (school_id = public.get_user_school_id() AND public.get_current_user_role() IN ('admin', 'financial'));

CREATE POLICY "Admin and financial can manage student services"
  ON public.student_services FOR ALL
  USING (school_id = public.get_user_school_id() AND public.get_current_user_role() IN ('admin', 'financial'))
  WITH CHECK (school_id = public.get_user_school_id() AND public.get_current_user_role() IN ('admin', 'financial'));

CREATE POLICY "Admin and financial can view service charges"
  ON public.service_charges FOR SELECT
  USING (school_id = public.get_user_school_id() AND public.get_current_user_role() IN ('admin', 'financial'));

CREATE POLICY "Admin and financial can manage service charges"
  ON public.service_charges FOR ALL
  USING (school_id = public.get_user_school_id() AND public.get_current_user_role() IN ('admin', 'financial'))
  WITH CHECK (school_id = public.get_user_school_id() AND public.get_current_user_role() IN ('admin', 'financial'));

-- 4. PERÍODO INTEGRAL/MEIO PERÍODO
ALTER TABLE public.classes ADD COLUMN monthly_fee_integral numeric;

ALTER TABLE public.contracts ADD COLUMN period text NOT NULL DEFAULT 'meio_periodo'
  CHECK (period IN ('meio_periodo', 'integral'));

-- 5. save_class_with_teachers precisa do novo parâmetro monthly_fee_integral.
--    Adicionar um parâmetro muda a assinatura da função — CREATE OR REPLACE
--    sozinho criaria uma segunda função sobrecarregada em vez de substituir
--    a antiga (e uma chamada com 9 argumentos passaria a ser ambígua entre
--    as duas). DROP explícito da assinatura antiga evita isso.
DROP FUNCTION IF EXISTS public.save_class_with_teachers(
  uuid, uuid, text, text, text, integer, numeric, text, uuid[]
);

CREATE FUNCTION public.save_class_with_teachers(
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
    SELECT v_class_id, unnest(p_teacher_ids);
  END IF;

  RETURN v_class_id;
END;
$$;
