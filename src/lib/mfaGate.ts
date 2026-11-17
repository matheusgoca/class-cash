export type MfaGateState = "ok" | "challenge" | "enroll_grace" | "enroll_blocked";

export interface MfaGateInput {
  currentLevel: "aal1" | "aal2" | null;
  hasVerifiedFactor: boolean;
  schoolRequires2fa: boolean;
  isAdminOrOwner: boolean;
  /** Master admin é sempre exigido, independente de toggle de escola. */
  isMasterAdmin: boolean;
  graceUntil: Date | null;
  now: Date;
}

// Espelho em TS de public.mfa_gate_ok() (SQL). Diferença intencional: o front
// também pede o código para quem tem fator mesmo quando não é exigido
// (2FA voluntário); o banco só bloqueia quando a exigência existe.
export function resolveMfaGate(i: MfaGateInput): MfaGateState {
  if (i.currentLevel === "aal2") return "ok";
  if (i.hasVerifiedFactor) return "challenge";
  const required = i.isMasterAdmin || (i.schoolRequires2fa && i.isAdminOrOwner);
  if (!required) return "ok";
  if (i.graceUntil && i.graceUntil.getTime() > i.now.getTime()) return "enroll_grace";
  return "enroll_blocked";
}

export function graceDaysLeft(graceUntil: Date, now: Date): number {
  const ms = graceUntil.getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}
