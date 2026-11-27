// supabase/functions/_shared/notificationEmail.test.ts
import { describe, it, expect } from 'vitest';
import { buildNotificationEmail, buildIndicators, escapeHtml, LOGO_URL, type EmailItem } from './notificationEmail.ts';

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
    expect(m.text).toContain('Dúvidas? Escreva para contato@classcash.com.br\nAjustar preferências');
    expect(m.html).toContain('Dúvidas? Escreva para contato@classcash.com.br');
    expect(m.html.indexOf('Dúvidas?')).toBeLessThan(m.html.indexOf('Ajustar preferências</a>'));
    expect(m.text).toMatch(/em atraso, em 3 turmas\./);
  });

  it('cobre os 5 eventos com assunto e destino certos', () => {
    const cases: [Partial<EmailItem>, string, string][] = [
      [{ event: 'tuition_due', offset_days: 3, item_count: 8 }, '8 mensalidades vencem em 3 dias', '/mensalidades?status=pending'],
      [{ event: 'renegotiation_installment', offset_days: 1, item_count: 3 }, '3 parcelas de renegociação vencem amanhã', '/mensalidades?status=pending'],
      [{ event: 'expense_due', offset_days: 2, item_count: 4, total_amount: 800 }, '4 despesas vencem em 2 dias', '/despesas'],
      [{ event: 'reenrollment', offset_days: 45, item_count: 18, total_amount: null, details: { renewed_count: 6 } }, '18 contratos terminam em 45 dias', '/rematricula'],
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

  // Layout (Gmail desktop mostrava o cartão deslocado à direita com faixa cinza à esquerda): regras de compatibilidade.
  describe('layout compatível com clientes de e-mail', () => {
    const html = () => buildNotificationEmail(
      { event: 'tuition_overdue', reference_date: '2031-03-10', offset_days: 5, item_count: 3, total_amount: 100, details: { class_count: 1 } } as never,
      { appUrl: 'https://app.exemplo.com.br', schoolName: 'Escola Exemplo' },
    ).html;
    const tags = (h: string, name: string) => h.match(new RegExp(String.raw`<${name}[^>]*>`, 'g')) ?? [];

    it('nenhum <table> usa padding no estilo (padding de table soma à largura de 100% e desloca o cartão)', () => {
      const tables = tags(html(), 'table');
      expect(tables.length).toBeGreaterThanOrEqual(5); // não vazio: externa, coluna, cartão, linha da escola, indicadores…
      for (const t of tables) expect(t.replace(/cellpadding="\d+"/g, '')).not.toMatch(/padding/i);
    });

    it('a coluna é uma tabela centralizada de 560: width no atributo (Outlook), fluida e max-width no estilo, align center e margin auto', () => {
      const col = tags(html(), 'table').filter((t) => /max-width:\s*560px/.test(t));
      expect(col).toHaveLength(1);
      expect(col[0]).toContain('width="560"');
      expect(col[0]).toContain('align="center"');
      expect(col[0]).toMatch(/width:\s*100%/);
      expect(col[0]).toMatch(/margin:\s*0 auto/);
    });

    it('a tabela externa preenche a largura toda com #F1F5F9 e centraliza a coluna no td com padding 40/16', () => {
      const h = html();
      const outer = tags(h, 'table')[0];
      expect(outer).toContain('width="100%"');
      expect(outer).toMatch(/background:\s*#F1F5F9/);
      expect(h).toMatch(/<td align="center" style="[^"]*padding:\s*40px 16px/);
    });

    it('fundo também por atributo (bgcolor) e o meta viewport', () => {
      const h = html();
      expect(h).toContain('bgcolor="#F1F5F9"');
      expect(h).toContain('bgcolor="#FFFFFF"');
      expect(h).toContain('name="viewport"');
    });

    it('nada de recursos que os clientes não suportam: flex, grid, sombra e gradiente (nem no estilo, nem nos comentários)', () => {
      for (const ev of EVENTS) expect(mail(ev).html).not.toMatch(/flex|grid|box-shadow|text-shadow|gradient/i);
    });
  });
});

// ---- identidade visual (layout aprovado): um teste por evento ----------------------------------------------------

const EVENTS: EmailItem[] = [
  { event: 'tuition_overdue', reference_date: '2026-11-26', offset_days: 5, item_count: 718, total_amount: 657082.5, details: { class_count: 4 } },
  { event: 'tuition_due', reference_date: '2026-11-26', offset_days: 3, item_count: 8, total_amount: 7200, details: { class_count: 2 } },
  { event: 'renegotiation_installment', reference_date: '2026-11-26', offset_days: 3, item_count: 3, total_amount: 1500, details: {} },
  { event: 'expense_due', reference_date: '2026-11-26', offset_days: 2, item_count: 4, total_amount: 8300, details: {} },
  { event: 'reenrollment', reference_date: '2026-11-26', offset_days: 45, item_count: 18, total_amount: null, details: { renewed_count: 6, declined_count: 2 } },
];
const mail = (item: EmailItem, school = 'Escola Exemplo') => buildNotificationEmail(item, { appUrl: 'https://app.exemplo.com.br', schoolName: school });
const nb = (s: string) => s.replace(/\u00a0/g, ' ');
const shown = (html: string) =>
  [...html.matchAll(/class="ind-v"[^>]*>([^<]*)<\/div><div class="ind-l"[^>]*>([^<]*)<\/div>/g)].map((m) => [nb(m[2]), nb(m[1])]);

describe('e-mail de aviso: identidade visual por evento', () => {
  const spec: Record<string, { badge: string; bg: string; fg: string; help: string; indicators: string[][] }> = {
    tuition_overdue: {
      badge: 'Em atraso', bg: '#FCE9E9', fg: '#B42323',
      help: 'Veja quem está em atraso, turma por turma, e registre o contato com as famílias.',
      indicators: [['Em atraso', 'R$ 657.082,50'], ['Mensalidades', '718'], ['Turmas', '4']],
    },
    tuition_due: {
      badge: 'A vencer', bg: '#FEF3C7', fg: '#92400E',
      help: 'Acompanhe os pagamentos da semana e confirme os que já caíram.',
      indicators: [['A receber', 'R$ 7.200,00'], ['Mensalidades', '8'], ['Turmas', '2']],
    },
    renegotiation_installment: {
      badge: 'Renegociação', bg: '#E6F0FF', fg: '#1D4ED8',
      help: 'Acordos em dia ajudam a recuperar o caixa. Confira o que vence antes do fim da semana.',
      indicators: [['A receber', 'R$ 1.500,00'], ['Parcelas', '3'], ['Primeira vence em', '3 dias']],
    },
    expense_due: {
      badge: 'A pagar', bg: '#FEF3C7', fg: '#92400E',
      help: 'Veja o que vence e marque como paga quando sair do caixa.',
      indicators: [['A pagar', 'R$ 8.300,00'], ['Despesas', '4']], // "Maior valor" não existe no payload: omitido
    },
    reenrollment: {
      badge: 'Rematrícula', bg: '#FAEEE6', fg: '#A95223',
      help: 'Acompanhe a decisão de cada família e renove em lote quando estiver pronto.',
      indicators: [['Contratos a vencer', '18'], ['Já rematriculados', '6'], ['Sem resposta', '10']],
    },
  };

  for (const item of EVENTS) {
    const s = spec[item.event];
    it(`${item.event}: selo, indicadores, título, ajuda, botão, rodapé e escape`, () => {
      const m = mail(item, 'Escola <i>X</i> & Cia');
      const h = m.html;
      // selo (texto e cores do evento)
      expect(h).toMatch(new RegExp(`background:${s.bg};color:${s.fg};">${s.badge}</span>`));
      // título e assunto continuam os do gerador
      expect(h).toContain(escapeHtml(m.subject));
      expect(m.subject).toMatch(/\S/);
      // faixa de indicadores: rótulos e valores exatos, na ordem
      expect(shown(h)).toEqual(s.indicators);
      // texto de ajuda do evento e botão (cor, tamanho e link)
      expect(h).toContain(s.help);
      expect(h).toMatch(/<a class="btn" href="https:\/\/app\.exemplo\.com\.br\/[^"]+" style="[^"]*background:#186E64;color:#FFFFFF;[^"]*font-size:16px;font-weight:700;padding:14px 24px;border-radius:8px;/);
      // cabeçalho, faixa de 4px, cartão e rodapés
      expect(h).toContain('Class Cash · Gestão financeira escolar simplificada');
      expect(h).toMatch(/<a href="https:\/\/app\.exemplo\.com\.br\/notificacoes\/preferencias" style="color:#186E64;text-decoration:underline;">Ajustar preferências<\/a>/);
      expect(h).toContain('Você recebe este e-mail porque ativou avisos por e-mail no Class Cash.');
      // escape de tudo que é interpolado (nome da escola com HTML)
      expect(h).not.toContain('<i>X</i>');
      expect(h).toContain('Escola &lt;i&gt;X&lt;/i&gt; &amp; Cia');
    });
  }

  it('cabeçalho fora do cartão: logo com width, height e alt, e o nome da marca (18px/700)', () => {
    const h = mail(EVENTS[0]).html;
    const img = h.match(/<img[^>]*>/)![0];
    expect(img).toContain(`src="${LOGO_URL}"`);
    expect(LOGO_URL).toBe('https://app.classcash.com.br/email/logo-64.png');
    expect(img).toContain('width="32"');
    expect(img).toContain('height="32"');
    expect(img).toContain('alt="Class Cash"');
    expect(h).toMatch(/font-size:18px;font-weight:700;color:#020817;">Class Cash<\/td>/);
    // o cabeçalho vem antes do cartão
    expect(h.indexOf('<img')).toBeLessThan(h.indexOf('border:1px solid #E2E8F0;border-radius:12px'));
  });

  it('cartão: fundo branco, borda 1px, raio 12, faixa de 4px teal e padding 32 (24 no celular)', () => {
    const h = mail(EVENTS[0]).html;
    expect(h).toMatch(/bgcolor="#FFFFFF" style="[^"]*background:#FFFFFF;border:1px solid #E2E8F0;border-radius:12px;/);
    expect(h).toMatch(/<td height="4" bgcolor="#186E64" style="height:4px;[^"]*background:#186E64;/);
    expect(h).toMatch(/class="pad" style="padding:32px;/);
    expect(h).toMatch(/@media only screen and \(max-width:480px\)[\s\S]*\.pad \{ padding:24px !important; \}/);
  });

  it('tipografia e cores: título 24px/700/1.3 (21px no celular), destaque 16px/1.55, escola 13px', () => {
    const h = mail(EVENTS[0]).html;
    expect(h).toMatch(/class="title" style="font-size:24px;font-weight:700;line-height:1\.3;color:#020817;/);
    expect(h).toMatch(/\.title \{ font-size:21px !important; \}/);
    expect(h).toMatch(/font-size:16px;line-height:1\.55;color:#334155;[^>]*>[^<]*em atraso/);
    expect(h).toMatch(/font-size:13px;color:#64748B;[^>]*>Escola Exemplo</);
    expect(h).toMatch(/font-size:12px;font-weight:700;background:#FCE9E9;color:#B42323;/);
    expect(h).toMatch(/padding:3px 10px;border-radius:999px;/);
  });

  it('faixa de indicadores: fundo #F8FAFC, borda e raio 8; valor 18px/700; rótulo 12px; empilha no celular como linhas rótulo/valor', () => {
    const h = mail(EVENTS[0]).html;
    expect(h).toMatch(/bgcolor="#F8FAFC" style="[^"]*background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;/);
    expect(h).toMatch(/class="ind-v" style="font-size:18px;font-weight:700;[^"]*color:#020817;/);
    expect(h).toMatch(/class="ind-l" style="font-size:12px;[^"]*color:#64748B;/);
    expect(h).toMatch(/\.ind \{ display:block !important; width:100% !important;/);
    expect(h).toMatch(/\.ind-v \{ float:right !important;/);
    expect(h).toMatch(/\.btn \{ display:block !important; text-align:center !important; \}/);
    expect(h).toMatch(/\.btn-t \{ width:100% !important; \}/);
  });

  it('indicador que não existe no payload é omitido (nunca inventado)', () => {
    // despesa: não há "Maior valor"
    expect(buildIndicators(EVENTS[3]).map((i) => i.label)).toEqual(['A pagar', 'Despesas']);
    // atraso sem class_count no payload: sem "Turmas"
    expect(buildIndicators(mk({ details: {} })).map((i) => i.label)).toEqual(['Em atraso', 'Mensalidades']);
    // valor total ausente: sem o indicador de dinheiro (não vira R$ 0,00)
    expect(buildIndicators(mk({ total_amount: null })).map((i) => i.label)).toEqual(['Mensalidades', 'Turmas']);
    // rematrícula sem renewed_count: só "Contratos a vencer"
    expect(buildIndicators({ ...EVENTS[4], details: {} }).map((i) => i.label)).toEqual(['Contratos a vencer']);
    // sem nenhum indicador a faixa nem aparece
    expect(mail({ ...EVENTS[4], details: {} }).html).toContain('Contratos a vencer');
  });

  it('renegociação: "Primeira vence em" fala hoje, amanhã ou N dias; rematrícula nunca dá "sem resposta" negativo', () => {
    const v = (n: number) => buildIndicators({ ...EVENTS[2], offset_days: n }).at(-1)!.value;
    expect([v(0), v(1), v(7)]).toEqual(['hoje', 'amanhã', '7 dias']);
    const sem = buildIndicators({ ...EVENTS[4], item_count: 2, details: { renewed_count: 2, declined_count: 1 } }).at(-1)!;
    expect(sem).toEqual({ label: 'Sem resposta', value: '0' });
  });

  it('a versão em texto simples não mudou (sem HTML, com o link e as preferências)', () => {
    const m = mail(EVENTS[0]);
    expect(m.text).not.toMatch(/<[a-z]/i);
    expect(m.text).toContain('Ver cobranças: https://app.exemplo.com.br/mensalidades?status=overdue');
    expect(m.text).toContain('Ajustar preferências: https://app.exemplo.com.br/notificacoes/preferencias');
    expect(nb(m.text)).toContain('R$ 657.082,50 em atraso, em 4 turmas.');
  });
});
