/**
 * Camada de dados do Histórico de alterações (S2, Fase 1). Busca páginas de
 * audit_logs e resolve os nomes das entidades referenciadas (FKs) e do ator,
 * em lote, pra alimentar `formatAuditEntry` (src/lib/auditFormat.ts).
 *
 * Toda consulta filtra school_id explicitamente mesmo com RLS (CLAUDE.md).
 */
import { supabase } from "@/integrations/supabase/client";
import {
  getRequiredEntityRefs,
  entityKey,
  type AuditLogRow,
  type EntityType,
  type ResolvedNames,
} from "./auditFormat";

const PAGE_SIZE = 25;

export interface AuditLogFilters {
  /** undefined = todas as escolas (só faz sentido no painel master). */
  schoolId?: string;
  actorUserId?: string;
  /** Várias tabelas de uma vez (ex: todas as que caem na categoria "Mensalidades"). */
  tableNames?: string[];
  action?: "insert" | "update" | "delete";
  onlyMasterActions?: boolean;
  includeGeneratedImport?: boolean;
  dateFrom?: string;
  dateTo?: string;
}

export interface AuditLogPage {
  rows: AuditLogRow[];
  nextCursor: string | null;
}

function applyFilters(query: any, filters: AuditLogFilters) {
  if (filters.schoolId) query = query.eq("school_id", filters.schoolId);
  if (filters.actorUserId) query = query.eq("actor_user_id", filters.actorUserId);
  if (filters.tableNames && filters.tableNames.length > 0) query = query.in("table_name", filters.tableNames);
  if (filters.action) query = query.eq("action", filters.action);
  if (filters.onlyMasterActions) query = query.eq("is_master_action", true);
  if (!filters.includeGeneratedImport) query = query.eq("source", "manual");
  if (filters.dateFrom) query = query.gte("created_at", filters.dateFrom);
  if (filters.dateTo) query = query.lte("created_at", filters.dateTo);
  return query;
}

export async function fetchAuditLogPage(
  filters: AuditLogFilters,
  cursor: string | null,
): Promise<AuditLogPage> {
  let query = supabase
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);
  query = applyFilters(query, filters);
  if (cursor) query = query.lt("created_at", cursor);

  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as unknown as AuditLogRow[];
  return {
    rows,
    nextCursor: rows.length === PAGE_SIZE ? rows[rows.length - 1].created_at : null,
  };
}

export interface ActorOption {
  userId: string;
  name: string;
}

/** Pra popular o filtro "Quem" — atores distintos que já têm log nessa escola. */
export async function fetchDistinctActors(schoolId: string): Promise<ActorOption[]> {
  const { data, error } = await supabase
    .from("audit_logs")
    .select("actor_user_id")
    .eq("school_id", schoolId)
    .eq("is_master_action", false)
    .not("actor_user_id", "is", null)
    .limit(500);
  if (error) throw error;

  const ids = Array.from(new Set((data ?? []).map((r) => r.actor_user_id as string)));
  if (ids.length === 0) return [];

  const { data: profiles, error: profilesError } = await (supabase as any)
    .from("profiles")
    .select("user_id,full_name")
    .in("user_id", ids);
  if (profilesError) throw profilesError;

  return (profiles ?? [])
    .map((p: any) => ({ userId: p.user_id, name: p.full_name }))
    .sort((a: ActorOption, b: ActorOption) => a.name.localeCompare(b.name, "pt-BR"));
}

export interface HiddenSummaryRow {
  table_name: string;
  cnt: number;
}

/** Só faz sentido pra escola única (owner); no painel master não escondemos por padrão. */
export async function fetchHiddenGeneratedSummary(
  schoolId: string,
  dateFrom?: string,
  dateTo?: string,
): Promise<HiddenSummaryRow[]> {
  const { data, error } = await (supabase as any).rpc("audit_logs_hidden_summary", {
    p_school_id: schoolId,
    p_date_from: dateFrom ?? null,
    p_date_to: dateTo ?? null,
  });
  if (error) throw error;
  return (data ?? []) as HiddenSummaryRow[];
}

const ENTITY_TABLE: Record<EntityType, { table: string; nameFields: string[] }> = {
  student: { table: "students", nameFields: ["full_name", "name"] },
  teacher: { table: "teachers", nameFields: ["full_name"] },
  class: { table: "classes", nameFields: ["name"] },
  category: { table: "expense_categories", nameFields: ["name"] },
  service: { table: "school_services", nameFields: ["name"] },
  user: { table: "profiles", nameFields: ["full_name"] },
};

/**
 * Resolve em lote os nomes de todas as entidades (FKs) referenciadas pelas
 * linhas da página, e também os nomes dos atores (profiles.full_name).
 * Agrupa por (tipo, school_id da própria linha) -- nunca busca cruzando
 * escolas, mesmo no painel master.
 */
export async function resolveAuditLogNames(
  rows: AuditLogRow[],
): Promise<{ names: ResolvedNames; actorNames: Record<string, string | null> }> {
  // tipo -> school_id -> ids
  const grouped = new Map<EntityType, Map<string, Set<string>>>();
  for (const row of rows) {
    const schoolId = row.school_id;
    if (!schoolId) continue;
    for (const ref of getRequiredEntityRefs(row)) {
      if (!grouped.has(ref.type)) grouped.set(ref.type, new Map());
      const bySchool = grouped.get(ref.type)!;
      if (!bySchool.has(schoolId)) bySchool.set(schoolId, new Set());
      bySchool.get(schoolId)!.add(ref.id);
    }
  }

  const names: ResolvedNames = {};
  const lookups: Promise<void>[] = [];

  for (const [type, bySchool] of grouped.entries()) {
    const meta = ENTITY_TABLE[type];
    for (const [schoolId, ids] of bySchool.entries()) {
      const idList = Array.from(ids);
      // profiles usa user_id como chave do usuário, não id
      const idColumn = meta.table === "profiles" ? "user_id" : "id";
      const selectCols = [idColumn, ...meta.nameFields].join(",");
      lookups.push(
        (supabase as any)
          .from(meta.table)
          .select(selectCols)
          .eq("school_id", schoolId)
          .in(idColumn, idList)
          .then(({ data }: { data: any[] | null }) => {
            for (const r of data ?? []) {
              const id = r[idColumn];
              const displayName = meta.nameFields.map((f) => r[f]).find((v) => !!v) ?? null;
              names[entityKey(type, id)] = displayName;
            }
            // ids não encontrados ficam null (resolvido, mas "removido")
            for (const id of idList) {
              const key = entityKey(type, id);
              if (!(key in names)) names[key] = null;
            }
          }),
      );
    }
  }

  // Atores: profiles não tem school_id consultável aqui sem risco de ocultar
  // o owner (que não tem linha em profiles) -- busca só por user_id, sem
  // escopo de escola, igual o resto do app já faz pra resolver nome de ator.
  const actorIds = Array.from(
    new Set(rows.filter((r) => !r.is_master_action && r.actor_user_id).map((r) => r.actor_user_id as string)),
  );
  const actorNames: Record<string, string | null> = {};
  let actorLookup: Promise<void> = Promise.resolve();
  if (actorIds.length > 0) {
    actorLookup = (supabase as any)
      .from("profiles")
      .select("user_id,full_name")
      .in("user_id", actorIds)
      .then(({ data }: { data: any[] | null }) => {
        for (const r of data ?? []) actorNames[r.user_id] = r.full_name ?? null;
        for (const id of actorIds) if (!(id in actorNames)) actorNames[id] = null;
      });
  }

  await Promise.all([...lookups, actorLookup]);
  return { names, actorNames };
}
