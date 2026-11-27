// Monta o e-mail de um aviso. Puro e sem imports de Deno/Supabase (testável no Vitest).
import { describeNotification, type NotificationEventName, type NotificationFacts } from './notificationText.ts';

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

// ---- identidade visual do aviso (tabelas e estilos inline; só o que os clientes de e-mail suportam) ----

/** Logo exibido a 32 px; publicado pelo front em public/email/logo-64.png. */
export const LOGO_URL = 'https://app.classcash.com.br/email/logo-64.png';

const EVENT_MARK: Record<NotificationEventName, { label: string; bg: string; fg: string }> = {
  tuition_overdue: { label: 'Em atraso', bg: '#FCE9E9', fg: '#B42323' },
  tuition_due: { label: 'A vencer', bg: '#FEF3C7', fg: '#92400E' },
  renegotiation_installment: { label: 'Renegociação', bg: '#E6F0FF', fg: '#1D4ED8' },
  expense_due: { label: 'A pagar', bg: '#FEF3C7', fg: '#92400E' },
  reenrollment: { label: 'Rematrícula', bg: '#FAEEE6', fg: '#A95223' },
};

const HELP_TEXT: Record<NotificationEventName, string> = {
  tuition_overdue: 'Veja quem está em atraso, turma por turma, e registre o contato com as famílias.',
  tuition_due: 'Acompanhe os pagamentos da semana e confirme os que já caíram.',
  renegotiation_installment: 'Acordos em dia ajudam a recuperar o caixa. Confira o que vence antes do fim da semana.',
  expense_due: 'Veja o que vence e marque como paga quando sair do caixa.',
  reenrollment: 'Acompanhe a decisão de cada família e renove em lote quando estiver pronto.',
};

export interface Indicator {
  label: string;
  value: string;
}

const brl = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
const int = (n: number) => new Intl.NumberFormat('pt-BR').format(n);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/**
 * Indicadores do aviso. Só dados que o aviso já carrega (item_count, total_amount, offset_days e details);
 * o que não existe no payload é omitido, nunca inventado.
 * Falta hoje: "Maior valor" (despesa), porque o gerador só grava `description` (e só quando há 1 despesa).
 */
export function buildIndicators(item: EmailItem): Indicator[] {
  const out: Indicator[] = [];
  const total = isNum(item.total_amount) ? item.total_amount : null;
  const d = item.details ?? {};
  switch (item.event) {
    case 'tuition_overdue':
    case 'tuition_due':
      if (total !== null) out.push({ label: item.event === 'tuition_overdue' ? 'Em atraso' : 'A receber', value: brl(total) });
      out.push({ label: 'Mensalidades', value: int(item.item_count) });
      if (isNum(d.class_count)) out.push({ label: 'Turmas', value: int(d.class_count) });
      break;
    case 'renegotiation_installment':
      if (total !== null) out.push({ label: 'A receber', value: brl(total) });
      out.push({ label: 'Parcelas', value: int(item.item_count) });
      // as parcelas do aviso vencem todas no mesmo dia (hoje + offset_days)
      out.push({
        label: 'Primeira vence em',
        value: item.offset_days === 0 ? 'hoje' : item.offset_days === 1 ? 'amanhã' : `${item.offset_days} dias`,
      });
      break;
    case 'expense_due':
      if (total !== null) out.push({ label: 'A pagar', value: brl(total) });
      out.push({ label: 'Despesas', value: int(item.item_count) });
      break;
    case 'reenrollment': {
      out.push({ label: 'Contratos a vencer', value: int(item.item_count) });
      if (isNum(d.renewed_count)) {
        const declined = isNum(d.declined_count) ? d.declined_count : 0;
        out.push({ label: 'Já rematriculados', value: int(d.renewed_count) });
        out.push({ label: 'Sem resposta', value: int(Math.max(0, item.item_count - d.renewed_count - declined)) });
      }
      break;
    }
  }
  return out;
}

function indicatorsHtml(list: Indicator[]): string {
  if (list.length === 0) return '';
  const w = Math.floor(100 / list.length);
  const cells = list
    .map(
      (it, i) =>
        `<td class="ind${i > 0 ? ' ind-n' : ''}" width="${w}%" valign="top" style="width:${w}%;padding:14px 16px;font-family:Arial,Helvetica,sans-serif;${i > 0 ? 'border-left:1px solid #E2E8F0;' : ''}"><div class="ind-v" style="font-size:18px;font-weight:700;line-height:1.3;color:#020817;">${escapeHtml(it.value)}</div><div class="ind-l" style="font-size:12px;line-height:1.4;color:#64748B;padding-top:2px;">${escapeHtml(it.label)}</div></td>`,
    )
    .join('');
  return `
                <tr><td style="padding-bottom:24px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F8FAFC" style="width:100%;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;border-collapse:separate;"><tr>${cells}</tr></table>
                </td></tr>`;
}

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

  const mark = EVENT_MARK[item.event];
  const help = HELP_TEXT[item.event];

  // Layout híbrido (Gmail, Outlook e celular):
  //  - NENHUM padding em <table> (soma à largura de 100% e desloca o cartão): o espaçamento fica nos <td>;
  //  - a coluna é uma tabela centralizada: width="560" no atributo (o Outlook desktop só entende o atributo) e
  //    width:100% + max-width:560px no estilo (fluida no celular), com margin:0 auto;
  //  - o que depende de <style> (24px de padding, título 21px, indicadores em linhas, botão largo) é refinamento:
  //    sem ele o layout fluido continua legível.
  const html = `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>${escapeHtml(subject)}</title>
<style>
@media only screen and (max-width:480px) {
  .pad { padding:24px !important; }
  .title { font-size:21px !important; }
  .ind { display:block !important; width:100% !important; box-sizing:border-box; overflow:hidden; border-left:0 !important; }
  .ind-n { border-top:1px solid #E2E8F0 !important; }
  .ind-v { float:right !important; padding-left:12px; }
  .ind-l { display:block !important; }
  .btn-t { width:100% !important; }
  .btn { display:block !important; text-align:center !important; }
}
</style></head>
<body style="margin:0;padding:0;background:#F1F5F9;" bgcolor="#F1F5F9">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F1F5F9" style="width:100%;background:#F1F5F9;">
    <tr><td align="center" style="padding:40px 16px;font-family:Arial,Helvetica,sans-serif;">
      <table role="presentation" align="center" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;margin:0 auto;">
        <tr><td style="padding-bottom:20px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="padding-right:10px;vertical-align:middle;"><img src="${LOGO_URL}" width="32" height="32" alt="Class Cash" style="display:block;border:0;width:32px;height:32px;border-radius:8px;"></td>
            <td style="vertical-align:middle;font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:700;color:#020817;">Class Cash</td>
          </tr></table>
        </td></tr>
        <tr><td>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:100%;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:12px;border-collapse:separate;">
            <tr><td height="4" bgcolor="#186E64" style="height:4px;line-height:4px;font-size:0;background:#186E64;border-radius:11px 11px 0 0;">&nbsp;</td></tr>
            <tr><td class="pad" style="padding:32px;font-family:Arial,Helvetica,sans-serif;color:#020817;" align="left">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
                <tr><td style="padding-bottom:16px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tr>
                    <td style="font-size:13px;color:#64748B;font-family:Arial,Helvetica,sans-serif;">${escapeHtml(school)}</td>
                    <td align="right" style="white-space:nowrap;padding-left:12px;"><span style="display:inline-block;padding:3px 10px;border-radius:999px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;background:${mark.bg};color:${mark.fg};">${escapeHtml(mark.label)}</span></td>
                  </tr></table>
                </td></tr>
                <tr><td class="title" style="font-size:24px;font-weight:700;line-height:1.3;color:#020817;padding-bottom:12px;">${escapeHtml(v.title)}</td></tr>
                <tr><td style="font-size:16px;line-height:1.55;color:#334155;padding-bottom:24px;">${escapeHtml(v.subtitle)}</td></tr>${indicatorsHtml(buildIndicators(item))}
                <tr><td style="padding-bottom:20px;">
                  <table role="presentation" class="btn-t" cellpadding="0" cellspacing="0" border="0"><tr>
                    <td align="center" bgcolor="#186E64" style="background:#186E64;border-radius:8px;"><a class="btn" href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#186E64;color:#FFFFFF;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;padding:14px 24px;border-radius:8px;">${escapeHtml(v.actionLabel)}</a></td>
                  </tr></table>
                </td></tr>
                <tr><td style="font-size:14px;line-height:1.5;color:#64748B;padding-bottom:24px;">${escapeHtml(help)}</td></tr>
                <tr><td style="font-size:12px;line-height:1.5;color:#64748B;border-top:1px solid #E2E8F0;padding-top:16px;">
                  ${escapeHtml(footer)}<br>
                  <a href="${escapeHtml(prefsUrl)}" style="color:#186E64;text-decoration:underline;">Ajustar preferências</a>
                </td></tr>
              </table>
            </td></tr>
          </table>
        </td></tr>
        <tr><td align="center" style="padding-top:20px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#64748B;">Class Cash · Gestão financeira escolar simplificada</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}
