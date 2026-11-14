/**
 * Fonte única dos segmentos que uma escola pode atender (S2, Fase 2).
 * Antes duplicado em Onboarding.tsx e Settings.tsx com os valores antigos
 * (infantil/fundamental/medio/tecnico); agora com os 6 valores novos —
 * fundamental virou fundamental_1 + fundamental_2 (ver migration
 * 20261113170000_schools_segments_v2_and_primary.sql).
 */
import { Lightbulb, BookOpen, GraduationCap, Building2, Languages, type LucideIcon } from "lucide-react";

export interface SegmentOption {
  value: string;
  label: string;
  description: string;
  icon: LucideIcon;
  /** técnico e idiomas aparecem como secundários na UI — nunca como principal sugerido. */
  secondary?: boolean;
}

export const SEGMENTS: SegmentOption[] = [
  { value: "infantil", label: "Educação Infantil", description: "Berçário ao Pré II", icon: Lightbulb },
  { value: "fundamental_1", label: "Fundamental I", description: "1º ao 5º ano", icon: BookOpen },
  { value: "fundamental_2", label: "Fundamental II", description: "6º ao 9º ano", icon: BookOpen },
  { value: "medio", label: "Ensino Médio", description: "1ª à 3ª série", icon: GraduationCap },
  { value: "tecnico", label: "Curso Técnico", description: "Cursos profissionalizantes", icon: Building2, secondary: true },
  { value: "idiomas", label: "Idiomas", description: "Níveis e módulos", icon: Languages, secondary: true },
];

export const SEGMENT_VALUES = SEGMENTS.map((s) => s.value);

export function segmentLabel(value: string): string {
  return SEGMENTS.find((s) => s.value === value)?.label ?? value;
}

/**
 * Normaliza um array de segmentos pro schema novo: expande o valor antigo
 * 'fundamental' em 'fundamental_1' + 'fundamental_2', remove duplicados e
 * valores desconhecidos, e devolve na ordem pedagógica de SEGMENTS (mesma
 * regra do backfill em 20261113170000_schools_segments_v2_and_primary.sql).
 * Usada antes de qualquer INSERT/UPDATE em schools.segments feito a partir
 * de dado que pode ser antigo (ex: user_metadata.pending_school_segments de
 * um convite criado antes desta sprint).
 */
export function normalizeSegments(segments: string[] | null | undefined): string[] {
  if (!segments || segments.length === 0) return [];
  const expanded = segments.flatMap((s) => (s === "fundamental" ? ["fundamental_1", "fundamental_2"] : [s]));
  const valid = new Set(expanded.filter((s) => SEGMENT_VALUES.includes(s)));
  return SEGMENT_VALUES.filter((v) => valid.has(v));
}

export interface GradeGroup {
  label: string;
  grades: string[];
}

// Etapas da Educação Básica (LDB 9.394/96 + BNCC + Lei 13.415/2017 - Novo
// Ensino Médio). Berçário/Maternal/Pré não têm nomenclatura federal
// padronizada, mas são os termos mais comuns; "grade" continua texto livre
// no banco, isto é só a lista sugerida no seletor. Técnico e idiomas não
// têm grupo de série -- não existe uma lista oficial pra sugerir.
const GRADE_GROUPS_BY_SEGMENT: Record<string, GradeGroup> = {
  infantil: {
    label: "Educação Infantil",
    grades: ["Berçário I", "Berçário II", "Maternal I", "Maternal II", "Pré I", "Pré II"],
  },
  fundamental_1: {
    label: "Fundamental I",
    grades: ["1º Ano", "2º Ano", "3º Ano", "4º Ano", "5º Ano"],
  },
  fundamental_2: {
    label: "Fundamental II",
    grades: ["6º Ano", "7º Ano", "8º Ano", "9º Ano"],
  },
  medio: {
    label: "Ensino Médio",
    grades: ["1º Ano (Médio)", "2º Ano (Médio)", "3º Ano (Médio)"],
  },
};

/** Ordem pedagógica fixa, independente da ordem em que a escola marcou os segmentos. */
const GRADE_GROUP_ORDER = ["infantil", "fundamental_1", "fundamental_2", "medio"];

export const ALL_GRADE_GROUPS: GradeGroup[] = GRADE_GROUP_ORDER.map((v) => GRADE_GROUPS_BY_SEGMENT[v]);

/**
 * Grupos de série pros segmentos marcados pela escola, na ordem pedagógica.
 * Escola sem segmento nenhum definido (array vazio/nulo) vê todos os grupos.
 */
export function getGradeGroupsForSegments(segments: string[] | null | undefined): GradeGroup[] {
  if (!segments || segments.length === 0) return ALL_GRADE_GROUPS;
  const selected = new Set(segments);
  return GRADE_GROUP_ORDER.filter((v) => selected.has(v)).map((v) => GRADE_GROUPS_BY_SEGMENT[v]);
}
