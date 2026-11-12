import { describe, it, expect } from "vitest";
import { getTuitionValue } from "./calculations";

describe("getTuitionValue", () => {
  it("usa final_amount quando preenchido (mensalidade paga, com desconto e multa)", () => {
    expect(getTuitionValue({ amount: 500, final_amount: 470 })).toBe(470);
  });

  it("cai para amount quando final_amount é null (pendente ou atrasada)", () => {
    expect(getTuitionValue({ amount: 500, final_amount: null })).toBe(500);
  });

  it("cai para amount quando final_amount é undefined (registro sem o campo selecionado)", () => {
    expect(getTuitionValue({ amount: 500 })).toBe(500);
  });

  it("trata amount como string (retorno bruto do Supabase) convertendo para número", () => {
    expect(getTuitionValue({ amount: "500", final_amount: null })).toBe(500);
    expect(getTuitionValue({ amount: "500", final_amount: "470" })).toBe(470);
  });

  it("não quebra com amount nulo (defensivo — não deveria ocorrer no banco)", () => {
    expect(getTuitionValue({ amount: null, final_amount: null })).toBe(0);
  });
});
