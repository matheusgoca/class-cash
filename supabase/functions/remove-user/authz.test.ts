import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { authorizeRemoval, type RemovalInput } from "./authz";

const A = "school-a";
const B = "school-b";

// Base: admin (não-owner) da escola A removendo um financeiro da mesma escola.
const base: RemovalInput = {
  callerId: "admin-1",
  targetId: "fin-1",
  callerAal: "aal1",
  caller: { isMaster: false, schoolId: A, isAdminRole: true },
  target: { schoolId: A, isMaster: false, isAdminRole: false },
  school: { ownerUserId: "owner-1", require2fa: false },
  otherAdmins: 2,
};
const withIn = (over: Partial<RemovalInput>): RemovalInput => ({ ...base, ...over });
const status = (i: RemovalInput) => { const r = authorizeRemoval(i); return r.ok ? 200 : r.status; };

describe("authorizeRemoval", () => {
  it("admin da mesma escola remove um membro", () => {
    expect(authorizeRemoval(base)).toEqual({ ok: true, actorRole: "admin" });
  });

  it("owner remove, mesmo sem linha de papel admin", () => {
    expect(status(withIn({ callerId: "owner-1", caller: { isMaster: false, schoolId: A, isAdminRole: false } }))).toBe(200);
  });

  it("financeiro/professor (não admin, não owner) não remove ninguém", () => {
    expect(status(withIn({ caller: { isMaster: false, schoolId: A, isAdminRole: false } }))).toBe(403);
  });

  it("ESCOLA DO ALVO MANDA: admin da escola A não remove usuário da escola B", () => {
    expect(status(withIn({ target: { schoolId: B, isMaster: false, isAdminRole: false }, school: { ownerUserId: "owner-b", require2fa: false } }))).toBe(403);
  });

  it("alvo sem escola: só o master", () => {
    expect(status(withIn({ target: { schoolId: null, isMaster: false, isAdminRole: false }, school: null }))).toBe(403);
    expect(status(withIn({ target: { schoolId: null, isMaster: false, isAdminRole: false }, school: null, caller: { isMaster: true, schoolId: null, isAdminRole: false } }))).toBe(200);
  });

  it("alvo master: negado para admin, owner e até para outro master", () => {
    const t = { schoolId: A, isMaster: true, isAdminRole: true };
    expect(status(withIn({ target: t }))).toBe(403);
    expect(status(withIn({ target: t, callerId: "owner-1", caller: { isMaster: false, schoolId: A, isAdminRole: false } }))).toBe(403);
    expect(status(withIn({ target: t, caller: { isMaster: true, schoolId: null, isAdminRole: false } }))).toBe(403);
  });

  it("o owner da escola do alvo não é removido (nem pelo master)", () => {
    expect(status(withIn({ targetId: "owner-1", target: { schoolId: A, isMaster: false, isAdminRole: true } }))).toBe(403);
    expect(status(withIn({ targetId: "owner-1", target: { schoolId: A, isMaster: false, isAdminRole: true }, caller: { isMaster: true, schoolId: null, isAdminRole: false } }))).toBe(403);
  });

  it("não remove a si mesmo", () => {
    expect(status(withIn({ targetId: "admin-1" }))).toBe(403);
  });

  it("não remove o último admin da escola, mas remove um admin quando há outro", () => {
    const t = { schoolId: A, isMaster: false, isAdminRole: true };
    expect(status(withIn({ target: t, otherAdmins: 0 }))).toBe(403);
    expect(status(withIn({ target: t, otherAdmins: 1 }))).toBe(200);
  });

  it("alvo inexistente → 404", () => {
    expect(status(withIn({ target: null, school: null }))).toBe(404);
  });

  it("escola que exige 2FA: o chamador precisa estar em aal2", () => {
    const req = { school: { ownerUserId: "owner-1", require2fa: true } };
    expect(status(withIn({ ...req, callerAal: "aal1" }))).toBe(403);
    expect(status(withIn({ ...req, callerAal: "aal2" }))).toBe(200);
  });

  it("master remove membro de qualquer escola, sem exigir aal2 da escola", () => {
    const r = authorizeRemoval(withIn({ caller: { isMaster: true, schoolId: null, isAdminRole: false }, school: { ownerUserId: "owner-1", require2fa: true } }));
    expect(r).toEqual({ ok: true, actorRole: "master" });
  });

  it("mensagens claras em português", () => {
    const msgs = [
      authorizeRemoval(withIn({ targetId: "admin-1" })),
      authorizeRemoval(withIn({ targetId: "owner-1" })),
      authorizeRemoval(withIn({ target: { schoolId: A, isMaster: true, isAdminRole: false } })),
      authorizeRemoval(withIn({ target: { schoolId: A, isMaster: false, isAdminRole: true }, otherAdmins: 0 })),
    ].map((r) => (r.ok ? "" : r.error));
    expect(msgs).toEqual([
      "Você não pode remover a si mesmo.",
      "O owner da escola não pode ser removido.",
      "Contas master não podem ser removidas por aqui.",
      "A escola precisa ter ao menos um admin.",
    ]);
  });
});

describe("remove-user/index.ts usa a decisão e a escola do alvo", () => {
  const src = readFileSync(resolve(__dirname, "index.ts"), "utf-8").replace(/\r\n/g, "\n");
  it("decide por authorizeRemoval com dados do perfil do alvo, não do corpo", () => {
    expect(src).toContain("authorizeRemoval({");
    expect(src).toMatch(/\.from\("profiles"\)[\s\S]*\.eq\("user_id", userId\)/);
    // a escola usada nas consultas vem do perfil do alvo
    expect(src).toContain("targetProfile?.school_id");
    // o school_id do corpo não decide nada: nenhuma consulta usa a variável do corpo como filtro de escola
    expect(src).not.toMatch(/\.eq\("id", school_id\)/);
  });
  it("só apaga depois de autorizar", () => {
    expect(src.indexOf("authorizeRemoval({")).toBeLessThan(src.indexOf(".delete()"));
    expect(src.indexOf("authorizeRemoval({")).toBeLessThan(src.indexOf("deleteUser("));
  });
});
