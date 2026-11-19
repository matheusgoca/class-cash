# Application Sync Changelog

## Sprint S3 — Notificações, etapa 2: interface (2026-11-19)

Spec: `docs/superpowers/specs/2026-11-18-gerador-notificacoes-design.md`. Plano: `docs/superpowers/plans/2026-11-19-notificacoes-etapa2-interface.md`. Só front; nenhuma migration.

- Sino no cabeçalho global (`NotificationBell`), com selo de não lidas ("9+" acima de 9), popover com os 4 avisos não lidos mais recentes, "Marcar todas como lidas" e atualização ao voltar o foco da janela. Mesma regra de visibilidade do item Notificações da barra lateral.
- Central `/notificacoes` preenchida: abas Todas/Não lidas/Cobrança/Renegociação/Despesas/Rematrícula, agrupamento por dia, "Carregar mais" por offset (20 por página, dedupe por `id`) e ação por aviso que marca como lido e navega.
- Card "Precisa da sua atenção hoje" no Dashboard (avisos gerados hoje; "Nada pendente para hoje." quando não há).
- Mensalidades passa a ler `?status=` (`pending`/`overdue`/`paid`) como filtro inicial.
- Textos e agrupamentos em `src/lib/notificationText.ts` (puro, testado); cliente dos RPCs em `src/lib/notifications.ts`.
- **Desvio da spec (G11):** botões "Ver parcelas" e "Ver contratos" no lugar de "Abrir renegociações"/"Abrir rematrícula" (as telas não existem).
- 152 testes passando (40 novos), incluindo testes de renderização dos três componentes (jsdom + Testing Library, só nos arquivos `.test.tsx`; o ambiente global segue `node`).
- **`renewed_count` exclui renovações canceladas:** "já rematriculado" só conta se a renovação não está `cancelled`. Migration `20261119120000_notifications_renewed_count_exclude_cancelled.sql` (só redefine `generate_daily_notifications`; única mudança é o filtro). Aplicada em produção em 2026-11-19; matriz 42/42 com a migration e 41/42 sem ela (o caso 1e, com uma renovação cancelada, detecta o defeito). Vale a partir da próxima geração.

## Sprint S3 — Gerador de notificações, etapa 1 (2026-11-18)

Spec: `docs/superpowers/specs/2026-11-18-gerador-notificacoes-design.md`. Plano: `docs/superpowers/plans/2026-11-18-gerador-notificacoes-etapa1.md`.

- Tabela `notifications` (uma linha por usuário × escola × evento × dia, dados estruturados; textos montados no front na etapa 2) e função `generate_daily_notifications()`, agendada no `pg_cron` às 08:00 UTC (05:00 em Brasília). Migration `20261118150000_notifications_generator.sql`.
- Destinatários pelo papel e vínculo atuais e pelas preferências (ou padrões); "hoje" no fuso do usuário; atraso como lembrete diário acumulado; reexecução idempotente preservando o lido.
- RPCs `list_notifications` (paginação por offset — todas as linhas de uma geração têm o mesmo `created_at`) e `mark_notifications_read`; gate de 2FA e `school_id` de `get_user_school_id()`.
- Matriz `supabase/tests/notifications_matrix.sql` em `BEGIN ... ROLLBACK`, com uma escola de teste criada dentro da transação.
- Ainda sem interface (etapa 2): os avisos começam a se acumular a partir da primeira execução do job.
- Migration aplicada em produção em 2026-11-18; matriz `supabase/tests/notifications_matrix.sql` com 38/38 ok contra o schema aplicado, incluindo uma segunda escola de teste com dados nas mesmas datas para provar o isolamento por `school_id`. Job `generate-daily-notifications` ativo.
- Correção do acúmulo do lembrete de atraso: migration `20261118160000_notifications_supersede_overdue.sql` — o aviso de atraso de hoje substitui os de dias anteriores ainda não lidos. Aplicada em produção em 2026-11-19; matriz 42/42 contra o schema aplicado.

## Sprint S3 — Preferências de notificação (2026-11-18)

Spec: `docs/superpowers/specs/2026-11-18-preferencias-notificacao-design.md`. Plano: `docs/superpowers/plans/2026-11-18-preferencias-notificacao.md`.

- Tabelas `notification_preferences` (usuário × escola × evento) e `notification_settings` (resumo diário, fuso, `confirmed_at`), escritas só pelos RPCs `ensure_notification_preferences()` e `save_notification_preferences(...)`; padrões, opções e direção numa única função (`notification_event_defaults()`). Migration `20261118120000_notification_preferences.sql`.
- E-mail nasce desligado e só vale depois do 1º save (`confirmed_at`); Rematrícula só para owner/admin; gate de 2FA (`mfa_gate` + `assert_mfa_gate()`); FKs com cascade para `schools` e `auth.users`.
- Front: central `/notificacoes` (estado vazio) e `/notificacoes/preferencias` conforme o mockup; grupo **Conta** na barra lateral com Notificações e Segurança da conta.
- **Desvio da spec:** opções de antecedência, direção e "recomendado" vêm do payload do RPC em vez de um catálogo no front (evita duas fontes).
- Migration aplicada em produção em 2026-11-18. Primeira tentativa falhou (`uuid_generate_v4()` não existe no search_path do `db push`; a extensão vive no schema `extensions`) e nada foi gravado; corrigido para `gen_random_uuid()`, o padrão de todas as tabelas de produção. Drift: `update_updated_at_column()` também não existe em produção — os triggers usam `set_updated_at()`.
- Matriz `supabase/tests/notification_prefs_matrix.sql`: 30/30 em `BEGIN ... ROLLBACK` contra o schema aplicado.
- Nada é gerado nem enviado ainda (gerador: próximos passos da S3; e-mail: S4).

## Sprint S2 — Histórico de alterações, segmentos e segurança da conta (2026-11-13 a 2026-11-17)

Escopo em `docs/PLANO_SPRINTS_NOV2026.md` (linha S2). Entregue em três PRs (#1, #2, #3), todos mergeados; migrations aplicadas em produção e Edge Function deployada (conferido em 2026-11-18).

### Fase 0 — Diagnóstico e pendências da S1 (PR #1)
- RLS de `audit_logs` validada com usuário não-master em `BEGIN...ROLLBACK` (isolamento por escola, financeiro sem acesso, UPDATE/DELETE bloqueados).
- Migration limpando o ramo morto `'owner'` da policy de `audit_logs` + índice `created_at desc` para o painel master.

### Fase 1 — Histórico de alterações (PR #1)
- `src/lib/auditFormat.ts` (formatador em português, Vitest) e `src/lib/auditLog.ts` (paginação por cursor, resolução de nomes em lote filtrando por `school_id`).
- Ação de master aparece como "Suporte Class Cash" para o owner; salário só para quem já vê salário.
- RPC `audit_logs_hidden_summary` (resumo dos eventos `generated`/`import`, ocultos por padrão).
- UI: aba "Histórico de alterações" em Configurações e painel `/master/historico`.

### Fase 2 — Segmentos (PR #1, revisto no PR #2)
- `fundamental` virou `fundamental_1` + `fundamental_2`; `src/lib/segments.ts` como fonte única; `SegmentPicker` compartilhado (Onboarding + Configurações).
- `ClassForm` filtra Série/Ano pelos segmentos da escola (com "Outra série" e preservação de valores antigos).
- **PR #2 (feedback de uso):** removidos o segmento principal (`primary_segment`, coluna dropada em `20261117123000`) e a mistura de clientes por segmento no Painel Master.

### Fase 3 — Segurança da conta (PR #3)
- Página `/seguranca` (todos os papéis): troca de senha em 3 passos (`src/lib/passwordRules.ts`; encerra as outras sessões) e 2FA TOTP (ativar em 3 passos, desativar pedindo código).
- Gate de 2FA no front (`MfaGateProvider` + `MfaGate`, decisão pura em `src/lib/mfaGate.ts`): desafio no login, ativação forçada ou faixa de carência de 7 dias.
- Configurações → toggle "Exigir 2FA de owner e admin"; Equipe → "Redefinir 2FA" por membro (Edge Function `reset-user-mfa`).
- Exigidos: owner/admin de escola com `require_2fa`, e o master sempre. Financeiro e professor não.
- Migrations, aplicadas nesta ordem depois do deploy do front e do master ativar o 2FA:
  1. `20261117120000_mfa_schema_and_gate_fn.sql` — `schools.require_2fa`, `mfa_grace`, `mfa_gate_ok()`, `assert_mfa_gate()`, `start_mfa_grace()`, trigger do toggle.
  2. `20261117130000_mfa_restrictive_policies.sql` — policy RESTRICTIVE `mfa_gate` em 15 tabelas + gate na view `teachers_directory`.
  3. `20261117131000_mfa_gate_in_definer_rpcs.sql` — `assert_mfa_gate()` nas 9 RPCs `SECURITY DEFINER` com dados de escola.
- **Bypass de RLS pré-existente corrigido:** `teachers_directory` (auto-atualizável, rodando como dono) permitia ao papel `teacher` fazer UPDATE/DELETE em todos os professores da escola. Sem exposição ativa (não havia usuários `teacher`), escrita na view revogada.
- Validação: `mfa_gate_matrix.sql` 30/30, `mfa_rls_matrix.sql` 36/36, 90 testes Vitest.

### Pendente ao final da S2
- QA manual da Fase 3 (roteiro em `QA_CHECKLIST.md`): toggle por escola, troca de senha ponta a ponta e "Redefinir 2FA" com sessão autenticada ainda não verificados.
- **Tela de preferências de notificação** (prevista na S2 em `PLANO_SPRINTS_NOV2026.md`) não foi implementada — puxar para o início da S3, junto com as tabelas `notifications`/`notification_preferences`.
- Branch `fix/lp-ajustes` (blur no saldo do hero, remove selo do topo e seção de depoimento) sem PR aberto.

---

## Sprint S1 — Auditoria financeira, base de logs e novo copy da LP (2026-11-13)

Escopo definido em `docs/PLANO_SPRINTS_NOV2026.md` e `docs/PROMPT_S1_CLAUDE_CODE.md`. Fases 1 e 2 aplicadas em produção; Fase 3 só no código (sem migration).

### Fase 1 — Confiança nos números
- **Item A:** `getTuitionValue()` em `src/lib/calculations.ts` centraliza `final_amount ?? amount`; `FinancialMetrics` e `DashboardCharts` passaram a usar o helper, alinhando com Mensalidades e `ClassHealthCards`.
- **Itens B/C (decisão do usuário):** Saldo Realizado (regime de caixa, `paid_date`) como métrica principal do Dashboard, Saldo Previsto (competência, `due_date`) como apoio. Implementado em `src/lib/financialBalance.ts` (`calculateMonthlyBalance`).
- **Item D:** seletor de mês recriado no Dashboard (mesmo padrão do Kanban); Saldo, Despesas do mês e tendência seguem o mês escolhido.
- **Item G:** relatório de Rentabilidade por Turma ganhou a linha "Custos gerais da escola (não rateados)" (`unallocatedSchoolCost` em `classCost.ts`), fechando o custo total com os gerais.
- **Item H:** migration com job diário (`pg_cron`) promovendo `tuitions.status = 'pending'` vencida para `'overdue'` no banco; `isTuitionOverdue()` mantido como segurança na UI.
- **Itens F e I:** apenas listados (histórico de salário do professor com vigência; unificar valor da mensalidade) — decisão de produto pendente, não implementados nesta sprint.
- Vitest instalado (não existia antes); `src/lib/*.test.ts` cobre os helpers novos.

### Fase 2 — Base de logs (`audit_logs`)
- Tabela `audit_logs` (append-only, sem policies de UPDATE/DELETE), RLS de SELECT para owner/admin da própria escola e master admin.
- Trigger genérica `audit_trigger_fn()` (`AFTER INSERT/UPDATE/DELETE`) aplicada em 15 tabelas, registrando ator, papel, `is_master_action`, tabela, registro e diff de campos.
- Coluna `source` (`manual` / `generated` / `import`) para diferenciar lançamento manual de geração em lote (mensalidades, despesas recorrentes, importação de planilha).
- RPCs novas: `insert_generated_tuitions`, `insert_generated_expenses`, `import_teacher`, `import_student`, `import_enrollment`, `import_contract`; `save_class_with_teachers` ganhou o parâmetro `p_source`.
- `generateTuitions.ts`, `generateExpenses.ts` e `src/lib/import/execute.ts` migrados para usar essas RPCs em vez de insert direto.
- Validado em produção: despesa manual e despesa recorrente geradas em escola de teste, como master admin, confirmando `is_master_action = true` e os campos corretos no log; dados de teste removidos depois (migration de cleanup).
- `supabase gen types typescript` rodado após as migrations; `as any` removido das chamadas às RPCs novas.

### Fase 3 — Novo copy da LP
- `src/pages/Landing.tsx` reescrita conforme `docs/mockups/LP.dc.html`: copy por problema ("Quem está inadimplente?", "Essa turma dá lucro?", "Quanto sobrou este mês?"), público principal escolas do infantil ao ensino médio (técnico e idiomas como "também atende"), sem números ou depoimentos inventados (espaço reservado para depoimento real da escola piloto).
- Mudança estrutural: a seção de Preços saiu do ar e os CTAs principais passaram de "Começar grátis" (self-signup) para "Conversar com a gente" / "Quero conhecer" (contato direto) — consistente com a fase de piloto do produto, sem venda self-service ativa ainda.
- Mantidos componentes e tokens do projeto (`ui/`, `success`/`warning`/`danger`, `brand-accent`); nenhum hex do mockup foi copiado.

### Seed de dados de teste (Colégio Estrela)
Escola de teste usada na validação da Fase 2 estava com 100% das 2.105 mensalidades vencidas desde março/2026 sem nenhum pagamento, e zero despesas cadastradas — não dava pra testar nada além do "tudo zerado". Aplicado direto em produção via `supabase db query --linked` (autorizado pelo usuário nesta sessão):
- Mensalidades: histórico de pagamento plausível (~90% pagas em dia, ~6% pagas com atraso e multa, ~4% seguem vencidas). Um registro foi fixado deterministicamente como exemplar do roteiro de QA (itens 1 e 2): aluno Jonas Barbosa, turma Fund. 1A, vencimento 05/09, desconto R$ 50 + multa R$ 35, pago em 02/10 (mês diferente do vencimento).
- Despesas: 5 `recurring_expenses` (Água, Luz, Internet/Telefone, IPTU, Coordenação) com lançamentos gerados para set/out (pagos) e nov/2026 (vencido, ainda não pago) via `set_config('app.audit_source', 'generated', ...)` — mesmo mecanismo das RPCs de geração em lote. Mais 3 despesas pontuais (`source='manual'`): manutenção, marketing e material didático (essa última com rateio `per_student` na turma Fund. 1A, pra exercitar os dois métodos de rateio no relatório).
- Validado: `audit_logs` registrou as despesas geradas com `source='generated'` e as manuais com `source='manual'`, como esperado.

### Pendente ao final da sprint
- Roteiro de QA manual (ver `QA_CHECKLIST.md`) ainda precisa ser executado na prática — os dados para rodá-lo já estão prontos.

### Achados laterais registrados, não resolvidos nesta sprint
- `ClassHealthCards.tsx` não usa `classCost.ts` apesar do `CLAUDE.md` descrever essa centralização — calcula só ocupação/receita/inadimplência, não custo por turma. `CLAUDE.md` está desatualizado nesse ponto.
- `DashboardCharts.tsx` já era regime de caixa (`paid_date`) antes da Fase 1; só `FinancialMetrics.tsx` não era — agora os dois são consistentes.

---

## Schema Synchronization - [Date]

This changelog documents all changes made to sync the application code with the exact Supabase database schema.

---

## 1. Type Definitions (`src/types/index.ts`)

### Updated All Interfaces to Match Exact Schema

#### Student Interface
**Added fields:**
- `email: string | null` - Student email address
- `phone: string | null` - Student phone number
- `enrollment_date: string | null` - Date of enrollment
- `full_tuition_value: number | null` - Base tuition amount
- `discount: number | null` - Discount percentage (0-100)
- `final_tuition_value: number | null` - Calculated final tuition after discount
- `updated_at: string` - Timestamp of last update

**Changed fields:**
- `birthDate` → `birth_date` (snake_case)
- `classId` → `class_id` (snake_case)
- `guardianContact` → `guardian_contact` (snake_case)
- `createdAt` → `created_at` (snake_case)

#### Teacher Interface
**Added fields:**
- `salary: number | null` - Teacher salary
- `phone: string | null` - Teacher phone number
- `updated_at: string` - Timestamp of last update

**Changed fields:**
- `name` → `full_name` (matches schema)
- `createdAt` → `created_at` (snake_case)
- Removed `classIds` and `subject` (not in schema)

#### Class Interface
**Added fields:**
- `grade: string | null` - School grade/year (e.g., "1º Ano", "2º Ano")
- `monthly_fee: number | null` - Monthly fee for the class
- `updated_at: string` - Timestamp of last update

**Changed fields:**
- `teacherId` → `teacher_id` (snake_case)
- `maxCapacity` → `max_capacity` (snake_case)
- `createdAt` → `created_at` (snake_case)
- Removed `studentIds` (not in schema, use join instead)

#### Tuition Interface
**Added fields:**
- `contract_id: string | null` - Link to contract
- `discount_applied: number | null` - Discount amount applied
- `penalty_amount: number | null` - Penalty/late fee amount
- `final_amount: number | null` - Final calculated amount
- `updated_at: string` - Timestamp of last update

**Changed fields:**
- `studentId` → `student_id` (snake_case)
- `dueDate` → `due_date` (snake_case)
- `paidDate` → `paid_date` (snake_case)
- `paymentMethod` → `payment_method` (snake_case)
- `createdAt` → `created_at` (snake_case)
- Status now includes `"cancelled"` option

**New Interfaces Added:**
- `Contract` - Contract management between students and classes
- `Payment` - Payment tracking table
- `Profile` - User profiles linked to auth
- `ClassTeacher` - Many-to-many relationship table

---

## 2. Student Management

### StudentForm Component (`src/components/students/StudentForm.tsx`)
**Changes:**
- ✅ Added real-time calculation of `final_tuition_value`
- ✅ Shows calculated final value in readonly display box
- ✅ Form watches `full_tuition_value` and `discount` fields
- ✅ Client-side validation: discount 0-100%, full_tuition_value >= 0
- ✅ All fields use exact schema column names

**Formula:**
```typescript
final_tuition_value = full_tuition_value * (1 - discount / 100)
```

### Students Page (`src/pages/Students.tsx`)
**Changes:**
- ✅ Server-side calculation of `final_tuition_value` before insert/update
- ✅ Authoritative calculation ensures data consistency
- ✅ Query uses exact column names in select

### StudentTable Component (`src/components/students/StudentTable.tsx`)
**Changes:**
- ✅ Displays `final_tuition_value` in currency format
- ✅ Shows email and phone columns
- ✅ Uses proper snake_case field names throughout

---

## 3. Class Management

### ClassForm Component (`src/components/classes/ClassForm.tsx`)
**Changes:**
- ✅ Added `grade` field with dropdown (1º Ano through 9º Ano)
- ✅ Added `monthly_fee` field for class-level fee
- ✅ Kept `tuition_per_student` for student-level fee
- ✅ Both fee fields optional and validated >= 0
- ✅ All fields use exact schema column names

### Classes Page (`src/pages/Classes.tsx`)
**Changes:**
- ✅ Query uses exact column names
- ✅ Properly handles nullable `teacher_id`
- ✅ Student count calculation uses join

### ClassTable Component (`src/components/classes/ClassTable.tsx`)
**Changes:**
- ✅ Displays monthly revenue calculation
- ✅ Shows teacher info from joined table
- ✅ Capacity tracking with visual indicators

---

## 4. Teacher Management

### TeacherForm Component (`src/components/teachers/TeacherForm.tsx`)
**Changes:**
- ✅ Added `phone` field (optional)
- ✅ Added `salary` field (required, numeric >= 0)
- ✅ Changed name field to `full_name`
- ✅ All fields use exact schema column names

### Teachers Page & Table
**Changes:**
- ✅ Query uses `full_name` instead of `name`
- ✅ Displays salary in formatted currency
- ✅ Shows phone number in table

---

## 5. Contract & Tuition Management

### Contracts (`src/pages/Contracts.tsx`, `src/components/contracts/`)
**Status:** ✅ Already using exact schema fields
- Uses `contract_id` in tuitions
- Properly calculates with `discount` and `monthly_amount`
- Auto-generates tuitions via database function

### Tuitions (`src/pages/Tuitions.tsx`, `src/components/tuitions/`)
**Status:** ✅ Already using exact schema fields
- Displays `final_amount`, `discount_applied`, `penalty_amount`
- "Mark as paid" sets `paid_date` and status
- Overdue detection based on `due_date` vs current date

---

## 6. Utility Functions

### New File: `src/lib/calculations.ts`
**Purpose:** Centralized calculation logic for consistency

**Functions:**
- `calculateFinalTuition(baseAmount, discountPercent)` - Calculate final tuition
- `calculateTuitionWithPenalty(baseAmount, discount, penalty)` - Full calculation
- `formatCurrency(value)` - Brazilian Real formatting
- `isTuitionOverdue(dueDate, status)` - Overdue detection
- `calculateClassRevenue(tuitionPerStudent, studentCount)` - Class revenue

**Benefits:**
- Consistent calculations across all components
- Easy to test and maintain
- Single source of truth for business logic

---

## 7. Database Queries

### All queries now use exact column names:

**Students:**
```typescript
.select(`
  id, name, birth_date, email, phone, enrollment_date, 
  class_id, guardian_contact, full_tuition_value, 
  discount, final_tuition_value, status, 
  created_at, updated_at,
  classes(name)
`)
```

**Classes:**
```typescript
.select(`
  id, name, grade, description, teacher_id, 
  max_capacity, tuition_per_student, monthly_fee, 
  color, created_at, updated_at,
  teachers(full_name, specialization)
`)
```

**Teachers:**
```typescript
.select(`
  id, full_name, email, phone, specialization, 
  salary, status, created_at, updated_at
`)
```

**Contracts:**
```typescript
.select(`
  id, student_id, class_id, start_date, end_date, 
  monthly_amount, discount, status, 
  created_at, updated_at,
  students(name),
  classes(name)
`)
```

**Tuitions:**
```typescript
.select(`
  id, student_id, contract_id, amount, due_date, 
  paid_date, description, status, payment_method, 
  discount_applied, penalty_amount, final_amount, 
  created_at, updated_at,
  students(name, classes(name)),
  contracts(monthly_amount, discount)
`)
```

---

## 8. Business Rules Implemented

### Student Tuition Calculation
- ✅ Client-side real-time preview
- ✅ Server-side authoritative calculation before save
- ✅ Formula: `final_tuition_value = full_tuition_value * (1 - discount/100)`

### Contract Tuition Generation
- ✅ Database trigger automatically creates tuitions
- ✅ Uses `generate_contract_tuitions()` function
- ✅ Only generates for active contracts
- ✅ Suspended/cancelled contracts prevent future tuitions

### Overdue Detection
- ✅ UI marks tuitions as overdue if `due_date < today` and `status = 'pending'`
- ✅ Does not auto-update DB status (manual process)

### Revenue Calculations
- ✅ Class revenue: `tuition_per_student * active_student_count`
- ✅ Total revenue from tuitions with `status = 'paid'`
- ✅ Dashboard aggregates by class and period

---

## 9. Validation Rules

### Students
- ✅ `name`: required, min 2 chars
- ✅ `birth_date`: required, valid date
- ✅ `email`: required, valid email format
- ✅ `phone`: required, min 10 chars
- ✅ `full_tuition_value`: required, >= 0
- ✅ `discount`: optional, 0-100
- ✅ `guardian_contact`: required, min 10 chars

### Classes
- ✅ `name`: required, min 2 chars
- ✅ `max_capacity`: required, 1-50
- ✅ `monthly_fee`: optional, >= 0
- ✅ `tuition_per_student`: optional, >= 0
- ✅ `color`: required, hex color

### Teachers
- ✅ `full_name`: required, min 2 chars
- ✅ `email`: required, valid email, unique
- ✅ `specialization`: required, from predefined list
- ✅ `salary`: required, >= 0

### Contracts
- ✅ `student_id`: required, must exist
- ✅ `start_date`: required, date
- ✅ `end_date`: required, >= start_date
- ✅ `monthly_amount`: required, > 0
- ✅ `discount`: optional, 0-100

---

## 10. Breaking Changes

### Field Name Changes (camelCase → snake_case)
All TypeScript code updated to use snake_case matching PostgreSQL:
- `birthDate` → `birth_date`
- `classId` → `class_id`
- `studentId` → `student_id`
- `teacherId` → `teacher_id`
- `dueDate` → `due_date`
- `paidDate` → `paid_date`
- etc.

### Removed Fields
- `Teacher.classIds` - Use joins instead
- `Teacher.subject` - Replaced by `specialization`
- `Teacher.name` - Replaced by `full_name`
- `Class.studentIds` - Use joins instead

### Status Enums
- **Student/Teacher:** `"active" | "inactive"`
- **Contract:** `"active" | "suspended" | "cancelled"`
- **Tuition:** `"pending" | "paid" | "overdue" | "cancelled"`

---

## 11. Testing Checklist

See `QA_CHECKLIST.md` for comprehensive test scenarios.

---

## 12. Migration Notes

### NO DATABASE CHANGES MADE
This sync only updated application code. The database schema was already correct.

### Backward Compatibility
⚠️ **Breaking:** Old code using camelCase fields will fail. All references must be updated.

### Deployment Steps
1. Deploy updated frontend code
2. Clear browser cache (field names changed)
3. Test CRUD operations for each entity
4. Verify calculations are correct
5. Check dashboard aggregations

---

## Summary

### Files Created
- ✅ `src/lib/calculations.ts` - Utility functions
- ✅ `CHANGELOG.md` - This file
- ✅ `QA_CHECKLIST.md` - Testing guide

### Files Modified
- ✅ `src/types/index.ts` - All interface definitions
- ✅ `src/components/students/StudentForm.tsx` - Added calculation display
- ✅ `src/components/students/StudentTable.tsx` - Updated column names
- ✅ `src/pages/Students.tsx` - Server-side calculation
- ✅ `src/components/classes/ClassForm.tsx` - Added grade & monthly_fee
- ✅ `src/components/classes/ClassTable.tsx` - Updated displays
- ✅ `src/components/teachers/TeacherForm.tsx` - Added phone & salary
- ✅ `src/components/teachers/TeacherTable.tsx` - Updated column names

### Queries Updated
- ✅ All Supabase queries use exact snake_case column names
- ✅ Joins properly reference foreign tables
- ✅ No empty string values in Select components

---

**Total Changes:** 15+ files modified, 3 files created
**Backward Compatible:** ❌ No (breaking changes in field names)
**Database Changes:** ✅ None (code-only sync)
**Ready for Production:** ✅ Yes (pending QA approval)
