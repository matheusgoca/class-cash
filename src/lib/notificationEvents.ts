// Catálogo da tela de preferências de notificação (S3). Padrões, opções de
// antecedência, direção e "recomendado" vêm do banco (notification_event_defaults()
// via RPC); aqui ficam só rótulos em português e regras puras da tela.

export type NotificationEvent =
  | 'tuition_due'
  | 'tuition_overdue'
  | 'renegotiation_installment'
  | 'expense_due'
  | 'reenrollment';

export type OffsetDirection = 'before' | 'after';

export interface EventPreference {
  event: NotificationEvent;
  direction: OffsetDirection;
  inApp: boolean;
  email: boolean;
  offsetDays: number;
  options: number[];
  emailRecommended: boolean;
}

export interface DigestPreference {
  enabled: boolean;
  time: string; // 'HH:MM', hora local; o fuso vai à parte no save
}

export interface PreferencesState {
  preferences: EventPreference[];
  digest: DigestPreference;
}

export const EVENT_LABELS: Record<NotificationEvent, { label: string; description: string }> = {
  tuition_due: { label: 'Mensalidade a vencer', description: 'Lembrete antes do vencimento' },
  tuition_overdue: { label: 'Mensalidade em atraso', description: 'Quando passa do vencimento' },
  renegotiation_installment: { label: 'Parcela de renegociação', description: 'Parcelas dos acordos ativos' },
  expense_due: { label: 'Despesa a pagar', description: 'Despesas e recorrências' },
  reenrollment: { label: 'Rematrícula', description: 'Contratos perto do fim' },
};

export const DIGEST_HOURS: string[] = Array.from({ length: 15 }, (_, i) => `${String(6 + i).padStart(2, '0')}:00`);

export function formatOffset(direction: OffsetDirection, n: number): string {
  const dias = n === 1 ? 'dia' : 'dias';
  if (direction === 'after') return `Após ${n} ${dias}`;
  if (n === 0) return 'No dia';
  return `${n} ${dias} antes`;
}

const key = (s: PreferencesState) =>
  JSON.stringify({
    p: s.preferences.map((p) => [p.event, p.inApp, p.email, p.offsetDays]),
    d: [s.digest.enabled, s.digest.time],
  });

export function isDirty(saved: PreferencesState, draft: PreferencesState): boolean {
  return key(saved) !== key(draft);
}

// Regra de produto (19/11): o e-mail acompanha o aviso no sistema. O e-mail só
// pode ficar ligado com "No sistema" ligado no mesmo evento, porque o e-mail nasce
// da notificação gerada para o sistema. Desligar o sistema desliga o e-mail junto;
// religar o sistema não religa o e-mail. O banco aplica a mesma regra em
// save_notification_preferences (EMAIL_REQUIRES_IN_APP).
export function updatePreference(pref: EventPreference, patch: Partial<EventPreference>): EventPreference {
  const next = { ...pref, ...patch };
  if (!next.inApp) next.email = false;
  return next;
}

export function applyRecommendedEmails(draft: PreferencesState): PreferencesState {
  return {
    ...draft,
    preferences: draft.preferences.map((p) =>
      p.emailRecommended ? updatePreference(p, { email: true }) : { ...p },
    ),
  };
}

// No 1º acesso o usuário pode salvar sem mudar nada: é assim que confirma a tela (D3).
export function canSave(saved: PreferencesState, draft: PreferencesState, confirmedAt: string | null): boolean {
  return confirmedAt === null || isDirty(saved, draft);
}
