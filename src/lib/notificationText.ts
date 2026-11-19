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

export function describeNotification(n: NotificationItem): NotificationView {
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
        subtitle: `${formatCurrency(total)} em atraso, em ${classes} ${plural(classes, 'turma', 'turmas')}.`,
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
        subtitle: `${venceEm} · ${formatCurrency(total)}`,
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
