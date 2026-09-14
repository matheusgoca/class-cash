// Limites do plano Starter — únicos aplicados hoje, já que Pro/Enterprise não têm
// cobrança nem self-service (são provisionados manualmente pelo Master Admin).
// Enforcement é soft (aviso, não bloqueio): não existe upgrade self-service ainda,
// então bloquear travaria uma escola pagante sem ela ter como se resolver sozinha.
export const STARTER_LIMITS = {
  students: 50,
  classes: 5,
} as const;

type LimitKind = keyof typeof STARTER_LIMITS;

export function isOverPlanLimit(plan: string | null | undefined, kind: LimitKind, count: number): boolean {
  if (plan !== 'starter') return false;
  return count >= STARTER_LIMITS[kind];
}
