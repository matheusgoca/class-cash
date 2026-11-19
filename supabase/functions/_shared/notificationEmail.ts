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
