import { useState } from 'react';
import { REGEXP_ONLY_DIGITS } from 'input-otp';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { useAuth } from '@/contexts/AuthContext';
import { useMfaGate } from '@/contexts/MfaGateContext';
import { supabase } from '@/integrations/supabase/client';
import { getFriendlyMfaError } from '@/lib/friendlyError';

/** Tela "digite o código de 6 dígitos" — login (aal1 → aal2) e retomada de sessão. */
export function MfaChallenge() {
  const { signOut } = useAuth();
  const { refresh } = useMfaGate();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (value: string) => {
    if (value.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError) throw listError;
      const factor = factors.totp[0];
      if (!factor) throw new Error('no-factor');

      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
        factorId: factor.id,
        code: value,
      });
      if (verifyError) throw verifyError;

      await refresh();
    } catch (err) {
      // Nunca logar o código digitado.
      setError(getFriendlyMfaError(err));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <ShieldCheck className="h-6 w-6 text-primary" aria-hidden="true" />
          </div>
          <CardTitle>Verificação em duas etapas</CardTitle>
          <CardDescription>
            Digite o código de 6 dígitos do seu aplicativo autenticador.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-center">
            <InputOTP
              maxLength={6}
              value={code}
              onChange={setCode}
              onComplete={submit}
              pattern={REGEXP_ONLY_DIGITS}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              disabled={busy}
              aria-label="Código de 6 dígitos"
            >
              <InputOTPGroup>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <InputOTPSlot key={i} index={i} />
                ))}
              </InputOTPGroup>
            </InputOTP>
          </div>

          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button className="w-full" disabled={busy || code.length !== 6} onClick={() => submit(code)}>
            {busy ? 'Verificando...' : 'Verificar'}
          </Button>
          <Button variant="ghost" className="w-full" onClick={signOut} disabled={busy}>
            Sair
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
