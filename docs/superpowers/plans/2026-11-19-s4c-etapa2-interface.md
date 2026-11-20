# S4c — Rematrícula, Etapa 2 (interface) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar a tela da rematrícula: página `/rematricula` com a decisão da família por contrato, renovação em lote com reajuste, mapa de turmas e prévia, painel-resumo em Contratos e texto do aviso apontando para a nova página.

**Architecture:** Regras de negócio em funções puras testadas (`tuitionRows.ts`, `renewal.ts`); chamadas ao servidor isoladas em `renewalApi.ts` (RPCs, lotes de 100) e `renewalData.ts` (leituras); a página e o diálogo só orquestram. A regra de mensalidades é **uma só** (extraída de `generateTuitions.ts`) e alimenta o lote e a prévia.

**Tech Stack:** React 18 + TypeScript, Vite, Vitest (+ jsdom/Testing Library nos `.test.tsx`), shadcn/ui, Supabase RPC.

**Spec:** `docs/superpowers/specs/2026-11-19-s4c-rematricula-design.md` (decisões R1–R9, seção "Etapa 2" e "Notas para a Etapa 2"). A etapa 1 (banco) **já está em produção** e `src/integrations/supabase/types.ts` já tem `renewal_decisions`, `renew_contracts` e `set_renewal_decision`.

## Contrato dos RPCs (já em produção)

- `set_renewal_decision(p_contract_id uuid, p_status text, p_reason text?, p_note text?)` → `void`. `p_status ∈ {contacted, will_renew, will_not_renew, none}`; `none` apaga; `will_not_renew` exige `p_reason ∈ {moved_city, price, changed_school, other}`. Erros (em `error.message`): `NOT_ALLOWED`, `INVALID_STATUS`, `INVALID_CONTRACT`, `REASON_REQUIRED`, `MFA_REQUIRED`.
- `renew_contracts(p_school_id uuid, p_items jsonb, p_fee_service_id uuid?)` → `{ renewed, tuitions, skipped: [{source_contract_id, reason: 'ALREADY_RENEWED'}] }`. 1 a 100 itens por chamada, atômica. Item: `{ source_contract_id, class_id (uuid|null), monthly_amount, start_date, end_date, tuitions: [{ due_date, amount, status ('pending'|'overdue'), description }] }`. O servidor herda `discount`, `due_day` e `period` do contrato de origem, exige `start_date = end_date da origem + 1 dia` e duração ≤ 24 meses, e confere `amount` contra `monthly_amount × (1 − discount/100)` com tolerância de R$ 0,01. Erros: `NOT_ALLOWED`, `INVALID_ITEMS`, `INVALID_ITEM` (com `error.details` citando o contrato), `INVALID_SERVICE`, `MFA_REQUIRED`.

## Rulings do plano (desvios deliberados da spec)

- **Menu:** o item "Rematrícula" entra no grupo **Financeiro**, logo depois de "Contratos" (a spec dizia "Gestão", mas Contratos mora em Financeiro). Mesmos papéis (`admin`, `financial`). Custo se errado: só a posição do item.
- **Mensagens de erro dos RPCs ficam em `renewalApi.ts`**, não em `friendlyError.ts`: `NOT_ALLOWED` já significa "preferências de notificação" lá.
- **`enrollments` continua intocada** (spec, riscos). O aviso de capacidade usa a contagem de **contratos ativos por turma**, não `enrollments`.
- **Leitura sem paginação do servidor:** o Supabase devolve no máximo 1000 linhas por consulta; no tamanho atual das escolas basta. Registrado como limite conhecido.

## Notas do cliente (da revisão final da etapa 1) — valem para todo o plano

- Enviar `class_id: null`, **nunca** string vazia (daria erro cru 22P02).
- Datas sempre com `toDateStr`/`parseLocalDate` de `src/lib/dateUtils.ts`, **nunca** `toISOString()`.
- Desconto, dia de vencimento e período vêm do contrato de **origem** (o lote não usa valores de formulário).
- `monthly_amount` arredondado a centavos; `amount` de cada mensalidade = valor final arredondado a centavos.
- Observação da decisão limitada a 500 caracteres na interface (`maxLength`).

## Global Constraints

- Textos em português do Brasil, com acentuação correta.
- Valores em reais sempre via `formatCurrency` de `src/lib/calculations.ts`; entrada de dinheiro via `CurrencyInput` (`src/components/ui/currency-input.tsx`).
- Cores só por tokens/classes do tema e componentes de `src/components/ui/`, nunca hex.
- Estado/seleção nunca só por cor: texto no selo, rótulo acessível (`aria-label`) nos controles.
- Toda consulta filtra `school_id` explicitamente (CLAUDE.md), mesmo com RLS.
- A regra de mensalidades existe **uma vez** (`buildTuitionRows`); proibido reimplementá-la.
- Nenhuma tela muda para quem não tem acesso: a rota é `allowedRoles={['admin', 'financial']}` e o item de menu usa os mesmos papéis.
- Testes: `npx vitest run` e `npm run build` verdes ao final de cada tarefa (hoje: 164 testes). Erros antigos de `tsc` (StudentForm, generateTuitions/Expenses `Json`, import/execute, Tuitions) **não** são desta etapa; não os piore.
- Commits em português; o hook `commit-msg` do repositório remove `Co-Authored-By: Claude` de propósito (não contornar). Nunca commitar os arquivos soltos do working tree (`RUBRICA_AVALIACAO.md`, `docs/RESUMO_SPRINT_S1_CLAUDE_PROJECT.md`, `docs/backups/`, `docs/designs/`). Push e PR só com o aval do usuário.
- Nada nesta etapa grava em produção por conta própria; o QA no navegador usa a escola de teste e **só com autorização** (a página renova contratos de verdade).

---

### Task 1: Extrair a regra de mensalidades (`tuitionRows.ts`)

**Files:**
- Create: `src/lib/tuitionRows.ts`
- Create: `src/lib/tuitionRows.test.ts`
- Modify: `src/lib/generateTuitions.ts` (a parte que monta as linhas passa a usar o módulo novo)

**Interfaces:**
- Produces:
  - `interface TuitionRowInput { startDate: string; endDate: string; dueDay: number; finalAmount: number }`
  - `interface BuiltTuitionRow { due_date: string; amount: number; status: 'pending' | 'overdue'; description: string }`
  - `buildTuitionRows(input: TuitionRowInput, today: Date, existingDates?: Set<string>): BuiltTuitionRow[]` — `today` já normalizada à meia-noite local; `existingDates` = vencimentos que já existem (idempotência).

- [ ] **Step 1: Escrever os testes que falham**

```ts
// src/lib/tuitionRows.test.ts
import { describe, it, expect } from 'vitest';
import { buildTuitionRows } from './tuitionRows';

const base = { startDate: '2031-03-01', endDate: '2032-02-29', dueDay: 5, finalAmount: 99 };
const monthName = (y: number, m: number) =>
  new Date(y, m, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

describe('buildTuitionRows', () => {
  it('gera 12 mensalidades de março/2031 a fevereiro/2032, no dia 5', () => {
    const rows = buildTuitionRows(base, new Date(2031, 0, 15));
    expect(rows).toHaveLength(12);
    expect(rows[0].due_date).toBe('2031-03-05');
    expect(rows[11].due_date).toBe('2032-02-05');
    expect(rows.every((r) => r.amount === 99)).toBe(true);
    expect(rows[0].description).toBe(`Mensalidade ${monthName(2031, 2)}`);
  });

  it('status: vencida (overdue) se já passou de hoje, senão pendente', () => {
    const rows = buildTuitionRows(base, new Date(2031, 4, 10)); // 10/05/2031
    expect(rows.filter((r) => r.status === 'overdue').map((r) => r.due_date)).toEqual(['2031-03-05', '2031-04-05', '2031-05-05']);
    expect(rows.find((r) => r.due_date === '2031-06-05')?.status).toBe('pending');
  });

  it('ajusta o vencimento ao último dia do mês (dia 31 em fevereiro, ano comum e bissexto)', () => {
    const rows = buildTuitionRows({ ...base, startDate: '2031-01-01', endDate: '2032-03-31', dueDay: 31 }, new Date(2030, 0, 1));
    expect(rows.find((r) => r.due_date.startsWith('2031-02'))?.due_date).toBe('2031-02-28');
    expect(rows.find((r) => r.due_date.startsWith('2032-02'))?.due_date).toBe('2032-02-29');
  });

  it('ignora o mês cujo vencimento cai antes do início do contrato', () => {
    // começa dia 20 com vencimento dia 5: a 1ª mensalidade é a do mês seguinte
    const rows = buildTuitionRows({ ...base, startDate: '2031-03-20', endDate: '2031-06-30' }, new Date(2031, 0, 1));
    expect(rows.map((r) => r.due_date)).toEqual(['2031-04-05', '2031-05-05', '2031-06-05']);
  });

  it('ignora o mês cujo vencimento cai depois do fim do contrato', () => {
    const rows = buildTuitionRows({ ...base, startDate: '2031-03-01', endDate: '2031-05-03' }, new Date(2031, 0, 1));
    expect(rows.map((r) => r.due_date)).toEqual(['2031-03-05', '2031-04-05']);
  });

  it('idempotente: não repete vencimentos já existentes', () => {
    const rows = buildTuitionRows(base, new Date(2031, 0, 1), new Set(['2031-03-05', '2031-04-05']));
    expect(rows).toHaveLength(10);
    expect(rows[0].due_date).toBe('2031-05-05');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/tuitionRows.test.ts 2>&1 | grep -E "Tests |FAIL|Error"`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar `tuitionRows.ts`** (porta fiel do laço de `generateTuitions.ts`, linhas ~46-90)

```ts
// src/lib/tuitionRows.ts
// Regra ÚNICA de geração das mensalidades de um contrato (extraída de generateTuitions.ts).
// Usada pela geração individual e pela renovação em lote (prévia + RPC): nunca reimplementar.
import { parseLocalDate, toDateStr } from '@/lib/dateUtils';

export interface TuitionRowInput {
  startDate: string; // 'YYYY-MM-DD'
  endDate: string;   // 'YYYY-MM-DD'
  dueDay: number;    // dia do mês do vencimento
  finalAmount: number;
}

export interface BuiltTuitionRow {
  due_date: string;
  amount: number;
  status: 'pending' | 'overdue';
  description: string;
}

/**
 * Monta as mensalidades de um contrato, mês a mês.
 * @param today meia-noite local de "hoje" (vencida = vencimento anterior a hoje)
 * @param existingDates vencimentos que já existem; são pulados (idempotência)
 */
export function buildTuitionRows(
  input: TuitionRowInput,
  today: Date,
  existingDates: Set<string> = new Set(),
): BuiltTuitionRow[] {
  const start = parseLocalDate(input.startDate);
  const end = parseLocalDate(input.endDate);
  const rows: BuiltTuitionRow[] = [];

  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (
    cursor.getFullYear() < end.getFullYear() ||
    (cursor.getFullYear() === end.getFullYear() && cursor.getMonth() <= end.getMonth())
  ) {
    // Vencimento no último dia do mês quando o dia não existe (ex.: dia 31 em fevereiro).
    const lastDay = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const day = Math.min(input.dueDay, lastDay);
    const dueDate = new Date(cursor.getFullYear(), cursor.getMonth(), day);

    // Só vale o mês cujo vencimento cai dentro do contrato (um contrato que começa dia 20 com
    // vencimento dia 5 não ganha uma mensalidade vencida antes da matrícula).
    if (dueDate >= start && dueDate <= end) {
      const dueDateStr = toDateStr(dueDate);
      if (!existingDates.has(dueDateStr)) {
        rows.push({
          due_date: dueDateStr,
          amount: input.finalAmount,
          status: dueDate < today ? 'overdue' : 'pending',
          description: `Mensalidade ${cursor.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}`,
        });
      }
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return rows;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/tuitionRows.test.ts 2>&1 | grep -E "Tests |FAIL"` → todos passam. Se o teste de `description` falhar por diferença de ICU entre ambientes, ajuste só a expectativa (ela já usa o mesmo `toLocaleDateString` do código).

- [ ] **Step 5: Refatorar `generateTuitions.ts` para usar o módulo**

Em `src/lib/generateTuitions.ts`: importar `buildTuitionRows`; **remover** do laço o bloco entre `// 3. Build list of months...` e o fim do `while`, e montar `toInsert` assim (mantendo os passos 1, 2 e 4 como estão):

```ts
import { buildTuitionRows } from '@/lib/tuitionRows';
// ...
  // 3. Linhas de mensalidade (regra única em tuitionRows.ts)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const toInsert: object[] = buildTuitionRows(
    { startDate: start_date, endDate: end_date, dueDay: due_day, finalAmount: final_amount },
    today,
    existingDates,
  ).map((r) => ({
    contract_id: contractId,
    student_id,
    school_id,
    amount: r.amount,
    final_amount: null,       // preenchido quando o pagamento é confirmado
    due_date: r.due_date,
    status: r.status,
    description: r.description,
  }));
```
Remover o import de `toDateStr` se ficar sem uso. O comportamento (linhas inseridas, status, descrição) não muda.

- [ ] **Step 6: Verificar**

Run: `npx vitest run 2>&1 | grep -E "Test Files|Tests |FAIL"` e `npm run build 2>&1 | grep -E "built in|error"` → verdes. `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep generateTuitions` não pode trazer erro **novo** (o `Json` antigo na chamada do RPC já existia).

- [ ] **Step 7: Commit**

```bash
git add src/lib/tuitionRows.ts src/lib/tuitionRows.test.ts src/lib/generateTuitions.ts
git commit -m "Regra de mensalidades extraída para tuitionRows.ts (usada pela geração e, depois, pela renovação em lote)"
```

---

### Task 2: Regras da renovação (`renewal.ts`)

**Files:**
- Create: `src/lib/renewal.ts`
- Create: `src/lib/renewal.test.ts`
- Modify: `src/components/contracts/ContractForm.tsx` (`handleRenew` passa a usar `nextTerm`)

**Interfaces:**
- Consumes: `buildTuitionRows`, `BuiltTuitionRow` (Task 1); `parseLocalDate`, `toDateStr` (`@/lib/dateUtils`).
- Produces (todos exportados de `src/lib/renewal.ts`):
  - tipos: `DecisionStatus = 'contacted' | 'will_renew' | 'will_not_renew'`; `DecisionReason = 'moved_city' | 'price' | 'changed_school' | 'other'`; `RenewalState = 'none' | 'renewed' | DecisionStatus`
  - `interface RenewalContract { id: string; student_id: string; student_name: string; class_id: string | null; class_name: string | null; start_date: string; end_date: string; monthly_amount: number; discount: number; due_day: number; period: string }`
  - `interface DecisionRow { contract_id: string; status: DecisionStatus; reason: DecisionReason | null; note: string | null }`
  - `interface RenewalClass { id: string; name: string; max_capacity: number | null }`
  - `interface RpcTuition { due_date: string; amount: number; status: 'pending' | 'overdue'; description: string }`
  - `interface RpcItem { source_contract_id: string; class_id: string | null; monthly_amount: number; start_date: string; end_date: string; tuitions: RpcTuition[] }`
  - `interface PlanRow { contractId: string; studentName: string; fromClassId: string | null; toClassId: string | null; currentMonthly: number; newMonthly: number; monthlyEdited: boolean; classChanged: boolean; start: string; end: string; tuitionCount: number; error: 'INVALID_AMOUNT' | 'NO_TUITIONS' | null }`
  - `interface PlanOptions { pct: number; classMap: Record<string, string | null>; overrides: Record<string, { classId?: string | null; monthly?: number }>; today: Date }`
  - `STATE_LABELS: Record<RenewalState, string>`, `REASON_LABELS: Record<DecisionReason, string>`
  - `classKey(id: string | null): string` (`''` para sem turma)
  - `round2(n: number): number`, `applyAdjustment(value: number, pct: number): number`, `finalAmountOf(monthly: number, discount: number | null | undefined): number`
  - `nextTerm(sourceEndDate: string): { start: string; end: string }`
  - `buildRenewalPlan(sources: RenewalContract[], opts: PlanOptions): { rows: PlanRow[]; items: RpcItem[]; totals: { contracts: number; tuitions: number; monthlyTotal: number } }`
  - `capacityWarnings(rows: PlanRow[], classes: RenewalClass[], activeByClass: Record<string, number>): { classId: string; className: string; projected: number; max: number }[]`
  - `renewalState(contractId: string, decisions: Record<string, DecisionRow>, renewedIds: Set<string>): RenewalState`
  - `summarizeWindow(contracts: RenewalContract[], decisions: Record<string, DecisionRow>, renewedIds: Set<string>): Record<RenewalState, number>`
  - `chunk<T>(items: T[], size: number): T[][]`

- [ ] **Step 1: Escrever os testes que falham**

```ts
// src/lib/renewal.test.ts
import { describe, it, expect } from 'vitest';
import {
  applyAdjustment, buildRenewalPlan, capacityWarnings, chunk, finalAmountOf, nextTerm,
  renewalState, summarizeWindow, type DecisionRow, type RenewalClass, type RenewalContract,
} from './renewal';

const src = (o: Partial<RenewalContract> = {}): RenewalContract => ({
  id: 'k1', student_id: 'st1', student_name: 'Ana', class_id: 'c1', class_name: '5º A',
  start_date: '2030-03-01', end_date: '2031-02-28', monthly_amount: 100, discount: 10, due_day: 5, period: 'integral', ...o,
});
const today = new Date(2031, 0, 15);
const opts = (o: Partial<Parameters<typeof buildRenewalPlan>[1]> = {}) => ({ pct: 10, classMap: {}, overrides: {}, today, ...o });

describe('nextTerm', () => {
  it('começa no dia seguinte e termina no último dia do 12º mês', () => {
    expect(nextTerm('2031-02-28')).toEqual({ start: '2031-03-01', end: '2032-02-29' });
    expect(nextTerm('2031-12-31')).toEqual({ start: '2032-01-01', end: '2032-12-31' });
    expect(nextTerm('2032-02-29')).toEqual({ start: '2032-03-01', end: '2033-02-28' });
  });
});

describe('valores', () => {
  it('applyAdjustment arredonda a centavos', () => {
    expect(applyAdjustment(100, 8)).toBe(108);
    expect(applyAdjustment(99.99, 8)).toBe(107.99);
    expect(applyAdjustment(100, 0)).toBe(100);
    expect(applyAdjustment(100, -10)).toBe(90);
  });
  it('finalAmountOf espelha monthly_amount * (1 - discount/100)', () => {
    expect(finalAmountOf(110, 10)).toBeCloseTo(99, 10);
    expect(finalAmountOf(200, 0)).toBe(200);
    expect(finalAmountOf(100, null)).toBe(100);
  });
});

describe('buildRenewalPlan', () => {
  it('reajusta, mantém a turma e gera o item do RPC com as mensalidades', () => {
    const { rows, items, totals } = buildRenewalPlan([src()], opts());
    expect(rows[0]).toMatchObject({ contractId: 'k1', fromClassId: 'c1', toClassId: 'c1', currentMonthly: 100, newMonthly: 110, monthlyEdited: false, classChanged: false, start: '2031-03-01', end: '2032-02-29', tuitionCount: 12, error: null });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ source_contract_id: 'k1', class_id: 'c1', monthly_amount: 110, start_date: '2031-03-01', end_date: '2032-02-29' });
    expect(items[0].tuitions).toHaveLength(12);
    expect(items[0].tuitions[0]).toMatchObject({ due_date: '2031-03-05', amount: 99, status: 'pending' });
    expect(totals).toEqual({ contracts: 1, tuitions: 12, monthlyTotal: 110 });
  });

  it('mapa de turmas: a turma de origem vai para o destino; null (sem turma) usa a chave ""', () => {
    const a = buildRenewalPlan([src(), src({ id: 'k2', class_id: null, class_name: null })], opts({ classMap: { c1: 'c2', '': 'c9' } }));
    expect(a.rows.map((r) => r.toClassId)).toEqual(['c2', 'c9']);
    expect(a.rows[0].classChanged).toBe(true);
    expect(a.items.map((i) => i.class_id)).toEqual(['c2', 'c9']);
  });

  it('turma sem mapeamento fica igual; override por linha vence o mapa (inclusive para null)', () => {
    const a = buildRenewalPlan([src()], opts());
    expect(a.items[0].class_id).toBe('c1');
    const b = buildRenewalPlan([src()], opts({ classMap: { c1: 'c2' }, overrides: { k1: { classId: null } } }));
    expect(b.items[0].class_id).toBeNull(); // null, nunca string vazia
    expect(b.rows[0].classChanged).toBe(true);
  });

  it('valor editado à mão não muda quando o percentual muda', () => {
    const edited = { k1: { monthly: 123.45 } };
    const a = buildRenewalPlan([src(), src({ id: 'k2' })], opts({ pct: 5, overrides: edited }));
    const b = buildRenewalPlan([src(), src({ id: 'k2' })], opts({ pct: 20, overrides: edited }));
    expect(a.rows[0]).toMatchObject({ newMonthly: 123.45, monthlyEdited: true });
    expect(b.rows[0].newMonthly).toBe(123.45);
    expect(a.rows[1].newMonthly).toBe(105);
    expect(b.rows[1].newMonthly).toBe(120);
  });

  it('valor zero ou negativo marca erro e fica fora dos itens', () => {
    const { rows, items, totals } = buildRenewalPlan([src(), src({ id: 'k2' })], opts({ overrides: { k1: { monthly: 0 } } }));
    expect(rows[0].error).toBe('INVALID_AMOUNT');
    expect(items.map((i) => i.source_contract_id)).toEqual(['k2']);
    expect(totals.contracts).toBe(1);
  });

  it('mensalidades vencidas se "hoje" é depois do vencimento', () => {
    const { items } = buildRenewalPlan([src()], opts({ today: new Date(2031, 4, 10) }));
    expect(items[0].tuitions.filter((t) => t.status === 'overdue')).toHaveLength(3);
  });

  it('o valor da mensalidade é o final arredondado a centavos (desconto com centavos)', () => {
    const { items } = buildRenewalPlan([src({ monthly_amount: 100.05, discount: 10 })], opts({ pct: 0 }));
    expect(items[0].monthly_amount).toBe(100.05);
    expect(items[0].tuitions[0].amount).toBe(90.05); // 100.05 * 0.9 = 90.045 -> 90.05
  });
});

describe('capacityWarnings', () => {
  const classes: RenewalClass[] = [
    { id: 'c1', name: '5º A', max_capacity: 2 },
    { id: 'c2', name: '6º A', max_capacity: 1 },
    { id: 'c3', name: '7º A', max_capacity: null },
  ];
  it('avisa quando a turma de destino passaria da capacidade; quem sai libera vaga', () => {
    const { rows } = buildRenewalPlan([src({ id: 'a' }), src({ id: 'b' })], opts({ classMap: { c1: 'c2' } }));
    const w = capacityWarnings(rows, classes, { c1: 2, c2: 1 });
    expect(w).toEqual([{ classId: 'c2', className: '6º A', projected: 3, max: 1 }]);
  });
  it('sem capacidade cadastrada ou sem troca de turma: sem aviso', () => {
    const stay = buildRenewalPlan([src()], opts()).rows;
    expect(capacityWarnings(stay, classes, { c1: 2 })).toEqual([]);
    const toNoCap = buildRenewalPlan([src()], opts({ classMap: { c1: 'c3' } })).rows;
    expect(capacityWarnings(toNoCap, classes, { c1: 2, c3: 99 })).toEqual([]);
  });
});

describe('estado da decisão', () => {
  const decisions: Record<string, DecisionRow> = {
    a: { contract_id: 'a', status: 'will_renew', reason: null, note: null },
    b: { contract_id: 'b', status: 'will_not_renew', reason: 'price', note: null },
  };
  it('renovado vence a decisão gravada; sem registro = none', () => {
    const renewed = new Set(['b']);
    expect(renewalState('a', decisions, renewed)).toBe('will_renew');
    expect(renewalState('b', decisions, renewed)).toBe('renewed');
    expect(renewalState('z', decisions, renewed)).toBe('none');
  });
  it('summarizeWindow conta cada estado', () => {
    const cs = [src({ id: 'a' }), src({ id: 'b' }), src({ id: 'c' }), src({ id: 'd' })];
    const s = summarizeWindow(cs, { ...decisions, c: { contract_id: 'c', status: 'contacted', reason: null, note: null } }, new Set(['b']));
    expect(s).toEqual({ none: 1, contacted: 1, will_renew: 1, will_not_renew: 0, renewed: 1 });
  });
});

describe('chunk', () => {
  it('divide em lotes', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([1, 2], 100)).toEqual([[1, 2]]);
    expect(chunk([], 3)).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/renewal.test.ts 2>&1 | grep -E "Tests |FAIL|Error"` → FAIL (módulo não existe).

- [ ] **Step 3: Implementar `renewal.ts`**

```ts
// src/lib/renewal.ts
// Regras puras da rematrícula (S4c). Sem acesso a rede: tudo testável no Vitest.
import { parseLocalDate, toDateStr } from '@/lib/dateUtils';
import { buildTuitionRows } from '@/lib/tuitionRows';

export type DecisionStatus = 'contacted' | 'will_renew' | 'will_not_renew';
export type DecisionReason = 'moved_city' | 'price' | 'changed_school' | 'other';
export type RenewalState = 'none' | 'renewed' | DecisionStatus;

export const STATE_LABELS: Record<RenewalState, string> = {
  none: 'Sem resposta',
  contacted: 'Contatado',
  will_renew: 'Vai renovar',
  will_not_renew: 'Não vai renovar',
  renewed: 'Renovado',
};

export const REASON_LABELS: Record<DecisionReason, string> = {
  moved_city: 'Mudança de cidade',
  price: 'Preço',
  changed_school: 'Mudou de escola',
  other: 'Outro',
};

export interface RenewalContract {
  id: string;
  student_id: string;
  student_name: string;
  class_id: string | null;
  class_name: string | null;
  start_date: string;
  end_date: string;
  monthly_amount: number;
  discount: number;
  due_day: number;
  period: string;
}

export interface DecisionRow {
  contract_id: string;
  status: DecisionStatus;
  reason: DecisionReason | null;
  note: string | null;
}

export interface RenewalClass {
  id: string;
  name: string;
  max_capacity: number | null;
}

export interface RpcTuition {
  due_date: string;
  amount: number;
  status: 'pending' | 'overdue';
  description: string;
}

export interface RpcItem {
  source_contract_id: string;
  class_id: string | null;
  monthly_amount: number;
  start_date: string;
  end_date: string;
  tuitions: RpcTuition[];
}

export interface PlanRow {
  contractId: string;
  studentName: string;
  fromClassId: string | null;
  toClassId: string | null;
  currentMonthly: number;
  newMonthly: number;
  monthlyEdited: boolean;
  classChanged: boolean;
  start: string;
  end: string;
  tuitionCount: number;
  error: 'INVALID_AMOUNT' | 'NO_TUITIONS' | null;
}

export interface PlanOptions {
  pct: number;
  classMap: Record<string, string | null>;
  overrides: Record<string, { classId?: string | null; monthly?: number }>;
  today: Date;
}

/** Chave de turma de origem; "sem turma" usa a string vazia. */
export const classKey = (id: string | null): string => id ?? '';

export const round2 = (n: number): number => Math.round(n * 100) / 100;

export const applyAdjustment = (value: number, pct: number): number => round2(value * (1 + pct / 100));

/** Espelha a coluna gerada contracts.final_amount (sem arredondar). */
export const finalAmountOf = (monthly: number, discount: number | null | undefined): number =>
  monthly * (1 - (discount ?? 0) / 100);

/** Mesma regra de ContractForm.handleRenew: começa no dia seguinte, termina no último dia do 12º mês. */
export function nextTerm(sourceEndDate: string): { start: string; end: string } {
  const end0 = parseLocalDate(sourceEndDate);
  const start = new Date(end0.getFullYear(), end0.getMonth(), end0.getDate() + 1);
  const end = new Date(start.getFullYear(), start.getMonth() + 12, 0);
  return { start: toDateStr(start), end: toDateStr(end) };
}

export function buildRenewalPlan(sources: RenewalContract[], opts: PlanOptions) {
  const rows: PlanRow[] = [];
  const items: RpcItem[] = [];

  for (const s of sources) {
    const ov = opts.overrides[s.id] ?? {};
    const key = classKey(s.class_id);
    const toClassId: string | null =
      ov.classId !== undefined ? ov.classId : key in opts.classMap ? opts.classMap[key] : s.class_id;
    const monthlyEdited = ov.monthly !== undefined;
    const newMonthly = round2(monthlyEdited ? (ov.monthly as number) : applyAdjustment(s.monthly_amount, opts.pct));
    const { start, end } = nextTerm(s.end_date);

    let error: PlanRow['error'] = null;
    let tuitions: RpcTuition[] = [];
    if (!(newMonthly > 0)) {
      error = 'INVALID_AMOUNT';
    } else {
      tuitions = buildTuitionRows(
        { startDate: start, endDate: end, dueDay: s.due_day, finalAmount: round2(finalAmountOf(newMonthly, s.discount)) },
        opts.today,
      );
      if (tuitions.length === 0) error = 'NO_TUITIONS';
    }

    rows.push({
      contractId: s.id,
      studentName: s.student_name,
      fromClassId: s.class_id,
      toClassId,
      currentMonthly: s.monthly_amount,
      newMonthly,
      monthlyEdited,
      classChanged: toClassId !== s.class_id,
      start,
      end,
      tuitionCount: tuitions.length,
      error,
    });
    if (!error) {
      items.push({
        source_contract_id: s.id,
        class_id: toClassId, // null ou uuid; nunca string vazia
        monthly_amount: newMonthly,
        start_date: start,
        end_date: end,
        tuitions: tuitions.map((t) => ({ due_date: t.due_date, amount: t.amount, status: t.status, description: t.description })),
      });
    }
  }

  const valid = rows.filter((r) => !r.error);
  return {
    rows,
    items,
    totals: {
      contracts: valid.length,
      tuitions: valid.reduce((n, r) => n + r.tuitionCount, 0),
      monthlyTotal: round2(valid.reduce((n, r) => n + r.newMonthly, 0)),
    },
  };
}

/** Turmas de destino que passariam da capacidade (contratos ativos − quem sai + quem chega). */
export function capacityWarnings(rows: PlanRow[], classes: RenewalClass[], activeByClass: Record<string, number>) {
  const valid = rows.filter((r) => !r.error);
  const out: { classId: string; className: string; projected: number; max: number }[] = [];
  for (const c of classes) {
    if (c.max_capacity == null) continue;
    const leaving = valid.filter((r) => r.fromClassId === c.id && r.toClassId !== c.id).length;
    const arriving = valid.filter((r) => r.toClassId === c.id && r.fromClassId !== c.id).length;
    const projected = (activeByClass[c.id] ?? 0) - leaving + arriving;
    if (arriving > 0 && projected > c.max_capacity) {
      out.push({ classId: c.id, className: c.name, projected, max: c.max_capacity });
    }
  }
  return out;
}

export function renewalState(
  contractId: string,
  decisions: Record<string, DecisionRow>,
  renewedIds: Set<string>,
): RenewalState {
  if (renewedIds.has(contractId)) return 'renewed';
  return decisions[contractId]?.status ?? 'none';
}

export function summarizeWindow(
  contracts: RenewalContract[],
  decisions: Record<string, DecisionRow>,
  renewedIds: Set<string>,
): Record<RenewalState, number> {
  const out: Record<RenewalState, number> = { none: 0, contacted: 0, will_renew: 0, will_not_renew: 0, renewed: 0 };
  for (const c of contracts) out[renewalState(c.id, decisions, renewedIds)] += 1;
  return out;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/renewal.test.ts 2>&1 | grep -E "Tests |FAIL"` → todos passam. O caso do desconto com centavos depende de `round2(100.05*0.9)`: 90.045 → `Math.round(9004.5)` = 9005 → 90.05. Se o ponto flutuante der 90.04 (100.05*0.9 = 90.04499999999999), ajuste a **expectativa** para o valor que `round2` realmente produz e deixe um comentário: o servidor aceita diferença de até R$ 0,01.

- [ ] **Step 5: `handleRenew` usa `nextTerm`**

Em `src/components/contracts/ContractForm.tsx`: importar `nextTerm` de `@/lib/renewal` e trocar o cálculo de datas (linhas ~271-278) por:

```tsx
      // Encadeia a partir do término real do contrato atual (regra única em renewal.ts)
      const { start: newStartStr, end: newEndStr } = nextTerm(contract.end_date);
```
e usar `newStartStr`/`newEndStr` em `start_date`/`end_date` do `renewalData` (linhas ~289-290) e `due_date: newStartStr` da cobrança da taxa (linha ~319). Remover as variáveis `oldEnd`, `newStart`, `newEnd` e, se ficarem sem uso, os imports de `toDateStr`. Nenhuma outra mudança de comportamento.

- [ ] **Step 6: Verificar e commitar**

Run: `npx vitest run 2>&1 | grep -E "Test Files|Tests |FAIL"` e `npm run build 2>&1 | grep -E "built in|error"` → verdes.

```bash
git add src/lib/renewal.ts src/lib/renewal.test.ts src/components/contracts/ContractForm.tsx
git commit -m "Regras da rematrícula (renewal.ts): prazo, reajuste, plano do lote, capacidade e estado derivado"
```

---

### Task 3: Cliente dos RPCs (`renewalApi.ts`) e leitura (`renewalData.ts`)

**Files:**
- Create: `src/lib/renewalApi.ts`
- Create: `src/lib/renewalApi.test.ts`
- Create: `src/lib/renewalData.ts`

**Interfaces:**
- Consumes: `chunk`, `RpcItem`, `DecisionStatus`, `DecisionReason`, `DecisionRow`, `RenewalContract`, `RenewalClass` (Task 2); `getFriendlyErrorMessage` (`@/lib/friendlyError`).
- Produces:
  - `friendlyRenewalError(error: unknown): string`
  - `setRenewalDecision(contractId: string, status: DecisionStatus | 'none', reason?: DecisionReason | null, note?: string | null): Promise<void>` — lança `Error` com mensagem amigável
  - `interface RenewResult { renewed: number; tuitions: number; skipped: { source_contract_id: string; reason: string }[]; processed: number; total: number; error: string | null }`
  - `renewContracts(schoolId: string, items: RpcItem[], feeServiceId?: string | null): Promise<RenewResult>` — lotes sequenciais de 100; **para no primeiro erro** e devolve o que já foi feito
  - `interface RenewalService { id: string; name: string; price: number }`
  - `interface RenewalData { contracts: RenewalContract[]; renewedIds: Set<string>; decisions: Record<string, DecisionRow>; classes: RenewalClass[]; activeByClass: Record<string, number>; services: RenewalService[] }`
  - `fetchRenewalData(schoolId: string, windowDays: number, today?: Date): Promise<RenewalData>`

- [ ] **Step 1: Testes que falham (`renewalApi`)**

```ts
// src/lib/renewalApi.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc } }));

import { friendlyRenewalError, renewContracts, setRenewalDecision } from './renewalApi';
import type { RpcItem } from './renewal';

const item = (i: number): RpcItem => ({
  source_contract_id: `k${i}`, class_id: null, monthly_amount: 100, start_date: '2031-03-01', end_date: '2032-02-29',
  tuitions: [{ due_date: '2031-03-05', amount: 90, status: 'pending', description: 'Mensalidade março de 2031' }],
});
const items = (n: number) => Array.from({ length: n }, (_, i) => item(i));

beforeEach(() => rpc.mockReset());

describe('friendlyRenewalError', () => {
  it('traduz os códigos dos RPCs', () => {
    expect(friendlyRenewalError({ message: 'REASON_REQUIRED' })).toMatch(/motivo/i);
    expect(friendlyRenewalError({ message: 'NOT_ALLOWED' })).toMatch(/perfil/i);
    expect(friendlyRenewalError({ message: 'INVALID_CONTRACT' })).toMatch(/renovado|inativo|encontrado/i);
    expect(friendlyRenewalError({ message: 'INVALID_SERVICE' })).toMatch(/taxa/i);
    expect(friendlyRenewalError({ message: 'MFA_REQUIRED' })).toMatch(/2FA|duas etapas/i);
  });
  it('INVALID_ITEM inclui o detalhe do servidor', () => {
    expect(friendlyRenewalError({ message: 'INVALID_ITEM', details: 'Contrato abc: valor mensal inválido.' })).toContain('Contrato abc: valor mensal inválido.');
  });
  it('erro desconhecido cai numa mensagem genérica', () => {
    expect(friendlyRenewalError({ message: 'algo estranho' })).toBeTruthy();
  });
});

describe('setRenewalDecision', () => {
  it('chama o RPC com os parâmetros certos (motivo/observação nulos viram undefined)', async () => {
    rpc.mockResolvedValue({ error: null });
    await setRenewalDecision('k1', 'will_renew');
    expect(rpc).toHaveBeenCalledWith('set_renewal_decision', { p_contract_id: 'k1', p_status: 'will_renew', p_reason: undefined, p_note: undefined });
    await setRenewalDecision('k2', 'will_not_renew', 'price', 'caro');
    expect(rpc).toHaveBeenLastCalledWith('set_renewal_decision', { p_contract_id: 'k2', p_status: 'will_not_renew', p_reason: 'price', p_note: 'caro' });
  });
  it('erro do servidor vira Error com mensagem amigável', async () => {
    rpc.mockResolvedValue({ error: { message: 'REASON_REQUIRED' } });
    await expect(setRenewalDecision('k1', 'will_not_renew')).rejects.toThrow(/motivo/i);
  });
});

describe('renewContracts', () => {
  it('divide em lotes de 100 e soma os resultados', async () => {
    rpc.mockResolvedValueOnce({ data: { renewed: 100, tuitions: 100, skipped: [] }, error: null })
       .mockResolvedValueOnce({ data: { renewed: 99, tuitions: 99, skipped: [{ source_contract_id: 'k150', reason: 'ALREADY_RENEWED' }] }, error: null })
       .mockResolvedValueOnce({ data: { renewed: 50, tuitions: 50, skipped: [] }, error: null });
    const r = await renewContracts('s1', items(250), 'svc1');
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc.mock.calls.map((c) => (c[1].p_items as unknown[]).length)).toEqual([100, 100, 50]);
    expect(rpc.mock.calls[0][0]).toBe('renew_contracts');
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_school_id: 's1', p_fee_service_id: 'svc1' });
    expect(r).toMatchObject({ renewed: 249, tuitions: 249, processed: 250, total: 250, error: null });
    expect(r.skipped).toEqual([{ source_contract_id: 'k150', reason: 'ALREADY_RENEWED' }]);
  });
  it('sem taxa envia p_fee_service_id undefined', async () => {
    rpc.mockResolvedValue({ data: { renewed: 1, tuitions: 1, skipped: [] }, error: null });
    await renewContracts('s1', items(1), null);
    expect(rpc.mock.calls[0][1].p_fee_service_id).toBeUndefined();
  });
  it('para no primeiro erro e devolve o que já foi renovado', async () => {
    rpc.mockResolvedValueOnce({ data: { renewed: 100, tuitions: 100, skipped: [] }, error: null })
       .mockResolvedValueOnce({ data: null, error: { message: 'INVALID_ITEM', details: 'Contrato k130: mensalidade fora do período do contrato.' } });
    const r = await renewContracts('s1', items(250), null);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ renewed: 100, tuitions: 100, processed: 100, total: 250 });
    expect(r.error).toContain('Contrato k130');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/renewalApi.test.ts 2>&1 | grep -E "Tests |FAIL|Error"` → FAIL.

- [ ] **Step 3: Implementar `renewalApi.ts`**

```ts
// src/lib/renewalApi.ts
// Cliente dos RPCs da rematrícula (S4c). school_id só vai de renew_contracts (p_school_id, validado no servidor).
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { getFriendlyErrorMessage } from '@/lib/friendlyError';
import { chunk, type DecisionReason, type DecisionStatus, type RpcItem } from '@/lib/renewal';

const BATCH_SIZE = 100;

const RPC_MESSAGES: Record<string, string> = {
  MFA_REQUIRED: 'Esta conta precisa da verificação em duas etapas (2FA) para continuar.',
  NOT_ALLOWED: 'Seu perfil não pode alterar a rematrícula.',
  INVALID_STATUS: 'Estado de rematrícula inválido. Recarregue a página e tente de novo.',
  INVALID_CONTRACT: 'Contrato não encontrado, inativo ou já renovado. Recarregue a página.',
  REASON_REQUIRED: 'Informe o motivo de a família não renovar.',
  INVALID_ITEMS: 'O lote precisa ter de 1 a 100 contratos.',
  INVALID_SERVICE: 'A taxa de rematrícula escolhida não está disponível. Escolha outra ou desmarque a taxa.',
};

export function friendlyRenewalError(error: unknown): string {
  const e = error as { message?: string; details?: string } | null;
  const code = (e?.message ?? '').trim();
  if (code === 'INVALID_ITEM') {
    return `Um contrato do lote foi recusado pelo servidor${e?.details ? `: ${e.details}` : '.'}`;
  }
  if (RPC_MESSAGES[code]) return RPC_MESSAGES[code];
  return getFriendlyErrorMessage(error, 'Não foi possível concluir a operação. Tente novamente.');
}

export async function setRenewalDecision(
  contractId: string,
  status: DecisionStatus | 'none',
  reason?: DecisionReason | null,
  note?: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('set_renewal_decision', {
    p_contract_id: contractId,
    p_status: status,
    p_reason: reason ?? undefined,
    p_note: note ?? undefined,
  });
  if (error) throw new Error(friendlyRenewalError(error));
}

export interface RenewResult {
  renewed: number;
  tuitions: number;
  skipped: { source_contract_id: string; reason: string }[];
  processed: number;
  total: number;
  error: string | null;
}

/** Renova em lotes sequenciais de 100 (cada chamada é atômica). Para no 1º erro e devolve o que já passou. */
export async function renewContracts(
  schoolId: string,
  items: RpcItem[],
  feeServiceId?: string | null,
): Promise<RenewResult> {
  const result: RenewResult = { renewed: 0, tuitions: 0, skipped: [], processed: 0, total: items.length, error: null };
  for (const batch of chunk(items, BATCH_SIZE)) {
    const { data, error } = await supabase.rpc('renew_contracts', {
      p_school_id: schoolId,
      p_items: batch as unknown as Json,
      p_fee_service_id: feeServiceId ?? undefined,
    });
    if (error) {
      result.error = friendlyRenewalError(error);
      return result;
    }
    const d = data as { renewed: number; tuitions: number; skipped: { source_contract_id: string; reason: string }[] };
    result.renewed += d.renewed;
    result.tuitions += d.tuitions;
    result.skipped.push(...d.skipped);
    result.processed += batch.length;
  }
  return result;
}
```

- [ ] **Step 4: Implementar `renewalData.ts`** (leituras; sem teste de unidade — é só consulta, coberta pelas telas com mock e pelo QA)

```ts
// src/lib/renewalData.ts
// Leituras da tela de rematrícula. Toda consulta filtra school_id (CLAUDE.md), mesmo com RLS.
import { supabase } from '@/integrations/supabase/client';
import { toDateStr } from '@/lib/dateUtils';
import type { DecisionRow, RenewalClass, RenewalContract } from '@/lib/renewal';

export interface RenewalService { id: string; name: string; price: number }

export interface RenewalData {
  contracts: RenewalContract[];
  renewedIds: Set<string>;
  decisions: Record<string, DecisionRow>;
  classes: RenewalClass[];
  activeByClass: Record<string, number>;
  services: RenewalService[];
}

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

/** Contratos ATIVOS que terminam até hoje + windowDays (inclui os já vencidos e ainda ativos). */
export async function fetchRenewalData(schoolId: string, windowDays: number, today: Date = new Date()): Promise<RenewalData> {
  const cutoff = toDateStr(new Date(today.getFullYear(), today.getMonth(), today.getDate() + windowDays));

  const [contractsRes, successorsRes, decisionsRes, classesRes, servicesRes, activeRes] = await Promise.all([
    supabase
      .from('contracts')
      .select('id, student_id, class_id, start_date, end_date, monthly_amount, discount, due_day, period, students(name, full_name), classes(name)')
      .eq('school_id', schoolId)
      .eq('status', 'active')
      .lte('end_date', cutoff)
      .order('end_date', { ascending: true }),
    supabase.from('contracts').select('renewed_from_id').eq('school_id', schoolId).not('renewed_from_id', 'is', null).neq('status', 'cancelled'),
    supabase.from('renewal_decisions').select('contract_id, status, reason, note').eq('school_id', schoolId),
    supabase.from('classes').select('id, name, max_capacity').eq('school_id', schoolId).order('name'),
    (supabase as any).from('school_services').select('id, name, price').eq('school_id', schoolId).eq('active', true).eq('type', 'avulso').order('name'),
    supabase.from('contracts').select('class_id').eq('school_id', schoolId).eq('status', 'active'),
  ]);
  for (const r of [contractsRes, successorsRes, decisionsRes, classesRes, servicesRes, activeRes]) {
    if (r.error) throw r.error;
  }

  const contracts: RenewalContract[] = (contractsRes.data ?? []).map((c: any) => {
    const st = one<{ name: string | null; full_name: string }>(c.students);
    const cl = one<{ name: string }>(c.classes);
    return {
      id: c.id,
      student_id: c.student_id,
      student_name: st?.full_name || st?.name || 'N/A',
      class_id: c.class_id,
      class_name: cl?.name ?? null,
      start_date: c.start_date,
      end_date: c.end_date,
      monthly_amount: Number(c.monthly_amount),
      discount: Number(c.discount),
      due_day: Number(c.due_day),
      period: c.period,
    };
  });

  const renewedIds = new Set<string>((successorsRes.data ?? []).map((r: any) => r.renewed_from_id as string));
  const decisions: Record<string, DecisionRow> = {};
  for (const d of decisionsRes.data ?? []) decisions[d.contract_id] = d as DecisionRow;
  const activeByClass: Record<string, number> = {};
  for (const a of activeRes.data ?? []) if (a.class_id) activeByClass[a.class_id] = (activeByClass[a.class_id] ?? 0) + 1;

  return {
    contracts,
    renewedIds,
    decisions,
    classes: (classesRes.data ?? []).map((c: any) => ({ id: c.id, name: c.name, max_capacity: c.max_capacity ?? null })),
    activeByClass,
    services: (servicesRes.data ?? []).map((s: any) => ({ id: s.id, name: s.name, price: Number(s.price) })),
  };
}
```

- [ ] **Step 5: Verificar e commitar**

Run: `npx vitest run src/lib/renewalApi.test.ts 2>&1 | grep -E "Tests |FAIL"` → passa. `npm run build 2>&1 | grep -E "built in|error"` e `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -E "renewal"` (sem erro novo nos arquivos `renewal*`).

```bash
git add src/lib/renewalApi.ts src/lib/renewalApi.test.ts src/lib/renewalData.ts
git commit -m "Cliente dos RPCs da rematrícula (lotes de 100, erros amigáveis) e leitura dos dados da tela"
```

---

### Task 4: Texto do aviso de rematrícula

**Files:**
- Modify: `supabase/functions/_shared/notificationText.ts` (caso `reenrollment`, linhas ~100-109)
- Modify: `src/lib/notificationText.test.ts` (caso `reenrollment`, linhas ~55-64)
- Modify: `supabase/functions/_shared/notificationEmail.test.ts` (linha ~37)
- Modify: `src/pages/Notifications.test.tsx` (linhas ~103-104)

**Interfaces:**
- Consumes: `details.declined_count` do aviso (já gerado em produção pela etapa 1).
- Produces: ação do evento `reenrollment` = rótulo **"Abrir rematrícula"**, caminho **`/rematricula`**; subtítulo `"6 já rematriculados · 3 não vão renovar · 9 pendentes"` (o trecho "não vão renovar" só quando `declined_count > 0`; pendentes = contratos − renovados − recusados).

- [ ] **Step 1: Atualizar os testes (devem falhar antes da implementação)**

Em `src/lib/notificationText.test.ts`, substituir o teste `'reenrollment com rematriculados e pendentes'` por:

```ts
  it('reenrollment com rematriculados, recusados e pendentes', () => {
    const v = describeNotification(mk({ event: 'reenrollment', item_count: 18, offset_days: 45, total_amount: null, details: { renewed_count: 6 } }));
    expect(v.title).toBe('18 contratos terminam em 45 dias');
    expect(v.subtitle).toBe('6 já rematriculados · 12 pendentes');
    expect(v.category).toBe('rematricula');
    expect(v.actionLabel).toBe('Abrir rematrícula');
    expect(v.actionPath).toBe('/rematricula');
    const withDeclined = describeNotification(mk({ event: 'reenrollment', item_count: 18, offset_days: 45, total_amount: null, details: { renewed_count: 6, declined_count: 3 } }));
    expect(withDeclined.subtitle).toBe('6 já rematriculados · 3 não vão renovar · 9 pendentes');
    const one = describeNotification(mk({ event: 'reenrollment', item_count: 3, offset_days: 45, total_amount: null, details: { renewed_count: 1, declined_count: 1 } }));
    expect(one.subtitle).toBe('1 já rematriculado · 1 não vai renovar · 1 pendente');
    expect(describeNotification(mk({ event: 'reenrollment', item_count: 1, offset_days: 1, details: { renewed_count: 0 } })).title)
      .toBe('1 contrato termina amanhã');
  });
```

Em `supabase/functions/_shared/notificationEmail.test.ts` trocar `'/contratos'` por `'/rematricula'` na linha do caso `reenrollment`. Em `src/pages/Notifications.test.tsx` trocar `name: 'Ver contratos'` por `name: 'Abrir rematrícula'` e `toHaveBeenCalledWith('/contratos')` por `toHaveBeenCalledWith('/rematricula')`.

Run: `npx vitest run src/lib/notificationText.test.ts src/pages/Notifications.test.tsx supabase/functions/_shared/notificationEmail.test.ts 2>&1 | grep -E "Tests |FAIL"` → FAIL (texto antigo).

- [ ] **Step 2: Implementar** — em `supabase/functions/_shared/notificationText.ts` substituir o caso `'reenrollment'` por:

```ts
    case 'reenrollment': {
      const renewed = Number(n.details.renewed_count ?? 0);
      const declined = Number(n.details.declined_count ?? 0);
      const pending = c - renewed - declined;
      const parts = [`${renewed} ${plural(renewed, 'já rematriculado', 'já rematriculados')}`];
      if (declined > 0) parts.push(`${declined} ${plural(declined, 'não vai renovar', 'não vão renovar')}`);
      parts.push(`${pending} ${plural(pending, 'pendente', 'pendentes')}`);
      return {
        title: `${c} ${plural(c, 'contrato', 'contratos')} ${plural(c, 'termina', 'terminam')} ${when(n.offset_days)}`,
        subtitle: parts.join(' · '),
        category: 'rematricula', categoryLabel: CATEGORY_LABELS.rematricula,
        actionLabel: 'Abrir rematrícula', actionPath: '/rematricula',
      };
    }
```

- [ ] **Step 3: Verificar e commitar**

Run: `npx vitest run 2>&1 | grep -E "Test Files|Tests |FAIL"` e `npm run build 2>&1 | grep -E "built in|error"` → verdes.

```bash
git add supabase/functions/_shared/notificationText.ts src/lib/notificationText.test.ts supabase/functions/_shared/notificationEmail.test.ts src/pages/Notifications.test.tsx
git commit -m "Aviso de rematrícula: botão \"Abrir rematrícula\" (/rematricula) e contagem dos que não vão renovar"
```

---

### Task 5: Página `/rematricula` (lista, filtros, decisão da família)

**Files:**
- Create: `src/pages/Renewal.tsx`
- Create: `src/components/renewal/RenewalTable.tsx`
- Create: `src/components/renewal/DecisionDialog.tsx`
- Create: `src/pages/Renewal.test.tsx`
- Modify: `src/App.tsx` (rota), `src/components/layout/AppSidebar.tsx` (item de menu), `src/components/layout/Layout.tsx` (título)

**Interfaces:**
- Consumes: tudo de `renewal.ts`, `renewalApi.ts` (`setRenewalDecision`), `renewalData.ts` (`fetchRenewalData`, `RenewalData`); `useSchool` (`@/contexts/SchoolContext`), `useToast`.
- Produces:
  - `export default function Renewal()` (página)
  - `RenewalTable` props: `{ rows: { contract: RenewalContract; state: RenewalState }[]; selected: Set<string>; onToggle(id: string): void; onTogglePage(ids: string[], checked: boolean): void; onChangeState(c: RenewalContract, s: RenewalState): void }`
  - `DecisionDialog` props: `{ contract: RenewalContract | null; onConfirm(reason: DecisionReason, note: string): void; onCancel(): void; saving: boolean }`
  - Slot para a Task 6: a página renderiza `<BatchRenewalDialog … />` (criado na Task 6); **nesta tarefa o botão "Renovar selecionados" já existe mas abre um diálogo ainda inexistente** → para o build fechar, a Task 5 cria `src/components/renewal/BatchRenewalDialog.tsx` como **stub** (`export function BatchRenewalDialog(_: BatchRenewalDialogProps) { return null; }` com a interface `BatchRenewalDialogProps` final, abaixo) e a Task 6 o substitui.

`BatchRenewalDialogProps` (final, definida já aqui):
```ts
export interface BatchRenewalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sources: RenewalContract[];
  classes: RenewalClass[];
  activeByClass: Record<string, number>;
  services: RenewalService[];
  schoolId: string;
  onDone: () => void; // recarrega a lista depois de renovar
}
```

- [ ] **Step 1: Rota, menu e título**

`src/App.tsx`: importar `Renewal from "./pages/Renewal"` e acrescentar, logo depois do bloco de `/contratos`:

```tsx
                <Route
                  path="/rematricula"
                  element={
                    <ProtectedRoute requireSchool allowedRoles={['admin', 'financial']}>
                      <Layout>
                        <Renewal />
                      </Layout>
                    </ProtectedRoute>
                  }
                />
```
`src/components/layout/AppSidebar.tsx`: adicionar `RefreshCw` ao import de `lucide-react` e, no grupo **Financeiro**, depois do item "Contratos":
`{ title: "Rematrícula", url: "/rematricula", icon: RefreshCw, roles: ['admin', 'financial'] },`
`src/components/layout/Layout.tsx`: em `PAGE_TITLES` acrescentar `"/rematricula": "Rematrícula",`.

- [ ] **Step 2: Teste que falha (`Renewal.test.tsx`)**

```tsx
// src/pages/Renewal.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { RenewalData } from '@/lib/renewalData';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), setDecision: vi.fn() }));
vi.mock('@/lib/renewalData', () => ({ fetchRenewalData: mocks.fetch }));
vi.mock('@/lib/renewalApi', async () => ({
  ...(await vi.importActual<typeof import('@/lib/renewalApi')>('@/lib/renewalApi')),
  setRenewalDecision: mocks.setDecision,
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: vi.fn() } }));
vi.mock('@/contexts/SchoolContext', () => ({ useSchool: () => ({ schoolId: 's1', school: { id: 's1' } }) }));

import Renewal from './Renewal';

const contract = (id: string, name: string, o: Record<string, unknown> = {}) => ({
  id, student_id: `st-${id}`, student_name: name, class_id: 'c1', class_name: '5º A', start_date: '2030-03-01', end_date: '2031-02-28',
  monthly_amount: 100, discount: 10, due_day: 5, period: 'integral', ...o,
});
const data = (o: Partial<RenewalData> = {}): RenewalData => ({
  contracts: [contract('a', 'Ana'), contract('b', 'Bruno'), contract('c', 'Carla'), contract('d', 'Davi')] as never,
  renewedIds: new Set(['d']),
  decisions: {
    b: { contract_id: 'b', status: 'will_renew', reason: null, note: null },
    c: { contract_id: 'c', status: 'will_not_renew', reason: 'price', note: null },
  },
  classes: [{ id: 'c1', name: '5º A', max_capacity: 30 }],
  activeByClass: { c1: 4 },
  services: [],
  ...o,
});

const renderPage = () => render(<MemoryRouter><Renewal /></MemoryRouter>);

beforeEach(() => {
  // Radix Select/Dialog em jsdom
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never;
  mocks.fetch.mockResolvedValue(data());
  mocks.setDecision.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Página de rematrícula', () => {
  it('lista os contratos da janela e o resumo por estado', async () => {
    renderPage();
    expect(await screen.findByText('Ana')).toBeTruthy();
    expect(screen.getByText('Bruno')).toBeTruthy();
    expect(screen.getByText('Carla')).toBeTruthy();
    expect(screen.getByText('Davi')).toBeTruthy();
    expect(mocks.fetch).toHaveBeenCalledWith('s1', 90);
    // resumo: 1 sem resposta (Ana), 1 vai renovar, 1 não vai, 1 renovado
    expect(screen.getByTestId('summary-none').textContent).toContain('1');
    expect(screen.getByTestId('summary-will_renew').textContent).toContain('1');
    expect(screen.getByTestId('summary-will_not_renew').textContent).toContain('1');
    expect(screen.getByTestId('summary-renewed').textContent).toContain('1');
  });

  it('"Renovado" é um selo de texto e a linha não é selecionável; "não vai renovar" também não', async () => {
    renderPage();
    await screen.findByText('Ana');
    const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;
    expect(within(rowOf('Davi')).getByText('Renovado')).toBeTruthy();
    expect((within(rowOf('Davi')).getByRole('checkbox') as HTMLInputElement).disabled || within(rowOf('Davi')).getByRole('checkbox').getAttribute('data-disabled') !== null).toBe(true);
    expect(within(rowOf('Carla')).getByRole('checkbox').getAttribute('data-disabled') !== null || (within(rowOf('Carla')).getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
  });

  it('quem "vai renovar" já vem selecionado e o botão mostra a contagem', async () => {
    renderPage();
    await screen.findByText('Ana');
    expect(screen.getByRole('button', { name: /Renovar selecionados \(1\)/ })).toBeTruthy();
  });

  it('marcar outro contrato atualiza a contagem; "Selecionar todos que vão renovar" seleciona só os que vão', async () => {
    renderPage();
    await screen.findByText('Ana');
    await userEvent.click(within(screen.getByText('Ana').closest('tr') as HTMLElement).getByRole('checkbox'));
    expect(screen.getByRole('button', { name: /Renovar selecionados \(2\)/ })).toBeTruthy();
  });

  it('filtra por estado e por busca', async () => {
    renderPage();
    await screen.findByText('Ana');
    await userEvent.type(screen.getByPlaceholderText('Buscar aluno...'), 'bru');
    expect(screen.queryByText('Ana')).toBeNull();
    expect(screen.getByText('Bruno')).toBeTruthy();
  });

  it('estado vazio e erro com "Tentar de novo"', async () => {
    mocks.fetch.mockResolvedValueOnce(data({ contracts: [] }));
    renderPage();
    expect(await screen.findByText('Nenhum contrato termina nesta janela.')).toBeTruthy();
    cleanup();
    mocks.fetch.mockRejectedValueOnce(new Error('boom'));
    renderPage();
    expect(await screen.findByText('Não foi possível carregar a rematrícula.')).toBeTruthy();
    mocks.fetch.mockResolvedValueOnce(data());
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Ana')).toBeTruthy();
  });

  it('mudar o estado de Ana para "Contatado" chama o RPC e recarrega', async () => {
    renderPage();
    await screen.findByText('Ana');
    const row = screen.getByText('Ana').closest('tr') as HTMLElement;
    await userEvent.click(within(row).getByRole('combobox', { name: /Estado de Ana/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'Contatado' }));
    await waitFor(() => expect(mocks.setDecision).toHaveBeenCalledWith('a', 'contacted'));
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
  });

  it('"Não vai renovar" abre o diálogo e exige o motivo', async () => {
    renderPage();
    await screen.findByText('Ana');
    const row = screen.getByText('Ana').closest('tr') as HTMLElement;
    await userEvent.click(within(row).getByRole('combobox', { name: /Estado de Ana/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'Não vai renovar' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('combobox', { name: 'Motivo' })).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: 'Salvar' }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.setDecision).not.toHaveBeenCalled();
  });
});
```

Run: `npx vitest run src/pages/Renewal.test.tsx 2>&1 | grep -E "Tests |FAIL|Error"` → FAIL (página não existe). Se o teste da seleção do `Checkbox` (Radix, `role="checkbox"` em `<button>`, desabilitado via `data-disabled`/`disabled`) divergir do esperado, ajuste só o seletor do teste, não o comportamento.

- [ ] **Step 3: `DecisionDialog.tsx`**

```tsx
// src/components/renewal/DecisionDialog.tsx
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { REASON_LABELS, type DecisionReason, type RenewalContract } from '@/lib/renewal';

interface Props {
  contract: RenewalContract | null;
  saving: boolean;
  onConfirm: (reason: DecisionReason, note: string) => void;
  onCancel: () => void;
}

export function DecisionDialog({ contract, saving, onConfirm, onCancel }: Props) {
  const [reason, setReason] = useState<DecisionReason | ''>('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (contract) { setReason(''); setNote(''); }
  }, [contract]);

  return (
    <Dialog open={!!contract} onOpenChange={(o) => { if (!o && !saving) onCancel(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Não vai renovar</DialogTitle>
          <DialogDescription>
            {contract ? `Registre por que a família de ${contract.student_name} não vai renovar. O contrato continua ativo até o fim.` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="renewal-reason">Motivo</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as DecisionReason)}>
              <SelectTrigger id="renewal-reason" aria-label="Motivo">
                <SelectValue placeholder="Escolha o motivo" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(REASON_LABELS) as DecisionReason[]).map((r) => (
                  <SelectItem key={r} value={r}>{REASON_LABELS[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="renewal-note">Observação (opcional)</Label>
            <Textarea id="renewal-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} rows={3} />
            <p className="text-xs text-muted-foreground">{note.length}/500</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={saving}>Cancelar</Button>
          <Button onClick={() => reason && onConfirm(reason, note)} disabled={!reason || saving}>
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```
(Confirme que `@/components/ui/label` existe: `ls src/components/ui/label.tsx`; se não existir, use `<label>` simples com as mesmas classes.)

- [ ] **Step 4: `RenewalTable.tsx`**

```tsx
// src/components/renewal/RenewalTable.tsx
import { format, parseISO } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency } from '@/lib/calculations';
import { STATE_LABELS, type RenewalContract, type RenewalState } from '@/lib/renewal';

export interface RenewalRowData { contract: RenewalContract; state: RenewalState }

interface Props {
  rows: RenewalRowData[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onTogglePage: (ids: string[], checked: boolean) => void;
  onChangeState: (c: RenewalContract, s: RenewalState) => void;
}

const EDITABLE: RenewalState[] = ['none', 'contacted', 'will_renew', 'will_not_renew'];
const selectable = (s: RenewalState) => s !== 'renewed' && s !== 'will_not_renew';

export function RenewalTable({ rows, selected, onToggle, onTogglePage, onChangeState }: Props) {
  const selectableIds = rows.filter((r) => selectable(r.state)).map((r) => r.contract.id);
  const allChecked = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">
            <Checkbox
              aria-label="Selecionar todos desta página"
              checked={allChecked}
              disabled={selectableIds.length === 0}
              onCheckedChange={(v) => onTogglePage(selectableIds, v === true)}
            />
          </TableHead>
          <TableHead>Aluno</TableHead>
          <TableHead>Turma</TableHead>
          <TableHead>Término</TableHead>
          <TableHead>Valor atual</TableHead>
          <TableHead className="w-[190px]">Estado</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ contract: c, state }) => (
          <TableRow key={c.id}>
            <TableCell>
              <Checkbox
                aria-label={`Selecionar ${c.student_name}`}
                checked={selected.has(c.id)}
                disabled={!selectable(state)}
                onCheckedChange={() => onToggle(c.id)}
              />
            </TableCell>
            <TableCell className="font-medium">{c.student_name}</TableCell>
            <TableCell>{c.class_name ?? 'Sem turma'}</TableCell>
            <TableCell>{format(parseISO(c.end_date), 'dd/MM/yyyy')}</TableCell>
            <TableCell>{formatCurrency(c.monthly_amount)}</TableCell>
            <TableCell>
              {state === 'renewed' ? (
                <Badge variant="secondary">{STATE_LABELS.renewed}</Badge>
              ) : (
                <Select value={state} onValueChange={(v) => onChangeState(c, v as RenewalState)}>
                  <SelectTrigger aria-label={`Estado de ${c.student_name}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EDITABLE.map((s) => (
                      <SelectItem key={s} value={s}>{STATE_LABELS[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 5: Stub do `BatchRenewalDialog.tsx`** (a Task 6 o substitui)

```tsx
// src/components/renewal/BatchRenewalDialog.tsx  (STUB da Task 5; substituído na Task 6)
import type { RenewalClass, RenewalContract } from '@/lib/renewal';
import type { RenewalService } from '@/lib/renewalData';

export interface BatchRenewalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sources: RenewalContract[];
  classes: RenewalClass[];
  activeByClass: Record<string, number>;
  services: RenewalService[];
  schoolId: string;
  onDone: () => void;
}

export function BatchRenewalDialog(_props: BatchRenewalDialogProps) {
  return null;
}
```

- [ ] **Step 6: `Renewal.tsx` (a página)**

```tsx
// src/pages/Renewal.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useSchool } from '@/contexts/SchoolContext';
import { BatchRenewalDialog } from '@/components/renewal/BatchRenewalDialog';
import { DecisionDialog } from '@/components/renewal/DecisionDialog';
import { RenewalTable } from '@/components/renewal/RenewalTable';
import { fetchRenewalData, type RenewalData } from '@/lib/renewalData';
import { setRenewalDecision } from '@/lib/renewalApi';
import {
  STATE_LABELS, renewalState, summarizeWindow,
  type DecisionReason, type RenewalContract, type RenewalState,
} from '@/lib/renewal';

const WINDOWS = [30, 60, 90, 180];
const PAGE_SIZE = 30;
const SUMMARY: RenewalState[] = ['renewed', 'will_renew', 'contacted', 'will_not_renew', 'none'];
const canSelect = (s: RenewalState) => s !== 'renewed' && s !== 'will_not_renew';

const Renewal = () => {
  const { schoolId } = useSchool();
  const { toast } = useToast();
  const [windowDays, setWindowDays] = useState(90);
  const [data, setData] = useState<RenewalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [classFilter, setClassFilter] = useState('all');
  const [stateFilter, setStateFilter] = useState<'all' | RenewalState>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [declining, setDeclining] = useState<RenewalContract | null>(null);
  const [saving, setSaving] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const preselected = useRef(false);

  const load = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    setError(false);
    try {
      const d = await fetchRenewalData(schoolId, windowDays);
      setData(d);
      setSelected((prev) => {
        const ok = (id: string) => {
          const c = d.contracts.find((x) => x.id === id);
          return !!c && canSelect(renewalState(id, d.decisions, d.renewedIds));
        };
        if (!preselected.current) {
          preselected.current = true;
          return new Set(d.contracts.filter((c) => renewalState(c.id, d.decisions, d.renewedIds) === 'will_renew').map((c) => c.id));
        }
        return new Set([...prev].filter(ok)); // mantém a seleção, poda quem deixou de poder ser renovado
      });
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [schoolId, windowDays]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [classFilter, stateFilter, search, windowDays]);

  const states = useMemo(() => {
    const m = new Map<string, RenewalState>();
    if (data) for (const c of data.contracts) m.set(c.id, renewalState(c.id, data.decisions, data.renewedIds));
    return m;
  }, [data]);

  const summary = useMemo(
    () => (data ? summarizeWindow(data.contracts, data.decisions, data.renewedIds) : null),
    [data],
  );

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.contracts
      .filter((c) => (classFilter === 'all' ? true : classFilter === 'none' ? c.class_id === null : c.class_id === classFilter))
      .filter((c) => (stateFilter === 'all' ? true : states.get(c.id) === stateFilter))
      .filter((c) => !q || c.student_name.toLowerCase().includes(q))
      .map((c) => ({ contract: c, state: states.get(c.id) ?? ('none' as RenewalState) }));
  }, [data, classFilter, stateFilter, search, states]);

  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const selectedContracts = useMemo(
    () => (data ? data.contracts.filter((c) => selected.has(c.id)) : []),
    [data, selected],
  );

  const toggle = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const togglePage = (ids: string[], checked: boolean) =>
    setSelected((prev) => { const n = new Set(prev); ids.forEach((id) => (checked ? n.add(id) : n.delete(id))); return n; });
  const selectAllWilling = () =>
    setSelected(new Set((data?.contracts ?? []).filter((c) => states.get(c.id) === 'will_renew').map((c) => c.id)));

  const changeState = async (c: RenewalContract, s: RenewalState) => {
    if (s === 'will_not_renew') { setDeclining(c); return; }
    try {
      await setRenewalDecision(c.id, s === 'none' ? 'none' : (s as 'contacted' | 'will_renew'));
      setSelected((prev) => { const n = new Set(prev); s === 'will_renew' ? n.add(c.id) : n.delete(c.id); return n; });
      await load();
    } catch (e) {
      toast({ title: 'Erro', description: (e as Error).message, variant: 'destructive' });
    }
  };

  const confirmDecline = async (reason: DecisionReason, note: string) => {
    if (!declining) return;
    setSaving(true);
    try {
      await setRenewalDecision(declining.id, 'will_not_renew', reason, note.trim() || null);
      setSelected((prev) => { const n = new Set(prev); n.delete(declining.id); return n; });
      setDeclining(null);
      await load();
    } catch (e) {
      toast({ title: 'Erro', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Rematrícula</h1>
          <p className="text-muted-foreground">Acompanhe a decisão das famílias e renove os contratos em lote</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={selectAllWilling} disabled={!data}>
            Selecionar todos que vão renovar
          </Button>
          <Button onClick={() => setBatchOpen(true)} disabled={selectedContracts.length === 0}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Renovar selecionados ({selectedContracts.length})
          </Button>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {SUMMARY.map((s) => (
            <Card key={s} data-testid={`summary-${s}`}>
              <CardContent className="p-4">
                <div className="text-2xl font-bold">{summary[s]}</div>
                <p className="text-sm text-muted-foreground">{STATE_LABELS[s]}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader className="border-b p-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative min-w-[200px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Buscar aluno..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={String(windowDays)} onValueChange={(v) => setWindowDays(Number(v))}>
              <SelectTrigger className="w-[170px]" aria-label="Janela"><SelectValue /></SelectTrigger>
              <SelectContent>
                {WINDOWS.map((w) => <SelectItem key={w} value={String(w)}>Próximos {w} dias</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={classFilter} onValueChange={setClassFilter}>
              <SelectTrigger className="w-[170px]" aria-label="Turma"><SelectValue placeholder="Turma" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as turmas</SelectItem>
                <SelectItem value="none">Sem turma</SelectItem>
                {(data?.classes ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={stateFilter} onValueChange={(v) => setStateFilter(v as 'all' | RenewalState)}>
              <SelectTrigger className="w-[170px]" aria-label="Estado"><SelectValue placeholder="Estado" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os estados</SelectItem>
                {(Object.keys(STATE_LABELS) as RenewalState[]).map((s) => <SelectItem key={s} value={s}>{STATE_LABELS[s]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading && !data ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Carregando…</div>
          ) : error ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <p className="font-medium">Não foi possível carregar a rematrícula.</p>
              <Button variant="outline" onClick={load}>Tentar de novo</Button>
            </div>
          ) : data && data.contracts.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">Nenhum contrato termina nesta janela.</div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">Nenhum contrato com esses filtros.</div>
          ) : (
            <>
              <RenewalTable rows={pageRows} selected={selected} onToggle={toggle} onTogglePage={togglePage} onChangeState={changeState} />
              <div className="flex items-center justify-between gap-3 border-t p-3 text-sm text-muted-foreground">
                <span>{filtered.length} contrato{filtered.length !== 1 ? 's' : ''}</span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
                  <span>Página {page} de {pages}</span>
                  <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <DecisionDialog contract={declining} saving={saving} onConfirm={confirmDecline} onCancel={() => setDeclining(null)} />

      {data && schoolId && (
        <BatchRenewalDialog
          open={batchOpen}
          onOpenChange={setBatchOpen}
          sources={selectedContracts}
          classes={data.classes}
          activeByClass={data.activeByClass}
          services={data.services}
          schoolId={schoolId}
          onDone={load}
        />
      )}
    </div>
  );
};

export default Renewal;
```

- [ ] **Step 7: Rodar e ver passar**

Run: `npx vitest run src/pages/Renewal.test.tsx 2>&1 | grep -E "Tests |FAIL|Error"` → passa. Se algum seletor do Radix divergir, ajuste o **teste** (não o comportamento). Depois: `npx vitest run 2>&1 | grep -E "Test Files|Tests |FAIL"` e `npm run build 2>&1 | grep -E "built in|error"` → verdes.

- [ ] **Step 8: Commit**

```bash
git add src/pages/Renewal.tsx src/pages/Renewal.test.tsx src/components/renewal src/App.tsx src/components/layout/AppSidebar.tsx src/components/layout/Layout.tsx
git commit -m "Página de rematrícula: lista da janela, filtros, resumo por estado e decisão da família (com diálogo de motivo)"
```

---

### Task 6: Renovação em lote (diálogo com reajuste, mapa de turmas e prévia)

**Files:**
- Modify (substituir o stub): `src/components/renewal/BatchRenewalDialog.tsx`
- Create: `src/components/renewal/BatchRenewalDialog.test.tsx`

**Interfaces:**
- Consumes: `BatchRenewalDialogProps` (Task 5, exatamente a mesma interface); `buildRenewalPlan`, `capacityWarnings`, `classKey`, `round2`, `RenewalContract`, `RenewalClass`, `PlanRow` (`renewal.ts`); `renewContracts`, `RenewResult` (`renewalApi.ts`); `RenewalService` (`renewalData.ts`); `CurrencyInput`; `formatCurrency`.
- Produces: o diálogo completo. Estados: `config` → `preview` → `running` → `done`. Ao fechar depois de `done` chama `onDone()`.

Comportamento (da spec, R2, R7, R8):
- **Configuração:** reajuste em % (campo texto com vírgula ou ponto; válido entre −99,99 e 200), taxa de rematrícula (select: "Sem taxa" + serviços avulsos ativos) e o **mapa de turmas**: uma linha por turma de origem presente na seleção, com "vai para…" (padrão = a mesma turma; opção "Sem turma").
- **Prévia:** tabela com aluno, turma origem → destino (select por linha), valor atual → novo (`CurrencyInput` por linha), período novo e nº de mensalidades; totais no rodapé (contratos, mensalidades, soma mensal); aviso de capacidade (`Alert`, não bloqueia); linhas com erro de valor ficam marcadas e **bloqueiam** o botão de confirmar.
- **Confirmar:** "Renovar N contratos" → `renewContracts(schoolId, plan.items, taxa)`; mostra resultado (renovados, mensalidades, pulados, e se houve erro: "Foram renovados X de Y antes do erro: …").

- [ ] **Step 1: Teste que falha**

```tsx
// src/components/renewal/BatchRenewalDialog.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({ renew: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: vi.fn() } }));
vi.mock('@/lib/renewalApi', async () => ({
  ...(await vi.importActual<typeof import('@/lib/renewalApi')>('@/lib/renewalApi')),
  renewContracts: mocks.renew,
}));

import { BatchRenewalDialog } from './BatchRenewalDialog';
import type { RenewalContract } from '@/lib/renewal';

const c = (id: string, name: string, o: Partial<RenewalContract> = {}): RenewalContract => ({
  id, student_id: `st-${id}`, student_name: name, class_id: 'c1', class_name: '5º A', start_date: '2030-03-01',
  end_date: '2031-02-28', monthly_amount: 100, discount: 10, due_day: 5, period: 'integral', ...o,
});
const props = (o: Record<string, unknown> = {}) => ({
  open: true, onOpenChange: vi.fn(), sources: [c('a', 'Ana'), c('b', 'Bruno', { monthly_amount: 200, discount: 0 })],
  classes: [{ id: 'c1', name: '5º A', max_capacity: 30 }, { id: 'c2', name: '6º A', max_capacity: 1 }],
  activeByClass: { c1: 2, c2: 1 }, services: [{ id: 'svc1', name: 'Taxa de rematrícula', price: 150 }],
  schoolId: 's1', onDone: vi.fn(), ...o,
});

beforeEach(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never;
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('BatchRenewalDialog', () => {
  it('configuração: reajuste, taxa e uma linha de mapa por turma de origem presente', async () => {
    render(<BatchRenewalDialog {...props()} />);
    expect(await screen.findByLabelText('Reajuste (%)')).toBeTruthy();
    expect(screen.getAllByText('5º A').length).toBeGreaterThan(0); // turma de origem da seleção (rótulo e valor do seletor)
    expect(screen.queryByText('6º A')).toBeNull();   // turma que não está na seleção não aparece no mapa
  });

  it('prévia: aplica o % (10%), mostra totais e o período novo', async () => {
    render(<BatchRenewalDialog {...props()} />);
    const pct = await screen.findByLabelText('Reajuste (%)');
    await userEvent.clear(pct);
    await userEvent.type(pct, '10');
    await userEvent.click(screen.getByRole('button', { name: 'Ver prévia' }));
    const ana = (await screen.findByText('Ana')).closest('tr') as HTMLElement;
    const bruno = screen.getByText('Bruno').closest('tr') as HTMLElement;
    expect(within(ana).getByDisplayValue('110,00')).toBeTruthy();   // 100 + 10%
    expect(within(bruno).getByDisplayValue('220,00')).toBeTruthy(); // 200 + 10%
    expect(within(ana).getByText(/01\/03\/2031/)).toBeTruthy();
    expect(screen.getByText(/2 contratos · 24 mensalidades/)).toBeTruthy(); // linha de totais (única)
    expect(screen.getByRole('button', { name: 'Renovar 2 contratos' })).toBeTruthy();
  });

  it('valor editado na linha não é recalculado ao voltar e mudar o %', async () => {
    render(<BatchRenewalDialog {...props()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Ver prévia' }));
    const ana = (await screen.findByText('Ana')).closest('tr') as HTMLElement;
    const input = within(ana).getByDisplayValue('100,00');
    await userEvent.clear(input);
    await userEvent.type(input, '15000'); // calculadora: 150,00
    expect(within(ana).getByDisplayValue('150,00')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    const pct = await screen.findByLabelText('Reajuste (%)');
    await userEvent.clear(pct);
    await userEvent.type(pct, '20');
    await userEvent.click(screen.getByRole('button', { name: 'Ver prévia' }));
    const ana2 = (await screen.findByText('Ana')).closest('tr') as HTMLElement;
    expect(within(ana2).getByDisplayValue('150,00')).toBeTruthy();                                   // editada: mantém
    expect(within(screen.getByText('Bruno').closest('tr') as HTMLElement).getByDisplayValue('240,00')).toBeTruthy(); // não editada: recalcula
  });

  it('valor zero numa linha bloqueia a confirmação', async () => {
    render(<BatchRenewalDialog {...props()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Ver prévia' }));
    const ana = (await screen.findByText('Ana')).closest('tr') as HTMLElement;
    await userEvent.clear(within(ana).getByDisplayValue('100,00'));
    expect((screen.getByRole('button', { name: /Renovar/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(ana).getByText(/valor inválido/i)).toBeTruthy();
  });

  it('confirmar envia os itens ao RPC com a taxa e mostra o resultado; fechar recarrega a lista', async () => {
    mocks.renew.mockResolvedValue({ renewed: 2, tuitions: 24, skipped: [], processed: 2, total: 2, error: null });
    const p = props();
    render(<BatchRenewalDialog {...p} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Ver prévia' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Renovar 2 contratos' }));
    await waitFor(() => expect(mocks.renew).toHaveBeenCalledTimes(1));
    const [schoolId, items, fee] = mocks.renew.mock.calls[0];
    expect(schoolId).toBe('s1');
    expect(fee).toBeNull();
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ source_contract_id: 'a', class_id: 'c1', monthly_amount: 100, start_date: '2031-03-01', end_date: '2032-02-29' });
    expect(items[0].tuitions).toHaveLength(12);
    expect(await screen.findByText(/2 contratos renovados/)).toBeTruthy();
    expect(screen.getByText(/24 mensalidades criadas/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(p.onDone).toHaveBeenCalled();
    expect(p.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('resultado com pulados e com erro parcial', async () => {
    mocks.renew.mockResolvedValue({ renewed: 1, tuitions: 12, skipped: [{ source_contract_id: 'b', reason: 'ALREADY_RENEWED' }], processed: 1, total: 2, error: 'Um contrato do lote foi recusado pelo servidor: x' });
    render(<BatchRenewalDialog {...props()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Ver prévia' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Renovar 2 contratos' }));
    expect(await screen.findByText(/1 contrato já estava renovado/)).toBeTruthy();
    expect(screen.getByText(/Foram renovados 1 de 2 antes do erro/)).toBeTruthy();
    expect(screen.getByText(/recusado pelo servidor/)).toBeTruthy();
  });

  it('aviso de capacidade quando a turma de destino estoura (não bloqueia)', async () => {
    // c2 tem capacidade 1 e já 1 ativo: levar 2 alunos de c1 para c2 estoura
    render(<BatchRenewalDialog {...props()} />);
    const map = await screen.findByRole('combobox', { name: /Vai para: 5º A/ });
    await userEvent.click(map);
    await userEvent.click(await screen.findByRole('option', { name: '6º A' }));
    await userEvent.click(screen.getByRole('button', { name: 'Ver prévia' }));
    expect(await screen.findByText(/6º A/, { selector: '[role="alert"] *' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Renovar 2 contratos' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
```

Run: `npx vitest run src/components/renewal/BatchRenewalDialog.test.tsx 2>&1 | grep -E "Tests |FAIL|Error"` → FAIL (o stub não renderiza nada).

- [ ] **Step 2: Implementar `BatchRenewalDialog.tsx`**

```tsx
// src/components/renewal/BatchRenewalDialog.tsx
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency } from '@/lib/calculations';
import { buildRenewalPlan, capacityWarnings, classKey, type RenewalClass, type RenewalContract } from '@/lib/renewal';
import { renewContracts, type RenewResult } from '@/lib/renewalApi';
import type { RenewalService } from '@/lib/renewalData';

export interface BatchRenewalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sources: RenewalContract[];
  classes: RenewalClass[];
  activeByClass: Record<string, number>;
  services: RenewalService[];
  schoolId: string;
  onDone: () => void;
}

type Stage = 'config' | 'preview' | 'running' | 'done';
const NO_CLASS = 'none';
const NO_FEE = 'none';

export function BatchRenewalDialog({ open, onOpenChange, sources, classes, activeByClass, services, schoolId, onDone }: BatchRenewalDialogProps) {
  const [stage, setStage] = useState<Stage>('config');
  const [pctText, setPctText] = useState('0');
  const [feeId, setFeeId] = useState<string>(NO_FEE);
  const [classMap, setClassMap] = useState<Record<string, string | null>>({});
  const [overrides, setOverrides] = useState<Record<string, { classId?: string | null; monthly?: number }>>({});
  const [result, setResult] = useState<RenewResult | null>(null);

  // Reabre limpo a cada abertura.
  useEffect(() => {
    if (open) { setStage('config'); setPctText('0'); setFeeId(NO_FEE); setClassMap({}); setOverrides({}); setResult(null); }
  }, [open]);

  const pct = Number(pctText.replace(',', '.'));
  const pctValid = pctText.trim() !== '' && Number.isFinite(pct) && pct > -100 && pct <= 200;
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const classNameOf = (id: string | null) => (id ? classes.find((c) => c.id === id)?.name ?? '—' : 'Sem turma');

  // Turmas de origem presentes na seleção (uma linha do mapa por turma).
  const origins = useMemo(() => {
    const seen = new Map<string, string | null>();
    for (const s of sources) seen.set(classKey(s.class_id), s.class_id);
    return [...seen.values()];
  }, [sources]);

  const plan = useMemo(
    () => buildRenewalPlan(sources, { pct: pctValid ? pct : 0, classMap, overrides, today }),
    [sources, pct, pctValid, classMap, overrides, today],
  );
  const warnings = useMemo(() => capacityWarnings(plan.rows, classes, activeByClass), [plan.rows, classes, activeByClass]);
  const hasError = plan.rows.some((r) => r.error);

  const confirm = async () => {
    setStage('running');
    const res = await renewContracts(schoolId, plan.items, feeId === NO_FEE ? null : feeId);
    setResult(res);
    setStage('done');
  };

  const close = () => {
    onOpenChange(false);
    if (result) onDone();
  };

  const setRowClass = (id: string, v: string) =>
    setOverrides((o) => ({ ...o, [id]: { ...o[id], classId: v === NO_CLASS ? null : v } }));
  const setRowMonthly = (id: string, v: number | undefined) =>
    setOverrides((o) => ({ ...o, [id]: { ...o[id], monthly: v ?? 0 } }));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && stage !== 'running') close(); }}>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Renovar em lote</DialogTitle>
          <DialogDescription>
            {sources.length} contrato{sources.length !== 1 ? 's' : ''} selecionado{sources.length !== 1 ? 's' : ''}.
            O novo contrato começa no dia seguinte ao fim do atual e dura 12 meses.
          </DialogDescription>
        </DialogHeader>

        {stage === 'config' && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="batch-pct">Reajuste (%)</Label>
                <Input id="batch-pct" inputMode="decimal" value={pctText} onChange={(e) => setPctText(e.target.value)} />
                {!pctValid && <p className="text-xs text-destructive">Informe um percentual entre -99,99 e 200.</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="batch-fee">Taxa de rematrícula</Label>
                <Select value={feeId} onValueChange={setFeeId}>
                  <SelectTrigger id="batch-fee" aria-label="Taxa de rematrícula"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_FEE}>Sem taxa</SelectItem>
                    {services.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} · {formatCurrency(s.price)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Turma de destino</p>
              {origins.map((o) => {
                const key = classKey(o);
                const value = key in classMap ? classMap[key] : o;
                return (
                  <div key={key} className="flex items-center gap-3">
                    <span className="w-40 text-sm">{classNameOf(o)}</span>
                    <span aria-hidden="true">→</span>
                    <Select value={value ?? NO_CLASS} onValueChange={(v) => setClassMap((m) => ({ ...m, [key]: v === NO_CLASS ? null : v }))}>
                      <SelectTrigger className="w-[220px]" aria-label={`Vai para: ${classNameOf(o)}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_CLASS}>Sem turma</SelectItem>
                        {classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={close}>Cancelar</Button>
              <Button onClick={() => setStage('preview')} disabled={!pctValid || sources.length === 0}>Ver prévia</Button>
            </DialogFooter>
          </div>
        )}

        {stage === 'preview' && (
          <div className="space-y-4">
            {warnings.length > 0 && (
              <Alert role="alert">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Capacidade das turmas</AlertTitle>
                <AlertDescription>
                  {warnings.map((w) => `${w.className}: ${w.projected} alunos para ${w.max} vagas`).join(' · ')}. Você pode continuar mesmo assim.
                </AlertDescription>
              </Alert>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Aluno</TableHead>
                  <TableHead>Turma</TableHead>
                  <TableHead>Valor atual → novo</TableHead>
                  <TableHead>Período novo</TableHead>
                  <TableHead>Mensalidades</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plan.rows.map((r) => (
                  <TableRow key={r.contractId}>
                    <TableCell className="font-medium">{r.studentName}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">{classNameOf(r.fromClassId)} →</span>
                        <Select value={r.toClassId ?? NO_CLASS} onValueChange={(v) => setRowClass(r.contractId, v)}>
                          <SelectTrigger className="w-[150px]" aria-label={`Turma de destino de ${r.studentName}`}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NO_CLASS}>Sem turma</SelectItem>
                            {classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">{formatCurrency(r.currentMonthly)} →</span>
                        <CurrencyInput className="w-[120px]" aria-label={`Novo valor de ${r.studentName}`} value={r.newMonthly} onChange={(v) => setRowMonthly(r.contractId, v)} />
                      </div>
                      {r.error === 'INVALID_AMOUNT' && <p className="mt-1 text-xs text-destructive">Valor inválido: informe um valor maior que zero.</p>}
                      {r.error === 'NO_TUITIONS' && <p className="mt-1 text-xs text-destructive">Nenhuma mensalidade seria gerada.</p>}
                    </TableCell>
                    <TableCell className="text-sm">
                      {format(parseISO(r.start), 'dd/MM/yyyy')} a {format(parseISO(r.end), 'dd/MM/yyyy')}
                    </TableCell>
                    <TableCell>{r.tuitionCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="text-sm text-muted-foreground">
              {plan.totals.contracts} contratos · {plan.totals.tuitions} mensalidades · {formatCurrency(plan.totals.monthlyTotal)} por mês
              {feeId !== NO_FEE ? ' · mais a taxa de rematrícula por contrato' : ''}
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStage('config')}>Voltar</Button>
              <Button onClick={confirm} disabled={hasError || plan.items.length === 0}>
                Renovar {plan.items.length} contrato{plan.items.length !== 1 ? 's' : ''}
              </Button>
            </DialogFooter>
          </div>
        )}

        {stage === 'running' && <p className="py-8 text-center text-sm text-muted-foreground">Renovando contratos… não feche esta janela.</p>}

        {stage === 'done' && result && (
          <div className="space-y-3">
            <p className="font-medium">
              {result.renewed} contrato{result.renewed !== 1 ? 's' : ''} renovado{result.renewed !== 1 ? 's' : ''} · {result.tuitions} mensalidade{result.tuitions !== 1 ? 's' : ''} criada{result.tuitions !== 1 ? 's' : ''}
            </p>
            {result.skipped.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {result.skipped.length} contrato{result.skipped.length !== 1 ? 's' : ''} já estava{result.skipped.length !== 1 ? 'm' : ''} renovado{result.skipped.length !== 1 ? 's' : ''} e foi pulado.
              </p>
            )}
            {result.error && (
              <Alert variant="destructive" role="alert">
                <AlertTitle>O lote parou</AlertTitle>
                <AlertDescription>
                  Foram renovados {result.processed} de {result.total} antes do erro: {result.error}
                </AlertDescription>
              </Alert>
            )}
            <DialogFooter><Button onClick={close}>Fechar</Button></DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```
(Nota: o texto "Foram renovados X de Y antes do erro" usa `processed`, ou seja, o que o servidor confirmou em lotes completos; `renewed` pode ser menor se houve contratos pulados.)

- [ ] **Step 3: Rodar e ver passar**

Run: `npx vitest run src/components/renewal/BatchRenewalDialog.test.tsx 2>&1 | grep -E "Tests |FAIL|Error"` → passa. Os pontos mais frágeis são os seletores do Radix (`combobox`/`option`) e o `getByDisplayValue('110,00')` do `CurrencyInput`; ajuste **o teste** se a formatação mostrada for outra (ex.: com `R$`), nunca o comportamento. O teste da "capacidade" depende de `[role="alert"]`: se a `Alert` do projeto não propagar `role`, ajuste o seletor para o texto do aviso.

- [ ] **Step 4: Verificar tudo**

Run: `npx vitest run 2>&1 | grep -E "Test Files|Tests |FAIL"` e `npm run build 2>&1 | grep -E "built in|error"` → verdes.

- [ ] **Step 5: Commit**

```bash
git add src/components/renewal/BatchRenewalDialog.tsx src/components/renewal/BatchRenewalDialog.test.tsx
git commit -m "Renovação em lote: reajuste em %, mapa de turmas, prévia editável, aviso de capacidade e resultado"
```

---

### Task 7: Painel em Contratos, documentação e PR

**Files:**
- Modify: `src/pages/Contracts.tsx` (painel vira resumo com link)
- Modify: `docs/superpowers/specs/2026-11-19-s4c-rematricula-design.md` (menu: grupo Financeiro)
- Modify: `CHANGELOG.md`, `QA_CHECKLIST.md`, `docs/STATUS.md`

- [ ] **Step 1: Painel de Contratos vira resumo com link**

Em `src/pages/Contracts.tsx`: manter `RENEWAL_WINDOW_DAYS`, `renewalCutoff`, `renewedFromIds`, `inRenewalWindow` e `pendingRenewal`; **substituir** o bloco JSX `{!loading && inRenewalWindow.length > 0 && ( <Card> … </Card> )}` por:

```tsx
      {!loading && inRenewalWindow.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <RefreshCw className="h-4 w-4" />
              Rematrícula — próximos {RENEWAL_WINDOW_DAYS} dias
              <span className="text-sm font-normal text-muted-foreground">
                ({inRenewalWindow.length - pendingRenewal.length} de {inRenewalWindow.length} já renovados)
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {pendingRenewal.length === 0
                ? "Todos os contratos que vencem nesse período já foram renovados."
                : `${pendingRenewal.length} contrato${pendingRenewal.length !== 1 ? "s" : ""} ainda sem renovação.`}
            </p>
            <Button asChild>
              <Link to="/rematricula">Abrir rematrícula</Link>
            </Button>
          </CardContent>
        </Card>
      )}
```
Importar `Link` de `react-router-dom`. Remover imports que ficarem sem uso (ex.: `format` se só o painel o usava; confira com o build). O "Renovar" individual continua na tabela de contratos (`ContractTable`/`ContractForm`), inalterado.

- [ ] **Step 2: Alinhar a spec** — em `docs/superpowers/specs/2026-11-19-s4c-rematricula-design.md`, na seção "Página `/rematricula`", trocar "item "Rematrícula" no grupo *Gestão* da barra lateral, depois de Contratos" por "item "Rematrícula" no grupo *Financeiro* da barra lateral, logo depois de Contratos (que mora nesse grupo)".

- [ ] **Step 3: Documentar**

`CHANGELOG.md`: nova seção no topo "Sprint S4c — Rematrícula, etapa 2 (interface) (2026-11-19)" listando: página `/rematricula` (lista, filtros, resumo, decisão da família com motivo), renovação em lote (reajuste %, taxa, mapa de turmas, prévia editável, capacidade, lotes de 100), regra de mensalidades extraída (`tuitionRows.ts`) e `nextTerm` compartilhado com o "Renovar" individual, texto do aviso ("Abrir rematrícula" e `declined_count`), painel de Contratos como resumo. Contagem **real** de testes ao final. Diga o que **não** foi feito (QA no navegador, se for o caso).
`QA_CHECKLIST.md`: seção "Roteiro de QA — S4c, rematrícula (etapa 2: interface)" **só com itens abertos** (`[ ]`) que dependem do navegador e da escola de teste, com autorização para renovar de verdade: página abre para owner/admin/financeiro e não para professor; filtros e resumo; "Não vai renovar" pede motivo e sai da seleção; decisão aparece depois de recarregar; lote com 2 contratos: prévia correta (valores, datas, mensalidades), editar valor de uma linha, mapa de turma, taxa; resultado e contratos novos/mensalidades conferidos em Contratos e Mensalidades; contrato já renovado é pulado; a 375 px e no tema escuro; o aviso de rematrícula leva à página; escrita manual logo depois de um lote não falha (`source` da auditoria).
`docs/STATUS.md`: a linha da S4c (etapa 2 pronta no código; QA no navegador pendente) e o próximo passo.

- [ ] **Step 4: Verificação final**

Run: `npx vitest run 2>&1 | grep -E "Test Files|Tests |FAIL"` e `npm run build 2>&1 | grep -E "built in|error"` → verdes.

- [ ] **Step 5: Commit (push e PR só com o aval do usuário)**

```bash
git add src/pages/Contracts.tsx docs/superpowers/specs/2026-11-19-s4c-rematricula-design.md CHANGELOG.md QA_CHECKLIST.md docs/STATUS.md
git commit -m "S4c etapa 2: painel de Contratos vira resumo com link, CHANGELOG, roteiro de QA e STATUS"
```

---

## Self-review

**Cobertura da spec (Etapa 2):** `renewal.ts` (prazo, reajuste, plano, capacidade, estado, resumo) e `buildTuitionRows` extraída: Tasks 1–2. Cliente e leituras: Task 3. Texto do aviso ("Abrir rematrícula", `declined_count`): Task 4. Página (rota, menu, título, filtros, resumo, tabela, seleção inicial, decisão com motivo, paginação preservando seleção, estados vazio/erro/carregando): Task 5. Diálogo do lote (reajuste, taxa, mapa, prévia editável, capacidade, confirmação, resultado, lotes de 100, erro parcial): Task 6. Painel de Contratos, docs e PR: Task 7. As "Notas para a Etapa 2" da spec estão no cabeçalho do plano e nos testes (`class_id: null`, datas locais, herança da origem, centavos, `maxLength` 500).

**Placeholders:** nenhum "TBD". Os pontos condicionais (existência de `label.tsx`; seletores do Radix em jsdom; formatação do `CurrencyInput`) trazem a instrução exata do que ajustar (o teste, não o comportamento).

**Consistência de tipos e nomes:** `RenewalContract`, `DecisionRow`, `RenewalClass`, `RpcItem`, `PlanRow`, `PlanOptions`, `RenewResult`, `RenewalData`, `RenewalService`, `BatchRenewalDialogProps` têm as mesmas definições onde são produzidos e consumidos; `buildRenewalPlan` devolve `{ rows, items, totals }` e é usado assim no diálogo; `renewContracts(schoolId, items, feeId|null)` bate com o teste e o diálogo; `setRenewalDecision(id, status|'none', reason?, note?)` bate com a página; os rótulos do menu/título/rota usam `/rematricula` em todo lugar.

**Riscos conhecidos:** (1) os componentes Radix (`Select`, `Dialog`, `Checkbox`) em jsdom dependem dos polyfills incluídos nos testes; seletores podem precisar de ajuste na execução. (2) A coluna `due_day`/`period` agora é lida de `contracts`, que a tela de Contratos não selecionava: só esta tela depende disso. (3) O QA no navegador renova contratos reais: só em escola de teste e com autorização; o Chrome não está conectado nesta sessão, então o QA visual pode ficar para o usuário. (4) Mil linhas por consulta (limite do Supabase): suficiente hoje.
