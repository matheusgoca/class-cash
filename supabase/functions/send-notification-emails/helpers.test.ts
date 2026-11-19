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
