# Fontes de receita além da mensalidade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar serviços extras opcionais (alimentação, inglês, natação, dança...) como assinatura mensal recorrente separada da mensalidade, e período integral/meio período como variação de preço no contrato — com as duas coisas entrando no Dashboard e nos Relatórios.

**Architecture:** Serviços extras seguem o padrão "molde → lançamento" já usado em despesas: `school_services` (catálogo livre por escola) → `student_services` (assinatura do aluno) → `service_charges` (cobrança mensal gerada por `generateServiceCharges.ts`, clone de `generateExpenses.ts`). Período é um campo novo em `contracts` com preço sugerido a partir de dois preços cadastrados na turma. Dashboard/Relatórios somam a nova fonte de receita nas mesmas telas que já mostram mensalidade.

**Tech Stack:** React + TypeScript + Vite, Supabase (Postgres + RLS), shadcn/ui, react-hook-form + zod.

**Spec:** `docs/superpowers/specs/2026-09-13-extra-revenue-streams-design.md`

## Global Constraints

- Sem suite de testes automatizada — cada task verifica com `npx tsc --noEmit`, `npm run build`, e checagem manual depois que a migration rodar.
- Tabelas usam `REFERENCES` (FK) e `TIMESTAMPTZ`/`DATE`, seguindo o padrão do resto do projeto (ver `20260911_expenses.sql`).
- Toda query contra tabela nova usa `(supabase as any)` até os tipos gerados serem atualizados.
- `profiles.user_id` (não `profiles.id`) casa com `auth.uid()`.
- Migrations SQL são entregues pro usuário rodar manualmente no Supabase Studio ou `supabase db push` — Claude não tem acesso de execução SQL neste projeto.
- Badges de status usam os tokens semânticos já existentes (`bg-pending`/`bg-paid`/`bg-overdue`, com `text-primary-foreground`/`text-success-foreground`/`text-danger-foreground`) — nunca cor hardcoded.
- Datas geradas client-side usam formatação local (nunca `.toISOString().split('T')[0]` para uma data já local — ver o bug corrigido em `generateTuitions.ts` nesta mesma sessão).
- Erros mostrados ao usuário sempre passam por `getFriendlyErrorMessage` (`src/lib/friendlyError.ts`).

---

### Task 1: Migration — schema completo

**Files:**
- Create: `supabase/migrations/20260913150000_extra_revenue_streams.sql`

- [ ] **Step 1: Escrever a migration**

Criar `supabase/migrations/20260913150000_extra_revenue_streams.sql`:

```sql
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
```

- [ ] **Step 2: Entregar para o usuário rodar**

Avisar o usuário para rodar `supabase/migrations/20260913150000_extra_revenue_streams.sql` no Supabase Studio (SQL Editor) ou `supabase db push` antes do QA final (Task 11). As tasks seguintes podem ser escritas e verificadas por tipo/build sem a migration ter rodado ainda.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260913150000_extra_revenue_streams.sql
git commit -m "Migration: serviços extras (molde->lançamento) + período integral/meio período"
```

---

### Task 2: generateServiceCharges.ts

**Files:**
- Create: `src/lib/generateServiceCharges.ts`

**Interfaces:**
- Consumes: `supabase` client
- Produces: `generateServiceCharges(studentServiceId: string): Promise<{ inserted: number; error?: string }>`

- [ ] **Step 1: Criar o módulo**

Clone estrutural de `generateExpenses.ts`, já sem os bugs de fuso/período corrigidos nesta sessão (data local, clamp de due_date dentro do intervalo real, idempotente via Set de due_date existentes):

```typescript
import { supabase } from '@/integrations/supabase/client';

// Formats a Date as 'YYYY-MM-DD' using its local fields — never toISOString(),
// which converts to UTC first and can shift the date by a day in timezones
// with a positive offset. Mirrors generateTuitions.ts / generateExpenses.ts.
function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface StudentService {
  id: string;
  school_id: string;
  student_id: string;
  service_id: string;
  price: number;
  due_day: number;
  start_date: string; // 'YYYY-MM-DD'
  end_date: string | null;
}

/**
 * Generates monthly service charges (lançamentos) for a student service
 * subscription (molde). Idempotent: skips months that already have a
 * charge for this student_service_id.
 *
 * When end_date is null (ongoing subscription), generates up to
 * `monthsAhead` months from today.
 *
 * @returns number of charges inserted
 */
export async function generateServiceCharges(
  studentServiceId: string,
  monthsAhead: number = 12
): Promise<{ inserted: number; error?: string }> {
  const { data: subscription, error: fetchError } = await (supabase as any)
    .from('student_services')
    .select('id, school_id, student_id, service_id, price, due_day, start_date, end_date, school_services(name)')
    .eq('id', studentServiceId)
    .single();

  if (fetchError || !subscription) {
    return { inserted: 0, error: fetchError?.message ?? 'Assinatura não encontrada' };
  }

  const { school_id, student_id, service_id, price, due_day, start_date, end_date } =
    subscription as StudentService;
  const serviceName: string = subscription.school_services?.name ?? 'Serviço';

  const { data: existing } = await (supabase as any)
    .from('service_charges')
    .select('due_date')
    .eq('student_service_id', studentServiceId);

  const existingDates = new Set<string>((existing ?? []).map((c: any) => c.due_date));

  const [sy, sm, sd] = start_date.split('-').map(Number);
  const start = new Date(sy, sm - 1, sd);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let end: Date | null = null;
  let endYear: number;
  let endMonth: number;

  if (end_date) {
    const [ey, em, ed] = end_date.split('-').map(Number);
    end = new Date(ey, em - 1, ed);
    endYear = end.getFullYear();
    endMonth = end.getMonth();
  } else {
    const horizon = new Date(today.getFullYear(), today.getMonth() + monthsAhead, 1);
    endYear = horizon.getFullYear();
    endMonth = horizon.getMonth();
  }

  const toInsert: object[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);

  while (
    cursor.getFullYear() < endYear ||
    (cursor.getFullYear() === endYear && cursor.getMonth() <= endMonth)
  ) {
    const lastDay = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const day = Math.min(due_day, lastDay);
    const dueDate = new Date(cursor.getFullYear(), cursor.getMonth(), day);

    if (dueDate >= start && (!end || dueDate <= end)) {
      const dueDateStr = toDateStr(dueDate);

      if (!existingDates.has(dueDateStr)) {
        const status = dueDate < today ? 'overdue' : 'pending';

        toInsert.push({
          student_service_id: studentServiceId,
          service_id,
          student_id,
          school_id,
          amount: price,
          due_date: dueDateStr,
          status,
          description: `${serviceName} - ${cursor.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}`,
        });
      }
    }

    cursor.setMonth(cursor.getMonth() + 1);
  }

  if (toInsert.length === 0) {
    return { inserted: 0 };
  }

  const { error: insertError } = await (supabase as any)
    .from('service_charges')
    .insert(toInsert);

  if (insertError) {
    return { inserted: 0, error: insertError.message };
  }

  return { inserted: toInsert.length };
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/lib/generateServiceCharges.ts
git commit -m "Adiciona generateServiceCharges — geração idempotente de cobrança de serviço"
```

---

### Task 3: Lib compartilhada de assinatura (subscribeStudentToService)

**Files:**
- Create: `src/lib/studentServices.ts`

**Interfaces:**
- Consumes: `generateServiceCharges` (Task 2)
- Produces: `SubscribeStudentToServiceParams { schoolId: string; studentId: string; serviceId: string; price: number; dueDay: number; startDate: string }`, `subscribeStudentToService(params: SubscribeStudentToServiceParams): Promise<{ inserted: number }>` (lança erro em caso de falha), `cancelStudentService(studentServiceId: string): Promise<void>`

- [ ] **Step 1: Criar o módulo**

Usado tanto pela tela "Serviços" quanto pela seção de serviços dentro do
cadastro do aluno — mantém a lógica de assinar/cancelar num lugar só.

```typescript
import { supabase } from '@/integrations/supabase/client';
import { generateServiceCharges } from '@/lib/generateServiceCharges';

function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface SubscribeStudentToServiceParams {
  schoolId: string;
  studentId: string;
  serviceId: string;
  price: number;
  dueDay: number;
  startDate: string; // 'YYYY-MM-DD'
}

export async function subscribeStudentToService(
  params: SubscribeStudentToServiceParams
): Promise<{ inserted: number }> {
  const { schoolId, studentId, serviceId, price, dueDay, startDate } = params;

  const { data: created, error } = await (supabase as any)
    .from('student_services')
    .insert({
      school_id: schoolId,
      student_id: studentId,
      service_id: serviceId,
      price,
      due_day: dueDay,
      start_date: startDate,
    })
    .select('id')
    .single();

  if (error) throw error;

  const { inserted, error: genError } = await generateServiceCharges(created.id);
  if (genError) throw new Error(genError);

  return { inserted };
}

export async function cancelStudentService(studentServiceId: string): Promise<void> {
  const { error } = await (supabase as any)
    .from('student_services')
    .update({ active: false, end_date: todayStr() })
    .eq('id', studentServiceId);

  if (error) throw error;
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/lib/studentServices.ts
git commit -m "Lib compartilhada: assinar/cancelar serviço de um aluno"
```

---

### Task 4: Período — ClassForm.tsx + Classes.tsx

**Files:**
- Modify: `src/components/classes/ClassForm.tsx`
- Modify: `src/pages/Classes.tsx`

**Interfaces:**
- Produces: `classData.monthly_fee_integral` no shape esperado por `ClassForm`/`Classes.tsx`

- [ ] **Step 1: Adicionar o campo no schema e nos defaults do form**

Modificar `src/components/classes/ClassForm.tsx`. No `classSchema`:

```typescript
const classSchema = z.object({
  name:                 z.string().min(2, 'Nome da turma deve ter pelo menos 2 caracteres'),
  grade:                z.string().nullable(),
  description:          z.string().optional(),
  max_capacity:         z.number().min(1).max(50),
  monthly_fee:          z.number().min(0).optional(),
  monthly_fee_integral: z.number().min(0).optional(),
  color:                z.string().min(1, 'Cor é obrigatória'),
  teacher_ids:          z.array(z.string()),
});
```

No `useForm` (bloco `defaultValues`), o campo `monthly_fee` atual é:

```typescript
      monthly_fee:  classData?.monthly_fee  ?? undefined,
```

Adicionar logo abaixo:

```typescript
      monthly_fee_integral: classData?.monthly_fee_integral ?? undefined,
```

No `useEffect` que reseta o form quando `classData` muda, o `form.reset({...})` tem a linha:

```typescript
        monthly_fee:  classData.monthly_fee  ?? undefined,
```

Adicionar logo abaixo (sem `?.`, igual ao resto desse bloco — dentro do `if (classData)` o valor já é garantido não-nulo):

```typescript
        monthly_fee_integral: classData.monthly_fee_integral ?? undefined,
```

- [ ] **Step 2: Adicionar o campo no formulário**

Logo depois do `FormField name="monthly_fee"` existente, adicionar:

```tsx
            <FormField control={form.control} name="monthly_fee_integral" render={({ field }) => (
              <FormItem>
                <FormLabel>Mensalidade integral (R$)</FormLabel>
                <FormControl>
                  <Input type="number" min="0" step="0.01" placeholder="0.00"
                    value={field.value ?? ''}
                    onChange={e => {
                      const val = e.target.value;
                      field.onChange(val === '' ? undefined : parseFloat(val));
                    }} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
```

- [ ] **Step 3: Passar o valor pro RPC em Classes.tsx**

Modificar `src/pages/Classes.tsx` — no `handleSubmit`, no objeto passado pro `.rpc('save_class_with_teachers', {...})`, adicionar a linha logo após `p_monthly_fee`:

```typescript
        p_monthly_fee: classFields.monthly_fee ?? null,
        p_monthly_fee_integral: classFields.monthly_fee_integral ?? null,
```

- [ ] **Step 4: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/components/classes/ClassForm.tsx src/pages/Classes.tsx
git commit -m "Turma ganha preço de mensalidade integral, além do preço base"
```

---

### Task 5: Período — ContractForm.tsx

**Files:**
- Modify: `src/components/contracts/ContractForm.tsx`

**Interfaces:**
- Consumes: `classes` state agora inclui `monthly_fee`/`monthly_fee_integral`
- Produces: `contractData.period: 'meio_periodo' | 'integral'` no insert/update de `contracts`

- [ ] **Step 1: Schema e estado**

No `contractSchema`, adicionar:

```typescript
const contractSchema = z.object({
  student_id:     z.string().min(1, "Aluno é obrigatório"),
  class_id:       z.string().optional(),
  period:         z.enum(["meio_periodo", "integral"]),
  start_date:     z.date({ message: "Data de início é obrigatória" }),
  end_date:       z.date({ message: "Data de término é obrigatória" }),
  monthly_amount: z.number().min(0, "Valor deve ser maior que zero"),
  discount:       z.number().min(0).max(100, "Desconto deve ser entre 0 e 100%"),
  due_day:        z.number().int().min(1).max(28),
  status:         z.enum(["active", "suspended", "cancelled"]),
});
```

`Class` interface e `defaultValues`/`reset`:

```typescript
interface Class {
  id: string;
  name: string;
  monthly_fee: number | null;
  monthly_fee_integral: number | null;
}
```

```typescript
  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
    reset,
  } = useForm<ContractFormData>({
    resolver: zodResolver(contractSchema),
    defaultValues: {
      status:  "active",
      period:  "meio_periodo",
      due_day: 10,
    },
  });
```

No `useEffect` que faz `reset(...)` quando `contract` existe, adicionar `period: contract.period || "meio_periodo",` junto dos outros campos.

- [ ] **Step 2: Buscar os dois preços da turma**

No `fetchClasses`, trocar o `select`:

```typescript
      const { data, error } = await supabase
        .from('classes')
        .select('id, name, monthly_fee, monthly_fee_integral')
        .eq('school_id', schoolId)
        .order('name');
```

- [ ] **Step 3: Auto-sugerir o valor mensal ao escolher turma + período**

Adicionar `watch("class_id")`, `watch("period")` e o efeito novo, logo depois do `useEffect` que já auto-calcula `end_date` (mesmo guard `!contract`, só se aplica em contrato novo pra não sobrescrever um valor já customizado numa edição):

```typescript
  const watchClassId = watch("class_id");
  const watchPeriod  = watch("period");

  useEffect(() => {
    if (contract || !watchClassId) return;
    const cls = classes.find((c) => c.id === watchClassId);
    if (!cls) return;
    const suggested = watchPeriod === "integral" ? cls.monthly_fee_integral : cls.monthly_fee;
    if (suggested != null) {
      setValue("monthly_amount", Number(suggested));
    }
  }, [watchClassId, watchPeriod, classes, contract, setValue]);
```

- [ ] **Step 4: Campo de período no formulário**

O JSX atual tem "Aluno" e "Turma" lado a lado no mesmo grid:

```tsx
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="student_id">Aluno *</Label>
          <Select
            onValueChange={(value) => setValue("student_id", value)}
            defaultValue={contract?.student_id}
          >
            <SelectTrigger>
              <SelectValue placeholder={loadingStudents ? "Carregando..." : "Selecione um aluno"} />
            </SelectTrigger>
            <SelectContent>
              {students.map((student) => (
                <SelectItem key={student.id} value={student.id}>
                  {student.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.student_id && (
            <p className="text-sm text-destructive">{errors.student_id.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="class_id">Turma</Label>
          <Select
            onValueChange={(value) => setValue("class_id", value === "none" ? "" : value)}
            defaultValue={contract?.class_id || "none"}
          >
            <SelectTrigger>
              <SelectValue placeholder={loadingClasses ? "Carregando..." : "Selecione uma turma"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Sem turma</SelectItem>
              {classes.map((classItem) => (
                <SelectItem key={classItem.id} value={classItem.id}>
                  {classItem.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
```

Substituir esse bloco inteiro por: "Aluno" numa linha própria (largura cheia), e "Turma" + "Período" lado a lado abaixo:

```tsx
      <div className="space-y-2">
        <Label htmlFor="student_id">Aluno *</Label>
        <Select
          onValueChange={(value) => setValue("student_id", value)}
          defaultValue={contract?.student_id}
        >
          <SelectTrigger>
            <SelectValue placeholder={loadingStudents ? "Carregando..." : "Selecione um aluno"} />
          </SelectTrigger>
          <SelectContent>
            {students.map((student) => (
              <SelectItem key={student.id} value={student.id}>
                {student.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.student_id && (
          <p className="text-sm text-destructive">{errors.student_id.message}</p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="class_id">Turma</Label>
          <Select
            onValueChange={(value) => setValue("class_id", value === "none" ? "" : value)}
            defaultValue={contract?.class_id || "none"}
          >
            <SelectTrigger>
              <SelectValue placeholder={loadingClasses ? "Carregando..." : "Selecione uma turma"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Sem turma</SelectItem>
              {classes.map((classItem) => (
                <SelectItem key={classItem.id} value={classItem.id}>
                  {classItem.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="period">Período *</Label>
          <Select
            onValueChange={(value) => setValue("period", value as "meio_periodo" | "integral")}
            defaultValue={contract?.period || "meio_periodo"}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="meio_periodo">Meio período</SelectItem>
              <SelectItem value="integral">Integral</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
```

- [ ] **Step 5: Incluir period no insert/update**

Em `onFormSubmit`, no objeto `contractData`:

```typescript
      const contractData = {
        student_id:     data.student_id,
        class_id:       data.class_id || null,
        period:         data.period,
        start_date:     data.start_date.toISOString().split('T')[0],
        end_date:       data.end_date.toISOString().split('T')[0],
        monthly_amount: data.monthly_amount,
        discount:       data.discount,
        due_day:        data.due_day,
        status:         data.status,
        school_id:      schoolId,
      };
```

E em `handleRenew`, no objeto `renewalData`, adicionar `period: contract.period,`.

- [ ] **Step 6: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add src/components/contracts/ContractForm.tsx
git commit -m "Contrato ganha período integral/meio período com preço sugerido pela turma"
```

---

### Task 6: ServiceCatalogSection.tsx

**Files:**
- Create: `src/components/services/ServiceCatalogSection.tsx`

**Interfaces:**
- Produces: `ServiceCatalogSection()` — sem props, CRUD de `school_services`

- [ ] **Step 1: Criar o componente**

Clone estrutural de `ExpenseCategoriesSection.tsx`, adaptado (sem cor/alocação/custo-fixo — só nome + preço + ativo):

```tsx
import { useState, useEffect } from 'react';
import { Sparkles, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useSchool } from '@/contexts/SchoolContext';
import { supabase } from '@/integrations/supabase/client';
import { getFriendlyErrorMessage } from '@/lib/friendlyError';

interface SchoolService {
  id: string;
  name: string;
  price: number;
  active: boolean;
}

export function ServiceCatalogSection() {
  const { schoolId } = useSchool();
  const { toast } = useToast();
  const [services, setServices] = useState<SchoolService[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (schoolId) fetchServices();
  }, [schoolId]);

  const fetchServices = async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('school_services')
        .select('id, name, price, active')
        .eq('school_id', schoolId)
        .order('name');
      if (error) throw error;
      setServices(data || []);
    } catch (err) {
      console.error('Error fetching school services:', err);
      toast({
        title: 'Erro',
        description: getFriendlyErrorMessage(err, 'Erro ao carregar serviços'),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    const price = parseFloat(newPrice);
    if (!newName.trim() || !schoolId || !price || price <= 0) return;
    setCreating(true);
    try {
      const { data, error } = await (supabase as any)
        .from('school_services')
        .insert({ school_id: schoolId, name: newName.trim(), price })
        .select('id, name, price, active')
        .single();
      if (error) throw error;
      setServices((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName('');
      setNewPrice('');
    } catch (err) {
      toast({
        title: 'Erro ao criar serviço',
        description: getFriendlyErrorMessage(err, 'Talvez já exista um serviço com esse nome'),
        variant: 'destructive',
      });
    } finally {
      setCreating(false);
    }
  };

  const updateService = async (id: string, patch: Partial<SchoolService>) => {
    setServices((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    const { error } = await (supabase as any).from('school_services').update(patch).eq('id', id);
    if (error) {
      toast({
        title: 'Erro ao salvar',
        description: getFriendlyErrorMessage(error, 'Erro ao salvar serviço'),
        variant: 'destructive',
      });
      fetchServices();
    }
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    try {
      const { error } = await (supabase as any).from('school_services').delete().eq('id', deletingId);
      if (error) throw error;
      setServices((prev) => prev.filter((s) => s.id !== deletingId));
      toast({ title: 'Serviço removido' });
    } catch {
      toast({
        title: 'Não foi possível remover',
        description: 'Esse serviço já tem alunos assinados ou cobranças lançadas. Desative em vez de remover.',
        variant: 'destructive',
      });
    } finally {
      setDeletingId(null);
    }
  };

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <CardTitle>Catálogo de Serviços</CardTitle>
        </div>
        <CardDescription>
          Livre para criar quantos serviços fizer sentido (alimentação, inglês, natação, dança...).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex justify-center py-6">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
          </div>
        ) : (
          <div className="space-y-2">
            {services.map((s) => (
              <div key={s.id} className="flex items-center gap-3 rounded-lg border px-3 py-2.5 flex-wrap">
                <Input
                  defaultValue={s.name}
                  onBlur={(e) => {
                    const value = e.target.value.trim();
                    if (value && value !== s.name) updateService(s.id, { name: value });
                  }}
                  className="max-w-[200px]"
                />
                <Input
                  type="number" min="0" step="0.01"
                  defaultValue={s.price}
                  onBlur={(e) => {
                    const value = parseFloat(e.target.value);
                    if (value > 0 && value !== s.price) updateService(s.id, { price: value });
                  }}
                  className="max-w-[140px]"
                />
                <span className="text-xs text-muted-foreground">{formatCurrency(s.price)}/mês</span>
                <div className="flex items-center gap-2 ml-auto">
                  <span className="text-xs text-muted-foreground">Ativo</span>
                  <Switch
                    checked={s.active}
                    onCheckedChange={(checked) => updateService(s.id, { active: checked })}
                  />
                </div>
                <Button
                  size="sm" variant="ghost"
                  className="text-red-500 hover:text-red-600 hover:bg-red-50"
                  onClick={() => setDeletingId(s.id)}
                  title="Remover serviço"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {services.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">Nenhum serviço cadastrado ainda.</p>
            )}
          </div>
        )}

        <div className="flex gap-2 pt-2 flex-wrap">
          <Input
            placeholder="Nome (ex: Inglês)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="max-w-[220px]"
          />
          <Input
            type="number" min="0" step="0.01"
            placeholder="Preço mensal"
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            className="max-w-[160px]"
          />
          <Button type="button" variant="outline" onClick={handleCreate}
            disabled={creating || !newName.trim() || !newPrice} className="gap-2">
            <Plus className="h-4 w-4" />
            Adicionar
          </Button>
        </div>
      </CardContent>

      {deletingId && (
        <Dialog open onOpenChange={() => setDeletingId(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Remover serviço</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Tem certeza? Serviços com assinaturas ou cobranças já lançadas não podem ser removidos.
            </p>
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => setDeletingId(null)}>Cancelar</Button>
              <Button variant="destructive" onClick={handleDelete}>Remover</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/components/services/ServiceCatalogSection.tsx
git commit -m "Catálogo de serviços extras (CRUD livre por escola)"
```

---

### Task 7: SubscribeServiceDialog.tsx + ServiceChargeTable.tsx

**Files:**
- Create: `src/components/services/SubscribeServiceDialog.tsx`
- Create: `src/components/services/ServiceChargeTable.tsx`

**Interfaces:**
- Consumes: `subscribeStudentToService` (Task 3)
- Produces: `SubscribeServiceDialog({ open, onOpenChange, schoolId, fixedStudentId?, onSuccess })`, `ServiceChargeTable({ data, loading, onRefresh })`

- [ ] **Step 1: Criar o dialog de assinatura**

Usado tanto pela tela "Serviços" (com seletor de aluno) quanto pela seção
dentro do cadastro do aluno (`fixedStudentId` already known — esconde o
seletor).

Criar `src/components/services/SubscribeServiceDialog.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { subscribeStudentToService } from '@/lib/studentServices';
import { getFriendlyErrorMessage } from '@/lib/friendlyError';

interface SubscribeServiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schoolId: string;
  fixedStudentId?: string;
  onSuccess: () => void;
}

interface ServiceOption {
  id: string;
  name: string;
  price: number;
}

interface StudentOption {
  id: string;
  name: string;
}

const todayStr = () => new Date().toISOString().slice(0, 10);

export function SubscribeServiceDialog({
  open, onOpenChange, schoolId, fixedStudentId, onSuccess,
}: SubscribeServiceDialogProps) {
  const { toast } = useToast();
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [studentId, setStudentId] = useState(fixedStudentId ?? '');
  const [serviceId, setServiceId] = useState('');
  const [dueDay, setDueDay] = useState('10');
  const [startDate, setStartDate] = useState(todayStr());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStudentId(fixedStudentId ?? '');
    setServiceId('');
    setDueDay('10');
    setStartDate(todayStr());

    (supabase as any)
      .from('school_services')
      .select('id, name, price')
      .eq('school_id', schoolId)
      .eq('active', true)
      .order('name')
      .then(({ data }: any) => setServices(data || []));

    if (!fixedStudentId) {
      (supabase as any)
        .from('students')
        .select('id, full_name')
        .eq('school_id', schoolId)
        .eq('status', 'active')
        .order('full_name')
        .then(({ data }: any) => setStudents((data || []).map((s: any) => ({ id: s.id, name: s.full_name }))));
    }
  }, [open, schoolId, fixedStudentId]);

  const selectedService = services.find((s) => s.id === serviceId);

  const handleSubmit = async () => {
    if (!studentId || !serviceId || !selectedService) {
      toast({ title: 'Preencha aluno e serviço', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      const { inserted } = await subscribeStudentToService({
        schoolId,
        studentId,
        serviceId,
        price: selectedService.price,
        dueDay: Number(dueDay),
        startDate,
      });
      toast({
        title: 'Assinatura criada!',
        description: `${inserted} cobrança${inserted !== 1 ? 's' : ''} gerada${inserted !== 1 ? 's' : ''}.`,
      });
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      toast({
        title: 'Erro',
        description: getFriendlyErrorMessage(error, 'Erro ao assinar serviço'),
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assinar serviço</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {!fixedStudentId && (
              <div className="space-y-2">
                <Label>Aluno</Label>
                <Select value={studentId} onValueChange={setStudentId}>
                  <SelectTrigger><SelectValue placeholder="Selecione um aluno" /></SelectTrigger>
                  <SelectContent>
                    {students.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>Serviço</Label>
              <Select value={serviceId} onValueChange={setServiceId}>
                <SelectTrigger><SelectValue placeholder="Selecione um serviço" /></SelectTrigger>
                <SelectContent>
                  {services.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} — {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(s.price)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Dia de vencimento</Label>
                <Input type="number" min="1" max="28" value={dueDay} onChange={(e) => setDueDay(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Início</Label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="button" onClick={handleSubmit} disabled={submitting}>
              {submitting ? 'Assinando...' : 'Assinar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
```

- [ ] **Step 2: Criar a tabela de cobranças**

Clone estrutural de `ExpenseTable.tsx`, adaptado (coluna "Aluno" + "Serviço" em vez de categoria/turma, sem filtro de turma):

```tsx
import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PaginationCompact } from "@/components/ui/pagination-compact";
import { ArrowUpDown, CheckCircle, Search } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { isTuitionOverdue } from "@/lib/calculations";
import { getFriendlyErrorMessage } from "@/lib/friendlyError";

export interface ServiceChargeRow {
  id: string;
  description: string;
  amount: number;
  status: "pending" | "paid" | "overdue" | "cancelled";
  due_date: string;
  paid_date: string | null;
  payment_method: string | null;
  studentName: string;
  serviceName: string;
}

interface ServiceChargeTableProps {
  data: ServiceChargeRow[];
  loading: boolean;
  onRefresh: () => void;
}

type SortField = "studentName" | "serviceName" | "amount" | "status" | "due_date";

export function ServiceChargeTable({ data, loading, onRefresh }: ServiceChargeTableProps) {
  const { toast } = useToast();
  const [sortField, setSortField] = useState<SortField>("due_date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(30);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const parseLocalDate = (date: string) => {
    const [y, m, d] = date.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  const formatDate = (date: string) => format(parseLocalDate(date), "dd/MM/yyyy", { locale: ptBR });
  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

  const getStatusBadge = (charge: ServiceChargeRow) => {
    const isOverdue = isTuitionOverdue(charge.due_date, charge.status);
    const status = isOverdue ? "overdue" : charge.status;
    switch (status) {
      case "pending":
        return <Badge className="bg-pending text-primary-foreground">Pendente</Badge>;
      case "paid":
        return <Badge className="bg-paid text-success-foreground">Paga</Badge>;
      case "overdue":
        return <Badge className="bg-overdue text-danger-foreground">Atrasada</Badge>;
      case "cancelled":
        return <Badge variant="secondary">Cancelada</Badge>;
      default:
        return <Badge variant="secondary">{charge.status}</Badge>;
    }
  };

  const handleMarkAsPaid = async (charge: ServiceChargeRow) => {
    try {
      const { error } = await (supabase as any)
        .from("service_charges")
        .update({
          status: "paid",
          paid_date: format(new Date(), "yyyy-MM-dd"),
          payment_method: charge.payment_method || "Não informado",
        })
        .eq("id", charge.id);
      if (error) throw error;
      toast({ title: "Sucesso", description: "Cobrança marcada como paga!" });
      onRefresh();
    } catch (error) {
      toast({
        title: "Erro",
        description: getFriendlyErrorMessage(error, "Erro ao marcar como paga"),
        variant: "destructive",
      });
    }
  };

  const filteredData = useMemo(() => {
    return data.filter((c) => {
      const isOverdue = isTuitionOverdue(c.due_date, c.status);
      const effectiveStatus = isOverdue ? "overdue" : c.status;
      const matchesSearch = !search
        || c.studentName.toLowerCase().includes(search.toLowerCase())
        || c.serviceName.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === "all" || effectiveStatus === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [data, search, statusFilter]);

  const sortedData = useMemo(() => {
    return [...filteredData].sort((a, b) => {
      let aVal: any, bVal: any;
      switch (sortField) {
        case "studentName": aVal = a.studentName; bVal = b.studentName; break;
        case "serviceName": aVal = a.serviceName; bVal = b.serviceName; break;
        case "amount": aVal = a.amount; bVal = b.amount; break;
        case "status": aVal = a.status; bVal = b.status; break;
        default: aVal = new Date(a.due_date); bVal = new Date(b.due_date);
      }
      if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });
  }, [filteredData, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDirection("asc"); }
    setCurrentPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(sortedData.length / itemsPerPage));
  const paginatedData = sortedData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  if (loading) {
    return (
      <Card>
        <CardHeader><CardTitle>Cobranças</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cobranças ({filteredData.length})</CardTitle>
        <div className="flex flex-wrap gap-3 pt-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar aluno ou serviço..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setCurrentPage(1); }}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="pending">Pendente</SelectItem>
              <SelectItem value="paid">Paga</SelectItem>
              <SelectItem value="overdue">Atrasada</SelectItem>
              <SelectItem value="cancelled">Cancelada</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-md border">
          <Table className="min-w-[700px]">
            <TableHeader>
              <TableRow>
                <TableHead><Button variant="ghost" size="sm" onClick={() => handleSort("studentName")} className="h-auto p-0 font-semibold">Aluno <ArrowUpDown className="ml-2 h-4 w-4" /></Button></TableHead>
                <TableHead><Button variant="ghost" size="sm" onClick={() => handleSort("serviceName")} className="h-auto p-0 font-semibold">Serviço <ArrowUpDown className="ml-2 h-4 w-4" /></Button></TableHead>
                <TableHead><Button variant="ghost" size="sm" onClick={() => handleSort("amount")} className="h-auto p-0 font-semibold">Valor <ArrowUpDown className="ml-2 h-4 w-4" /></Button></TableHead>
                <TableHead><Button variant="ghost" size="sm" onClick={() => handleSort("status")} className="h-auto p-0 font-semibold">Status <ArrowUpDown className="ml-2 h-4 w-4" /></Button></TableHead>
                <TableHead><Button variant="ghost" size="sm" onClick={() => handleSort("due_date")} className="h-auto p-0 font-semibold">Vencimento <ArrowUpDown className="ml-2 h-4 w-4" /></Button></TableHead>
                <TableHead>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedData.map((charge) => {
                const isOverdue = isTuitionOverdue(charge.due_date, charge.status);
                const canMarkAsPaid = charge.status === "pending" || isOverdue;
                return (
                  <TableRow key={charge.id}>
                    <TableCell className="font-medium">{charge.studentName}</TableCell>
                    <TableCell>{charge.serviceName}</TableCell>
                    <TableCell className="font-medium">{formatCurrency(charge.amount)}</TableCell>
                    <TableCell>{getStatusBadge(charge)}</TableCell>
                    <TableCell>{formatDate(charge.due_date)}</TableCell>
                    <TableCell>
                      {canMarkAsPaid && (
                        <Button size="sm" variant="outline" onClick={() => handleMarkAsPaid(charge)}
                          className="text-green-600 hover:text-green-700" title="Marcar como paga">
                          <CheckCircle className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {paginatedData.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    Nenhuma cobrança encontrada
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <PaginationCompact
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
          totalItems={filteredData.length}
          itemsPerPage={itemsPerPage}
        />
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/components/services/SubscribeServiceDialog.tsx src/components/services/ServiceChargeTable.tsx
git commit -m "Dialog de assinatura de serviço + tabela de cobranças"
```

---

### Task 8: Página Serviços + rota/menu

**Files:**
- Create: `src/pages/Services.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/layout/AppSidebar.tsx`
- Modify: `src/components/layout/Layout.tsx`

**Interfaces:**
- Consumes: `ServiceCatalogSection` (Task 6), `SubscribeServiceDialog`, `ServiceChargeTable`, `ServiceChargeRow` (Task 7), `cancelStudentService` (Task 3)

- [ ] **Step 1: Criar a página**

Criar `src/pages/Services.tsx`:

```tsx
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Plus, Repeat, ChevronDown } from "lucide-react";
import { ServiceCatalogSection } from "@/components/services/ServiceCatalogSection";
import { SubscribeServiceDialog } from "@/components/services/SubscribeServiceDialog";
import { ServiceChargeTable, type ServiceChargeRow } from "@/components/services/ServiceChargeTable";
import { cancelStudentService } from "@/lib/studentServices";
import { getFriendlyErrorMessage } from "@/lib/friendlyError";
import { isTuitionOverdue } from "@/lib/calculations";

interface ActiveSubscriptionRow {
  id: string;
  price: number;
  due_day: number;
  studentName: string;
  serviceName: string;
}

const Services = () => {
  const { schoolId } = useSchool();
  const { toast } = useToast();
  const [charges, setCharges] = useState<ServiceChargeRow[]>([]);
  const [subscriptions, setSubscriptions] = useState<ActiveSubscriptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSubscribe, setShowSubscribe] = useState(false);
  const [showActive, setShowActive] = useState(false);

  useEffect(() => {
    if (schoolId) fetchAll();
  }, [schoolId]);

  const fetchAll = async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const [{ data: chargesData, error: chargesErr }, { data: subsData, error: subsErr }] = await Promise.all([
        (supabase as any)
          .from("service_charges")
          .select("id, description, amount, status, due_date, paid_date, payment_method, students(full_name), school_services(name)")
          .eq("school_id", schoolId)
          .order("due_date", { ascending: false }),
        (supabase as any)
          .from("student_services")
          .select("id, price, due_day, active, students(full_name), school_services(name)")
          .eq("school_id", schoolId)
          .eq("active", true)
          .order("created_at", { ascending: false }),
      ]);

      if (chargesErr) throw chargesErr;
      if (subsErr) throw subsErr;

      setCharges((chargesData || []).map((c: any) => ({
        id: c.id,
        description: c.description,
        amount: Number(c.amount),
        status: c.status,
        due_date: c.due_date,
        paid_date: c.paid_date,
        payment_method: c.payment_method,
        studentName: c.students?.full_name ?? "N/A",
        serviceName: c.school_services?.name ?? "N/A",
      })));

      setSubscriptions((subsData || []).map((s: any) => ({
        id: s.id,
        price: Number(s.price),
        due_day: s.due_day,
        studentName: s.students?.full_name ?? "N/A",
        serviceName: s.school_services?.name ?? "N/A",
      })));
    } catch (error) {
      toast({
        title: "Erro",
        description: getFriendlyErrorMessage(error, "Erro ao carregar serviços"),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async (subscriptionId: string) => {
    try {
      await cancelStudentService(subscriptionId);
      toast({ title: "Assinatura cancelada" });
      fetchAll();
    } catch (error) {
      toast({
        title: "Erro",
        description: getFriendlyErrorMessage(error, "Erro ao cancelar assinatura"),
        variant: "destructive",
      });
    }
  };

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

  const openCharges = charges.filter((c) => isTuitionOverdue(c.due_date, c.status) || c.status === "pending");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Serviços</h1>
          <p className="text-muted-foreground">
            Alimentação, cursos extras e qualquer assinatura mensal além da mensalidade
          </p>
        </div>
        <Button onClick={() => setShowSubscribe(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Nova Assinatura
        </Button>
      </div>

      <Card className="w-fit">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">Cobranças em aberto</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{openCharges.length}</div>
        </CardContent>
      </Card>

      <ServiceChargeTable data={charges} loading={loading} onRefresh={fetchAll} />

      <Card>
        <Collapsible open={showActive} onOpenChange={setShowActive}>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer select-none">
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2">
                  <Repeat className="h-4 w-4" />
                  Assinaturas ativas ({subscriptions.length})
                </span>
                <ChevronDown className={`h-4 w-4 transition-transform ${showActive ? "rotate-180" : ""}`} />
              </CardTitle>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent>
              {subscriptions.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Nenhuma assinatura ativa. Clique em "Nova Assinatura" pra começar.
                </p>
              ) : (
                <div className="space-y-2">
                  {subscriptions.map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3 flex-wrap">
                      <div>
                        <span className="font-medium">{s.studentName}</span>
                        <Badge variant="outline" className="ml-2">{s.serviceName}</Badge>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatCurrency(s.price)} · todo dia {s.due_day}
                        </p>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => handleCancel(s.id)}>
                        Cancelar
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      <ServiceCatalogSection />

      {schoolId && (
        <SubscribeServiceDialog
          open={showSubscribe}
          onOpenChange={setShowSubscribe}
          schoolId={schoolId}
          onSuccess={fetchAll}
        />
      )}
    </div>
  );
};

export default Services;
```

- [ ] **Step 2: Rota**

Modificar `src/App.tsx`. Import junto dos outros:

```typescript
import Services from "./pages/Services";
```

Rota nova, ao lado de `/despesas`:

```tsx
                <Route
                  path="/servicos"
                  element={
                    <ProtectedRoute requireSchool allowedRoles={['admin', 'financial']}>
                      <Layout>
                        <Services />
                      </Layout>
                    </ProtectedRoute>
                  }
                />
```

- [ ] **Step 3: Menu**

Modificar `src/components/layout/AppSidebar.tsx`. Import do ícone junto dos outros:

```typescript
  Sparkles,
```

No grupo "Financeiro", logo depois do item "Despesas":

```typescript
      { title: "Despesas",    url: "/despesas",    icon: Wallet,    roles: ['admin', 'financial'] },
      { title: "Serviços",    url: "/servicos",    icon: Sparkles,  roles: ['admin', 'financial'] },
```

- [ ] **Step 4: Título da página**

Modificar `src/components/layout/Layout.tsx`, no `PAGE_TITLES`:

```typescript
  "/servicos": "Serviços",
```

- [ ] **Step 5: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Services.tsx src/App.tsx src/components/layout/AppSidebar.tsx src/components/layout/Layout.tsx
git commit -m "Nova tela Serviços: catálogo, assinaturas ativas e cobranças"
```

---

### Task 9: Seção de serviços no cadastro do aluno

**Files:**
- Create: `src/components/students/StudentServicesSection.tsx`
- Modify: `src/components/students/StudentForm.tsx`

**Interfaces:**
- Consumes: `SubscribeServiceDialog` (Task 7), `cancelStudentService` (Task 3)
- Produces: `StudentServicesSection({ studentId, schoolId })`

- [ ] **Step 1: Criar a seção**

Criar `src/components/students/StudentServicesSection.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { SubscribeServiceDialog } from '@/components/services/SubscribeServiceDialog';
import { cancelStudentService } from '@/lib/studentServices';
import { getFriendlyErrorMessage } from '@/lib/friendlyError';

interface StudentSubscription {
  id: string;
  price: number;
  serviceName: string;
}

interface StudentServicesSectionProps {
  studentId: string;
  schoolId: string;
}

export function StudentServicesSection({ studentId, schoolId }: StudentServicesSectionProps) {
  const { toast } = useToast();
  const [subscriptions, setSubscriptions] = useState<StudentSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSubscribe, setShowSubscribe] = useState(false);

  useEffect(() => {
    fetchSubscriptions();
  }, [studentId]);

  const fetchSubscriptions = async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('student_services')
        .select('id, price, school_services(name)')
        .eq('student_id', studentId)
        .eq('active', true)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setSubscriptions((data || []).map((s: any) => ({
        id: s.id,
        price: Number(s.price),
        serviceName: s.school_services?.name ?? 'N/A',
      })));
    } catch (error) {
      console.error('Error fetching student services:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async (subscriptionId: string) => {
    try {
      await cancelStudentService(subscriptionId);
      toast({ title: 'Assinatura cancelada' });
      fetchSubscriptions();
    } catch (error) {
      toast({
        title: 'Erro',
        description: getFriendlyErrorMessage(error, 'Erro ao cancelar assinatura'),
        variant: 'destructive',
      });
    }
  };

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">Serviços Contratados</p>
        <Button type="button" size="sm" variant="outline" onClick={() => setShowSubscribe(true)} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Assinar serviço
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-4">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
        </div>
      ) : subscriptions.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum serviço contratado.</p>
      ) : (
        <div className="space-y-2">
          {subscriptions.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{s.serviceName}</Badge>
                <span className="text-sm text-muted-foreground">{formatCurrency(s.price)}/mês</span>
              </div>
              <Button type="button" size="sm" variant="ghost" onClick={() => handleCancel(s.id)}>
                Cancelar
              </Button>
            </div>
          ))}
        </div>
      )}

      <SubscribeServiceDialog
        open={showSubscribe}
        onOpenChange={setShowSubscribe}
        schoolId={schoolId}
        fixedStudentId={studentId}
        onSuccess={fetchSubscriptions}
      />
    </div>
  );
}
```

- [ ] **Step 2: Montar dentro do StudentForm**

Modificar `src/components/students/StudentForm.tsx`. Import junto dos outros:

```typescript
import { StudentServicesSection } from './StudentServicesSection';
import { useSchool } from '@/contexts/SchoolContext';
```

Dentro do componente, logo no início (antes do `useForm`):

```typescript
  const { schoolId } = useSchool();
```

No JSX, logo depois do bloco "Matrícula & Financeiro" (depois do `</div>` que fecha o "Valor final calculado" e antes do `<DialogFooter>`), adicionar — só renderiza em modo edição, já que precisa de `student.id`:

```tsx
          {student?.id && schoolId && (
            <>
              <Separator />
              <StudentServicesSection studentId={student.id} schoolId={schoolId} />
            </>
          )}
```

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Verificar manualmente (visual, antes da migration rodar)**

Run: `npm run dev`. Abrir edição de um aluno existente — a seção "Serviços Contratados" deve aparecer (vazia, "Nenhum serviço contratado" — o botão "Assinar serviço" só funciona de verdade depois da Task 1 rodar em produção).

- [ ] **Step 5: Commit**

```bash
git add src/components/students/StudentServicesSection.tsx src/components/students/StudentForm.tsx
git commit -m "Cadastro do aluno ganha seção de serviços contratados"
```

---

### Task 10: Dashboard e Relatórios

**Files:**
- Modify: `src/components/dashboard/FinancialMetrics.tsx`
- Modify: `src/components/reports/ClassProfitability.tsx`
- Modify: `src/pages/Reports.tsx`

- [ ] **Step 1: FinancialMetrics — somar receita de serviços**

Modificar `src/components/dashboard/FinancialMetrics.tsx`. No estado inicial, adicionar `monthlyServiceRevenue: 0,` logo após `monthlyRevenue: 0,`.

No `Promise.all` do `fetchMetrics`, adicionar uma quarta query e desestruturar:

```typescript
      const [
        { data: students, error: studentsError },
        { data: teachers, error: teachersError },
        { data: tuitions, error: tuitionsError },
        { data: expenses, error: expensesError },
        { data: serviceCharges, error: serviceChargesError },
      ] = await Promise.all([
        (supabase as any).from('students').select('id').eq('school_id', schoolId).eq('status', 'active'),
        (supabase as any).from('teachers').select('id, salary').eq('school_id', schoolId).eq('status', 'active'),
        (supabase as any).from('tuitions').select('amount, status, due_date').eq('school_id', schoolId),
        (supabase as any).from('expenses').select('amount, status, due_date').eq('school_id', schoolId).gte('due_date', twoMonthsAgo),
        (supabase as any).from('service_charges').select('amount, status, due_date').eq('school_id', schoolId),
      ]);

      if (studentsError) throw studentsError;
      if (teachersError) throw teachersError;
      if (tuitionsError) throw tuitionsError;
      if (expensesError) throw expensesError;
      if (serviceChargesError) throw serviceChargesError;
```

Logo depois do bloco que calcula `monthlyRevenue`/`previousMonthRevenue` (o `for (const t of activeTuitions)`), adicionar o bloco equivalente pra serviços:

```typescript
      // Same bucketing for service charges (cancelled excluded)
      const activeServiceCharges = serviceCharges?.filter((s: any) => s.status !== "cancelled") || [];
      let monthlyServiceRevenue = 0;
      let previousMonthServiceRevenue = 0;
      for (const s of activeServiceCharges) {
        const due = new Date(s.due_date);
        const y = due.getFullYear();
        const m = due.getMonth();
        if (y === currentYear && m === currentMonth) monthlyServiceRevenue += Number(s.amount);
        else if (y === prevRef.getFullYear() && m === prevRef.getMonth()) previousMonthServiceRevenue += Number(s.amount);
      }
```

Na conta de `financialBalance`/`previousBalance`, incluir a receita de serviços:

```typescript
      const financialBalance = monthlyRevenue + monthlyServiceRevenue - totalSalaries - monthlyExpenses;
      const previousBalance = previousMonthRevenue + previousMonthServiceRevenue - totalSalaries - previousMonthExpenses;
```

E no `setMetrics(...)`, adicionar `monthlyServiceRevenue,` junto de `monthlyRevenue,`.

- [ ] **Step 2: Novo card no grid secundário**

No JSX, trocar `className="grid grid-cols-2 md:grid-cols-5 gap-4"` (a faixa secundária) por `className="grid grid-cols-2 md:grid-cols-6 gap-4"`, e adicionar um card novo logo depois do card "Despesas do mês":

```tsx
        <div className="flex items-center gap-3 rounded-lg border p-3">
          <div className="rounded-md p-2 bg-muted/50">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Receita de serviços</p>
            <p className="text-sm font-semibold">{formatCurrency(metrics.monthlyServiceRevenue)}</p>
          </div>
        </div>
```

Adicionar `Sparkles` ao import de `lucide-react` no topo do arquivo. Também ajustar o skeleton de loading (`grid grid-cols-2 md:grid-cols-5` vira `md:grid-cols-6`, e o array `[1,2,3,4,5]` vira `[1,2,3,4,5,6]`) pra não ficar faltando um placeholder.

- [ ] **Step 3: ClassProfitability — atribuir receita de serviço à turma**

Modificar `src/components/reports/ClassProfitability.tsx`. No `Promise.all` do `fetchData`, adicionar `student_id` na query de `enrollments` e uma query nova de `service_charges`:

```typescript
      const [
        { data: classes, error: classErr },
        { data: tuitions, error: tErr },
        { data: enrollments, error: eErr },
        { data: expensesData, error: expErr },
        { data: serviceCharges, error: scErr },
      ] = await Promise.all([
        (supabase as any)
          .from("classes")
          .select(`id, name, level, class_teachers ( teacher_id, teachers ( salary ) )`)
          .eq("school_id", schoolId),
        (supabase as any)
          .from("tuitions")
          .select("final_amount, amount, contracts(class_id)")
          .eq("school_id", schoolId)
          .eq("status", "paid"),
        (supabase as any)
          .from("enrollments")
          .select("student_id, class_id"),
        (supabase as any)
          .from("expenses")
          .select("amount, class_id, expense_categories(allocation_method)")
          .eq("school_id", schoolId)
          .eq("status", "paid"),
        (supabase as any)
          .from("service_charges")
          .select("amount, student_id")
          .eq("school_id", schoolId)
          .eq("status", "paid"),
      ]);

      if (classErr) throw classErr;
      if (tErr) throw tErr;
      if (eErr) throw eErr;
      if (expErr) throw expErr;
      if (scErr) throw scErr;
```

Logo depois do bloco `revenueByClass`/`studentsByClass`, adicionar o mapeamento de aluno→turma e a soma da receita de serviço na mesma `revenueByClass`:

```typescript
      const classByStudent: Record<string, string> = {};
      for (const e of enrollments || []) {
        classByStudent[e.student_id] = e.class_id;
      }

      for (const sc of serviceCharges || []) {
        const classId = classByStudent[sc.student_id];
        if (!classId) continue;
        revenueByClass[classId] = (revenueByClass[classId] || 0) + Number(sc.amount || 0);
      }
```

- [ ] **Step 4: Reports.tsx — seção Serviços no export**

Modificar `src/pages/Reports.tsx`. Junto do `ExpenseExportRow`/`fetchExpensesForExport` já existentes (da sessão anterior), adicionar o equivalente pra serviços:

```typescript
  interface ServiceExportRow {
    studentName: string;
    serviceName: string;
    amount: number;
    status: string;
    due_date: string;
    paid_date: string | null;
  }

  const fetchServiceChargesForExport = async (): Promise<ServiceExportRow[]> => {
    let query = (supabase as any)
      .from("service_charges")
      .select("amount, status, due_date, paid_date, students(full_name), school_services(name)")
      .eq("school_id", schoolId!);

    if (filters.startDate) query = query.gte("due_date", filters.startDate);
    if (filters.endDate) query = query.lte("due_date", filters.endDate);

    const { data, error } = await query.order("due_date", { ascending: false });
    if (error) throw error;

    return (data || []).map((item: any) => ({
      studentName: item.students?.full_name ?? "N/A",
      serviceName: item.school_services?.name ?? "N/A",
      amount: Number(item.amount),
      status: item.status,
      due_date: item.due_date,
      paid_date: item.paid_date,
    }));
  };
```

Em `exportToCSV`, junto de `fetchExpensesForExport()`, buscar também os serviços e adicionar uma terceira seção ao CSV final:

```typescript
    let serviceRows: ServiceExportRow[];
    try {
      serviceRows = await fetchServiceChargesForExport();
    } catch (error) {
      toast({
        title: "Erro",
        description: getFriendlyErrorMessage(error, "Erro ao carregar serviços para o relatório"),
        variant: "destructive",
      });
      return;
    }
    const servicesTotal = serviceRows
      .filter((s) => s.status !== "cancelled")
      .reduce((sum, s) => sum + s.amount, 0);
```

(logo depois do bloco equivalente de `expenseRows`/`expensesTotal`) e, no `csv` final:

```typescript
    const serviceCsvData = [
      ...serviceRows.map((s) => ({
        "Aluno": s.studentName,
        "Serviço": s.serviceName,
        "Valor": s.amount,
        "Status": expenseStatusLabel(s.status),
        "Data de Vencimento": formatDate(s.due_date),
        "Data de Pagamento": s.paid_date ? formatDate(s.paid_date) : "N/A",
      })),
      {},
      { "Aluno": "Total de Serviços", "Serviço": "", "Valor": servicesTotal, "Status": "", "Data de Vencimento": "", "Data de Pagamento": "" },
    ];

    const csv =
      Papa.unparse(csvData) +
      "\n\n\nDESPESAS\n\n" +
      Papa.unparse(expenseCsvData) +
      "\n\n\nSERVIÇOS\n\n" +
      Papa.unparse(serviceCsvData);
```

Em `exportToExcel`, o mesmo padrão: buscar `serviceRows` logo depois de `expenseRows` (mesmo bloco try/catch já usado pra despesas, adaptado):

```typescript
    let serviceRows: ServiceExportRow[];
    try {
      serviceRows = await fetchServiceChargesForExport();
    } catch (error) {
      toast({
        title: "Erro",
        description: getFriendlyErrorMessage(error, "Erro ao carregar serviços para o relatório"),
        variant: "destructive",
      });
      return;
    }
    const servicesTotal = serviceRows
      .filter((s) => s.status !== "cancelled")
      .reduce((sum, s) => sum + s.amount, 0);
```

Montar a planilha e adicionar como terceira aba do workbook, junto de `expensesWorksheetData`:

```typescript
    const servicesWorksheetData = [
      ["Aluno", "Serviço", "Valor", "Status", "Data de Vencimento", "Data de Pagamento"],
      ...serviceRows.map((s) => [
        s.studentName,
        s.serviceName,
        s.amount,
        expenseStatusLabel(s.status),
        formatDate(s.due_date),
        s.paid_date ? formatDate(s.paid_date) : "N/A",
      ]),
      [],
      ["RESUMO"],
      ["Total de Serviços", `${serviceRows.length} registros`, servicesTotal],
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(worksheetData), "Mensalidades");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(expensesWorksheetData), "Despesas");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(servicesWorksheetData), "Serviços");
    XLSX.writeFile(workbook, `relatorio-financeiro-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
```

(essa última parte substitui o bloco `const workbook = ...` até `XLSX.writeFile(...)` que já existe no fim de `exportToExcel`, da sessão anterior.)

- [ ] **Step 5: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: build sem erros.

- [ ] **Step 7: Commit**

```bash
git add src/components/dashboard/FinancialMetrics.tsx src/components/reports/ClassProfitability.tsx src/pages/Reports.tsx
git commit -m "Dashboard e Relatórios somam receita de serviços extras"
```

---

### Task 11: QA manual fim a fim

**Files:** nenhum (checagem)

- [ ] **Step 1: Confirmar que a migration da Task 1 já rodou**

Perguntar ao usuário se já rodou `supabase/migrations/20260913150000_extra_revenue_streams.sql` — sem isso, catálogo/assinatura/cobrança e o campo de período falham.

- [ ] **Step 2: Build de produção**

Run: `npm run build`
Expected: build limpo.

- [ ] **Step 3: QA — serviços extras**

Run: `npm run dev`, logar como admin/financial.
- Em Serviços: criar um serviço no catálogo (ex: "Inglês", R$150). Clicar "Nova Assinatura", assinar um aluno. Conferir que a cobrança do mês aparece na tabela.
- Marcar a cobrança como paga.
- Abrir o cadastro do mesmo aluno (Alunos → editar): a seção "Serviços Contratados" deve mostrar a assinatura. Cancelar por lá e conferir que some da lista de "Assinaturas ativas" em Serviços.

- [ ] **Step 4: QA — período**

Em Turmas, editar uma turma e preencher "Mensalidade integral" além da base. Em Contratos, criar um contrato novo nessa turma, alternar entre Meio período/Integral e conferir que o Valor Mensal muda sozinho pro preço certo (e que dá pra sobrescrever manualmente depois).

- [ ] **Step 5: QA — Dashboard e Relatórios**

No Dashboard, conferir que o card "Receita de serviços" mostra o valor da cobrança paga no mês, e que o Saldo Financeiro do Mês já soma essa receita. Em Relatórios, exportar CSV e Excel e conferir que as seções/abas de Despesas e Serviços aparecem certas.

- [ ] **Step 6: Commit final (se algo precisou de ajuste durante o QA)**

```bash
git add -A
git commit -m "Ajustes de QA em fontes de receita além da mensalidade"
```

(Pular este commit se nenhum ajuste foi necessário.)
