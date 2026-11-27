// Gera as prévias estáticas dos avisos por e-mail (docs/email-previews/*.html), uma por evento.
// Uso: npx vite-node scripts/gen-email-previews.ts
// Dados de exemplo (nenhuma escola real). Na prévia, o logo aponta para a cópia local logo-64.png desta pasta
// (a URL pública só responde depois do deploy do front).
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildNotificationEmail, LOGO_URL, type EmailItem } from '../supabase/functions/_shared/notificationEmail.ts';

const ctx = { appUrl: 'https://app.classcash.com.br', schoolName: 'Colégio Exemplo' };
const ref = '2026-11-26';
const items: EmailItem[] = [
  { event: 'tuition_overdue', reference_date: ref, offset_days: 5, item_count: 718, total_amount: 657082.5, details: { class_count: 4 } },
  { event: 'tuition_due', reference_date: ref, offset_days: 3, item_count: 8, total_amount: 7200, details: { class_count: 2 } },
  { event: 'renegotiation_installment', reference_date: ref, offset_days: 3, item_count: 3, total_amount: 1500, details: {} },
  { event: 'expense_due', reference_date: ref, offset_days: 2, item_count: 4, total_amount: 8300, details: {} },
  { event: 'reenrollment', reference_date: ref, offset_days: 45, item_count: 18, total_amount: null, details: { renewed_count: 6, declined_count: 2 } },
];

const out = resolve(__dirname, '..', 'docs', 'email-previews');
mkdirSync(out, { recursive: true });
for (const item of items) {
  const { html } = buildNotificationEmail(item, ctx);
  writeFileSync(resolve(out, `${item.event}.html`), html.replace(LOGO_URL, 'logo-64.png'), 'utf-8');
  console.log(`${item.event}.html`);
}
