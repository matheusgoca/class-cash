import { describe, it, expect } from 'vitest';
import { getFriendlyErrorMessage } from './friendlyError';

describe('getFriendlyErrorMessage — preferências de notificação', () => {
  it.each([
    ['MFA_REQUIRED', 'Esta conta precisa da verificação em duas etapas (2FA) para continuar.'],
    ['NO_SCHOOL', 'Sua conta ainda não está vinculada a uma escola.'],
    ['NOT_ALLOWED', 'Seu perfil não tem acesso às preferências de notificação.'],
    ['EVENT_NOT_ALLOWED', 'Seu perfil não pode configurar um dos avisos escolhidos.'],
    ['INVALID_OFFSET', 'Uma das antecedências escolhidas não é permitida.'],
    ['INVALID_TIMEZONE', 'Não foi possível identificar o fuso horário do seu navegador.'],
    ['INVALID_DIGEST_TIME', 'Escolha um horário de resumo entre 06:00 e 20:00.'],
  ])('%s', (code, expected) => {
    expect(getFriendlyErrorMessage({ code: 'P0001', message: code })).toBe(expected);
  });
});
