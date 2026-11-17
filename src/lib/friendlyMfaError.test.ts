import { describe, it, expect } from "vitest";
import { getFriendlyMfaError } from "./friendlyError";

describe("getFriendlyMfaError", () => {
  it("código TOTP errado (por code ou por mensagem)", () => {
    const msg = "Código incorreto ou expirado. Confira o horário do celular e tente de novo.";
    expect(getFriendlyMfaError({ code: "mfa_verification_failed", message: "x" })).toBe(msg);
    expect(getFriendlyMfaError({ message: "Invalid TOTP code entered" })).toBe(msg);
  });

  it("desafio expirado", () => {
    expect(getFriendlyMfaError({ code: "mfa_challenge_expired" })).toBe(
      "O código expirou. Digite o novo código que aparece no aplicativo.",
    );
  });

  it("excesso de tentativas (code ou HTTP 429)", () => {
    const msg = "Muitas tentativas. Aguarde um minuto e tente de novo.";
    expect(getFriendlyMfaError({ code: "over_request_rate_limit" })).toBe(msg);
    expect(getFriendlyMfaError({ status: 429, message: "x" })).toBe(msg);
  });

  it("fator não encontrado", () => {
    expect(getFriendlyMfaError({ code: "mfa_factor_not_found" })).toBe(
      "Nenhum autenticador encontrado para esta conta.",
    );
  });

  it("erro desconhecido cai numa mensagem genérica, sem vazar o texto cru", () => {
    expect(getFriendlyMfaError({ message: "boom: secret=ABC123" })).toBe(
      "Não foi possível verificar o código. Tente novamente.",
    );
    expect(getFriendlyMfaError(null)).toBe("Não foi possível verificar o código. Tente novamente.");
  });
});
