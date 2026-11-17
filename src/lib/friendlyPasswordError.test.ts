import { describe, it, expect } from "vitest";
import { getFriendlyPasswordError } from "./friendlyError";

describe("getFriendlyPasswordError", () => {
  it("nova senha igual à atual", () => {
    const msg = "A nova senha precisa ser diferente da atual.";
    expect(getFriendlyPasswordError({ code: "same_password" })).toBe(msg);
    expect(getFriendlyPasswordError({ message: "New password should be different from the old password." })).toBe(msg);
  });

  it("senha fraca (inclui checagem de vazamento)", () => {
    expect(getFriendlyPasswordError({ code: "weak_password" })).toBe(
      "Essa senha é fraca ou já apareceu em vazamentos. Escolha outra.",
    );
  });

  it("exige reautenticação recente", () => {
    expect(getFriendlyPasswordError({ code: "reauthentication_needed" })).toBe(
      "Por segurança, saia e entre novamente antes de trocar a senha.",
    );
  });

  it("excesso de tentativas", () => {
    expect(getFriendlyPasswordError({ code: "over_request_rate_limit" })).toBe(
      "Muitas tentativas. Aguarde um minuto e tente de novo.",
    );
    expect(getFriendlyPasswordError({ status: 429 })).toBe(
      "Muitas tentativas. Aguarde um minuto e tente de novo.",
    );
  });

  it("erro desconhecido não vaza o texto cru", () => {
    expect(getFriendlyPasswordError({ message: "boom internal detail" })).toBe(
      "Não foi possível alterar a senha. Tente novamente.",
    );
    expect(getFriendlyPasswordError(undefined)).toBe("Não foi possível alterar a senha. Tente novamente.");
  });
});
