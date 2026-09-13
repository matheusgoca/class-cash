-- ================================================================
-- MIGRATION: expenses (despesas da escola)
-- Sprint — Despesas (água, luz, IPTU, coordenação, etc.)
-- ================================================================
-- Padrão "molde → lançamento" espelhando contracts → tuitions:
--   expense_categories  : categorias livres, criadas pela escola
--   recurring_expenses  : molde de despesa recorrente (opcional)
--   expenses            : lançamento mensal, gerado do molde ou avulso
-- ================================================================

-- 1. CATEGORIAS DE DESPESA (livres, sem nada travado)
CREATE TABLE public.expense_categories (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         uuid        NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  name              text        NOT NULL,
  color             text        NOT NULL DEFAULT '#64748b',
  is_fixed_cost     boolean     NOT NULL DEFAULT false,
  allocation_method text        NOT NULL DEFAULT 'school'
                                 CHECK (allocation_method IN ('school', 'per_class', 'per_student')),
  created_by        uuid        REFERENCES auth.users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, name)
);

COMMENT ON COLUMN public.expense_categories.allocation_method IS
  'Como a despesa é rateada nos relatórios: school = custo geral da escola (não entra no custo por turma), per_class = dividido entre as turmas selecionadas, per_student = dividido proporcionalmente por aluno matriculado';

-- 2. DESPESAS RECORRENTES (molde — opcional, só quando a despesa se repete)
CREATE TABLE public.recurring_expenses (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    uuid        NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  category_id  uuid        NOT NULL REFERENCES public.expense_categories(id) ON DELETE RESTRICT,
  class_id     uuid        REFERENCES public.classes(id) ON DELETE SET NULL,
  description  text        NOT NULL,
  amount       numeric     NOT NULL CHECK (amount > 0),
  due_day      integer     NOT NULL CHECK (due_day BETWEEN 1 AND 28),
  start_date   date        NOT NULL,
  end_date     date,
  active       boolean     NOT NULL DEFAULT true,
  created_by   uuid        REFERENCES auth.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date > start_date)
);

COMMENT ON COLUMN public.recurring_expenses.class_id IS
  'Quando preenchida, a despesa recorrente pertence a uma turma específica. Quando nula, é uma despesa geral da escola (rateada conforme expense_categories.allocation_method nos relatórios)';

-- 3. DESPESAS (lançamento — o que efetivamente aparece nas telas e relatórios)
CREATE TABLE public.expenses (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id             uuid        NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  category_id           uuid        NOT NULL REFERENCES public.expense_categories(id) ON DELETE RESTRICT,
  recurring_expense_id  uuid        REFERENCES public.recurring_expenses(id) ON DELETE SET NULL,
  class_id              uuid        REFERENCES public.classes(id) ON DELETE SET NULL,
  description           text        NOT NULL,
  amount                numeric     NOT NULL CHECK (amount > 0),
  due_date              date        NOT NULL,
  paid_date             date,
  status                text        NOT NULL DEFAULT 'pending'
                                     CHECK (status IN ('pending', 'paid', 'overdue', 'cancelled')),
  payment_method        text,
  notes                 text,
  created_by            uuid        REFERENCES auth.users(id),
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- 4. RLS
ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses            ENABLE ROW LEVEL SECURITY;

-- expense_categories: admin e financeiro veem; só admin cria/edita/apaga
-- (categorias moram na tela de Configurações, que já é admin-only, mas o
--  financeiro precisa poder LER a lista para lançar despesas em /despesas)
CREATE POLICY "School members can view expense categories"
  ON public.expense_categories FOR SELECT
  USING (
    school_id = public.get_user_school_id() AND
    public.get_current_user_role() IN ('admin', 'financial')
  );

CREATE POLICY "Admin can manage expense categories"
  ON public.expense_categories FOR ALL
  USING (
    school_id = public.get_user_school_id() AND
    public.get_current_user_role() = 'admin'
  )
  WITH CHECK (
    school_id = public.get_user_school_id() AND
    public.get_current_user_role() = 'admin'
  );

-- recurring_expenses: admin e financeiro podem ver e gerenciar
CREATE POLICY "Admin and financial can view recurring expenses"
  ON public.recurring_expenses FOR SELECT
  USING (
    school_id = public.get_user_school_id() AND
    public.get_current_user_role() IN ('admin', 'financial')
  );

CREATE POLICY "Admin and financial can manage recurring expenses"
  ON public.recurring_expenses FOR ALL
  USING (
    school_id = public.get_user_school_id() AND
    public.get_current_user_role() IN ('admin', 'financial')
  )
  WITH CHECK (
    school_id = public.get_user_school_id() AND
    public.get_current_user_role() IN ('admin', 'financial')
  );

-- expenses: admin e financeiro podem ver e gerenciar
CREATE POLICY "Admin and financial can view expenses"
  ON public.expenses FOR SELECT
  USING (
    school_id = public.get_user_school_id() AND
    public.get_current_user_role() IN ('admin', 'financial')
  );

CREATE POLICY "Admin and financial can manage expenses"
  ON public.expenses FOR ALL
  USING (
    school_id = public.get_user_school_id() AND
    public.get_current_user_role() IN ('admin', 'financial')
  )
  WITH CHECK (
    school_id = public.get_user_school_id() AND
    public.get_current_user_role() IN ('admin', 'financial')
  );

-- 5. Índices
CREATE INDEX ON public.expense_categories (school_id);
CREATE INDEX ON public.recurring_expenses (school_id);
CREATE INDEX ON public.recurring_expenses (category_id);
CREATE INDEX ON public.recurring_expenses (class_id) WHERE class_id IS NOT NULL;
CREATE INDEX ON public.expenses (school_id);
CREATE INDEX ON public.expenses (category_id);
CREATE INDEX ON public.expenses (class_id) WHERE class_id IS NOT NULL;
CREATE INDEX ON public.expenses (due_date);
CREATE INDEX ON public.expenses (recurring_expense_id) WHERE recurring_expense_id IS NOT NULL;

-- 6. Categorias padrão (ponto de partida — nada travado, a escola edita/apaga/cria livremente)
INSERT INTO public.expense_categories (school_id, name, color, is_fixed_cost, allocation_method)
SELECT s.id, c.name, c.color, c.is_fixed_cost, c.allocation_method
FROM public.schools s
CROSS JOIN (
  VALUES
    ('Água',              '#0ea5e9', true,  'school'),
    ('Luz',               '#f59e0b', true,  'school'),
    ('IPTU',              '#8b5cf6', true,  'school'),
    ('Internet/Telefone', '#06b6d4', true,  'school'),
    ('Coordenação',       '#ec4899', true,  'school'),
    ('Manutenção',        '#84cc16', false, 'school'),
    ('Material Didático', '#f97316', false, 'per_student'),
    ('Marketing',         '#6366f1', false, 'school'),
    ('Outros',            '#64748b', false, 'school')
) AS c(name, color, is_fixed_cost, allocation_method)
ON CONFLICT (school_id, name) DO NOTHING;
