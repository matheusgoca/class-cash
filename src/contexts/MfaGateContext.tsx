import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './AuthContext';
import { useSchool } from './SchoolContext';
import { useMasterAdmin } from './MasterAdminContext';
import { resolveMfaGate, type MfaGateState } from '@/lib/mfaGate';

type GateState = MfaGateState | 'loading';

interface MfaGateContextType {
  state: GateState;
  /** Fim da carência (só preenchido quando state === 'enroll_grace'). */
  graceUntil: Date | null;
  /** Recalcula (chamar depois de verificar, ativar ou desativar um fator). */
  refresh: () => Promise<void>;
}

const MfaGateContext = createContext<MfaGateContextType | undefined>(undefined);

export const useMfaGate = () => {
  const ctx = useContext(MfaGateContext);
  if (!ctx) throw new Error('useMfaGate must be used within MfaGateProvider');
  return ctx;
};

// Estado vive num Provider (e não num hook por rota) porque o ProtectedRoute é
// remontado a cada navegação: um hook ali refaria 3 chamadas e piscaria um
// spinner a cada clique. Aqui calcula uma vez por usuário/escola.
export const MfaGateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading: authLoading } = useAuth();
  const { school, loading: schoolLoading } = useSchool();
  const { isMasterAdmin } = useMasterAdmin();

  const [state, setState] = useState<GateState>('loading');
  const [graceUntil, setGraceUntil] = useState<Date | null>(null);
  const seq = useRef(0);

  const userId = user?.id ?? null;
  const schoolRequires2fa = school?.require_2fa ?? false;
  const schoolOwnerId = school?.owner_user_id ?? null;

  const compute = useCallback(async () => {
    const mine = ++seq.current;

    if (!userId) {
      setGraceUntil(null);
      setState('ok');
      return;
    }

    try {
      const [aalRes, factorsRes] = await Promise.all([
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        supabase.auth.mfa.listFactors(),
      ]);
      if (aalRes.error) throw aalRes.error;
      if (factorsRes.error) throw factorsRes.error;

      // `totp` da listFactors só traz fatores já verificados.
      const hasVerifiedFactor = factorsRes.data.totp.length > 0;

      // owner ou admin (owner não precisa de linha em user_roles). Só consulta
      // quando a resposta pode importar: escola exige e usuário não é master.
      let isAdminOrOwner = userId === schoolOwnerId;
      if (!isAdminOrOwner && schoolRequires2fa && !isMasterAdmin) {
        const { data: roleRow, error: roleErr } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', userId)
          .maybeSingle();
        if (roleErr) throw roleErr;
        isAdminOrOwner = roleRow?.role === 'admin';
      }

      const input = {
        currentLevel: aalRes.data.currentLevel,
        hasVerifiedFactor,
        schoolRequires2fa,
        isAdminOrOwner,
        isMasterAdmin,
        now: new Date(),
      };

      let result = resolveMfaGate({ ...input, graceUntil: null });
      let until: Date | null = null;

      // 'enroll_blocked' sem carência = exigido, sem fator, sem aal2. Pede ao
      // banco para iniciar a carência (idempotente) ANTES de liberar a tela:
      // é isso que evita a corrida com as queries das páginas.
      if (result === 'enroll_blocked') {
        const { data, error } = await supabase.rpc('start_mfa_grace');
        if (error) throw error;
        const iso = data as string | null;
        if (iso) {
          until = new Date(iso);
          result = resolveMfaGate({ ...input, graceUntil: until });
        }
      }

      if (mine !== seq.current) return; // chegou uma execução mais nova
      setGraceUntil(until);
      setState(result);
    } catch (err) {
      // Nunca logar o objeto inteiro nem tokens. A barreira real é o banco
      // (RLS); aqui, na dúvida, mantém o último estado conhecido e só libera
      // se nunca houve um.
      const e = err as { code?: string; message?: string };
      console.error('[MfaGate] falha ao calcular estado:', e?.code ?? e?.message ?? 'erro');
      if (mine === seq.current) setState((prev) => (prev === 'loading' ? 'ok' : prev));
    }
  }, [userId, schoolRequires2fa, schoolOwnerId, isMasterAdmin]);

  // Trocou de usuário → volta a 'loading' (sem piscar quando é só o refetch da
  // escola: aí o estado anterior é mantido até o novo resultado chegar).
  useEffect(() => {
    setState('loading');
    setGraceUntil(null);
  }, [userId]);

  useEffect(() => {
    if (authLoading || schoolLoading) return;
    void compute();
  }, [authLoading, schoolLoading, compute]);

  return (
    <MfaGateContext.Provider value={{ state, graceUntil, refresh: compute }}>
      {children}
    </MfaGateContext.Provider>
  );
};
