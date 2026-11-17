import { useCallback, useEffect, useState } from 'react';
import { REGEXP_ONLY_DIGITS } from 'input-otp';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { useToast } from '@/hooks/use-toast';
import { useRole } from '@/hooks/use-role';
import { useSchool } from '@/contexts/SchoolContext';
import { useMasterAdmin } from '@/contexts/MasterAdminContext';
import { useMfaGate } from '@/contexts/MfaGateContext';
import { supabase } from '@/integrations/supabase/client';
import { getFriendlyMfaError } from '@/lib/friendlyError';
import { MfaEnrollFlow } from './MfaEnrollFlow';

type FactorState = { status: 'loading' } | { status: 'none' } | { status: 'active'; factorId: string };

/** Card "Verificação em duas etapas" da página /seguranca (vale para todos os papéis). */
export function TwoFactorCard() {
  const { toast } = useToast();
  const { school } = useSchool();
  const { isAdmin } = useRole();
  const { isMasterAdmin } = useMasterAdmin();
  const { refresh } = useMfaGate();

  const [factor, setFactor] = useState<FactorState>({ status: 'loading' });
  const [enrolling, setEnrolling] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Quem é exigido não pode desativar (senão cairia direto no bloqueio).
  const required = isMasterAdmin || (!!school?.require_2fa && isAdmin);

  const load = useCallback(async () => {
    const { data, error: listError } = await supabase.auth.mfa.listFactors();
    if (listError) {
      setFactor({ status: 'none' });
      return;
    }
    const verified = data.totp[0];
    setFactor(verified ? { status: 'active', factorId: verified.id } : { status: 'none' });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const afterEnroll = async () => {
    setEnrolling(false);
    await load();
    await refresh();
  };

  const closeDisable = () => {
    setDisabling(false);
    setCode('');
    setError(null);
  };

  const disable = async (value: string) => {
    if (factor.status !== 'active' || value.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Desativar exige o código atual: prova de que é a pessoa certa e deixa a
      // sessão em aal2, que é o que o unenroll exige.
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
        factorId: factor.factorId,
        code: value,
      });
      if (verifyError) throw verifyError;

      const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId: factor.factorId });
      if (unenrollError) throw unenrollError;

      toast({ title: 'Verificação em duas etapas desativada' });
      closeDisable();
      await load();
      await refresh();
    } catch (err) {
      setError(getFriendlyMfaError(err));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
          <CardTitle>Verificação em duas etapas (2FA)</CardTitle>
          {factor.status === 'active' && <Badge>Ativa</Badge>}
        </div>
        <CardDescription>
          Além da senha, pede um código de 6 dígitos gerado no seu celular. Protege a conta mesmo que a senha vaze.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {factor.status === 'loading' && (
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" aria-label="Carregando" />
        )}

        {factor.status === 'none' && !enrolling && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">A verificação em duas etapas não está ativa nesta conta.</p>
            <Button onClick={() => setEnrolling(true)}>Ativar</Button>
          </div>
        )}

        {factor.status === 'none' && enrolling && (
          <MfaEnrollFlow onDone={afterEnroll} onCancel={() => setEnrolling(false)} />
        )}

        {factor.status === 'active' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Ao entrar, será pedido o código do seu aplicativo autenticador.
            </p>
            {required ? (
              <Alert>
                <AlertDescription>
                  {isMasterAdmin
                    ? 'Contas master precisam manter o 2FA ativo.'
                    : 'Sua escola exige 2FA de owner e admin, então ele não pode ser desativado.'}
                </AlertDescription>
              </Alert>
            ) : (
              <Button variant="outline" className="gap-2" onClick={() => setDisabling(true)}>
                <ShieldOff className="h-4 w-4" aria-hidden="true" />
                Desativar
              </Button>
            )}
          </div>
        )}
      </CardContent>

      <Dialog open={disabling} onOpenChange={(open) => !open && !busy && closeDisable()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Desativar 2FA</DialogTitle>
            <DialogDescription>Digite o código atual do aplicativo para confirmar.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <InputOTP
              maxLength={6}
              value={code}
              onChange={setCode}
              onComplete={disable}
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
            {error && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="flex gap-2">
              <Button variant="destructive" onClick={() => disable(code)} disabled={busy || code.length !== 6}>
                {busy ? 'Desativando...' : 'Desativar'}
              </Button>
              <Button variant="ghost" onClick={closeDisable} disabled={busy}>
                Cancelar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
