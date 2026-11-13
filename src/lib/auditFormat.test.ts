import { describe, it, expect } from "vitest";
import {
  formatAuditEntry,
  getRequiredEntityRefs,
  entityKey,
  type AuditLogRow,
} from "./auditFormat";
import { formatCurrency } from "./calculations";

function makeLog(overrides: Partial<AuditLogRow>): AuditLogRow {
  return {
    id: "log-1",
    school_id: "school-1",
    actor_user_id: "user-1",
    actor_role: "admin",
    is_master_action: false,
    table_name: "students",
    record_id: "rec-1",
    action: "update",
    changed_fields: null,
    old_data: null,
    new_data: null,
    source: "manual",
    created_at: "2026-11-13T00:00:00Z",
    ...overrides,
  };
}

const baseOptions = { actorName: "Marina Souza", names: {}, canSeeSalary: true };

describe("formatAuditEntry — ator", () => {
  it("ação de master admin aparece como 'Suporte Class Cash', nunca o nome real", () => {
    const log = makeLog({ is_master_action: true });
    const entry = formatAuditEntry(log, { ...baseOptions, actorName: "Nome Real do Master" });
    expect(entry.actorLabel).toBe("Suporte Class Cash");
    expect(entry.actorBadge).toBe("support");
    expect(entry.summary).not.toContain("Nome Real do Master");
  });

  it("no painel do próprio master, a ação master mostra o nome real com selo 'master'", () => {
    const log = makeLog({ is_master_action: true, actor_user_id: "master-1" });
    const entry = formatAuditEntry(log, { ...baseOptions, actorName: "Nome Real do Master", viewerIsMaster: true });
    expect(entry.actorLabel).toBe("Nome Real do Master");
    expect(entry.actorBadge).toBe("master");
  });

  it("actor_user_id nulo aparece como 'Sistema'", () => {
    const log = makeLog({ actor_user_id: null });
    const entry = formatAuditEntry(log, baseOptions);
    expect(entry.actorLabel).toBe("Sistema");
    expect(entry.actorBadge).toBe("system");
  });

  it("usuário comum mostra o nome resolvido via profiles", () => {
    const log = makeLog({});
    const entry = formatAuditEntry(log, baseOptions);
    expect(entry.actorLabel).toBe("Marina Souza");
    expect(entry.actorBadge).toBe("user");
  });

  it("ator removido (profile não encontrado) cai num rótulo genérico, não quebra", () => {
    const log = makeLog({});
    const entry = formatAuditEntry(log, { ...baseOptions, actorName: null });
    expect(entry.actorLabel).toBe("Usuário removido");
  });
});

describe("formatAuditEntry — tuitions", () => {
  it("marcar como paga gera a frase do mockup, com nome do aluno via join", () => {
    const log = makeLog({
      table_name: "tuitions",
      action: "update",
      changed_fields: ["status", "paid_date"],
      old_data: { student_id: "stu-1", status: "pending", paid_date: null, amount: 450 },
      new_data: { student_id: "stu-1", status: "paid", paid_date: "2026-10-10", amount: 450 },
    });
    const entry = formatAuditEntry(log, {
      ...baseOptions,
      names: { [entityKey("student", "stu-1")]: "Beatriz Lima" },
    });
    expect(entry.summary).toBe("Marcou como paga a mensalidade de Beatriz Lima.");
    expect(entry.categoryLabel).toBe("Mensalidades");
    const statusDiff = entry.diffs.find((d) => d.label === "Status");
    expect(statusDiff).toEqual({ label: "Status", from: "Pendente", to: "Pago" });
  });

  it("aluno removido depois do fato cai no rótulo de fallback, não quebra", () => {
    const log = makeLog({
      table_name: "tuitions",
      action: "update",
      changed_fields: ["status"],
      old_data: { student_id: "stu-removido", status: "pending" },
      new_data: { student_id: "stu-removido", status: "paid" },
    });
    const entry = formatAuditEntry(log, {
      ...baseOptions,
      names: { [entityKey("student", "stu-removido")]: null },
    });
    expect(entry.summary).toBe("Marcou como paga a mensalidade de aluno removido.");
  });

  it("mensalidade gerada automaticamente (source=generated) tem nota distinta", () => {
    const log = makeLog({
      table_name: "tuitions",
      action: "insert",
      source: "generated",
      new_data: { student_id: "stu-1", status: "pending" },
    });
    const entry = formatAuditEntry(log, {
      ...baseOptions,
      names: { [entityKey("student", "stu-1")]: "Beatriz Lima" },
    });
    expect(entry.summary).toContain("gerada automaticamente");
    expect(entry.note).toBeTruthy();
  });
});

describe("formatAuditEntry — contratos, com diff de valor", () => {
  it("alteração de valor da mensalidade usa formatCurrency nos dois lados", () => {
    const log = makeLog({
      table_name: "contracts",
      action: "update",
      changed_fields: ["monthly_amount"],
      old_data: { student_id: "stu-2", monthly_amount: 500 },
      new_data: { student_id: "stu-2", monthly_amount: 450 },
    });
    const entry = formatAuditEntry(log, {
      ...baseOptions,
      names: { [entityKey("student", "stu-2")]: "João Pereira" },
    });
    expect(entry.summary).toBe("Atualizou o contrato de João Pereira.");
    expect(entry.diffs).toContainEqual({
      label: "Valor da mensalidade",
      from: formatCurrency(500),
      to: formatCurrency(450),
    });
  });
});

describe("formatAuditEntry — professores e privacidade de salário", () => {
  const log = makeLog({
    table_name: "teachers",
    action: "update",
    changed_fields: ["salary"],
    old_data: { full_name: "Carla Mendes", salary: 3000 },
    new_data: { full_name: "Carla Mendes", salary: 3300 },
  });

  it("quem pode ver salário (admin/financial) vê o diff com valores", () => {
    const entry = formatAuditEntry(log, { ...baseOptions, canSeeSalary: true });
    expect(entry.summary).toBe("Atualizou o professor Carla Mendes.");
    expect(entry.diffs).toContainEqual({ label: "Salário", from: formatCurrency(3000), to: formatCurrency(3300) });
  });

  it("quem não pode ver salário recebe valores ocultos, nunca o número real", () => {
    const entry = formatAuditEntry(log, { ...baseOptions, canSeeSalary: false });
    expect(entry.diffs).toContainEqual({ label: "Salário", from: "(oculto)", to: "(oculto)" });
    expect(JSON.stringify(entry)).not.toContain("3000");
    expect(JSON.stringify(entry)).not.toContain("3300");
  });
});

describe("formatAuditEntry — class_teachers (atribuição de professor)", () => {
  it("insert vira 'atribuiu o professor', com nome da turma e do professor resolvidos", () => {
    const log = makeLog({
      table_name: "class_teachers",
      action: "insert",
      new_data: { teacher_id: "t-1", class_id: "c-1" },
    });
    const entry = formatAuditEntry(log, {
      ...baseOptions,
      names: {
        [entityKey("teacher", "t-1")]: "Carla Mendes",
        [entityKey("class", "c-1")]: "5º Ano A",
      },
    });
    expect(entry.summary).toBe("Atribuiu o professor Carla Mendes em 5º Ano A.");
  });
});

describe("formatAuditEntry — convites (equipe)", () => {
  it("convite novo mostra e-mail e papel traduzido", () => {
    const log = makeLog({
      table_name: "invitations",
      action: "insert",
      new_data: { email: "rafael@escola.exemplo", role: "financial" },
    });
    const entry = formatAuditEntry(log, baseOptions);
    expect(entry.summary).toBe("Convidou rafael@escola.exemplo como Financeiro.");
  });
});

describe("formatAuditEntry — tabela desconhecida nunca quebra a tela", () => {
  it("cai no fallback genérico em vez de lançar erro", () => {
    const log = makeLog({
      table_name: "uma_tabela_nova_do_futuro",
      action: "insert",
      new_data: { campo_qualquer: "valor" },
    });
    expect(() => formatAuditEntry(log, baseOptions)).not.toThrow();
    const entry = formatAuditEntry(log, baseOptions);
    expect(entry.summary).toContain("Criou");
  });

  it("campo sem tradução cadastrada vira um rótulo humanizado, não quebra", () => {
    const log = makeLog({
      table_name: "students",
      action: "update",
      changed_fields: ["um_campo_novo_sem_meta"],
      old_data: { full_name: "Ana", um_campo_novo_sem_meta: "a" },
      new_data: { full_name: "Ana", um_campo_novo_sem_meta: "b" },
    });
    const entry = formatAuditEntry(log, baseOptions);
    expect(entry.diffs).toContainEqual({ label: "Um campo novo sem meta", from: "a", to: "b" });
  });
});

describe("getRequiredEntityRefs", () => {
  it("extrai só os campos que são FK de verdade, ignorando o resto", () => {
    const log = makeLog({
      table_name: "contracts",
      new_data: { student_id: "stu-1", class_id: "cls-1", monthly_amount: 500 },
    });
    const refs = getRequiredEntityRefs(log);
    expect(refs).toContainEqual({ type: "student", id: "stu-1" });
    expect(refs).toContainEqual({ type: "class", id: "cls-1" });
    expect(refs).toHaveLength(2);
  });

  it("tabela sem nenhuma FK conhecida não pede lookup nenhum", () => {
    const log = makeLog({
      table_name: "students",
      new_data: { full_name: "Ana", status: "active" },
    });
    expect(getRequiredEntityRefs(log)).toEqual([]);
  });

  it("linha sem old_data nem new_data (não deveria acontecer, mas não quebra) retorna vazio", () => {
    const log = makeLog({ table_name: "contracts", old_data: null, new_data: null });
    expect(getRequiredEntityRefs(log)).toEqual([]);
  });
});

describe("formatAuditEntry — exclusão", () => {
  it("delete usa old_data pra descrever o que foi removido", () => {
    const log = makeLog({
      table_name: "students",
      action: "delete",
      old_data: { full_name: "Pedro Henrique" },
      new_data: null,
    });
    const entry = formatAuditEntry(log, baseOptions);
    expect(entry.summary).toBe("Excluiu o aluno Pedro Henrique.");
  });
});
