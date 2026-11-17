/**
 * Traduz uma linha de audit_logs numa frase em português pra tela de
 * Histórico de alterações (S2, Fase 1). Função pura — não faz query.
 * Quem chama resolve os nomes de entidades referenciadas (getRequiredEntityRefs
 * diz quais buscar) e passa pra cá via ResolvedNames.
 *
 * Nunca expõe old_data/new_data brutos, tokens ou e-mails de convite além do
 * necessário — só os campos explicitamente tratados abaixo chegam à tela.
 */

import { formatCurrency } from "./calculations";

export type AuditAction = "insert" | "update" | "delete";

export interface AuditLogRow {
  id: string;
  school_id: string | null;
  actor_user_id: string | null;
  actor_role: string | null;
  is_master_action: boolean;
  table_name: string;
  record_id: string | null;
  action: string;
  changed_fields: string[] | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  source: string;
  created_at: string;
}

export type EntityType =
  | "student"
  | "teacher"
  | "class"
  | "category"
  | "service"
  | "user";

export interface EntityRef {
  type: EntityType;
  id: string;
}

/** Chave usada no mapa de nomes resolvidos: `${type}:${id}`. */
export function entityKey(type: EntityType, id: string): string {
  return `${type}:${id}`;
}

/** null = resolvido e não encontrado (registro removido depois). undefined = ainda não buscado. */
export type ResolvedNames = Record<string, string | null | undefined>;

export interface FormatAuditOptions {
  /** Nome já resolvido do ator (via profiles), null se não achou. */
  actorName: string | null;
  names: ResolvedNames;
  /** admin/financial (mesma regra de teachers_select) — só quem já vê salário no resto do app. */
  canSeeSalary: boolean;
  /**
   * Owner/admin (false, padrão): ação de master vira sempre "Suporte Class
   * Cash", nome do master nunca exposto. Master admin vendo o próprio painel
   * global (true): mostra o nome real do ator, com selo de "master".
   */
  viewerIsMaster?: boolean;
}

export interface AuditDiff {
  label: string;
  from: string;
  to: string;
}

export interface FormattedAuditEntry {
  actorLabel: string;
  actorBadge: "support" | "user" | "system" | "master";
  categoryLabel: string;
  summary: string;
  diffs: AuditDiff[];
  note?: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  students: "Alunos",
  teachers: "Professores",
  classes: "Turmas",
  class_teachers: "Turmas",
  contracts: "Contratos",
  tuitions: "Mensalidades",
  expenses: "Despesas",
  recurring_expenses: "Despesas",
  service_charges: "Serviços",
  school_services: "Serviços",
  student_services: "Serviços",
  renegotiations: "Mensalidades",
  user_roles: "Equipe",
  invitations: "Equipe",
  schools: "Escola",
};

/** Agrupa as tabelas auditadas pela categoria que aparece no filtro "Onde" da tela. */
export function getCategoryFilterOptions(): { label: string; tableNames: string[] }[] {
  const byLabel = new Map<string, string[]>();
  for (const [table, label] of Object.entries(CATEGORY_LABELS)) {
    if (!byLabel.has(label)) byLabel.set(label, []);
    byLabel.get(label)!.push(table);
  }
  return Array.from(byLabel.entries())
    .map(([label, tableNames]) => ({ label, tableNames }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}

function genericCategoryLabel(tableName: string): string {
  return CATEGORY_LABELS[tableName] ?? humanizeFieldName(tableName);
}

const CURRENCY_FIELDS = new Set([
  "amount",
  "final_amount",
  "discount_applied",
  "penalty_amount",
  "salary",
  "monthly_amount",
  "monthly_fee",
  "monthly_fee_integral",
  "full_tuition_value",
  "final_tuition_value",
  "price",
  "original_amount",
  "new_installment_amount",
  "total_renegotiated",
]);

const PERCENT_FIELDS = new Set(["discount"]);

const DATE_FIELDS = new Set([
  "due_date",
  "paid_date",
  "start_date",
  "end_date",
  "birth_date",
  "enrollment_date",
  "first_due_date",
]);

const STATUS_LABELS: Record<string, Record<string, string>> = {
  tuitions: {
    pending: "Pendente",
    paid: "Pago",
    overdue: "Atrasado",
    cancelled: "Cancelada",
    renegotiated: "Renegociada",
  },
  expenses: {
    pending: "Pendente",
    paid: "Paga",
    overdue: "Atrasada",
  },
  contracts: {
    active: "Ativo",
    suspended: "Suspenso",
    cancelled: "Cancelado",
  },
  students: { active: "Ativo", inactive: "Inativo" },
  teachers: { active: "Ativo", inactive: "Inativo" },
  schools: { active: "Ativa", suspended: "Suspensa" },
  invitations: {
    pending: "Pendente",
    accepted: "Aceito",
    expired: "Expirado",
    revoked: "Revogado",
  },
  service_charges: {
    pending: "Pendente",
    paid: "Paga",
    overdue: "Atrasada",
  },
};

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador",
  financial: "Financeiro",
  teacher: "Professor",
};

// Campo -> {label, tipo de entidade referenciada (se for FK)}. Campos fora
// daqui caem no fallback genérico de humanizeFieldName, nunca quebram a tela.
const FIELD_META: Record<
  string,
  Record<string, { label: string; entity?: EntityType }>
> = {
  students: {
    full_name: { label: "Nome" },
    status: { label: "Status" },
    full_tuition_value: { label: "Mensalidade cheia" },
    discount: { label: "Desconto" },
    final_tuition_value: { label: "Mensalidade final" },
  },
  teachers: {
    full_name: { label: "Nome" },
    salary: { label: "Salário" },
    specialization: { label: "Especialização" },
    status: { label: "Status" },
  },
  classes: {
    name: { label: "Nome da turma" },
    grade: { label: "Série/Ano" },
    max_capacity: { label: "Capacidade" },
    monthly_fee: { label: "Mensalidade da turma" },
  },
  class_teachers: {
    teacher_id: { label: "Professor", entity: "teacher" },
    class_id: { label: "Turma", entity: "class" },
    weekly_hours: { label: "Horas semanais" },
  },
  contracts: {
    student_id: { label: "Aluno", entity: "student" },
    class_id: { label: "Turma", entity: "class" },
    monthly_amount: { label: "Valor da mensalidade" },
    discount: { label: "Desconto" },
    status: { label: "Status" },
    start_date: { label: "Início" },
    end_date: { label: "Fim" },
  },
  tuitions: {
    student_id: { label: "Aluno", entity: "student" },
    status: { label: "Status" },
    amount: { label: "Valor" },
    final_amount: { label: "Valor final" },
    discount_applied: { label: "Desconto" },
    penalty_amount: { label: "Multa" },
    due_date: { label: "Vencimento" },
    paid_date: { label: "Data de pagamento" },
    payment_method: { label: "Forma de pagamento" },
  },
  expenses: {
    description: { label: "Descrição" },
    category_id: { label: "Categoria", entity: "category" },
    class_id: { label: "Turma", entity: "class" },
    amount: { label: "Valor" },
    due_date: { label: "Vencimento" },
    paid_date: { label: "Data de pagamento" },
    status: { label: "Status" },
  },
  recurring_expenses: {
    description: { label: "Descrição" },
    category_id: { label: "Categoria", entity: "category" },
    class_id: { label: "Turma", entity: "class" },
    amount: { label: "Valor" },
    active: { label: "Ativa" },
  },
  service_charges: {
    description: { label: "Descrição" },
    service_id: { label: "Serviço", entity: "service" },
    student_id: { label: "Aluno", entity: "student" },
    amount: { label: "Valor" },
    status: { label: "Status" },
    due_date: { label: "Vencimento" },
    paid_date: { label: "Data de pagamento" },
  },
  school_services: {
    name: { label: "Nome do serviço" },
    price: { label: "Preço" },
    active: { label: "Ativo" },
  },
  student_services: {
    student_id: { label: "Aluno", entity: "student" },
    service_id: { label: "Serviço", entity: "service" },
    price: { label: "Preço" },
  },
  renegotiations: {
    student_id: { label: "Aluno", entity: "student" },
    installments: { label: "Parcelas" },
    new_installment_amount: { label: "Valor da parcela" },
    total_renegotiated: { label: "Total renegociado" },
    original_amount: { label: "Valor original em atraso" },
  },
  user_roles: {
    user_id: { label: "Usuário", entity: "user" },
    role: { label: "Papel" },
  },
  invitations: {
    email: { label: "E-mail" },
    role: { label: "Papel" },
    status: { label: "Status" },
    invited_by: { label: "Convidado por", entity: "user" },
  },
  schools: {
    name: { label: "Nome" },
    segments: { label: "Segmentos" },
    plan: { label: "Plano" },
    status: { label: "Status" },
  },
};

function humanizeFieldName(field: string): string {
  return field
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
}

function fieldMeta(table: string, field: string) {
  return FIELD_META[table]?.[field] ?? { label: humanizeFieldName(field) };
}

function formatFieldValue(
  table: string,
  field: string,
  value: unknown,
  canSeeSalary: boolean,
): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field === "salary" && !canSeeSalary) return "(oculto)";
  if (CURRENCY_FIELDS.has(field) && typeof value === "number") {
    return formatCurrency(value);
  }
  if (PERCENT_FIELDS.has(field) && typeof value === "number") {
    return `${value}%`;
  }
  if (DATE_FIELDS.has(field) && typeof value === "string") {
    const d = new Date(value + "T00:00:00");
    if (!isNaN(d.getTime())) return d.toLocaleDateString("pt-BR");
  }
  if (field === "status") {
    const table_statuses = STATUS_LABELS[table];
    if (table_statuses && typeof value === "string" && table_statuses[value]) {
      return table_statuses[value];
    }
  }
  if (field === "role" && typeof value === "string") {
    return ROLE_LABELS[value] ?? value;
  }
  if (field === "active" || typeof value === "boolean") {
    return value ? "Sim" : "Não";
  }
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

/** Resolve o nome do próprio registro auditado, quando ele tem um campo "nome" direto. */
function ownNameFromRow(table: string, row: Record<string, unknown> | null): string | null {
  if (!row) return null;
  switch (table) {
    case "students":
      return (row.full_name as string) ?? (row.name as string) ?? null;
    case "teachers":
      return (row.full_name as string) ?? null;
    case "classes":
      return (row.name as string) ?? null;
    case "schools":
      return (row.name as string) ?? null;
    case "expenses":
    case "recurring_expenses":
      return (row.description as string) ?? null;
    case "school_services":
      return (row.name as string) ?? null;
    case "invitations":
      return (row.email as string) ?? null;
    default:
      return null;
  }
}

function resolveEntityName(
  type: EntityType,
  id: string | null | undefined,
  names: ResolvedNames,
  fallback: string,
): string {
  if (!id) return "—";
  const resolved = names[entityKey(type, id)];
  // undefined = nunca foi buscado. Na prática só acontece com user_roles sem
  // school_id (caso raro, ver comentário da migration de audit_logs) — a
  // página inteira já foi resolvida antes de chegar aqui, não é "carregando".
  if (resolved === undefined) return "usuário";
  if (resolved === null) return fallback;
  return resolved;
}

/** Quais entidades externas (FK) essa linha referencia e precisam de busca em lote. */
export function getRequiredEntityRefs(log: AuditLogRow): EntityRef[] {
  const row = (log.new_data ?? log.old_data) as Record<string, unknown> | null;
  if (!row) return [];
  const meta = FIELD_META[log.table_name];
  if (!meta) return [];
  const refs: EntityRef[] = [];
  for (const [field, info] of Object.entries(meta)) {
    if (!info.entity) continue;
    const id = row[field];
    if (typeof id === "string" && id.length > 0) {
      refs.push({ type: info.entity, id });
    }
  }
  return refs;
}

function diffForField(
  table: string,
  field: string,
  oldRow: Record<string, unknown> | null,
  newRow: Record<string, unknown> | null,
  names: ResolvedNames,
  canSeeSalary: boolean,
): AuditDiff | null {
  const meta = fieldMeta(table, field);
  const oldVal = oldRow?.[field];
  const newVal = newRow?.[field];

  if (meta.entity) {
    const fromName =
      oldVal != null
        ? resolveEntityName(meta.entity, String(oldVal), names, "(removido)")
        : "—";
    const toName =
      newVal != null
        ? resolveEntityName(meta.entity, String(newVal), names, "(removido)")
        : "—";
    if (fromName === toName) return null;
    return { label: meta.label, from: fromName, to: toName };
  }

  const fromStr = formatFieldValue(table, field, oldVal, canSeeSalary);
  const toStr = formatFieldValue(table, field, newVal, canSeeSalary);
  // Campo oculto (ex: salário pra quem não pode ver): sempre mostra a linha
  // avisando que mudou, mesmo os dois lados sendo "(oculto)" — senão o
  // registro de que algo mudou desaparece junto com o valor escondido.
  const isHiddenField = field === "salary" && !canSeeSalary;
  if (fromStr === toStr && !isHiddenField) return null;
  return { label: meta.label, from: fromStr, to: toStr };
}

function buildDiffs(log: AuditLogRow, names: ResolvedNames, canSeeSalary: boolean): AuditDiff[] {
  if (log.action !== "update" || !log.changed_fields) return [];
  const diffs: AuditDiff[] = [];
  for (const field of log.changed_fields) {
    if (field === "updated_at" || field === "created_at") continue;
    const diff = diffForField(log.table_name, field, log.old_data, log.new_data, names, canSeeSalary);
    if (diff) diffs.push(diff);
  }
  return diffs;
}

function subjectFor(log: AuditLogRow, names: ResolvedNames): string {
  const row = (log.new_data ?? log.old_data) as Record<string, unknown> | null;
  const own = ownNameFromRow(log.table_name, row);
  if (own) return own;
  if (!row) return "um registro";

  switch (log.table_name) {
    case "contracts":
    case "tuitions":
    case "renegotiations":
    case "student_services":
    case "service_charges": {
      const studentId = row.student_id as string | undefined;
      return resolveEntityName("student", studentId, names, "aluno removido");
    }
    case "class_teachers": {
      const teacherName = resolveEntityName("teacher", row.teacher_id as string, names, "professor removido");
      const className = resolveEntityName("class", row.class_id as string, names, "turma removida");
      return `${teacherName} em ${className}`;
    }
    case "user_roles":
      return resolveEntityName("user", row.user_id as string, names, "usuário removido");
    default:
      return "um registro";
  }
}

const ACTION_VERBS: Record<AuditAction, string> = {
  insert: "Criou",
  update: "Atualizou",
  delete: "Excluiu",
};

function buildSummary(log: AuditLogRow, names: ResolvedNames): { summary: string; note?: string } {
  const action = (log.action as AuditAction) in ACTION_VERBS ? (log.action as AuditAction) : "update";
  const subject = subjectFor(log, names);

  switch (log.table_name) {
    case "tuitions": {
      if (action === "update" && log.new_data?.status === "paid") {
        return { summary: `Marcou como paga a mensalidade de ${subject}.` };
      }
      if (action === "update" && log.new_data?.status === "renegotiated") {
        return { summary: `Renegociou a mensalidade de ${subject}.` };
      }
      if (action === "insert") {
        if (log.source === "generated") {
          return { summary: `Mensalidade gerada automaticamente para ${subject}.`, note: "Gerada pelo sistema a partir do contrato" };
        }
        return { summary: `Criou uma mensalidade para ${subject}.` };
      }
      return { summary: `${ACTION_VERBS[action]} a mensalidade de ${subject}.` };
    }
    case "renegotiations":
      return { summary: `Renegociou a mensalidade de ${subject}.` };
    case "class_teachers":
      if (action === "insert") return { summary: `Atribuiu o professor ${subject}.` };
      if (action === "delete") return { summary: `Removeu o professor ${subject}.` };
      return { summary: `Atualizou a atribuição do professor ${subject}.` };
    case "expenses":
      if (action === "insert") {
        if (log.source === "generated") {
          return { summary: `Lançamento gerado para a despesa recorrente "${subject}".`, note: "Gerada automaticamente" };
        }
        return { summary: `Criou a despesa "${subject}".` };
      }
      if (action === "update" && log.new_data?.status === "paid") {
        return { summary: `Marcou como paga a despesa "${subject}".` };
      }
      return { summary: `${ACTION_VERBS[action]} a despesa "${subject}".` };
    case "recurring_expenses":
      if (action === "insert") return { summary: `Criou a despesa recorrente "${subject}".` };
      return { summary: `${ACTION_VERBS[action]} a despesa recorrente "${subject}".` };
    case "invitations": {
      const role = ROLE_LABELS[(log.new_data?.role as string) ?? ""] ?? (log.new_data?.role as string) ?? "";
      if (action === "insert") return { summary: `Convidou ${subject} como ${role}.` };
      if (action === "update" && log.new_data?.status === "accepted") {
        return { summary: `${subject} aceitou o convite.` };
      }
      return { summary: `${ACTION_VERBS[action]} o convite de ${subject}.` };
    }
    case "user_roles":
      if (action === "insert") return { summary: `Adicionou ${subject} à equipe.` };
      if (action === "update") return { summary: `Alterou o papel de ${subject}.` };
      return { summary: `Removeu ${subject} da equipe.` };
    case "teachers":
      return { summary: `${ACTION_VERBS[action]} o professor ${subject}.` };
    case "students":
      return { summary: `${ACTION_VERBS[action]} o aluno ${subject}.` };
    case "classes":
      return { summary: `${ACTION_VERBS[action]} a turma ${subject}.` };
    case "contracts":
      return { summary: `${ACTION_VERBS[action]} o contrato de ${subject}.` };
    case "schools":
      return { summary: `${ACTION_VERBS[action]} os dados da escola.` };
    default:
      return { summary: `${ACTION_VERBS[action]} ${genericCategoryLabel(log.table_name).toLowerCase()}: ${subject}.` };
  }
}

export function formatAuditEntry(log: AuditLogRow, options: FormatAuditOptions): FormattedAuditEntry {
  const { actorName, names, canSeeSalary, viewerIsMaster = false } = options;

  let actorLabel: string;
  let actorBadge: FormattedAuditEntry["actorBadge"];
  if (log.is_master_action && !viewerIsMaster) {
    actorLabel = "Suporte Class Cash";
    actorBadge = "support";
  } else if (log.is_master_action && viewerIsMaster) {
    actorLabel = actorName ?? "Master";
    actorBadge = "master";
  } else if (!log.actor_user_id) {
    actorLabel = "Sistema";
    actorBadge = "system";
  } else {
    actorLabel = actorName ?? "Usuário removido";
    actorBadge = "user";
  }

  const { summary, note } = buildSummary(log, names);
  const diffs = buildDiffs(log, names, canSeeSalary);

  return {
    actorLabel,
    actorBadge,
    categoryLabel: genericCategoryLabel(log.table_name),
    summary,
    diffs,
    note,
  };
}
