# Notificações S3 — Etapa 2 (interface) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar no front os avisos que o gerador diário já grava: sino no cabeçalho, central preenchida, card "Precisa da sua atenção hoje" no Dashboard e filtro `?status=` em Mensalidades.

**Architecture:** Textos e agrupamentos em funções puras (`notificationText.ts`, testadas com Vitest); um cliente fino dos RPCs `list_notifications`/`mark_notifications_read` (`notifications.ts`); três componentes de UI que só consomem essas duas camadas. Nenhuma mudança de banco: a etapa 1 já está em produção.

**Tech Stack:** React + TypeScript, Vite, Vitest, shadcn/ui (`Popover`, `Badge`, `Button`, `Card`, `Tabs`), Supabase RPC, react-router-dom.

**Spec:** `docs/superpowers/specs/2026-11-18-gerador-notificacoes-design.md` (seção "Etapa 2"; decisões G1, G6, G10, G11).

## Global Constraints

- Textos em português do Brasil, com acentuação correta.
- `school_id` nunca vai do cliente: os RPCs usam `get_user_school_id()`.
- Moeda sempre via `formatCurrency` de `src/lib/calculations.ts`.
- Visibilidade do sino e do card = `showNotificationsItem(...)` de `src/lib/accountMenu.ts` (G10).
- Paginação da central por **offset**, 20 por página, deduplicando por `id` (spec, seção Central).
- Cores só por tokens do tema/componentes de `src/components/ui/`, nunca hex (spec, cabeçalho).
- "Não lido" nunca só por cor: ponto + peso da fonte.
- Botões: "Ver parcelas"/"Ver contratos" no lugar de "Abrir renegociações"/"Abrir rematrícula" (G11).
- Testes: `npx vitest run` (112 verdes hoje) e `npm run build` devem passar ao final de cada tarefa.
- Branch nova a partir de `main`: `feature/s3-notificacoes-interface`. Commits em português, terminando com a linha `Co-Authored-By` exigida.

---

### Task 1: Filtro `?status=` em Mensalidades

**Files:**
- Modify: `src/pages/Tuitions.tsx:63-64` e `:285-291`
- Modify: `src/components/tuitions/TuitionTable.tsx:62,67,75`
- Create: `src/lib/tuitionStatusParam.ts`
- Test: `src/lib/tuitionStatusParam.test.ts`

**Interfaces:**
- Produces: `parseStatusParam(raw: string | null): 'all' | 'pending' | 'overdue' | 'paid'` — usado por `Tuitions.tsx`; `TuitionTable` ganha a prop opcional `initialStatus?: string` (padrão `'all'`).

- [ ] **Step 1: Criar a branch**

```bash
git checkout main && git pull --ff-only && git checkout -b feature/s3-notificacoes-interface
```

- [ ] **Step 2: Escrever o teste que falha**

```ts
// src/lib/tuitionStatusParam.test.ts
import { describe, it, expect } from 'vitest';
import { parseStatusParam } from './tuitionStatusParam';

describe('parseStatusParam', () => {
  it('aceita os três status conhecidos', () => {
    expect(parseStatusParam('pending')).toBe('pending');
    expect(parseStatusParam('overdue')).toBe('overdue');
    expect(parseStatusParam('paid')).toBe('paid');
  });
  it('cai em "all" para ausente ou desconhecido', () => {
    expect(parseStatusParam(null)).toBe('all');
    expect(parseStatusParam('')).toBe('all');
    expect(parseStatusParam('cancelled')).toBe('all');
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run src/lib/tuitionStatusParam.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 4: Implementar**

```ts
// src/lib/tuitionStatusParam.ts
export type TuitionStatusFilter = 'all' | 'pending' | 'overdue' | 'paid';

const VALID: TuitionStatusFilter[] = ['pending', 'overdue', 'paid'];

/** Valor inicial do filtro de status vindo de `?status=` (ex.: botões das notificações). */
export function parseStatusParam(raw: string | null): TuitionStatusFilter {
  return VALID.includes(raw as TuitionStatusFilter) ? (raw as TuitionStatusFilter) : 'all';
}
```

- [ ] **Step 5: Ligar na tela**

Em `Tuitions.tsx`, importar `parseStatusParam`, logo abaixo de `initialSearch` (linha 64) acrescentar:

```tsx
  const initialStatus = parseStatusParam(searchParams.get("status"));
```

e passar `initialStatus={initialStatus}` ao `<TuitionTable ... initialSearch={initialSearch} />` (linha ~291).

Em `TuitionTable.tsx`: na interface `TuitionTableProps` (linha 62) acrescentar `initialStatus?: string;`; na assinatura (linha 67) acrescentar `initialStatus = "all"` à desestruturação; e trocar a linha 75 por:

```tsx
  const [statusFilter, setStatusFilter] = useState(initialStatus);
```

- [ ] **Step 6: Verificar**

Run: `npx vitest run src/lib/tuitionStatusParam.test.ts` → PASS. Run: `npm run build` → sem erros.

- [ ] **Step 7: Commit**

```bash
git add src/lib/tuitionStatusParam.ts src/lib/tuitionStatusParam.test.ts src/pages/Tuitions.tsx src/components/tuitions/TuitionTable.tsx
git commit -m "Mensalidades: filtro de status inicial via ?status= (S3 etapa 2)"
```

---

### Task 2: Formatador de texto (`notificationText.ts`)

**Files:**
- Create: `src/lib/notificationText.ts`
- Test: `src/lib/notificationText.test.ts`

**Interfaces:**
- Consumes: `NotificationEvent` de `src/lib/notificationEvents.ts`; `formatCurrency(value: number): string` de `src/lib/calculations.ts`.
- Produces:
  - `type NotificationCategory = 'cobranca' | 'renegociacao' | 'despesas' | 'rematricula'`
  - `interface NotificationItem { id: string; event: NotificationEvent; reference_date: string; offset_days: number; item_count: number; total_amount: number | null; details: Record<string, unknown>; read_at: string | null; created_at: string }`
  - `interface NotificationView { title: string; subtitle: string; category: NotificationCategory; categoryLabel: string; actionLabel: string; actionPath: string }`
  - `describeNotification(n: NotificationItem): NotificationView`
  - `groupByDay(items: NotificationItem[], now: Date): { label: 'Hoje' | 'Ontem' | 'Esta semana' | 'Anteriores'; items: NotificationItem[] }[]` (grupos vazios omitidos, ordem fixa)
  - `formatRelativeTime(createdAt: string, now: Date): string`

Regras de texto (copiar da spec): `offset_days` 0 → "hoje", 1 → "amanhã", n → "em n dias". Singular quando `item_count === 1`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
// src/lib/notificationText.test.ts
import { describe, it, expect } from 'vitest';
import { describeNotification, groupByDay, formatRelativeTime, type NotificationItem } from './notificationText';

const base: NotificationItem = {
  id: '1', event: 'tuition_due', reference_date: '2026-11-19', offset_days: 3,
  item_count: 8, total_amount: 4000, details: {}, read_at: null, created_at: '2026-11-19T08:00:00Z',
};
const mk = (o: Partial<NotificationItem>): NotificationItem => ({ ...base, ...o });

describe('describeNotification', () => {
  it('tuition_due plural, singular, hoje e amanhã', () => {
    expect(describeNotification(mk({})).title).toBe('8 mensalidades vencem em 3 dias');
    expect(describeNotification(mk({ item_count: 1, offset_days: 1 })).title).toBe('1 mensalidade vence amanhã');
    expect(describeNotification(mk({ item_count: 2, offset_days: 0 })).title).toBe('2 mensalidades vencem hoje');
    expect(describeNotification(mk({ item_count: 1, offset_days: 0 })).title).toBe('1 mensalidade vence hoje');
    const v = describeNotification(mk({}));
    expect(v.category).toBe('cobranca');
    expect(v.categoryLabel).toBe('Cobrança');
    expect(v.actionLabel).toBe('Ver cobranças');
    expect(v.actionPath).toBe('/mensalidades?status=pending');
  });
  it('tuition_overdue com valor e turmas', () => {
    const v = describeNotification(mk({ event: 'tuition_overdue', item_count: 12, offset_days: 5, total_amount: 6840, details: { class_count: 3 } }));
    expect(v.title).toBe('12 mensalidades vencidas há mais de 5 dias');
    expect(v.subtitle).toContain('em atraso, em 3 turmas.');
    expect(v.subtitle).toMatch(/^R\$\s6\.840,00/);
    expect(v.actionPath).toBe('/mensalidades?status=overdue');
  });
  it('tuition_overdue singular e 1 turma; offset 1 usa "dia"', () => {
    const v = describeNotification(mk({ event: 'tuition_overdue', item_count: 1, offset_days: 1, total_amount: 100, details: { class_count: 1 } }));
    expect(v.title).toBe('1 mensalidade vencida há mais de 1 dia');
    expect(v.subtitle).toContain('em 1 turma.');
  });
  it('renegotiation_installment', () => {
    const v = describeNotification(mk({ event: 'renegotiation_installment', item_count: 3, offset_days: 1 }));
    expect(v.title).toBe('3 parcelas de renegociação vencem amanhã');
    expect(describeNotification(mk({ event: 'renegotiation_installment', item_count: 1, offset_days: 2 })).title)
      .toBe('1 parcela de renegociação vence em 2 dias');
    expect(v.category).toBe('renegociacao');
    expect(v.actionLabel).toBe('Ver parcelas');
    expect(v.actionPath).toBe('/mensalidades?status=pending');
  });
  it('expense_due com 1 item usa a descrição; vários, a contagem', () => {
    const one = describeNotification(mk({ event: 'expense_due', item_count: 1, offset_days: 2, total_amount: 4200, details: { description: 'Aluguel' } }));
    expect(one.title).toBe('Despesa a pagar: Aluguel');
    expect(one.subtitle).toMatch(/^Vence em 2 dias · R\$\s4\.200,00$/);
    expect(one.actionLabel).toBe('Ver despesa');
    const many = describeNotification(mk({ event: 'expense_due', item_count: 4, offset_days: 2, total_amount: 800 }));
    expect(many.title).toBe('4 despesas vencem em 2 dias');
    expect(many.actionLabel).toBe('Ver despesas');
    expect(many.actionPath).toBe('/despesas');
    expect(describeNotification(mk({ event: 'expense_due', item_count: 1, offset_days: 0, total_amount: 10, details: {} })).title)
      .toBe('1 despesa vence hoje');
  });
  it('reenrollment com rematriculados e pendentes', () => {
    const v = describeNotification(mk({ event: 'reenrollment', item_count: 18, offset_days: 45, total_amount: null, details: { renewed_count: 6 } }));
    expect(v.title).toBe('18 contratos terminam em 45 dias');
    expect(v.subtitle).toBe('6 já rematriculados · 12 pendentes');
    expect(v.category).toBe('rematricula');
    expect(v.actionLabel).toBe('Ver contratos');
    expect(v.actionPath).toBe('/contratos');
    expect(describeNotification(mk({ event: 'reenrollment', item_count: 1, offset_days: 1, details: { renewed_count: 0 } })).title)
      .toBe('1 contrato termina amanhã');
  });
});

describe('groupByDay', () => {
  const now = new Date(2026, 10, 19, 10, 0); // 19/11/2026 10:00 local (quinta)
  it('agrupa em Hoje / Ontem / Esta semana / Anteriores e omite vazios', () => {
    const items = [
      mk({ id: 'a', reference_date: '2026-11-19' }),
      mk({ id: 'b', reference_date: '2026-11-18' }),
      mk({ id: 'c', reference_date: '2026-11-16' }),
      mk({ id: 'd', reference_date: '2026-11-01' }),
    ];
    const g = groupByDay(items, now);
    expect(g.map((x) => x.label)).toEqual(['Hoje', 'Ontem', 'Esta semana', 'Anteriores']);
    expect(g.map((x) => x.items[0].id)).toEqual(['a', 'b', 'c', 'd']);
    expect(groupByDay([items[0]], now).map((x) => x.label)).toEqual(['Hoje']);
  });
});

describe('formatRelativeTime', () => {
  const now = new Date(2026, 10, 19, 10, 0);
  it('hoje com hora, ontem e dia da semana', () => {
    expect(formatRelativeTime(new Date(2026, 10, 19, 5, 0).toISOString(), now)).toBe('hoje 05:00');
    expect(formatRelativeTime(new Date(2026, 10, 18, 5, 0).toISOString(), now)).toBe('ontem');
    expect(formatRelativeTime(new Date(2026, 10, 16, 5, 0).toISOString(), now)).toBe('seg');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/notificationText.test.ts` → FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```ts
// src/lib/notificationText.ts
import { formatCurrency } from './calculations';
import type { NotificationEvent } from './notificationEvents';

export type NotificationCategory = 'cobranca' | 'renegociacao' | 'despesas' | 'rematricula';

export interface NotificationItem {
  id: string;
  event: NotificationEvent;
  reference_date: string; // 'YYYY-MM-DD'
  offset_days: number;
  item_count: number;
  total_amount: number | null;
  details: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export interface NotificationView {
  title: string;
  subtitle: string;
  category: NotificationCategory;
  categoryLabel: string;
  actionLabel: string;
  actionPath: string;
}

export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  cobranca: 'Cobrança',
  renegociacao: 'Renegociação',
  despesas: 'Despesas',
  rematricula: 'Rematrícula',
};

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const dias = (n: number) => `${n} ${plural(n, 'dia', 'dias')}`;

/** "hoje" / "amanhã" / "em N dias" — para eventos com antecedência. */
function when(offset: number): string {
  if (offset === 0) return 'hoje';
  if (offset === 1) return 'amanhã';
  return `em ${dias(offset)}`;
}

/** Concorda o verbo: "vence"/"vencem", "termina"/"terminam". */
const verb = (n: number, one: string, many: string) => plural(n, one, many);

export function describeNotification(n: NotificationItem): NotificationView {
  const c = n.item_count;
  const total = n.total_amount ?? 0;
  switch (n.event) {
    case 'tuition_due':
      return {
        title: `${c} ${plural(c, 'mensalidade', 'mensalidades')} ${verb(c, 'vence', 'vencem')} ${when(n.offset_days)}`,
        subtitle: 'Bom momento para enviar o lembrete aos responsáveis.',
        category: 'cobranca', categoryLabel: CATEGORY_LABELS.cobranca,
        actionLabel: 'Ver cobranças', actionPath: '/mensalidades?status=pending',
      };
    case 'tuition_overdue': {
      const classes = Number(n.details.class_count ?? 0);
      return {
        title: `${c} ${plural(c, 'mensalidade vencida', 'mensalidades vencidas')} há mais de ${dias(n.offset_days)}`,
        subtitle: `${formatCurrency(total)} em atraso, em ${classes} ${plural(classes, 'turma', 'turmas')}.`,
        category: 'cobranca', categoryLabel: CATEGORY_LABELS.cobranca,
        actionLabel: 'Ver cobranças', actionPath: '/mensalidades?status=overdue',
      };
    }
    case 'renegotiation_installment':
      return {
        title: `${c} ${plural(c, 'parcela', 'parcelas')} de renegociação ${verb(c, 'vence', 'vencem')} ${when(n.offset_days)}`,
        subtitle: 'Acordos ativos com parcelas em aberto.',
        category: 'renegociacao', categoryLabel: CATEGORY_LABELS.renegociacao,
        actionLabel: 'Ver parcelas', actionPath: '/mensalidades?status=pending',
      };
    case 'expense_due': {
      const description = typeof n.details.description === 'string' ? n.details.description : null;
      const title = c === 1 && description
        ? `Despesa a pagar: ${description}`
        : `${c} ${plural(c, 'despesa', 'despesas')} ${verb(c, 'vence', 'vencem')} ${when(n.offset_days)}`;
      const venceEm = n.offset_days === 0 ? 'Vence hoje' : n.offset_days === 1 ? 'Vence amanhã' : `Vence em ${dias(n.offset_days)}`;
      return {
        title,
        subtitle: `${venceEm} · ${formatCurrency(total)}`,
        category: 'despesas', categoryLabel: CATEGORY_LABELS.despesas,
        actionLabel: c === 1 ? 'Ver despesa' : 'Ver despesas', actionPath: '/despesas',
      };
    }
    case 'reenrollment': {
      const renewed = Number(n.details.renewed_count ?? 0);
      return {
        title: `${c} ${plural(c, 'contrato', 'contratos')} ${verb(c, 'termina', 'terminam')} ${when(n.offset_days)}`,
        subtitle: `${renewed} ${plural(renewed, 'já rematriculado', 'já rematriculados')} · ${c - renewed} ${plural(c - renewed, 'pendente', 'pendentes')}`,
        category: 'rematricula', categoryLabel: CATEGORY_LABELS.rematricula,
        actionLabel: 'Ver contratos', actionPath: '/contratos',
      };
    }
  }
}

// ---- datas -----------------------------------------------------------------

/** Dias de calendário entre duas datas 'YYYY-MM-DD' (b - a), sem depender de fuso. */
function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

const pad = (n: number) => String(n).padStart(2, '0');
const localKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export type DayGroupLabel = 'Hoje' | 'Ontem' | 'Esta semana' | 'Anteriores';
const GROUP_ORDER: DayGroupLabel[] = ['Hoje', 'Ontem', 'Esta semana', 'Anteriores'];

export function groupByDay(items: NotificationItem[], now: Date): { label: DayGroupLabel; items: NotificationItem[] }[] {
  const today = localKey(now);
  const buckets: Record<DayGroupLabel, NotificationItem[]> = { Hoje: [], Ontem: [], 'Esta semana': [], Anteriores: [] };
  for (const it of items) {
    const age = dayDiff(it.reference_date, today);
    const label: DayGroupLabel = age <= 0 ? 'Hoje' : age === 1 ? 'Ontem' : age <= 6 ? 'Esta semana' : 'Anteriores';
    buckets[label].push(it);
  }
  return GROUP_ORDER.filter((l) => buckets[l].length > 0).map((l) => ({ label: l, items: buckets[l] }));
}

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

export function formatRelativeTime(createdAt: string, now: Date): string {
  const d = new Date(createdAt);
  const age = dayDiff(localKey(d), localKey(now));
  if (age <= 0) return `hoje ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (age === 1) return 'ontem';
  if (age <= 6) return WEEKDAYS[d.getDay()];
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/notificationText.test.ts` → PASS. Se o `formatCurrency` usar espaço não separável (U+00A0), os `toMatch(/R\$\s…/)` já cobrem; ajuste só os regex, nunca o código, se falhar por isso.

- [ ] **Step 5: Commit**

```bash
git add src/lib/notificationText.ts src/lib/notificationText.test.ts
git commit -m "Formatador de texto das notificações: títulos, agrupamento por dia e horário relativo (S3 etapa 2)"
```

---

### Task 3: Cliente dos RPCs (`notifications.ts`) e hook de visibilidade

**Files:**
- Create: `src/lib/notifications.ts`
- Create: `src/hooks/use-show-notifications.ts`
- Test: `src/lib/notifications.test.ts`

**Interfaces:**
- Consumes: `NotificationItem` (Task 2), `NotificationCategory` (Task 2), `supabase.rpc('list_notifications' | 'mark_notifications_read')`.
- Produces:
  - `interface NotificationsPage { items: NotificationItem[]; filteredTotal: number; total: number; unread: number }`
  - `parseNotificationsPayload(raw: unknown): NotificationsPage` (lança `Error('Resposta inesperada do servidor.')`)
  - `listNotifications(opts?: { offset?: number; limit?: number; category?: NotificationCategory | null; unreadOnly?: boolean }): Promise<NotificationsPage>`
  - `markNotificationsRead(ids?: string[] | null): Promise<number>`
  - `mergeById(prev: NotificationItem[], next: NotificationItem[]): NotificationItem[]` (dedupe por `id`, mantém a ordem de `prev` e anexa só os novos)
  - `useShowNotifications(): boolean` (mesma regra do item da barra lateral)

- [ ] **Step 1: Teste que falha**

```ts
// src/lib/notifications.test.ts
import { describe, it, expect } from 'vitest';
import { parseNotificationsPayload, mergeById } from './notifications';

const item = (id: string) => ({
  id, event: 'tuition_due', reference_date: '2026-11-19', offset_days: 3, item_count: 2,
  total_amount: 10, details: {}, read_at: null, created_at: '2026-11-19T08:00:00Z',
});

describe('parseNotificationsPayload', () => {
  it('converte o payload do RPC', () => {
    const p = parseNotificationsPayload({ items: [item('a')], filtered_total: 5, total: 7, unread: 3 });
    expect(p.items).toHaveLength(1);
    expect(p.filteredTotal).toBe(5);
    expect(p.total).toBe(7);
    expect(p.unread).toBe(3);
  });
  it('rejeita payload malformado', () => {
    expect(() => parseNotificationsPayload(null)).toThrow('Resposta inesperada do servidor.');
    expect(() => parseNotificationsPayload({ total: 1 })).toThrow();
  });
});

describe('mergeById', () => {
  it('não duplica ids já carregados e mantém a ordem', () => {
    const out = mergeById([item('a') as never, item('b') as never], [item('b') as never, item('c') as never]);
    expect(out.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/notifications.test.ts` → FAIL.

- [ ] **Step 3: Implementar o cliente**

```ts
// src/lib/notifications.ts
import { supabase } from '@/integrations/supabase/client';
import type { NotificationCategory, NotificationItem } from './notificationText';

export interface NotificationsPage {
  items: NotificationItem[];
  filteredTotal: number;
  total: number;
  unread: number;
}

interface RawPage {
  items: NotificationItem[];
  filtered_total: number;
  total: number;
  unread: number;
}

export function parseNotificationsPayload(raw: unknown): NotificationsPage {
  const p = raw as RawPage | null;
  if (!p || !Array.isArray(p.items) || typeof p.total !== 'number' || typeof p.unread !== 'number') {
    throw new Error('Resposta inesperada do servidor.');
  }
  return { items: p.items, filteredTotal: p.filtered_total ?? p.total, total: p.total, unread: p.unread };
}

// school_id nunca vai do cliente: os RPCs usam get_user_school_id().
export async function listNotifications(opts: {
  offset?: number;
  limit?: number;
  category?: NotificationCategory | null;
  unreadOnly?: boolean;
} = {}): Promise<NotificationsPage> {
  const { data, error } = await supabase.rpc('list_notifications', {
    p_offset: opts.offset ?? 0,
    p_limit: opts.limit ?? 20,
    p_category: opts.category ?? undefined,
    p_unread_only: opts.unreadOnly ?? false,
  });
  if (error) throw error;
  return parseNotificationsPayload(data);
}

/** `null`/omitido = todas do usuário. Devolve quantas foram marcadas. */
export async function markNotificationsRead(ids?: string[] | null): Promise<number> {
  const { data, error } = await supabase.rpc('mark_notifications_read', { p_ids: ids ?? undefined });
  if (error) throw error;
  return data ?? 0;
}

/** Uma geração no meio da paginação desloca o offset: dedupe por id. */
export function mergeById(prev: NotificationItem[], next: NotificationItem[]): NotificationItem[] {
  const seen = new Set(prev.map((i) => i.id));
  return [...prev, ...next.filter((i) => !seen.has(i.id))];
}
```

- [ ] **Step 4: Hook de visibilidade** (mesmas fontes do `AppSidebar.tsx:106-151`)

```ts
// src/hooks/use-show-notifications.ts
import { useAuth } from '@/contexts/AuthContext';
import { useMasterAdmin } from '@/contexts/MasterAdminContext';
import { useRole } from '@/hooks/use-role';
import { showNotificationsItem } from '@/lib/accountMenu';

/** Mesma regra do item "Notificações" da barra lateral (G10). */
export function useShowNotifications(): boolean {
  const { profile } = useAuth();
  const { isMasterAdmin, viewingSchoolId } = useMasterAdmin();
  const { role } = useRole();
  return showNotificationsItem({ role, isMasterAdmin, viewingSchoolId, homeSchoolId: profile?.school_id ?? null });
}
```

Antes de salvar, abrir `src/components/layout/AppSidebar.tsx` (imports no topo) e copiar os caminhos reais de `useAuth`, `useMasterAdmin`, `useRole`; ajustar os três `import` se diferirem dos acima.

- [ ] **Step 5: Verificar**

Run: `npx vitest run src/lib/notifications.test.ts` → PASS. Run: `npm run build` → sem erros de tipo (confirma a assinatura de `p_category: undefined` contra `types.ts`).

- [ ] **Step 6: Commit**

```bash
git add src/lib/notifications.ts src/lib/notifications.test.ts src/hooks/use-show-notifications.ts
git commit -m "Cliente dos RPCs de notificação e hook de visibilidade (S3 etapa 2)"
```

---

### Task 4: Sino no cabeçalho

**Files:**
- Create: `src/components/notifications/NotificationBell.tsx`
- Modify: `src/components/layout/Layout.tsx:5,55`

**Interfaces:**
- Consumes: `listNotifications`, `markNotificationsRead` (Task 3); `describeNotification`, `formatRelativeTime` (Task 2); `useShowNotifications` (Task 3); `Popover`, `PopoverTrigger`, `PopoverContent` de `@/components/ui/popover`.
- Produces: `<NotificationBell />` (sem props; retorna `null` quando não deve aparecer).

- [ ] **Step 1: Confirmar componentes UI existentes**

Run: `ls src/components/ui/popover.tsx src/components/ui/badge.tsx src/components/ui/tabs.tsx`
Se `popover.tsx` não existir: `npx shadcn@latest add popover`.

- [ ] **Step 2: Implementar o sino**

```tsx
// src/components/notifications/NotificationBell.tsx
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useShowNotifications } from '@/hooks/use-show-notifications';
import { listNotifications, markNotificationsRead, type NotificationsPage } from '@/lib/notifications';
import { describeNotification, formatRelativeTime } from '@/lib/notificationText';

export function NotificationBell() {
  const visible = useShowNotifications();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<NotificationsPage | null>(null);

  const refresh = useCallback(async () => {
    try {
      setData(await listNotifications({ offset: 0, limit: 4, unreadOnly: true }));
    } catch {
      setData(null); // falha: só o ícone, sem selo, sem quebrar o cabeçalho
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [visible, refresh]);

  if (!visible) return null;

  const unread = data?.unread ?? 0;
  const badge = unread > 9 ? '9+' : String(unread);
  const now = new Date();

  const markAll = async () => {
    try { await markNotificationsRead(null); } finally { await refresh(); }
  };
  const openItem = async (id: string, path: string) => {
    setOpen(false);
    try { await markNotificationsRead([id]); } catch { /* navegar mesmo assim */ }
    navigate(path);
    refresh();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notificações, ${unread} não lidas`}>
          <Bell className="h-5 w-5" aria-hidden="true" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground">
              {badge}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-semibold">Notificações</p>
          {unread > 0 && (
            <Button variant="link" size="sm" className="h-auto p-0" onClick={markAll}>
              Marcar todas como lidas
            </Button>
          )}
        </div>
        {data && data.items.length > 0 ? (
          <ul className="max-h-80 divide-y overflow-y-auto">
            {data.items.map((n) => {
              const v = describeNotification(n);
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => openItem(n.id, v.actionPath)}
                    className="flex w-full flex-col gap-0.5 px-4 py-3 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                  >
                    <span className="text-sm font-semibold">{v.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {v.subtitle} · {formatRelativeTime(n.created_at, now)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Tudo em dia.</p>
        )}
        <div className="border-t px-4 py-2 text-center">
          <Link to="/notificacoes" onClick={() => setOpen(false)} className="text-sm font-medium text-primary hover:underline">
            Ver todas as notificações
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 3: Montar no `Layout.tsx`**

Adicionar `import { NotificationBell } from "@/components/notifications/NotificationBell";` e, no cabeçalho, inserir `<NotificationBell />` imediatamente antes de `<DebugReportButton />` (linha 55).

- [ ] **Step 4: Verificar**

Run: `npm run build` e `npx vitest run` → verdes. Subir `npm run dev` e conferir no navegador (logado como owner/admin da escola de teste): sino aparece, selo mostra o total de não lidas, popover abre, clicar num aviso marca como lido e navega para `/mensalidades?status=overdue` já filtrado; professor não vê o sino.

- [ ] **Step 5: Commit**

```bash
git add src/components/notifications/NotificationBell.tsx src/components/layout/Layout.tsx
git commit -m "Sino de notificações no cabeçalho com popover (S3 etapa 2)"
```

---

### Task 5: Central de notificações preenchida

**Files:**
- Modify (reescrever): `src/pages/Notifications.tsx`

**Interfaces:**
- Consumes: `listNotifications`, `markNotificationsRead`, `mergeById` (Task 3); `describeNotification`, `groupByDay`, `formatRelativeTime`, `CATEGORY_LABELS`, `NotificationCategory` (Task 2); `Tabs`, `TabsList`, `TabsTrigger` de `@/components/ui/tabs`; `Badge`.
- Produces: página `/notificacoes` (export default, rota já existente).

Comportamento: abas **Todas · total**, **Não lidas · unread**, Cobrança, Renegociação, Despesas, Rematrícula. Trocar de aba zera a lista e recarrega do offset 0. "Carregar mais" soma 20 por vez. Rodapé "Mostrando X de Y" (Y = `filteredTotal`).

- [ ] **Step 1: Implementar a página**

```tsx
// src/pages/Notifications.tsx
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { listNotifications, markNotificationsRead, mergeById } from '@/lib/notifications';
import {
  CATEGORY_LABELS, describeNotification, formatRelativeTime, groupByDay,
  type NotificationCategory, type NotificationItem,
} from '@/lib/notificationText';

const PAGE = 20;
type Tab = 'all' | 'unread' | NotificationCategory;

const Notifications = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>('all');
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [counts, setCounts] = useState({ total: 0, unread: 0, filtered: 0 });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);

  const query = (t: Tab, offset: number) =>
    listNotifications({
      offset, limit: PAGE,
      unreadOnly: t === 'unread',
      category: t === 'all' || t === 'unread' ? null : t,
    });

  const load = useCallback(async (t: Tab) => {
    setLoading(true);
    setError(false);
    try {
      const p = await query(t, 0);
      setItems(p.items);
      setCounts({ total: p.total, unread: p.unread, filtered: p.filteredTotal });
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(tab); }, [tab, load]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const p = await query(tab, items.length);
      setItems((prev) => mergeById(prev, p.items));
      setCounts({ total: p.total, unread: p.unread, filtered: p.filteredTotal });
    } catch {
      toast({ title: 'Não foi possível carregar mais avisos.', variant: 'destructive' });
    } finally {
      setLoadingMore(false);
    }
  };

  const markAll = async () => {
    try {
      await markNotificationsRead(null);
      await load(tab);
    } catch {
      toast({ title: 'Não foi possível marcar como lidas.', variant: 'destructive' });
    }
  };

  const openItem = async (n: NotificationItem, path: string) => {
    if (!n.read_at) { try { await markNotificationsRead([n.id]); } catch { /* segue */ } }
    navigate(path);
  };

  const now = new Date();
  const groups = groupByDay(items, now);
  const filtered = tab !== 'all';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Notificações</h1>
          <p className="text-muted-foreground">Lembretes de cobrança, renegociação, despesas e rematrícula</p>
        </div>
        <div className="flex gap-2">
          {counts.unread > 0 && (
            <Button variant="outline" onClick={markAll}>
              <CheckCheck className="mr-2 h-4 w-4" />
              Marcar todas como lidas
            </Button>
          )}
          <Button variant="outline" asChild>
            <Link to="/notificacoes/preferencias">
              <SlidersHorizontal className="mr-2 h-4 w-4" />
              Preferências
            </Link>
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="all">Todas · {counts.total}</TabsTrigger>
          <TabsTrigger value="unread">Não lidas · {counts.unread}</TabsTrigger>
          {(Object.keys(CATEGORY_LABELS) as NotificationCategory[]).map((c) => (
            <TabsTrigger key={c} value={c}>{CATEGORY_LABELS[c]}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {loading ? (
        <Card><CardContent className="py-16 text-center text-sm text-muted-foreground">Carregando…</CardContent></Card>
      ) : error ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="font-medium">Não foi possível carregar as notificações.</p>
            <Button variant="outline" onClick={() => load(tab)}>Tentar de novo</Button>
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Bell className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            </div>
            <p className="font-medium">
              {filtered && counts.total > 0 ? 'Nenhuma notificação nesta categoria.' : 'Nenhuma notificação ainda.'}
            </p>
            {!(filtered && counts.total > 0) && (
              <p className="max-w-md text-sm text-muted-foreground">
                Os avisos aparecem aqui quando houver mensalidades, despesas ou contratos no prazo das suas preferências.
              </p>
            )}
            <Button variant="link" asChild>
              <Link to="/notificacoes/preferencias">Ajustar preferências</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.label} aria-label={g.label} className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground">{g.label}</h2>
              <Card>
                <ul className="divide-y">
                  {g.items.map((n) => {
                    const v = describeNotification(n);
                    const unread = !n.read_at;
                    return (
                      <li key={n.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex gap-3">
                          <span
                            aria-hidden="true"
                            className={`mt-2 h-2 w-2 shrink-0 rounded-full ${unread ? 'bg-primary' : 'bg-transparent'}`}
                          />
                          <div className="space-y-1">
                            <p className={unread ? 'font-semibold' : 'font-normal text-muted-foreground'}>
                              {unread && <span className="sr-only">Não lida: </span>}
                              {v.title}
                            </p>
                            <p className="text-sm text-muted-foreground">{v.subtitle}</p>
                            <div className="flex items-center gap-2">
                              <Badge variant="secondary">{v.categoryLabel}</Badge>
                              <span className="text-xs text-muted-foreground">{formatRelativeTime(n.created_at, now)}</span>
                            </div>
                          </div>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => openItem(n, v.actionPath)}>
                          {v.actionLabel}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </section>
          ))}

          <div className="flex flex-col items-center gap-3">
            <p className="text-sm text-muted-foreground">
              Mostrando {items.length} de {counts.filtered} notificações
            </p>
            {items.length < counts.filtered && (
              <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Carregando…' : 'Carregar mais'}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Notifications;
```

- [ ] **Step 2: Verificar**

Run: `npm run build` → sem erros. No navegador (`npm run dev`, escola de teste com as 3 linhas `tuition_overdue`): abas mostram contagens corretas; aba Despesas mostra "Nenhuma notificação nesta categoria."; "Marcar todas como lidas" zera o selo do sino; botão de ação abre `/mensalidades?status=overdue` com o filtro aplicado; a 375 px nada estoura a largura.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Notifications.tsx
git commit -m "Central de notificações: abas, agrupamento por dia, marcar como lida e paginação (S3 etapa 2)"
```

---

### Task 6: Card "Precisa da sua atenção hoje"

**Files:**
- Create: `src/components/dashboard/AttentionCard.tsx`
- Modify: `src/pages/Index.tsx` (inserir depois de `<FinancialMetrics />`, linha 15)

**Interfaces:**
- Consumes: `listNotifications`, `markNotificationsRead` (Task 3); `describeNotification` (Task 2); `useShowNotifications` (Task 3).
- Produces: `<AttentionCard />` sem props; `null` quando `useShowNotifications()` é falso.

Regra (G1 + spec): busca `listNotifications({ limit: 20 })` (a ordenação vem por `reference_date desc`), usa como "hoje" o `reference_date` mais recente devolvido e mostra só os itens com essa data, lidos ou não. Primeiro botão `default`, demais `outline`. Rodapé: "Gerado hoje às HH:MM" a partir do `created_at` mais recente dos itens exibidos. Se o `reference_date` mais recente não for o dia de hoje no navegador, tratar como "sem itens" (aviso de dias passados não é "hoje").

- [ ] **Step 1: Implementar**

```tsx
// src/components/dashboard/AttentionCard.tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useShowNotifications } from '@/hooks/use-show-notifications';
import { listNotifications, markNotificationsRead } from '@/lib/notifications';
import { describeNotification, type NotificationItem } from '@/lib/notificationText';

const pad = (n: number) => String(n).padStart(2, '0');

export function AttentionCard() {
  const visible = useShowNotifications();
  const navigate = useNavigate();
  const [items, setItems] = useState<NotificationItem[] | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    listNotifications({ offset: 0, limit: 20 })
      .then((p) => {
        if (cancelled) return;
        // "Hoje" = reference_date mais recente (fuso salvo do usuário no servidor, G1).
        const latest = p.items[0]?.reference_date;
        setItems(latest ? p.items.filter((n) => n.reference_date === latest) : []);
      })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, [visible]);

  if (!visible || items === null) return null;

  const now = new Date();
  const todayLocal = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  // Se o aviso mais recente não é de hoje (geração ainda não rodou), não finge que é.
  const today = items.filter((n) => n.reference_date === todayLocal || items[0]?.reference_date === todayLocal);
  const shown = items[0]?.reference_date === todayLocal ? today : [];

  const go = async (n: NotificationItem, path: string) => {
    if (!n.read_at) { try { await markNotificationsRead([n.id]); } catch { /* segue */ } }
    navigate(path);
  };

  const generatedAt = shown.length
    ? new Date(shown.reduce((a, b) => (a.created_at > b.created_at ? a : b)).created_at)
    : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-lg">Precisa da sua atenção hoje</CardTitle>
        {shown.length > 0 && <Badge variant="secondary">{shown.length} {shown.length === 1 ? 'item' : 'itens'}</Badge>}
      </CardHeader>
      <CardContent className="space-y-3">
        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nada pendente para hoje.</p>
        ) : (
          <>
            <ul className="space-y-3">
              {shown.map((n, i) => {
                const v = describeNotification(n);
                return (
                  <li key={n.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium">{v.title}</p>
                      <p className="text-sm text-muted-foreground">{v.subtitle}</p>
                    </div>
                    <Button size="sm" variant={i === 0 ? 'default' : 'outline'} onClick={() => go(n, v.actionPath)}>
                      {v.actionLabel}
                    </Button>
                  </li>
                );
              })}
            </ul>
            {generatedAt && (
              <p className="text-xs text-muted-foreground">
                Gerado hoje às {pad(generatedAt.getHours())}:{pad(generatedAt.getMinutes())}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
```

Simplificar antes de salvar: a variável `today` acima é redundante; remover a linha `const today = ...` e definir `const shown = items[0]?.reference_date === todayLocal ? items : [];` (os `items` já são só os do `reference_date` mais recente).

- [ ] **Step 2: Montar no Dashboard**

Em `src/pages/Index.tsx`, importar `AttentionCard` de `@/components/dashboard/AttentionCard` e renderizar `<AttentionCard />` logo depois de `<FinancialMetrics />`.

- [ ] **Step 3: Verificar**

Run: `npm run build` e `npx vitest run` → verdes. No navegador: card aparece no Dashboard para owner/admin/financeiro, com o título "12 mensalidades vencidas…" da escola de teste e o botão "Ver cobranças" levando a `/mensalidades?status=overdue`; professor não vê o card; sem avisos de hoje mostra "Nada pendente para hoje.".

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/AttentionCard.tsx src/pages/Index.tsx
git commit -m "Card \"Precisa da sua atenção hoje\" no Dashboard (S3 etapa 2)"
```

---

### Task 7: QA, documentação e PR

**Files:**
- Modify: `CHANGELOG.md`, `QA_CHECKLIST.md`, `docs/STATUS.md`
- Modify: `docs/superpowers/specs/2026-11-18-gerador-notificacoes-design.md` (marcar etapa 2 como entregue; registrar a decisão sobre `renewed_count`, ver Step 2)

- [ ] **Step 1: QA completo no navegador**

Seguir o roteiro da spec (seção "Testes (etapa 2)"): sino com contador e popover; marcar como lido (item e "todas"); central com as seis abas, agrupamento e "Carregar mais"; card no Dashboard; botões levando às telas filtradas; perfis owner, admin, financeiro (veem) e professor (não vê); tela a 375 px; dark mode. Registrar o resultado em `QA_CHECKLIST.md` no formato das seções anteriores (S3 preferências).

Se precisar de mais de 20 avisos para testar a paginação, **pedir autorização** antes de executar `generate_daily_notifications(p_now)` ou qualquer escrita em produção; não gerar dados sem autorização.

- [ ] **Step 2: Decidir a pendência `renewed_count`**

A etapa 2 exibe "N já rematriculados · M pendentes" a partir de `renewed_count`, que hoje conta renovações canceladas. Perguntar ao usuário se "já rematriculado" deve excluir contratos `cancelled`. Se sim, é uma migration nova (fora desta etapa de front): registrar no `STATUS.md` como próximo item, sem bloquear o PR.

- [ ] **Step 3: Documentar**

`CHANGELOG.md`: entrada "S3 etapa 2 — interface de notificações" listando sino, central, card e filtro `?status=`. `docs/STATUS.md`: mover a linha "S3, etapa 2" para ✅ e atualizar "O que fazer em seguida" (próximo: pendências da spec, QA da S2 Fase 3, depois S4).

- [ ] **Step 4: Verificação final**

Run: `npx vitest run` (todos verdes) e `npm run build` (sem erros).

- [ ] **Step 5: Commit e PR**

```bash
git add CHANGELOG.md QA_CHECKLIST.md docs/STATUS.md docs/superpowers/specs/2026-11-18-gerador-notificacoes-design.md
git commit -m "Fecha a S3 etapa 2: CHANGELOG, QA e STATUS"
git push -u origin feature/s3-notificacoes-interface
gh pr create --base main --title "S3 etapa 2: sino, central e card de atenção" --body "<resumo + roteiro de QA>"
```

O push e o PR só com o aval do usuário.

---

## Self-review

- **Cobertura da spec:** `notificationText.ts` (Task 2: descrições dos 5 eventos, `groupByDay`, `formatRelativeTime`); `notifications.ts` (Task 3); sino com 4 itens, selo "9+", foco da janela, falha silenciosa, clique que marca e navega (Task 4); central com abas, agrupamento, "Mostrando X de Y", "Carregar mais" por offset com dedupe, vazio por filtro (Task 5); card com itens do `reference_date` mais recente, botão primário no primeiro, rodapé, vazio (Task 6); `?status=` (Task 1); QA e testes (Task 7). Sem lacunas.
- **Placeholders:** nenhum; o único ajuste condicional (imports do hook na Task 3 e simplificação do `today` na Task 6) traz a instrução exata.
- **Consistência de tipos:** `NotificationItem`, `NotificationCategory`, `NotificationsPage`, `listNotifications`, `markNotificationsRead`, `mergeById`, `useShowNotifications` e `describeNotification` mantêm os mesmos nomes e assinaturas em todas as tarefas.
- **Riscos conhecidos:** (1) `formatCurrency` pode usar espaço não separável — os testes usam `\s`; (2) o "hoje" do card depende do fuso do navegador coincidir com o do servidor — nos raros casos em que não coincidir, o card mostra "Nada pendente" (degradação segura, anotada no código).
