import { describe, it, expect } from "vitest";
import { resolveMfaGate, graceDaysLeft } from "./mfaGate";

const now = new Date("2026-11-20T12:00:00Z");
const base = {
  currentLevel: "aal1" as const,
  hasVerifiedFactor: false,
  schoolRequires2fa: false,
  isAdminOrOwner: true,
  isMasterAdmin: false,
  graceUntil: null,
  now,
};

describe("resolveMfaGate", () => {
  it("sem exigência e sem fator → ok", () => {
    expect(resolveMfaGate(base)).toBe("ok");
  });

  it("tem fator verificado mas sessão aal1 → challenge (qualquer escola)", () => {
    expect(resolveMfaGate({ ...base, hasVerifiedFactor: true })).toBe("challenge");
  });

  it("sessão aal2 → ok", () => {
    expect(
      resolveMfaGate({ ...base, hasVerifiedFactor: true, currentLevel: "aal2", schoolRequires2fa: true }),
    ).toBe("ok");
  });

  it("escola exige, admin sem fator, dentro da carência → enroll_grace", () => {
    expect(
      resolveMfaGate({ ...base, schoolRequires2fa: true, graceUntil: new Date("2026-11-25T00:00:00Z") }),
    ).toBe("enroll_grace");
  });

  it("escola exige, admin sem fator, carência vencida → enroll_blocked", () => {
    expect(
      resolveMfaGate({ ...base, schoolRequires2fa: true, graceUntil: new Date("2026-11-19T00:00:00Z") }),
    ).toBe("enroll_blocked");
  });

  it("escola exige, sem carência registrada → enroll_blocked (seguro por padrão)", () => {
    expect(resolveMfaGate({ ...base, schoolRequires2fa: true })).toBe("enroll_blocked");
  });

  it("escola exige mas usuário é financeiro/professor → ok", () => {
    expect(resolveMfaGate({ ...base, schoolRequires2fa: true, isAdminOrOwner: false })).toBe("ok");
  });

  it("master admin é exigido mesmo sem toggle de escola nenhum", () => {
    const m = { ...base, isMasterAdmin: true, isAdminOrOwner: false, schoolRequires2fa: false };
    expect(resolveMfaGate({ ...m, graceUntil: new Date("2026-11-25T00:00:00Z") })).toBe("enroll_grace");
    expect(resolveMfaGate({ ...m, graceUntil: null })).toBe("enroll_blocked");
    expect(resolveMfaGate({ ...m, hasVerifiedFactor: true })).toBe("challenge");
    expect(resolveMfaGate({ ...m, hasVerifiedFactor: true, currentLevel: "aal2" })).toBe("ok");
  });
});

describe("graceDaysLeft", () => {
  it("arredonda para cima e nunca é negativo", () => {
    expect(graceDaysLeft(new Date("2026-11-22T00:00:00Z"), now)).toBe(2);
    expect(graceDaysLeft(new Date("2026-11-10T00:00:00Z"), now)).toBe(0);
  });
});
