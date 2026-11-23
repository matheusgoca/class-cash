// supabase/functions/_shared/notificationEmail.test.ts
import { describe, it, expect } from 'vitest';
import { buildNotificationEmail, escapeHtml, type EmailItem } from './notificationEmail.ts';

const ctx = { appUrl: 'https://app.exemplo.com.br/', schoolName: 'Escola Exemplo' };
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
    expect(m.html).toContain('Escola Exemplo');
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
