# S4a — E-mail por evento Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enviar, às 08:00 no fuso de cada usuário, um e-mail por aviso do sistema (mesmos números do sino), via Resend, lançado **apagado** (interruptor desligado em produção).

**Architecture:** Um job `pg_cron` horário chama, via `pg_net`, a Edge Function `send-notification-emails`. A função reivindica avisos elegíveis num RPC (`claim_notification_emails`, toda a regra de elegibilidade no SQL), envia pelo Resend e registra o resultado (`mark_email_result`) numa fila `email_outbox`. O texto do e-mail reutiliza `describeNotification`, movido para `supabase/functions/_shared/`.

**Tech Stack:** Postgres (pg_cron, pg_net, Vault), Supabase Edge Functions (Deno), Resend HTTP API, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-19-s4a-email-notificacoes-design.md` (decisões E1–E10).

## Global Constraints

- Textos em português do Brasil, com acentuação correta.
- Toda consulta filtra `school_id` explicitamente, mesmo com RLS (CLAUDE.md).
- `gen_random_uuid()` (nunca `uuid_generate_v4()`) e `public.set_updated_at()` (nunca `update_updated_at_column()`): drift de schema em produção (`docs/STATUS.md`, "Armadilhas").
- RLS padrão do projeto: SELECT do próprio usuário na própria escola (+ master) e policy RESTRICTIVE `mfa_gate`; sem policies de escrita (spec G12 da S3).
- RPCs de envio: `SECURITY DEFINER`, `set search_path = public`, `revoke all … from public, anon, authenticated`, `grant execute … to service_role`.
- Segredos **nunca** em migration nem no repositório: chave de serviço no Vault (`service_role_key`); `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_SENDING_ENABLED`, `EMAIL_ALLOWLIST`, `APP_URL` como secrets da função.
- `EMAIL_SENDING_ENABLED` ausente ou diferente de `"true"` = desligado (padrão). Desligado, nada é reivindicado nem registrado.
- A matriz SQL roda em `BEGIN … ROLLBACK` contra produção: **nunca remover o `rollback;`**; não rodar perto das 08:00 UTC.
- **Toda escrita em produção** (`db push`, deploy da função, secrets, Vault, ligar o interruptor) só com autorização explícita do usuário, mostrando `--dry-run` quando existir.
- Comandos Supabase: `npx supabase@2.117.0 …` (versão fixa do projeto). Saída de `db query --linked` é JSON precedido de linhas de log.
- Cores do e-mail em hex inline são permitidas (cliente de e-mail não resolve tokens do tema); o restante da UI segue os tokens.
- Commits em português, cada um terminando com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- `npx vitest run` e `npm run build` verdes ao final de cada tarefa. Erros antigos de `tsc` (StudentForm, generateTuitions, generateExpenses, import/execute, Tuitions) **não** são desta sprint.

---

### Task 1: Mover o texto das notificações para `_shared/`

**Files:**
- Create: `supabase/functions/_shared/notificationText.ts`
- Modify (reescrever): `src/lib/notificationText.ts`
- Test (regressão, sem alterar): `src/lib/notificationText.test.ts`

**Interfaces:**
- Produces (em `_shared/notificationText.ts`, sem imports):
  - `type NotificationEventName = 'tuition_due' | 'tuition_overdue' | 'renegotiation_installment' | 'expense_due' | 'reenrollment'`
  - `type NotificationCategory = 'cobranca' | 'renegociacao' | 'despesas' | 'rematricula'`
  - `interface NotificationFacts { event: NotificationEventName; offset_days: number; item_count: number; total_amount: number | null; details: Record<string, unknown> }`
  - `interface NotificationItem extends NotificationFacts { id: string; reference_date: string; read_at: string | null; created_at: string }`
  - `interface NotificationView { title; subtitle; category; categoryLabel; actionLabel; actionPath }` (inalterado)
  - `CATEGORY_LABELS`, `describeNotification(n: NotificationFacts): NotificationView`, `groupByDay`, `formatRelativeTime`, `DayGroupLabel` (inalterados)
- `src/lib/notificationText.ts` reexporta tudo, mantendo os nomes que o front já importa.

- [ ] **Step 1: Branch a partir da spec**

```bash
git checkout docs/spec-s4a-email && git checkout -b feature/s4a-email-notificacoes
```

- [ ] **Step 2: Criar o módulo compartilhado**

```ts
// supabase/functions/_shared/notificationText.ts
// Textos das notificações. Compartilhado entre o front (src/lib/notificationText.ts
// reexporta) e a Edge Function de e-mail. SEM imports: Deno e Vite importam o mesmo arquivo.

export type NotificationEventName =
  | 'tuition_due'
  | 'tuition_overdue'
  | 'renegotiation_installment'
  | 'expense_due'
  | 'reenrollment';

export type NotificationCategory = 'cobranca' | 'renegociacao' | 'despesas' | 'rematricula';

/** O que basta para descrever um aviso (o e-mail não tem id nem read_at). */
export interface NotificationFacts {
  event: NotificationEventName;
  offset_days: number;
  item_count: number;
  total_amount: number | null;
  details: Record<string, unknown>;
}

export interface NotificationItem extends NotificationFacts {
  id: string;
  reference_date: string; // 'YYYY-MM-DD'
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

// Mesma saída de formatCurrency em src/lib/calculations.ts (duplicado de propósito:
// este arquivo não pode importar nada).
const formatBRL = (value: number): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const dias = (n: number) => `${n} ${plural(n, 'dia', 'dias')}`;

/** "hoje" / "amanhã" / "em N dias" — para eventos com antecedência. */
function when(offset: number): string {
  if (offset === 0) return 'hoje';
  if (offset === 1) return 'amanhã';
  return `em ${dias(offset)}`;
}

export function describeNotification(n: NotificationFacts): NotificationView {
  const c = n.item_count;
  const total = n.total_amount ?? 0;
  switch (n.event) {
    case 'tuition_due':
      return {
        title: `${c} ${plural(c, 'mensalidade', 'mensalidades')} ${plural(c, 'vence', 'vencem')} ${when(n.offset_days)}`,
        subtitle: 'Bom momento para enviar o lembrete aos responsáveis.',
        category: 'cobranca', categoryLabel: CATEGORY_LABELS.cobranca,
        actionLabel: 'Ver cobranças', actionPath: '/mensalidades?status=pending',
      };
    case 'tuition_overdue': {
      const classes = Number(n.details.class_count ?? 0);
      return {
        title: `${c} ${plural(c, 'mensalidade vencida', 'mensalidades vencidas')} há mais de ${dias(n.offset_days)}`,
        subtitle: `${formatBRL(total)} em atraso, em ${classes} ${plural(classes, 'turma', 'turmas')}.`,
        category: 'cobranca', categoryLabel: CATEGORY_LABELS.cobranca,
        actionLabel: 'Ver cobranças', actionPath: '/mensalidades?status=overdue',
      };
    }
    case 'renegotiation_installment':
      return {
        title: `${c} ${plural(c, 'parcela', 'parcelas')} de renegociação ${plural(c, 'vence', 'vencem')} ${when(n.offset_days)}`,
        subtitle: 'Acordos ativos com parcelas em aberto.',
        category: 'renegociacao', categoryLabel: CATEGORY_LABELS.renegociacao,
        actionLabel: 'Ver parcelas', actionPath: '/mensalidades?status=pending',
      };
    case 'expense_due': {
      const description = typeof n.details.description === 'string' ? n.details.description : null;
      const title = c === 1 && description
        ? `Despesa a pagar: ${description}`
        : `${c} ${plural(c, 'despesa', 'despesas')} ${plural(c, 'vence', 'vencem')} ${when(n.offset_days)}`;
      const venceEm = n.offset_days === 0 ? 'Vence hoje' : n.offset_days === 1 ? 'Vence amanhã' : `Vence em ${dias(n.offset_days)}`;
      return {
        title,
        subtitle: `${venceEm} · ${formatBRL(total)}`,
        category: 'despesas', categoryLabel: CATEGORY_LABELS.despesas,
        actionLabel: c === 1 ? 'Ver despesa' : 'Ver despesas', actionPath: '/despesas',
      };
    }
    case 'reenrollment': {
      const renewed = Number(n.details.renewed_count ?? 0);
      return {
        title: `${c} ${plural(c, 'contrato', 'contratos')} ${plural(c, 'termina', 'terminam')} ${when(n.offset_days)}`,
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

- [ ] **Step 3: Reduzir `src/lib/notificationText.ts` a uma reexportação**

```ts
// O texto das notificações vive em supabase/functions/_shared/ para ser o mesmo no
// e-mail (Edge Function, Deno) e na tela. Este arquivo só reexporta.
export * from '../../supabase/functions/_shared/notificationText.ts';
```

- [ ] **Step 4: Rodar a regressão (os 8 testes existentes e o restante da suíte)**

Run: `npx vitest run 2>&1 | grep -E "Test Files|Tests |FAIL|×"`
Expected: `152 passed`, nenhum FAIL.

- [ ] **Step 5: Build e tipos**

Run: `npm run build 2>&1 | grep -E "built in|error"` → `built in …`.
Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -E "notificationText|notifications|Notification|Attention"` → sem saída (os erros antigos de outros arquivos não contam).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/notificationText.ts src/lib/notificationText.ts
git commit -m "Texto das notificações passa a viver em _shared/ (usado pela tela e pelo e-mail)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Montador do e-mail (`notificationEmail.ts`)

**Files:**
- Create: `supabase/functions/_shared/notificationEmail.ts`
- Test: `supabase/functions/_shared/notificationEmail.test.ts`

**Interfaces:**
- Consumes: `describeNotification`, `NotificationFacts` de `./notificationText.ts` (Task 1).
- Produces:
  - `interface EmailItem extends NotificationFacts { reference_date: string }`
  - `interface EmailContext { appUrl: string; schoolName: string }`
  - `interface BuiltEmail { subject: string; html: string; text: string }`
  - `escapeHtml(s: string): string`
  - `buildNotificationEmail(item: EmailItem, ctx: EmailContext): BuiltEmail`

- [ ] **Step 1: Escrever os testes que falham**

```ts
// supabase/functions/_shared/notificationEmail.test.ts
import { describe, it, expect } from 'vitest';
import { buildNotificationEmail, escapeHtml, type EmailItem } from './notificationEmail.ts';

const ctx = { appUrl: 'https://app.exemplo.com.br/', schoolName: 'Colégio Estrela' };
const base: EmailItem = {
  event: 'tuition_overdue', reference_date: '2026-11-19', offset_days: 5,
  item_count: 12, total_amount: 6840, details: { class_count: 3 },
};
const mk = (o: Partial<EmailItem>): EmailItem => ({ ...base, ...o });

describe('escapeHtml', () => {
  it('escapa os cinco caracteres perigosos', () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  });
});

describe('buildNotificationEmail', () => {
  it('atraso: assunto, botão, rodapé e link sem barra duplicada', () => {
    const m = buildNotificationEmail(base, ctx);
    expect(m.subject).toBe('12 mensalidades vencidas há mais de 5 dias');
    expect(m.html).toContain('href="https://app.exemplo.com.br/mensalidades?status=overdue"');
    expect(m.html).toContain('Ver cobranças');
    expect(m.html).toContain('Colégio Estrela');
    expect(m.html).toContain('href="https://app.exemplo.com.br/notificacoes/preferencias"');
    expect(m.html).toContain('Você recebe este e-mail porque ativou avisos por e-mail');
    expect(m.text).toContain('Ver cobranças: https://app.exemplo.com.br/mensalidades?status=overdue');
    expect(m.text).toContain('Ajustar preferências: https://app.exemplo.com.br/notificacoes/preferencias');
    expect(m.text).toMatch(/em atraso, em 3 turmas\./);
  });

  it('cobre os 5 eventos com assunto e destino certos', () => {
    const cases: [Partial<EmailItem>, string, string][] = [
      [{ event: 'tuition_due', offset_days: 3, item_count: 8 }, '8 mensalidades vencem em 3 dias', '/mensalidades?status=pending'],
      [{ event: 'renegotiation_installment', offset_days: 1, item_count: 3 }, '3 parcelas de renegociação vencem amanhã', '/mensalidades?status=pending'],
      [{ event: 'expense_due', offset_days: 2, item_count: 4, total_amount: 800 }, '4 despesas vencem em 2 dias', '/despesas'],
      [{ event: 'reenrollment', offset_days: 45, item_count: 18, total_amount: null, details: { renewed_count: 6 } }, '18 contratos terminam em 45 dias', '/contratos'],
    ];
    for (const [o, subject, path] of cases) {
      const m = buildNotificationEmail(mk(o), ctx);
      expect(m.subject).toBe(subject);
      expect(m.html).toContain(`href="https://app.exemplo.com.br${path}"`);
    }
  });

  it('escapa texto digitado pelo usuário (descrição de despesa) no HTML', () => {
    const m = buildNotificationEmail(
      mk({ event: 'expense_due', item_count: 1, offset_days: 2, total_amount: 100, details: { description: '<script>alert(1)</script>' } }),
      ctx,
    );
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('assunto sem quebras de linha (anti header injection)', () => {
    const m = buildNotificationEmail(
      mk({ event: 'expense_due', item_count: 1, offset_days: 2, total_amount: 100, details: { description: 'Aluguel\r\nBcc: x@y.com' } }),
      ctx,
    );
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.subject).toBe('Despesa a pagar: Aluguel Bcc: x@y.com');
  });

  it('nome da escola com HTML é escapado', () => {
    const m = buildNotificationEmail(base, { ...ctx, schoolName: 'Escola <b>X</b>' });
    expect(m.html).not.toContain('<b>X</b>');
    expect(m.html).toContain('Escola &lt;b&gt;X&lt;/b&gt;');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run supabase/functions/_shared/notificationEmail.test.ts 2>&1 | grep -E "Tests |FAIL|Error"`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```ts
// supabase/functions/_shared/notificationEmail.ts
// Monta o e-mail de um aviso. Puro e sem imports de Deno/Supabase (testável no Vitest).
import { describeNotification, type NotificationFacts } from './notificationText.ts';

export interface EmailItem extends NotificationFacts {
  reference_date: string;
}
export interface EmailContext {
  appUrl: string;
  schoolName: string;
}
export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

export function buildNotificationEmail(item: EmailItem, ctx: EmailContext): BuiltEmail {
  const v = describeNotification(item);
  const base = ctx.appUrl.replace(/\/+$/, '');
  const actionUrl = base + v.actionPath;
  const prefsUrl = base + '/notificacoes/preferencias';
  const school = oneLine(ctx.schoolName);
  const subject = oneLine(v.title);
  const footer = 'Você recebe este e-mail porque ativou avisos por e-mail no Class Cash.';

  const text = [
    school,
    '',
    v.title,
    v.subtitle,
    '',
    `${v.actionLabel}: ${actionUrl}`,
    '',
    footer,
    `Ajustar preferências: ${prefsUrl}`,
  ].join('\n');

  // Tabelas e estilos inline: clientes de e-mail não suportam CSS moderno nem tokens do tema.
  const html = `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:8px;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#18181b;">
        <tr><td style="font-size:13px;color:#52525b;padding-bottom:12px;">${escapeHtml(school)}</td></tr>
        <tr><td style="font-size:20px;font-weight:700;line-height:1.3;padding-bottom:8px;">${escapeHtml(v.title)}</td></tr>
        <tr><td style="font-size:15px;line-height:1.5;color:#3f3f46;padding-bottom:20px;">${escapeHtml(v.subtitle)}</td></tr>
        <tr><td style="padding-bottom:24px;">
          <a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 20px;border-radius:6px;">${escapeHtml(v.actionLabel)}</a>
        </td></tr>
        <tr><td style="font-size:12px;line-height:1.5;color:#52525b;border-top:1px solid #e4e4e7;padding-top:16px;">
          ${escapeHtml(footer)}<br>
          <a href="${escapeHtml(prefsUrl)}" style="color:#3f3f46;">Ajustar preferências</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run supabase/functions/_shared/notificationEmail.test.ts 2>&1 | grep -E "Tests |FAIL"`
Expected: `5 passed` (ou o total de testes do arquivo), nenhum FAIL. Se `toContain('Ver cobranças')` falhar por entidade, revise o `escapeHtml` do rótulo (não deve alterar letras acentuadas).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/notificationEmail.ts supabase/functions/_shared/notificationEmail.test.ts
git commit -m "Montador do e-mail de notificação (HTML + texto, com escape e assunto em uma linha)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Banco — `pg_net`, `email_outbox`, RPCs e matriz SQL

**Files:**
- Create: `supabase/migrations/20261119130000_enable_pg_net.sql`
- Create: `supabase/migrations/20261119130100_email_outbox.sql`
- Create: `supabase/migrations/20261119130200_email_claim_rpcs.sql`
- Create: `supabase/tests/email_outbox_matrix.sql`

**Interfaces:**
- Produces (SQL):
  - tabela `public.email_outbox (id, school_id, user_id, event, reference_date, status, attempts, last_error, provider_message_id, sent_at, created_at, updated_at)`, `UNIQUE (user_id, school_id, event, reference_date)`
  - `public.claim_notification_emails(p_now timestamptz default now(), p_limit integer default 40, p_only_emails text[] default null) returns jsonb` — array de `{ outbox_id, to_email, school_name, event, reference_date, offset_days, item_count, total_amount, details }`
  - `public.mark_email_result(p_outbox_id uuid, p_status text, p_provider_id text default null, p_error text default null) returns void`
  - ambos restritos ao `service_role`.

- [ ] **Step 1: Migration do `pg_net` (isolada: se a extensão exigir privilégio, falha sozinha)**

```sql
-- supabase/migrations/20261119130000_enable_pg_net.sql
-- S4a: pg_net permite ao pg_cron chamar a Edge Function de e-mail (net.http_post).
create extension if not exists pg_net with schema extensions;
```

- [ ] **Step 2: Migration da fila**

```sql
-- supabase/migrations/20261119130100_email_outbox.sql
-- S4a: fila de e-mails por evento. Uma linha por usuário × escola × evento × dia.
-- SEM FK para notifications: o aviso de atraso é substituído todo dia e o histórico
-- de envio não pode sumir junto. Escrita só pelos RPCs (service_role); sem policies de escrita.

create table if not exists public.email_outbox (
  id                  uuid primary key default gen_random_uuid(),
  school_id           uuid not null references public.schools(id) on delete cascade,
  user_id             uuid not null references auth.users(id)     on delete cascade,
  event               text not null
                      check (event in ('tuition_due','tuition_overdue','renegotiation_installment','expense_due','reenrollment')),
  reference_date      date not null,
  status              text not null check (status in ('sending','sent','failed')),
  attempts            integer not null default 0,
  last_error          text,
  provider_message_id text,
  sent_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint email_outbox_user_school_event_day_key unique (user_id, school_id, event, reference_date)
);
create index if not exists idx_email_outbox_status_updated on public.email_outbox (status, updated_at);

drop trigger if exists update_email_outbox_updated_at on public.email_outbox;
create trigger update_email_outbox_updated_at
  before update on public.email_outbox
  for each row execute function public.set_updated_at();

alter table public.email_outbox enable row level security;

drop policy if exists email_outbox_select on public.email_outbox;
create policy email_outbox_select on public.email_outbox
  for select to authenticated
  using ((user_id = auth.uid() and school_id = public.get_user_school_id()) or public.is_master_admin());

drop policy if exists mfa_gate on public.email_outbox;
create policy mfa_gate on public.email_outbox as restrictive for all to authenticated
  using ((select public.mfa_gate_ok())) with check ((select public.mfa_gate_ok()));
```

- [ ] **Step 3: Migration dos RPCs**

```sql
-- supabase/migrations/20261119130200_email_claim_rpcs.sql
-- S4a: reivindicação e resultado de envios. Chamados só pela Edge Function (service_role).
-- Regras (spec E3, E6, E7): aviso do próprio dia, a partir das 08:00 locais, canal e-mail ligado,
-- tela confirmada (confirmed_at), destinatário atual, e-mail confirmado.

create or replace function public.claim_notification_emails(
  p_now         timestamptz default now(),
  p_limit       integer     default 40,
  p_only_emails text[]      default null
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'INVALID_LIMIT' using errcode = '22023';
  end if;

  with cand as (
    select n.user_id, n.school_id, n.event, n.reference_date, n.created_at as n_created,
           n.offset_days, n.item_count, n.total_amount, n.details,
           u.email as to_email, sc.name as school_name
      from public.notifications n
      join public.profiles p                 on p.user_id = n.user_id and p.school_id = n.school_id
      join auth.users u                      on u.id = n.user_id
      join public.schools sc                 on sc.id = n.school_id
      join public.notification_settings s    on s.user_id = n.user_id and s.school_id = n.school_id
      join public.notification_preferences np on np.user_id = n.user_id and np.school_id = n.school_id and np.event = n.event
      join public.notification_event_defaults() d on d.event = n.event
     where s.confirmed_at is not null
       and np.email
       and u.email is not null and u.email_confirmed_at is not null
       and (p_only_emails is null
            or lower(u.email) = any (select lower(x) from unnest(p_only_emails) x))
       and n.reference_date = (p_now at time zone coalesce(s.timezone, 'America/Sao_Paulo'))::date
       and extract(hour from (p_now at time zone coalesce(s.timezone, 'America/Sao_Paulo'))) >= 8
       and (public.mfa_is_admin_or_owner(n.user_id, n.school_id)
            or (not d.admin_only
                and exists (select 1 from public.user_roles r where r.user_id = n.user_id and r.role = 'financial')))
  ),
  eligible as (
    select c.*
      from cand c
      left join public.email_outbox o
        on o.user_id = c.user_id and o.school_id = c.school_id
       and o.event = c.event and o.reference_date = c.reference_date
     where o.id is null
        or (o.status = 'failed'  and o.attempts < 3)
        or (o.status = 'sending' and o.attempts < 3 and o.updated_at < now() - interval '30 minutes')
     order by c.n_created, c.user_id, c.event
     limit p_limit
  ),
  claimed as (
    insert into public.email_outbox as o (school_id, user_id, event, reference_date, status, attempts)
    select school_id, user_id, event, reference_date, 'sending', 1 from eligible
    on conflict (user_id, school_id, event, reference_date) do update
      set status = 'sending', attempts = o.attempts + 1
      where o.attempts < 3
        and (o.status = 'failed'
             or (o.status = 'sending' and o.updated_at < now() - interval '30 minutes'))
    returning o.id, o.user_id, o.school_id, o.event, o.reference_date
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'outbox_id',      cl.id,
           'to_email',       e.to_email,
           'school_name',    e.school_name,
           'event',          e.event,
           'reference_date', e.reference_date,
           'offset_days',    e.offset_days,
           'item_count',     e.item_count,
           'total_amount',   e.total_amount,
           'details',        e.details
         ) order by e.n_created, e.user_id, e.event), '[]'::jsonb)
    into v_result
    from claimed cl
    join eligible e
      on e.user_id = cl.user_id and e.school_id = cl.school_id
     and e.event = cl.event and e.reference_date = cl.reference_date;

  return v_result;
end $$;

create or replace function public.mark_email_result(
  p_outbox_id   uuid,
  p_status      text,
  p_provider_id text default null,
  p_error       text default null
) returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if p_status is null or p_status not in ('sent', 'failed') then
    raise exception 'INVALID_STATUS' using errcode = '22023';
  end if;
  -- Só uma linha em 'sending' recebe resultado: um aviso tardio não sobrescreve um reenvio.
  update public.email_outbox
     set status              = p_status,
         provider_message_id = case when p_status = 'sent'   then p_provider_id else provider_message_id end,
         sent_at             = case when p_status = 'sent'   then now() else sent_at end,
         last_error          = case when p_status = 'failed' then left(coalesce(p_error, 'erro desconhecido'), 500) else null end
   where id = p_outbox_id and status = 'sending';
end $$;

revoke all on function public.claim_notification_emails(timestamptz, integer, text[]) from public, anon, authenticated;
revoke all on function public.mark_email_result(uuid, text, text, text)               from public, anon, authenticated;
grant execute on function public.claim_notification_emails(timestamptz, integer, text[]) to service_role;
grant execute on function public.mark_email_result(uuid, text, text, text)               to service_role;
```

- [ ] **Step 4: Escrever a matriz SQL**

A matriz reaproveita os dois usuários de teste da `notifications_matrix.sql` (admin e financeiro, movidos para uma escola de teste criada dentro da transação). Insere os avisos direto em `notifications` (não depende do gerador) e simula o relógio com `p_now`. O marcador `-- @@MIGRATION@@` é trocado pelas migrations 2 e 3 na hora de rodar (Step 6).

```sql
-- supabase/tests/email_outbox_matrix.sql
-- Matriz do envio de e-mails por evento (S4a). Spec: docs/superpowers/specs/2026-11-19-s4a-email-notificacoes-design.md
-- Tudo dentro de BEGIN ... ROLLBACK: nada persiste.
-- ATENÇÃO: roda contra PRODUÇÃO, cria uma escola de teste, move dois usuários de teste para ela e
-- confirma o e-mail deles dentro da transação — NUNCA remova o "rollback;" do final.
--
-- Como rodar (migrations ainda NÃO aplicadas): gerar um arquivo que troca a linha marcadora MIGRATION
-- (sozinha na linha) pelo conteúdo de 20261119130100_email_outbox.sql seguido de 20261119130200_email_claim_rpcs.sql.
-- Migrations já aplicadas: npx supabase@2.117.0 db query --linked -f supabase/tests/email_outbox_matrix.sql
-- Saída: uma linha por verificação; "ok" deve ser true em TODAS.

begin;

-- @@MIGRATION@@

create temp table t_res (n serial, cenario text, got text, esperado text, ok boolean);

create function pg_temp.run_as(p_uid uuid, p_aal text, p_sql text)
returns text language plpgsql as $f$
declare v text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'aal', p_aal, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    execute p_sql into v;
  exception when others then
    v := 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v;
end $f$;

create function pg_temp.rec(p_cenario text, p_got text, p_esperado text) returns void language sql as $f$
  insert into t_res (cenario, got, esperado, ok)
  values (p_cenario, p_got, p_esperado,
          coalesce(p_got = p_esperado or (p_esperado like 'ERR:%' and p_got like p_esperado || '%'), false))
$f$;

-- quantos itens a reivindicação devolveu
create function pg_temp.claimed(p_now timestamptz, p_only text[] default null) returns text language sql as $f$
  select jsonb_array_length(public.claim_notification_emails(p_now, 40, p_only))::text
$f$;

do $$
declare
  u_master uuid := '52d00ab5-567f-4537-b33a-22c2bd44e14d'; -- master + owner + admin, Colegio Teste
  u_admin  uuid := 'e0185312-eea9-4273-a9a8-ad9d575d4781'; -- admin (movido para a escola X)
  u_fin    uuid := 'b7ba4eb2-c7a2-4129-83a8-de8e7175c446'; -- financeiro (movido para a escola X)
  d        date := date '2031-03-10';
  t_8sp    timestamptz := '2031-03-10 11:00:00+00';   -- 08:00 em São Paulo (UTC-3)
  t_7sp    timestamptz := '2031-03-10 10:59:00+00';   -- 07:59 em São Paulo
  t_8hnl   timestamptz := '2031-03-10 18:00:00+00';   -- 08:00 em Honolulu (UTC-10)
  s_x uuid; s_y uuid;
  e_admin text; id_ad_over uuid; id_ad_re uuid; id_fin_over uuid;
  v text;
begin
  perform set_config('request.jwt.claims', '', true);

  insert into public.schools (name, owner_user_id) values ('Escola Teste S4a X', u_master) returning id into s_x;
  insert into public.schools (name, owner_user_id) values ('Escola Teste S4a Y', u_master) returning id into s_y;
  update public.profiles set school_id = s_x where user_id in (u_admin, u_fin);
  delete from auth.mfa_factors where user_id in (u_admin, u_fin);
  delete from public.mfa_grace  where user_id in (u_admin, u_fin);
  delete from public.notification_preferences where user_id in (u_admin, u_fin);
  delete from public.notification_settings    where user_id in (u_admin, u_fin);
  delete from public.notifications            where user_id in (u_admin, u_fin);
  delete from public.email_outbox             where user_id in (u_admin, u_fin);
  update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id in (u_admin, u_fin);
  select email into e_admin from auth.users where id = u_admin;

  -- Os dois confirmaram a tela e ligaram e-mail em atraso e rematrícula (fin tem linha de rematrícula
  -- de propósito: o financeiro NÃO é destinatário desse evento).
  insert into public.notification_settings (school_id, user_id, confirmed_at) values (s_x, u_admin, now()), (s_x, u_fin, now());
  insert into public.notification_preferences (school_id, user_id, event, in_app, email, offset_days) values
    (s_x, u_admin, 'tuition_overdue', true, true, 5), (s_x, u_admin, 'reenrollment', true, true, 45),
    (s_x, u_fin,   'tuition_overdue', true, true, 5), (s_x, u_fin,   'reenrollment', true, true, 45);

  insert into public.notifications (school_id, user_id, event, reference_date, offset_days, item_count, total_amount, details) values
    (s_x, u_admin, 'tuition_overdue', d, 5, 12, 6840, '{"class_count": 3}'),
    (s_x, u_admin, 'reenrollment',    d, 45, 18, null, '{"renewed_count": 6}'),
    (s_x, u_fin,   'tuition_overdue', d, 5, 12, 6840, '{"class_count": 3}'),
    (s_x, u_fin,   'reenrollment',    d, 45, 18, null, '{"renewed_count": 6}'),
    (s_y, u_admin, 'tuition_overdue', d, 5, 99, 1,    '{"class_count": 1}');   -- escola Y: admin não tem perfil lá (isca)

  -- 1. Horário local
  perform pg_temp.rec('1a antes das 08:00 locais: nada',           pg_temp.claimed(t_7sp), '0');
  perform pg_temp.rec('1b às 08:00 locais: admin(2) + fin(1) — fin não recebe rematrícula', pg_temp.claimed(t_8sp), '3');
  perform pg_temp.rec('1c fila tem exatamente esses 3',
    (select string_agg(x, ',' order by x) from (
       select case user_id when u_admin then 'admin' else 'fin' end || ':' || event as x
         from public.email_outbox where school_id = s_x) t),
    'admin:reenrollment,admin:tuition_overdue,fin:tuition_overdue');
  perform pg_temp.rec('1d escola Y (sem vínculo do admin) não gera fila',
    (select count(*)::text from public.email_outbox where school_id = s_y), '0');

  -- 2. Não duplica
  perform pg_temp.rec('2a segunda chamada imediata: nada (já reivindicado)', pg_temp.claimed(t_8sp), '0');
  perform pg_temp.rec('2b tentativas = 1 em todas',
    (select string_agg(distinct attempts::text, ',') from public.email_outbox where school_id = s_x), '1');

  -- 3. Payload (reivindicação filtrada para o admin, 1º item)
  delete from public.email_outbox where school_id = s_x;
  perform pg_temp.rec('3a payload traz nome da escola e e-mail',
    (select ((it ->> 'school_name') || '|' || (it ->> 'to_email') = 'Escola Teste S4a X|' || e_admin)::text
       from (select (public.claim_notification_emails(t_8sp, 40, array[e_admin])) -> 0 as it) q), 'true');
  delete from public.email_outbox where school_id = s_x;

  -- 4. Resultado e tentativas
  perform pg_temp.claimed(t_8sp);                                   -- 3 linhas 'sending'
  select id into id_ad_over from public.email_outbox where user_id = u_admin and event = 'tuition_overdue';
  select id into id_fin_over from public.email_outbox where user_id = u_fin   and event = 'tuition_overdue';
  perform public.mark_email_result(id_ad_over, 'sent', 're_123', null);
  perform pg_temp.rec('4a sent grava id do provedor e sent_at',
    (select (status = 'sent' and provider_message_id = 're_123' and sent_at is not null)::text
       from public.email_outbox where id = id_ad_over), 'true');
  begin
    perform public.mark_email_result(id_fin_over, 'xyz');
    perform pg_temp.rec('4b status inválido falha', 'sem erro', 'ERR:22023');
  exception when others then
    perform pg_temp.rec('4b status inválido falha', 'ERR:' || sqlstate, 'ERR:22023');
  end;
  perform public.mark_email_result(id_fin_over, 'failed', null, 'boom');
  perform pg_temp.rec('4c failed grava o erro', (select last_error from public.email_outbox where id = id_fin_over), 'boom');
  perform pg_temp.rec('4d failed com 1 tentativa volta à fila', pg_temp.claimed(t_8sp), '1');
  perform pg_temp.rec('4e tentativas = 2 após o reenvio', (select attempts::text from public.email_outbox where id = id_fin_over), '2');
  perform public.mark_email_result(id_fin_over, 'failed', null, 'boom 2');
  perform pg_temp.rec('4f falha com 2 tentativas volta (3ª)', pg_temp.claimed(t_8sp), '1');
  perform public.mark_email_result(id_fin_over, 'failed', null, 'boom 3');
  perform pg_temp.rec('4g falha com 3 tentativas NÃO volta mais', pg_temp.claimed(t_8sp), '0');
  perform public.mark_email_result(id_ad_over, 'failed', null, 'tardio');   -- já 'sent': resultado tardio não sobrescreve
  perform pg_temp.rec('4h resultado tardio não altera linha que não está em sending',
    (select status from public.email_outbox where id = id_ad_over), 'sent');

  -- 5. 'sending' parado volta; recente não
  select id into id_ad_re from public.email_outbox where user_id = u_admin and event = 'reenrollment';
  perform pg_temp.rec('5a sending recente não volta', pg_temp.claimed(t_8sp), '0');
  alter table public.email_outbox disable trigger update_email_outbox_updated_at;
  update public.email_outbox set updated_at = now() - interval '1 hour' where id = id_ad_re;
  alter table public.email_outbox enable trigger update_email_outbox_updated_at;
  perform pg_temp.rec('5b sending parado há 1h volta', pg_temp.claimed(t_8sp), '1');
  perform pg_temp.rec('5c tentativas = 2 após o reclaim', (select attempts::text from public.email_outbox where id = id_ad_re), '2');

  -- 6. Fuso: financeiro em Honolulu
  delete from public.email_outbox where school_id = s_x;
  update public.notification_settings set timezone = 'Pacific/Honolulu' where user_id = u_fin;
  perform pg_temp.rec('6a Honolulu 01:00 locais: fin não recebe (admin sim: 2)', pg_temp.claimed(t_8sp), '2');
  perform pg_temp.rec('6b Honolulu 08:00 locais: fin recebe', pg_temp.claimed(t_8hnl), '1');
  update public.notification_settings set timezone = 'America/Sao_Paulo' where user_id = u_fin;

  -- 7. Só o aviso do próprio dia
  delete from public.email_outbox where school_id = s_x;
  insert into public.notification_preferences (school_id, user_id, event, in_app, email, offset_days)
    values (s_x, u_fin, 'tuition_due', true, true, 3);
  insert into public.notifications (school_id, user_id, event, reference_date, offset_days, item_count, total_amount, details)
    values (s_x, u_fin, 'tuition_due', d - 1, 3, 2, 100, '{"class_count": 1}');   -- aviso de ONTEM
  perform pg_temp.claimed(t_8sp);
  perform pg_temp.rec('7a aviso de ontem nunca vira e-mail',
    (select count(*)::text from public.email_outbox where user_id = u_fin and event = 'tuition_due'), '0');

  -- 8. Sem confirmed_at
  delete from public.email_outbox where school_id = s_x;
  update public.notification_settings set confirmed_at = null where user_id = u_fin;
  perform pg_temp.claimed(t_8sp);
  perform pg_temp.rec('8a tela não confirmada: sem e-mail', (select count(*)::text from public.email_outbox where user_id = u_fin), '0');
  update public.notification_settings set confirmed_at = now() where user_id = u_fin;

  -- 9. Canal e-mail desligado / sem linha de preferência
  delete from public.email_outbox where school_id = s_x;
  update public.notification_preferences set email = false where user_id = u_fin and event = 'tuition_overdue';
  perform pg_temp.claimed(t_8sp);
  perform pg_temp.rec('9a email = false: sem e-mail', (select count(*)::text from public.email_outbox where user_id = u_fin), '0');
  update public.notification_preferences set email = true where user_id = u_fin and event = 'tuition_overdue';
  delete from public.notification_preferences where user_id = u_fin and event = 'tuition_overdue';
  delete from public.email_outbox where school_id = s_x;
  perform pg_temp.claimed(t_8sp);
  perform pg_temp.rec('9b sem linha de preferência: sem e-mail', (select count(*)::text from public.email_outbox where user_id = u_fin), '0');
  insert into public.notification_preferences (school_id, user_id, event, in_app, email, offset_days)
    values (s_x, u_fin, 'tuition_overdue', true, true, 5);

  -- 10. E-mail não confirmado
  delete from public.email_outbox where school_id = s_x;
  update auth.users set email_confirmed_at = null where id = u_fin;
  perform pg_temp.claimed(t_8sp);
  perform pg_temp.rec('10a e-mail não confirmado: sem envio', (select count(*)::text from public.email_outbox where user_id = u_fin), '0');
  update auth.users set email_confirmed_at = now() where id = u_fin;

  -- 11. Papel atual
  delete from public.email_outbox where school_id = s_x;
  update public.user_roles set role = 'teacher' where user_id = u_fin;
  perform pg_temp.claimed(t_8sp);
  perform pg_temp.rec('11a financeiro virou professor: sem envio', (select count(*)::text from public.email_outbox where user_id = u_fin), '0');
  update public.user_roles set role = 'financial' where user_id = u_fin;

  -- 12. Allowlist e limite
  delete from public.email_outbox where school_id = s_x;
  perform pg_temp.rec('12a allowlist (case-insensitive) só deixa passar o admin: 2', pg_temp.claimed(t_8sp, array[upper(e_admin)]), '2');
  delete from public.email_outbox where school_id = s_x;
  perform pg_temp.rec('12b p_limit = 1 devolve 1', (select jsonb_array_length(public.claim_notification_emails(t_8sp, 1))::text), '1');
  begin
    perform public.claim_notification_emails(t_8sp, 0);
    perform pg_temp.rec('12c p_limit = 0 falha', 'sem erro', 'ERR:22023');
  exception when others then
    perform pg_temp.rec('12c p_limit = 0 falha', 'ERR:' || sqlstate, 'ERR:22023');
  end;

  -- 13. Permissões e RLS
  perform pg_temp.rec('13a usuário comum não chama o RPC', pg_temp.run_as(u_admin, 'aal1',
    'select public.claim_notification_emails()::text'), 'ERR:42501');
  delete from public.email_outbox where school_id = s_x;
  perform pg_temp.claimed(t_8sp);
  perform pg_temp.rec('13b admin vê só as próprias linhas na fila', pg_temp.run_as(u_admin, 'aal1',
    'select count(*)::text from public.email_outbox'),
    (select count(*)::text from public.email_outbox where user_id = u_admin));
  perform pg_temp.rec('13c admin não vê linhas do financeiro', pg_temp.run_as(u_admin, 'aal1', format(
    'select count(*)::text from public.email_outbox where user_id = %L', u_fin)), '0');
  perform pg_temp.rec('13d INSERT direto na fila falha', pg_temp.run_as(u_admin, 'aal1', format(
    $q$with x as (insert into public.email_outbox (school_id, user_id, event, reference_date, status)
       values (%L, auth.uid(), 'tuition_due', current_date, 'sent') returning 1) select count(*)::text from x$q$, s_x)), 'ERR:42501');
  perform pg_temp.rec('13e UPDATE direto não afeta', pg_temp.run_as(u_admin, 'aal1',
    'with x as (update public.email_outbox set status = ''sent'' where user_id = auth.uid() returning 1) select count(*)::text from x'), '0');
end $$;

select n, cenario, got, esperado, ok from t_res order by n;

rollback;
```

- [ ] **Step 5: Rodar a matriz e ver falhar (ainda sem as migrations aplicadas e sem o marcador trocado)**

Run: `npx supabase@2.117.0 db query --linked -f supabase/tests/email_outbox_matrix.sql 2>&1 | tail -8`
Expected: erro `relation "public.email_outbox" does not exist` ou `function … does not exist` (vermelho esperado: a tabela e os RPCs ainda não existem no banco). A transação é descartada; nada persiste.

- [ ] **Step 6: Rodar a matriz com as migrations embutidas (BEGIN…ROLLBACK, lê/valida sem aplicar)**

```bash
B="C:/Users/mathe/AppData/Local/Temp/claude/f869db936a1e168f/34e3216f-f7ee-454a-9c3b-6fc894e0f1a5/scratchpad"
python - <<EOF
m1=open('supabase/migrations/20261119130100_email_outbox.sql',encoding='utf-8').read()
m2=open('supabase/migrations/20261119130200_email_claim_rpcs.sql',encoding='utf-8').read()
t=open('supabase/tests/email_outbox_matrix.sql',encoding='utf-8').read()
assert t.count('-- @@MIGRATION@@')==1 and t.rstrip().endswith('rollback;')
open(r'$B/email_matrix_with_migration.sql','w',encoding='utf-8').write(t.replace('-- @@MIGRATION@@', m1 + '\n' + m2))
EOF
timeout 110 npx supabase@2.117.0 db query --linked -f "$B/email_matrix_with_migration.sql" 2>&1 | python -c "
import sys,json
t=sys.stdin.read(); r=json.loads(t[t.index('{'):])['rows']
print(len(r),'casos; falhas:',[(x['cenario'],x['got'],x['esperado']) for x in r if not x['ok']])"
```
Expected: todos os casos `ok` (`falhas: []`). Se um caso falhar, corrija a **migration** (não o caso) a menos que o caso esteja errado; rode de novo. Pré-requisito: autorização do usuário para a matriz (lê/escreve só dentro da transação descartada) e longe das 08:00 UTC.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261119130000_enable_pg_net.sql supabase/migrations/20261119130100_email_outbox.sql supabase/migrations/20261119130200_email_claim_rpcs.sql supabase/tests/email_outbox_matrix.sql
git commit -m "Fila de e-mails (email_outbox) e RPCs de reivindicação/resultado, com matriz SQL (ainda não aplicadas)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Edge Function `send-notification-emails`

**Files:**
- Create: `supabase/functions/send-notification-emails/helpers.ts`
- Test: `supabase/functions/send-notification-emails/helpers.test.ts`
- Create: `supabase/functions/send-notification-emails/index.ts`
- Modify: `supabase/config.toml` (acrescentar o bloco da função)

**Interfaces:**
- Consumes: `buildNotificationEmail` (Task 2); RPCs `claim_notification_emails`, `mark_email_result` (Task 3).
- Produces (`helpers.ts`, puro, sem imports):
  - `bearerMatches(header: string | null, key: string): boolean` (comparação em tempo constante)
  - `isSendingEnabled(raw: string | undefined | null): boolean` (só `"true"`)
  - `parseAllowlist(raw: string | undefined | null): string[] | null` (`null` quando vazio)
  - `errorMessage(status: number, body: unknown): string` (≤ 500 chars)

- [ ] **Step 1: Teste que falha**

```ts
// supabase/functions/send-notification-emails/helpers.test.ts
import { describe, it, expect } from 'vitest';
import { bearerMatches, isSendingEnabled, parseAllowlist, errorMessage } from './helpers.ts';

describe('bearerMatches', () => {
  it('aceita só o Bearer exato', () => {
    expect(bearerMatches('Bearer abc123', 'abc123')).toBe(true);
    expect(bearerMatches('Bearer abc124', 'abc123')).toBe(false);
    expect(bearerMatches('abc123', 'abc123')).toBe(false);
    expect(bearerMatches(null, 'abc123')).toBe(false);
    expect(bearerMatches('Bearer ', 'abc123')).toBe(false);
    expect(bearerMatches('Bearer abc123', '')).toBe(false);
  });
});

describe('isSendingEnabled', () => {
  it('só "true" liga', () => {
    expect(isSendingEnabled('true')).toBe(true);
    for (const v of [undefined, null, '', 'TRUE', '1', 'yes', 'false']) expect(isSendingEnabled(v as never)).toBe(false);
  });
});

describe('parseAllowlist', () => {
  it('separa por vírgula, apara espaços e ignora vazios', () => {
    expect(parseAllowlist(' a@x.com, b@y.com ,, ')).toEqual(['a@x.com', 'b@y.com']);
  });
  it('vazio ou ausente = null (sem filtro)', () => {
    expect(parseAllowlist(undefined)).toBeNull();
    expect(parseAllowlist('')).toBeNull();
    expect(parseAllowlist(' , ')).toBeNull();
  });
});

describe('errorMessage', () => {
  it('usa message do corpo quando existe, com o status', () => {
    expect(errorMessage(403, { message: 'domain not verified' })).toBe('HTTP 403: domain not verified');
  });
  it('serializa corpo sem message e trunca em 500', () => {
    expect(errorMessage(500, { x: 1 })).toBe('HTTP 500: {"x":1}');
    expect(errorMessage(500, { message: 'a'.repeat(900) }).length).toBe(500);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run supabase/functions/send-notification-emails/helpers.test.ts 2>&1 | grep -E "Tests |FAIL|Error"` → FAIL (módulo não existe).

- [ ] **Step 3: Implementar os helpers**

```ts
// supabase/functions/send-notification-emails/helpers.ts
// Regras puras da Edge Function, sem imports de Deno (testáveis no Vitest).

/** Compara o Authorization recebido com a chave de serviço, em tempo constante. */
export function bearerMatches(header: string | null, key: string): boolean {
  if (!header || !key || !header.startsWith('Bearer ')) return false;
  const given = header.slice('Bearer '.length);
  if (given.length !== key.length) return false;
  let diff = 0;
  for (let i = 0; i < key.length; i++) diff |= given.charCodeAt(i) ^ key.charCodeAt(i);
  return diff === 0;
}

/** Interruptor global (E9): só o texto exato "true" liga. */
export function isSendingEnabled(raw: string | undefined | null): boolean {
  return raw === 'true';
}

/** EMAIL_ALLOWLIST: "a@x.com, b@y.com" → lista; vazio → null (sem filtro). */
export function parseAllowlist(raw: string | undefined | null): string[] | null {
  const list = (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : null;
}

/** Texto de erro gravado em email_outbox.last_error (máx. 500 caracteres). */
export function errorMessage(status: number, body: unknown): string {
  const msg =
    body && typeof body === 'object' && 'message' in body && typeof (body as { message: unknown }).message === 'string'
      ? (body as { message: string }).message
      : JSON.stringify(body);
  return `HTTP ${status}: ${msg}`.slice(0, 500);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run supabase/functions/send-notification-emails/helpers.test.ts 2>&1 | grep -E "Tests |FAIL"` → todos passam.

- [ ] **Step 5: Escrever a função**

```ts
// supabase/functions/send-notification-emails/index.ts
// S4a: envia por e-mail os avisos do dia. Chamada só pelo pg_cron (via pg_net), de hora em hora.
// Toda a regra de quem recebe o quê e quando está no RPC claim_notification_emails (SQL).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildNotificationEmail } from "../_shared/notificationEmail.ts";
import { bearerMatches, errorMessage, isSendingEnabled, parseAllowlist } from "./helpers.ts";

const BATCH = 40;
const PAUSE_MS = 600; // limite do Resend: 2 requisições por segundo
const DEFAULT_APP_URL = "https://class-cash-tan.vercel.app";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

serve(async (req) => {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!bearerMatches(req.headers.get("Authorization"), serviceKey)) {
    return json({ error: "Não autorizado" }, 401);
  }

  // E9: desligado = não reivindica nada (a fila não acumula).
  if (!isSendingEnabled(Deno.env.get("EMAIL_SENDING_ENABLED"))) {
    return json({ skipped: "disabled" });
  }

  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("EMAIL_FROM");
  if (!apiKey || !from) return json({ error: "RESEND_API_KEY e EMAIL_FROM são obrigatórios" }, 500);
  const appUrl = Deno.env.get("APP_URL") || DEFAULT_APP_URL;

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: items, error: claimError } = await supabase.rpc("claim_notification_emails", {
    p_now: new Date().toISOString(),
    p_limit: BATCH,
    p_only_emails: parseAllowlist(Deno.env.get("EMAIL_ALLOWLIST")),
  });
  if (claimError) {
    console.error("claim_notification_emails falhou:", claimError.message);
    return json({ error: "Falha ao reivindicar avisos" }, 500);
  }

  let sent = 0;
  let failed = 0;
  const list = (items ?? []) as Array<Record<string, unknown>>;

  for (let i = 0; i < list.length; i++) {
    const item = list[i] as {
      outbox_id: string; to_email: string; school_name: string; event: never;
      reference_date: string; offset_days: number; item_count: number;
      total_amount: number | null; details: Record<string, unknown>;
    };
    if (i > 0) await sleep(PAUSE_MS);

    let status: "sent" | "failed" = "failed";
    let providerId: string | null = null;
    let error: string | null = null;
    try {
      const mail = buildNotificationEmail(item, { appUrl, schoolName: item.school_name });
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          // Reenvio após queda não duplica o e-mail (válida por 24 h no Resend).
          "Idempotency-Key": item.outbox_id,
        },
        body: JSON.stringify({ from, to: [item.to_email], subject: mail.subject, html: mail.html, text: mail.text }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body && typeof body.id === "string") {
        status = "sent";
        providerId = body.id;
      } else {
        error = errorMessage(res.status, body);
      }
    } catch (e) {
      error = `exceção: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500);
    }

    const { error: markError } = await supabase.rpc("mark_email_result", {
      p_outbox_id: item.outbox_id,
      p_status: status,
      p_provider_id: providerId,
      p_error: error,
    });
    if (markError) console.error("mark_email_result falhou:", markError.message);
    status === "sent" ? sent++ : failed++;
  }

  // Só contagens no log: nunca endereços de e-mail.
  console.log(JSON.stringify({ claimed: list.length, sent, failed }));
  return json({ claimed: list.length, sent, failed });
});
```

- [ ] **Step 6: Registrar `verify_jwt = false` (padrão do projeto: o Bearer é checado no código)**

Acrescentar ao final do bloco de funções de `supabase/config.toml`, depois de `[functions.reset-user-mfa]`:

```toml
[functions.send-notification-emails]
verify_jwt = false
```

- [ ] **Step 7: Verificar**

Run: `npx vitest run 2>&1 | grep -E "Test Files|Tests |FAIL|×"` → tudo verde.
Run: `npm run build 2>&1 | grep -E "built in|error"` → `built in …`.
A função em si não roda no Vitest (Deno); a lógica de decisão está no SQL (matriz) e nos helpers/montador (Vitest). O teste real é o do Task 6.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/send-notification-emails supabase/config.toml
git commit -m "Edge Function send-notification-emails (envio pelo Resend, desligada por padrão)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Job horário, documentação e PR

**Files:**
- Create: `supabase/migrations/20261119130300_send_notification_emails_cron.sql`
- Modify: `CHANGELOG.md`, `QA_CHECKLIST.md`, `docs/STATUS.md`
- Modify (regenerar): `src/integrations/supabase/types.ts` (depois que as migrations estiverem aplicadas, Task 6)

**Interfaces:**
- Consumes: Edge Function `send-notification-emails` (Task 4), `net.http_post` (Task 3, step 1), segredo `service_role_key` no Vault.

- [ ] **Step 1: Migration do job**

```sql
-- supabase/migrations/20261119130300_send_notification_emails_cron.sql
-- S4a: de hora em hora chama a Edge Function de e-mail (spec E4). A chave de serviço vem do
-- Vault (segredo "service_role_key") em tempo de execução: nunca fica nesta migration.
-- Se o segredo ainda não existir, o Bearer vai nulo, a função responde 401 e nada acontece (falha segura).
-- Aplicar SÓ DEPOIS de a função estar implantada.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'send-notification-emails') then
    perform cron.unschedule('send-notification-emails');
  end if;
end $$;

select cron.schedule(
  'send-notification-emails',
  '0 * * * *',
  $cron$
  select net.http_post(
    url     := 'https://rzkguvbdyaukfzgolpqi.supabase.co/functions/v1/send-notification-emails',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || coalesce(
        (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1), '')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);
```

- [ ] **Step 2: Documentar**

`CHANGELOG.md`: nova seção no topo, "Sprint S4a — E-mail por evento (2026-11-19)", com: transporte (Resend), fila `email_outbox`, RPCs, Edge Function, job horário, texto compartilhado em `_shared/`, lançamento apagado, e o resultado da matriz (preencher com o número real de casos e o dia em que for aplicada).

`QA_CHECKLIST.md`: nova seção "Roteiro de QA — S4a, e-mail por evento", com:
- [ ] Matriz `supabase/tests/email_outbox_matrix.sql` toda `ok` contra o schema aplicado
- [ ] `cron.job` com `send-notification-emails` (`0 * * * *`, ativo)
- [ ] Com o interruptor desligado: a função responde `{"skipped":"disabled"}` e `email_outbox` continua vazia
- [ ] Teste de ponta a ponta com `EMAIL_ALLOWLIST` = e-mail do dono: um e-mail chega com assunto, botão e rodapé certos; reexecução não duplica
- [ ] E-mail aparece corretamente no Gmail e no Outlook (celular e desktop)
- [ ] Domínio verificado e `EMAIL_FROM` trocado; remetente correto

`docs/STATUS.md`: linha da S4a na tabela (✅ código pronto, **apagado**; depende de conta no Resend e domínio), passos do usuário (conta Resend, segredo no Vault, domínio), e estas consultas de monitoramento:

```bash
npx supabase@2.117.0 db query --linked "select status, count(*), max(updated_at) from public.email_outbox where reference_date >= current_date - 1 group by 1"
npx supabase@2.117.0 db query --linked "select event, last_error, updated_at from public.email_outbox where status = 'failed' order by updated_at desc limit 10"
npx supabase@2.117.0 db query --linked "select status, start_time from cron.job_run_details where jobid = (select jobid from cron.job where jobname='send-notification-emails') order by start_time desc limit 3"
```

- [ ] **Step 3: Verificação final**

Run: `npx vitest run 2>&1 | grep -E "Test Files|Tests |FAIL"` e `npm run build 2>&1 | grep -E "built in|error"` → verdes.

- [ ] **Step 4: Commit e PR (push só com o aval do usuário)**

```bash
git add supabase/migrations/20261119130300_send_notification_emails_cron.sql CHANGELOG.md QA_CHECKLIST.md docs/STATUS.md
git commit -m "S4a: job horário de envio, CHANGELOG, roteiro de QA e STATUS" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push -u origin feature/s4a-email-notificacoes
gh pr create --base main --title "S4a: e-mail por evento (Resend, fila, envio às 08:00 locais) — lançado apagado" --body "<resumo + roteiro de QA>"
```

---

### Task 6: Lançar em produção, apagado (cada passo com autorização)

Esta tarefa **grava em produção**. Peça autorização por passo e mostre o `--dry-run` antes do `db push`. O PR da Task 5 deve estar mergeado ou, no mínimo, aprovado pelo usuário.

**Files:**
- Modify (regenerar): `src/integrations/supabase/types.ts`

- [ ] **Step 1: Dry-run das migrations da fila e dos RPCs**

Run: `npx supabase@2.117.0 db push --linked --dry-run 2>&1 | tail -10`
Expected: lista **as quatro** migrations (`…130000` a `…130300`). Para aplicar só as três primeiras, mova temporariamente a `…130300` para fora de `supabase/migrations/` (ou aplique depois de implantar a função, passo 4) — o job não pode existir antes da função.

- [ ] **Step 2: Aplicar `pg_net`, fila e RPCs (após autorização)**

Run (com `…130300` ainda fora da pasta): `npx supabase@2.117.0 db push --linked`
Verificar: `npx supabase@2.117.0 db query --linked "select to_regclass('public.email_outbox') is not null as tabela, (select count(*) from pg_extension where extname='pg_net') as pg_net, (select count(*) from pg_proc where proname in ('claim_notification_emails','mark_email_result')) as rpcs"` → `tabela: true`, `pg_net: 1`, `rpcs: 2`.

- [ ] **Step 3: Matriz contra o schema aplicado (BEGIN…ROLLBACK, com autorização)**

Run: `npx supabase@2.117.0 db query --linked -f supabase/tests/email_outbox_matrix.sql` e confira que todos os casos têm `ok = true`. Registre a contagem no CHANGELOG.

- [ ] **Step 4: Implantar a função (após autorização)**

Run: `npx supabase@2.117.0 functions deploy send-notification-emails --no-verify-jwt`
Sem nenhum secret de e-mail definido, o interruptor está desligado. Verificação: chamar a função com a chave de serviço deve responder `{"skipped":"disabled"}`, e sem Bearer, 401.

- [ ] **Step 5: Aplicar o job (após autorização)**

Devolva `…130300` à pasta e rode `npx supabase@2.117.0 db push --linked --dry-run`, depois `db push --linked`. Verificar: `select jobname, schedule, active from cron.job where jobname='send-notification-emails'` → `0 * * * *`, ativo. Depois de uma hora cheia, `cron.job_run_details` deve mostrar `succeeded` e `email_outbox` continua vazia (apagado).

- [ ] **Step 6: Regenerar os tipos**

Run: `npx supabase@2.117.0 gen types typescript --linked > src/integrations/supabase/types.ts` (confira com `git diff --stat` que só entraram `email_outbox` e os dois RPCs) e então `npx vitest run` + `npm run build`.
Commit: `git add src/integrations/supabase/types.ts && git commit -m "types.ts: email_outbox e RPCs de e-mail" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`.

---

### Task 7: Ligar de verdade (depende do usuário)

Passos de configuração, não de código. O estado "apagado" da Task 6 já é um bom ponto de parada.

- [ ] **Step 1 (usuário): Conta no Resend e chave de API.** Criar a conta, gerar a API key.
- [ ] **Step 2 (usuário): Chave de serviço no Vault.** No SQL Editor do Supabase: `select vault.create_secret('<SERVICE_ROLE_KEY do painel>', 'service_role_key');` (a chave nunca vai para o chat nem para o repositório).
- [ ] **Step 3 (com autorização): Teste de ponta a ponta com o remetente de teste.** Definir os secrets `RESEND_API_KEY`, `EMAIL_FROM=Class Cash <onboarding@resend.dev>`, `EMAIL_ALLOWLIST=<e-mail da conta Resend>`, `EMAIL_SENDING_ENABLED=true`. Garantir que o usuário de teste tem `confirmed_at` e e-mail ligado num evento com aviso no dia (preferências, `/notificacoes/preferencias`). Esperar a próxima hora cheia (depois das 08:00 locais) ou chamar a função à mão com a chave de serviço. Esperado: um e-mail chega; `email_outbox` mostra `sent` com `provider_message_id`; nova chamada não duplica.
- [ ] **Step 4 (usuário): Domínio.** Registrar domínio, verificar no Resend (registros DNS), e então trocar `EMAIL_FROM` para o endereço do domínio e **remover** `EMAIL_ALLOWLIST`. Nenhuma mudança de código.
- [ ] **Step 5: Registrar** no `docs/STATUS.md` que a S4a está no ar (e a data) e fechar o item da lista de pendências.

---

## Self-review

**Cobertura da spec:**
- E1/E2 (Resend, secrets): Task 4 (função) e Task 7. E3 (08:00 locais) e E6 (só do dia) e E7 (D3): Task 3 (RPC) + casos 1, 6, 7, 8, 9, 10, 11 da matriz. E4 (cron → pg_net → função): Tasks 3 (extensão) e 5 (job) e 6. E5 (fila sem FK): Task 3, migration `email_outbox`. E8 (texto compartilhado): Task 1. E9 (interruptor): Task 4 (`isSendingEnabled`) + verificação no Task 6/5. E10 (`Idempotency-Key`): Task 4 (index.ts).
- Tabela, RLS, RPCs, reclaim de `sending`, 3 tentativas, allowlist: Task 3 e casos 4, 5, 12, 13.
- Conteúdo do e-mail (assunto, botão, rodapé, escape, texto puro): Task 2.
- Observabilidade e consultas: Task 5, step 2. Rollout em 4 etapas: Tasks 6 e 7. LGPD e limite de plano: spec (riscos), sem tarefa de código.
- A decisão "não registrar nada com o interruptor desligado" está no código (retorna antes do RPC) e na verificação do Task 6, step 4/5.

**Placeholders:** nenhum "TBD". O corpo do PR no Task 5 step 4 (`<resumo + roteiro de QA>`) deve ser escrito no momento, a partir do CHANGELOG.

**Consistência de tipos/nomes:** `NotificationFacts` (Task 1) é o parâmetro de `describeNotification` e a base de `EmailItem` (Task 2); `buildNotificationEmail(item, { appUrl, schoolName })` é chamado com esses mesmos nomes em `index.ts` (Task 4); o payload do RPC (`outbox_id`, `to_email`, `school_name`, `event`, `reference_date`, `offset_days`, `item_count`, `total_amount`, `details`) é o consumido pela função; `mark_email_result(p_outbox_id, p_status, p_provider_id, p_error)` bate com as chamadas `rpc(...)`. Nomes de migration (`…130000` a `…130300`) e de secrets (`service_role_key`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_SENDING_ENABLED`, `EMAIL_ALLOWLIST`, `APP_URL`) são os mesmos em todo o plano.

**Riscos conhecidos:** (1) a extensão `pg_net` pode pedir privilégio no `db push`; por isso fica numa migration isolada (Task 3, step 1). (2) O caso `5b` da matriz depende de desligar o trigger `update_email_outbox_updated_at` dentro da transação; DDL é transacional no Postgres, então o `rollback;` desfaz. (3) A integração real com o Resend só é coberta pelo teste manual do Task 7.
