import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { useMfaGate } from '@/contexts/MfaGateContext';
import { graceDaysLeft } from '@/lib/mfaGate';
import { MfaChallenge } from './MfaChallenge';
import { MfaEnrollFlow } from './MfaEnrollFlow';

const Spinner = () => (
  <div className="min-h-screen flex items-center justify-center">
    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
  </div>
);

/** Envolve o conteúdo protegido: desafio, ativação forçada ou faixa de carência. */
export const MfaGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { state, graceUntil, refresh } = useMfaGate();
  const { signOut } = useAuth();

  if (state === 'loading') return <Spinner />;

  if (state === 'challenge') return <MfaChallenge />;

  if (state === 'enroll_blocked') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-destructive" aria-hidden="true" />
              <CardTitle>Ative a verificação em duas etapas</CardTitle>
            </div>
            <CardDescription>
              Sua conta precisa da verificação em duas etapas (2FA) para continuar. Leva cerca de 2 minutos.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <MfaEnrollFlow onDone={refresh} />
            <Button variant="ghost" className="w-full" onClick={signOut}>
              Sair
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (state === 'enroll_grace' && graceUntil) {
    const days = graceDaysLeft(graceUntil, new Date());
    // Data no fuso do navegador (regra do projeto: UTC no banco, local só na exibição).
    const until = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(graceUntil);
    return (
      <>
        <div
          role="status"
          className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-amber-100 px-4 py-2 text-sm text-amber-950 border-b border-amber-300"
        >
          <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Sua conta precisa da verificação em duas etapas. Ative até <strong>{until}</strong>
            {' '}({days} {days === 1 ? 'dia' : 'dias'}) para não perder o acesso.
          </span>
          <Link to="/seguranca" className="font-medium underline underline-offset-2">
            Ativar agora
          </Link>
        </div>
        {children}
      </>
    );
  }

  return <>{children}</>;
};
