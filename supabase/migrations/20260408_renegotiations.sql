-- ================================================================
-- MIGRATION: renegotiations
-- Sprint 7 — Renegociação de mensalidades
-- ================================================================

-- 1. Tabela principal
CREATE TABLE public.renegotiations (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id              uuid        NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  school_id               uuid        NOT NULL REFERENCES public.schools(id)  ON DELETE RESTRICT,
  original_amount         numeric     NOT NULL CHECK (original_amount > 0),
  new_installment_amount  numeric     NOT NULL CHECK (new_installment_amount > 0),
  installments            integer     NOT NULL CHECK (installments >= 1),
  total_renegotiated      numeric     NOT NULL CHECK (total_renegotiated > 0),
  first_due_date          date        NOT NULL,
  notes                   text,
  created_by              uuid        REFERENCES auth.users(id),
  created_at              timestamptz NOT NULL DEFAULT now()
);

-- 2. Rastrear qual renegociação cancelou / gerou cada tuition
--    (nullable: tuitions existentes não têm renegociação)
ALTER TABLE public.tuitions
  ADD COLUMN IF NOT EXISTS renegotiation_id uuid
    REFERENCES public.renegotiations(id) ON DELETE SET NULL;

-- 3. RLS
ALTER TABLE public.renegotiations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "School members can view own renegotiations"
  ON public.renegotiations FOR SELECT
  USING (school_id = public.get_user_school_id());

CREATE POLICY "School members can insert renegotiations"
  ON public.renegotiations FOR INSERT
  WITH CHECK (school_id = public.get_user_school_id());

-- Renegociações não são editadas nem deletadas (audit trail imutável)

-- 4. Índices
CREATE INDEX ON public.renegotiations (school_id);
CREATE INDEX ON public.renegotiations (student_id);
CREATE INDEX ON public.tuitions (renegotiation_id) WHERE renegotiation_id IS NOT NULL;
