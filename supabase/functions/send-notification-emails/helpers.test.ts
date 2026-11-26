// supabase/functions/send-notification-emails/helpers.test.ts
import { describe, it, expect } from 'vitest';
import { jobAuthorized, buildSendBody, isSendingEnabled, parseAllowlist, parseReplyTo, errorMessage, mayShip } from './helpers.ts';

describe('jobAuthorized (segredo dedicado do job, S6)', () => {
  const S = 'f'.repeat(64);
  it('aceita só o valor exato, ignorando espaço e quebra de linha nas pontas', async () => {
    expect(await jobAuthorized(S, S)).toBe(true);
    expect(await jobAuthorized(` ${S}
`, `${S}
`)).toBe(true);
  });
  it('rejeita valor diferente, parecido, mais curto, mais longo e ausente', async () => {
    expect(await jobAuthorized('e'.repeat(64), S)).toBe(false);
    expect(await jobAuthorized('f'.repeat(63) + 'e', S)).toBe(false);
    expect(await jobAuthorized('f'.repeat(63), S)).toBe(false);
    expect(await jobAuthorized('f'.repeat(65), S)).toBe(false);
    expect(await jobAuthorized(null, S)).toBe(false);
    expect(await jobAuthorized('', S)).toBe(false);
  });
  it('falha fechada: segredo configurado ausente, vazio ou com menos de 32 caracteres nunca autoriza', async () => {
    expect(await jobAuthorized(S, undefined)).toBe(false);
    expect(await jobAuthorized(S, null)).toBe(false);
    expect(await jobAuthorized('', '')).toBe(false);
    expect(await jobAuthorized('abc', 'abc')).toBe(false);
    expect(await jobAuthorized('a'.repeat(31), 'a'.repeat(31))).toBe(false);
    expect(await jobAuthorized('a'.repeat(32), 'a'.repeat(32))).toBe(true);
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

describe('parseReplyTo', () => {
  it('aceita um endereço simples ou "Nome <endereço>", aparado', () => {
    expect(parseReplyTo(' suporte@classcash.com.br ')).toBe('suporte@classcash.com.br');
    expect(parseReplyTo('Class Cash <suporte@classcash.com.br>')).toBe('Class Cash <suporte@classcash.com.br>');
  });
  it('ausente, vazio ou inválido = null (sem reply-to)', () => {
    for (const v of [undefined, null, '', '   ', 'sem-arroba', 'a@b', 'Nome <a@b.com', 'a@b.com>', '@b.com']) {
      expect(parseReplyTo(v as never)).toBeNull();
    }
  });
  it('recusa lista e quebra de linha (injeção de cabeçalho)', () => {
    expect(parseReplyTo('a@b.com, c@d.com')).toBeNull();
    expect(parseReplyTo('a@b.com;c@d.com')).toBeNull();
    expect(parseReplyTo('a@b.com\r\nBcc: x@y.com')).toBeNull();
  });
});

describe('buildSendBody', () => {
  const mail = { subject: 'Assunto', html: '<p>oi</p>', text: 'oi' };
  it('sem reply-to: o corpo não tem o campo', () => {
    const b = buildSendBody('Class Cash <a@x.com>', 'dest@y.com', mail, null);
    expect(b).toEqual({ from: 'Class Cash <a@x.com>', to: ['dest@y.com'], subject: 'Assunto', html: '<p>oi</p>', text: 'oi' });
    expect('reply_to' in b).toBe(false);
  });
  it('com reply-to: vai em reply_to', () => {
    expect(buildSendBody('a@x.com', 'dest@y.com', mail, 'suporte@x.com').reply_to).toBe('suporte@x.com');
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

describe('mayShip (checagem no envio do interruptor por escola, S6 bloco 1)', () => {
  it('só envia quando o RPC email_may_send devolve exatamente true', () => {
    expect(mayShip({ data: true, error: null })).toBe(true);
  });
  it('falha fechada: false, nulo, erro do RPC ou valor inesperado NÃO enviam', () => {
    expect(mayShip({ data: false, error: null })).toBe(false);
    expect(mayShip({ data: null, error: null })).toBe(false);
    expect(mayShip({ data: true, error: { message: 'boom' } })).toBe(false);
    expect(mayShip({ data: 'true', error: null })).toBe(false);
    expect(mayShip({ data: 1, error: null })).toBe(false);
    expect(mayShip(undefined)).toBe(false);
  });
});
