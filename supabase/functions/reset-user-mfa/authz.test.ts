import { describe, it, expect } from "vitest";
import { authorizeMfaReset, jwtAal, type AuthzInput } from "./authz";

const SCHOOL = "school-a";

// Cenário base: admin (não-owner) da escola A redefinindo o 2FA de um financeiro da mesma escola.
const base: AuthzInput = {
  callerId: "admin-1",
  targetId: "fin-1",
  callerAal: "aal2",
  caller: { isMaster: false, schoolId: SCHOOL, isAdminRole: true },
  target: { schoolId: SCHOOL, isMaster: false },
  school: { ownerUserId: "owner-1", require2fa: false },
};

describe("authorizeMfaReset", () => {
  it("admin da mesma escola pode", () => {
    expect(authorizeMfaReset(base)).toEqual({ ok: true, actorRole: "admin" });
  });

  it("owner da escola pode, mesmo sem linha em user_roles", () => {
    const r = authorizeMfaReset({
      ...base,
      callerId: "owner-1",
      caller: { isMaster: false, schoolId: SCHOOL, isAdminRole: false },
    });
    expect(r).toEqual({ ok: true, actorRole: "admin" });
  });

  it("financeiro/professor (sem papel admin e não-owner) não pode", () => {
    const r = authorizeMfaReset({ ...base, caller: { isMaster: false, schoolId: SCHOOL, isAdminRole: false } });
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it("admin de OUTRA escola não pode", () => {
    const r = authorizeMfaReset({ ...base, caller: { isMaster: false, schoolId: "school-b", isAdminRole: true } });
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it("não pode redefinir o próprio 2FA (peça a outro admin)", () => {
    const r = authorizeMfaReset({ ...base, targetId: base.callerId });
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it("alvo inexistente ou sem escola → 404", () => {
    expect(authorizeMfaReset({ ...base, target: null })).toMatchObject({ ok: false, status: 404 });
    expect(authorizeMfaReset({ ...base, target: { schoolId: null, isMaster: false } })).toMatchObject({
      ok: false,
      status: 404,
    });
  });

  it("escola que exige 2FA: o chamador precisa estar em aal2 (senha roubada não basta)", () => {
    const required = { ...base, school: { ownerUserId: "owner-1", require2fa: true } };
    expect(authorizeMfaReset({ ...required, callerAal: "aal1" })).toMatchObject({ ok: false, status: 403 });
    expect(authorizeMfaReset({ ...required, callerAal: "aal2" })).toEqual({ ok: true, actorRole: "admin" });
  });

  it("master pode qualquer usuário de qualquer escola, sem exigir aal2 da escola", () => {
    const r = authorizeMfaReset({
      ...base,
      callerId: "master-1",
      callerAal: "aal1",
      caller: { isMaster: true, schoolId: null, isAdminRole: false },
      school: { ownerUserId: "owner-1", require2fa: true },
    });
    expect(r).toEqual({ ok: true, actorRole: "master" });
  });

  it("master pode redefinir o próprio 2FA", () => {
    const r = authorizeMfaReset({
      ...base,
      callerId: "master-1",
      targetId: "master-1",
      caller: { isMaster: true, schoolId: null, isAdminRole: false },
      target: { schoolId: SCHOOL, isMaster: true },
    });
    expect(r).toEqual({ ok: true, actorRole: "master" });
  });

  it("ESCALADA: admin de escola NÃO pode redefinir o 2FA de um master, mesmo na mesma escola", () => {
    // O master do Class Cash também é owner/admin de uma escola: sem esta regra,
    // qualquer admin dela removeria o 2FA do master.
    const r = authorizeMfaReset({
      ...base,
      targetId: "master-1",
      target: { schoolId: SCHOOL, isMaster: true },
    });
    expect(r).toMatchObject({ ok: false, status: 403 });
  });
});

describe("jwtAal", () => {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const token = (payload: object) => `${b64({ alg: "HS256" })}.${b64(payload)}.sig`;

  it("lê o aal do payload", () => {
    expect(jwtAal(token({ aal: "aal2" }))).toBe("aal2");
    expect(jwtAal(token({ aal: "aal1" }))).toBe("aal1");
  });

  it("sem claim ou token malformado → aal1 (seguro por padrão)", () => {
    expect(jwtAal(token({}))).toBe("aal1");
    expect(jwtAal("lixo")).toBe("aal1");
    expect(jwtAal("")).toBe("aal1");
  });
});
