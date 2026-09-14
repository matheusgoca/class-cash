# Fontes de receita além da mensalidade — design

Data: 2026-09-13

## Objetivo

Hoje a única fonte de receita do class-cash é a mensalidade do contrato
(`contracts.monthly_amount` → `tuitions`). A escola quer registrar e cobrar
por serviços extras (alimentação, inglês, natação, dança, ...) e por período
integral/meio período. Este design cobre as duas coisas, mantidas como
mecanismos distintos porque resolvem problemas diferentes:

- **Serviços extras**: algo que o aluno pode ou não contratar, independente
  da mensalidade — precisa de assinatura, cobrança recorrente própria, e
  poder ser adicionado/removido sem tocar no contrato.
- **Período integral/meio período**: uma variação de preço da própria
  mensalidade, escolhida no contrato.

## Decisões (confirmadas com o usuário)

- Serviço extra = assinatura mensal recorrente (não cobrança por uso).
- Cada serviço vira um **lançamento separado** da mensalidade (não soma no
  `monthly_amount` do contrato) — mesmo padrão molde→lançamento já usado em
  despesas. Isso preserva a visibilidade de quanto cada serviço rende e
  permite entrar/sair do serviço sem editar o contrato.
- Catálogo de serviços é **livre por escola** (igual `expense_categories`).
- Período é escolhido **por contrato**, não por turma — a turma continua
  sendo uma só; o preço muda conforme o período escolhido no contrato, com
  **sugestão automática de valor** a partir de dois preços cadastrados na
  turma (editável depois, como já acontece com desconto).
- Receita de serviços **entra nos totais** do Dashboard e dos relatórios
  desde a v1 (Saldo Financeiro, receita por turma, export).
- Assinar um aluno num serviço acontece tanto numa **tela "Serviços" nova**
  (visão geral da escola) quanto **dentro do cadastro do aluno** (visão
  consolidada por aluno) — as duas escrevem nas mesmas tabelas.

## Schema

### Serviços extras (molde → lançamento, espelha recurring_expenses → expenses)

```sql
CREATE TABLE public.school_services (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid        NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  name       text        NOT NULL,
  price      numeric     NOT NULL CHECK (price > 0),
  active     boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, name)
);

CREATE TABLE public.student_services (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid        NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id  uuid        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  service_id  uuid        NOT NULL REFERENCES public.school_services(id) ON DELETE RESTRICT,
  price       numeric     NOT NULL CHECK (price > 0), -- snapshot do preço na assinatura; editável por aluno
  due_day     integer     NOT NULL CHECK (due_day BETWEEN 1 AND 28),
  start_date  date        NOT NULL,
  end_date    date,
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date > start_date)
);

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
```

RLS em todas as três: admin/financial gerenciam (`school_id =
get_user_school_id() AND get_current_user_role() IN ('admin','financial')`),
mesmo padrão de `expenses`. Índices em `school_id`, e em `student_services
(student_id)` / `service_charges (student_id, status)` pelas queries mais
comuns.

`src/lib/generateServiceCharges.ts` — clone estrutural de
`generateTuitions.ts`/`generateExpenses.ts`, já escrito com as correções
desta sessão desde o início (clamp de `due_date` dentro de
`start_date`/`end_date`, formatação de data local em vez de
`toISOString()`, idempotente).

### Período integral/meio período

```sql
ALTER TABLE public.classes ADD COLUMN monthly_fee_integral numeric;

ALTER TABLE public.contracts ADD COLUMN period text NOT NULL DEFAULT 'meio_periodo'
  CHECK (period IN ('meio_periodo', 'integral'));
```

`monthly_fee` (já existente) continua sendo o preço de meio período;
`monthly_fee_integral` é opcional — se uma turma não preencher, o campo de
período no contrato ainda funciona, só não pré-sugere valor (cai no
comportamento manual de hoje).

`save_class_with_teachers` (função SECURITY DEFINER que salva turma +
professores atomicamente) precisa do parâmetro novo
`p_monthly_fee_integral`. Como adicionar um parâmetro muda a assinatura da
função, a migration dá `DROP FUNCTION` explícito da assinatura antiga antes
de recriar — `CREATE OR REPLACE` sozinho criaria uma segunda função
sobrecarregada em vez de substituir, e uma chamada com 9 argumentos passaria
a ser ambígua entre as duas.

## Frontend

### Tela "Serviços" (nova, rota `/servicos`, menu ao lado de Despesas)

Mesmo padrão de `Expenses.tsx`: cabeçalho com botão "Nova assinatura",
cards de resumo (total/pendente/pago/atrasado), tabela de `service_charges`
com filtro por aluno/serviço/status, seção colapsável "Catálogo de
serviços" (CRUD de `school_services`, igual `ExpenseCategoriesSection`).

### `StudentForm.tsx` — seção "Serviços contratados"

Só renderiza em modo edição (precisa de `student.id`). Lista as
`student_services` ativas do aluno com preço e serviço, botão "Assinar
serviço" (Select de `school_services` ativos + due_day) e botão de
cancelar assinatura. Escreve direto no Supabase ao clicar, sem esperar o
"Salvar" do formulário principal — mesmo padrão de estado independente já
usado em `ExpenseCategoriesSection` dentro de `Expenses.tsx`.

### `ContractForm.tsx` — período

Novo campo Select "Período" (Meio período / Integral, default meio
período). `fetchClasses` passa a buscar também `monthly_fee` e
`monthly_fee_integral`. Um novo `useEffect` (só quando `!contract`, mesmo
guard já usado pro auto-cálculo de `end_date`) prescreve `monthly_amount`
a partir do preço da turma selecionada para o período escolhido, sempre que
`class_id` ou `period` mudam — e só quando a turma tiver um preço definido
pra aquele período; senão não mexe no valor.

### `ClassForm.tsx`

Segundo campo de preço "Mensalidade integral (R$)" ao lado de "Mensalidade
base (R$)", mesmo padrão de input (`CurrencyInput`-style opcional). Passa
`monthly_fee_integral` pro RPC `save_class_with_teachers`.

## Relatórios/Dashboard

- **`FinancialMetrics.tsx`**: nova query de `service_charges` (excluindo
  `cancelled`), novo card "Receita de Serviços", somado no cálculo de
  `financialBalance`/`monthlyRevenue` do mesmo jeito que mensalidade.
- **`ClassProfitability.tsx`**: busca `service_charges` com status `paid`,
  junta `student_id → enrollments.class_id` pra atribuir a receita à turma
  do aluno (mesmo caminho de join que `enrollments` já usa pra contar
  alunos por turma), soma em `revenue`.
- **`Reports.tsx`**: terceira seção/aba "Serviços" no export CSV/Excel,
  mesmo padrão que a seção "Despesas" adicionada na sessão anterior — reusa
  a mesma estrutura de fetch+summary, adaptada pra `service_charges`.

## Fora de escopo (YAGNI)

- Cobrança por uso/dia (ex: alimentação variável por presença) — ficou fora
  na decisão de escopo; pode virar um "tipo de cobrança" novo depois se a
  escola pedir.
- Vínculo de custo/professor a um serviço (ex: professor de inglês
  específico, `classCost.ts`) — serviços extras não têm custo alocado
  nesta v1, só receita. Se precisar de rentabilidade por serviço no
  futuro, é uma extensão separada.
- Editar o preço de um `school_service` não altera assinaturas já ativas
  (cada `student_services.price` é um snapshot) — reajuste de preço em
  massa fica pra depois, se pedido.

## Teste

Sem suite automatizada (mesma situação do resto do projeto). Validação:
`npx tsc --noEmit` + `npm run build` a cada etapa, QA manual depois da
migration rodar — assinar aluno em serviço, gerar cobrança, ver na tela
Serviços e no cadastro do aluno, conferir que entra no Saldo Financeiro e
na receita por turma, criar contrato integral e conferir valor sugerido.
