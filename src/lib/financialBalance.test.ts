import { describe, it, expect } from "vitest";
import { calculateMonthlyBalance } from "./financialBalance";

// Mês de referência: novembro/2026 (month é 0-indexed, como Date#getMonth())
const YEAR = 2026;
const MONTH = 10;

describe("calculateMonthlyBalance", () => {
  it("Realizado soma só o que foi pago dentro do mês, pelo paid_date", () => {
    const result = calculateMonthlyBalance({
      tuitions: [
        // paga em novembro, mesmo com vencimento em outubro — entra no Realizado de novembro
        { amount: 500, final_amount: 470, status: "paid", due_date: "2026-10-05", paid_date: "2026-11-02" },
        // vence em novembro mas ainda não foi paga — não entra no Realizado
        { amount: 500, final_amount: null, status: "pending", due_date: "2026-11-10", paid_date: null },
      ],
      serviceCharges: [],
      expenses: [],
      monthlySalaries: 0,
      year: YEAR,
      month: MONTH,
    });
    expect(result.realizedRevenue).toBe(470);
  });

  it("Previsto soma tudo não cancelado com vencimento no mês, pago ou não", () => {
    const result = calculateMonthlyBalance({
      tuitions: [
        { amount: 500, final_amount: 470, status: "paid", due_date: "2026-11-05", paid_date: "2026-11-02" },
        { amount: 300, final_amount: null, status: "pending", due_date: "2026-11-10", paid_date: null },
        { amount: 200, final_amount: null, status: "cancelled", due_date: "2026-11-15", paid_date: null },
      ],
      serviceCharges: [],
      expenses: [],
      monthlySalaries: 0,
      year: YEAR,
      month: MONTH,
    });
    // 470 (paga) + 300 (pendente) — cancelada fica fora
    expect(result.forecastRevenue).toBe(770);
  });

  it("inclui service_charges pagas no Realizado e todas (exceto cancelled) no Previsto", () => {
    const result = calculateMonthlyBalance({
      tuitions: [],
      serviceCharges: [
        { amount: 100, status: "paid", due_date: "2026-10-20", paid_date: "2026-11-01" },
        { amount: 50, status: "pending", due_date: "2026-11-20", paid_date: null },
      ],
      expenses: [],
      monthlySalaries: 0,
      year: YEAR,
      month: MONTH,
    });
    expect(result.realizedRevenue).toBe(100);
    expect(result.forecastRevenue).toBe(50);
  });

  it("despesas pagas no mês entram no Realizado; todas não canceladas com vencimento no mês entram no Previsto", () => {
    const result = calculateMonthlyBalance({
      tuitions: [],
      serviceCharges: [],
      expenses: [
        { amount: 200, status: "paid", due_date: "2026-10-28", paid_date: "2026-11-03" },
        { amount: 80, status: "pending", due_date: "2026-11-25", paid_date: null },
        { amount: 40, status: "cancelled", due_date: "2026-11-01", paid_date: null },
      ],
      monthlySalaries: 0,
      year: YEAR,
      month: MONTH,
    });
    expect(result.realizedExpenses).toBe(200);
    expect(result.forecastExpenses).toBe(80);
  });

  it("salário mensal entra integral nos dois regimes (sem histórico de pagamento no sistema)", () => {
    const result = calculateMonthlyBalance({
      tuitions: [],
      serviceCharges: [],
      expenses: [],
      monthlySalaries: 1000,
      year: YEAR,
      month: MONTH,
    });
    expect(result.realized).toBe(-1000);
    expect(result.forecast).toBe(-1000);
  });

  it("ignora registros sem paid_date no Realizado mesmo que status seja paid (dado inconsistente)", () => {
    const result = calculateMonthlyBalance({
      tuitions: [{ amount: 500, final_amount: 500, status: "paid", due_date: "2026-11-05", paid_date: null }],
      serviceCharges: [],
      expenses: [],
      monthlySalaries: 0,
      year: YEAR,
      month: MONTH,
    });
    expect(result.realizedRevenue).toBe(0);
    // mas entra no Previsto pelo due_date
    expect(result.forecastRevenue).toBe(500);
  });
});
