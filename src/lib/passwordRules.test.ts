import { describe, it, expect } from "vitest";
import { evaluatePassword } from "./passwordRules";

describe("evaluatePassword", () => {
  it("exige 10+ caracteres e um número", () => {
    expect(evaluatePassword("abcdefghi1").valid).toBe(true);
    expect(evaluatePassword("abcdefghi").valid).toBe(false); // 9 chars, sem número
    expect(evaluatePassword("abcdefghij").valid).toBe(false); // sem número
    expect(evaluatePassword("a1").valid).toBe(false); // curta
  });

  it("símbolo é recomendado, não obrigatório", () => {
    const r = evaluatePassword("abcdefghi1");
    const symbol = r.rules.find((x) => x.id === "symbol")!;
    expect(symbol.required).toBe(false);
    expect(symbol.ok).toBe(false);
    expect(r.valid).toBe(true);
  });

  it("detecta símbolo", () => {
    expect(evaluatePassword("abcdefghi1!").rules.find((x) => x.id === "symbol")!.ok).toBe(true);
  });
});
