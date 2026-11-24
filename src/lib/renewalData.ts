// src/lib/renewalData.ts
// Leituras da tela de rematrícula. Toda consulta filtra school_id (CLAUDE.md), mesmo com RLS.
import { supabase } from '@/integrations/supabase/client';
import { toDateStr } from '@/lib/dateUtils';
import type { DecisionRow, RenewalClass, RenewalContract } from '@/lib/renewal';

export interface RenewalService { id: string; name: string; price: number }

export interface RenewalData {
  contracts: RenewalContract[];
  renewedIds: Set<string>;
  decisions: Record<string, DecisionRow>;
  classes: RenewalClass[];
  activeByClass: Record<string, number>;
  services: RenewalService[];
}

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

/** Contratos ATIVOS que terminam até hoje + windowDays (inclui os já vencidos e ainda ativos). */
export async function fetchRenewalData(schoolId: string, windowDays: number, today: Date = new Date()): Promise<RenewalData> {
  const cutoff = toDateStr(new Date(today.getFullYear(), today.getMonth(), today.getDate() + windowDays));

  const [contractsRes, successorsRes, decisionsRes, classesRes, servicesRes, activeRes] = await Promise.all([
    supabase
      .from('contracts')
      .select('id, student_id, class_id, start_date, end_date, monthly_amount, discount, due_day, period, students(name, full_name), classes(name)')
      .eq('school_id', schoolId)
      .eq('status', 'active')
      .lte('end_date', cutoff)
      .order('end_date', { ascending: true }),
    supabase.from('contracts').select('renewed_from_id').eq('school_id', schoolId).not('renewed_from_id', 'is', null).neq('status', 'cancelled'),
    supabase.from('renewal_decisions').select('contract_id, status, reason, note').eq('school_id', schoolId),
    supabase.from('classes').select('id, name, max_capacity').eq('school_id', schoolId).order('name'),
    (supabase as any).from('school_services').select('id, name, price').eq('school_id', schoolId).eq('active', true).eq('type', 'avulso').order('name'),
    supabase.from('contracts').select('class_id').eq('school_id', schoolId).eq('status', 'active'),
  ]);
  for (const r of [contractsRes, successorsRes, decisionsRes, classesRes, servicesRes, activeRes]) {
    if (r.error) throw r.error;
  }

  const contracts: RenewalContract[] = (contractsRes.data ?? []).map((c: any) => {
    const st = one<{ name: string | null; full_name: string }>(c.students);
    const cl = one<{ name: string }>(c.classes);
    return {
      id: c.id,
      student_id: c.student_id,
      student_name: st?.full_name || st?.name || 'N/A',
      class_id: c.class_id,
      class_name: cl?.name ?? null,
      start_date: c.start_date,
      end_date: c.end_date,
      monthly_amount: Number(c.monthly_amount),
      discount: Number(c.discount),
      due_day: Number(c.due_day),
      period: c.period,
    };
  });

  const renewedIds = new Set<string>((successorsRes.data ?? []).map((r: any) => r.renewed_from_id as string));
  const decisions: Record<string, DecisionRow> = {};
  for (const d of decisionsRes.data ?? []) decisions[d.contract_id] = d as DecisionRow;
  const activeByClass: Record<string, number> = {};
  for (const a of activeRes.data ?? []) if (a.class_id) activeByClass[a.class_id] = (activeByClass[a.class_id] ?? 0) + 1;

  return {
    contracts,
    renewedIds,
    decisions,
    classes: (classesRes.data ?? []).map((c: any) => ({ id: c.id, name: c.name, max_capacity: c.max_capacity ?? null })),
    activeByClass,
    services: (servicesRes.data ?? []).map((s: any) => ({ id: s.id, name: s.name, price: Number(s.price) })),
  };
}
