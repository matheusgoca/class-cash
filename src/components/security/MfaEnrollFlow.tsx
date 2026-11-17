import { useState } from 'react';
import { REGEXP_ONLY_DIGITS } from 'input-otp';
import { Copy, QrCode, Smartphone, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { getFriendlyMfaError } from '@/lib/friendlyError';

interface MfaEnrollFlowProps {
  /** Chamado depois que o fator foi verificado com sucesso. */
  onDone: () => void | Promise<void>;
  /** Quando há "Cancelar" (fora do bloqueio forçado). */
  onCancel?: () => void;
}

type Step = 1 | 2 | 3;

/**
 * Ativação do 2FA em 3 passos: instalar o app → escanear o QR → digitar o
 * código. O segredo (QR e chave manual) fica só em estado local deste
 * componente: nunca vai para log, console nem armazenamento.
 */
export function MfaEnrollFlow({ onDone, onCancel }: MfaEnrollFlowProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');

  // O enroll acontece no clique (não num effect) para o StrictMode não criar
  // dois fatores.
  const startEnroll = async () => {
    setBusy(true);
    setError(null);
    try {
      const { data: list, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError) throw listError;

      // 1 fator ativo por usuário: simplifica a recuperação.
      if (list.totp.length > 0) {
        setError('Esta conta já tem a verificação em duas etapas ativa.');
        return;
      }

      // Tentativas abandonadas deixam fatores não verificados; limpa antes de criar outro.
      for (const stale of list.all.filter((f) => f.status !== 'verified')) {
        await supabase.auth.mfa.unenroll({ factorId: stale.id });
      }

      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Aplicativo autenticador',
      });
      if (enrollError) throw enrollError;

      setFactorId(data.id);
      setQr(data.totp.qr_code);
      setSecret(data.totp.secret);
      setStep(2);
    } catch (err) {
      console.error('[MfaEnroll] falha ao iniciar:', (err as { code?: string })?.code ?? 'erro');
      setError('Não foi possível iniciar a ativação. Tente novamente em instantes.');
    } finally {
      setBusy(false);
    }
  };

  const verify = async (value: string) => {
    if (value.length !== 6 || busy || !factorId) return;
    setBusy(true);
    setError(null);
    try {
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: value });
      if (verifyError) throw verifyError;
      // Apaga o segredo da memória antes de seguir.
      setQr(null);
      setSecret(null);
      toast({ title: 'Verificação em duas etapas ativada!' });
      await onDone();
    } catch (err) {
      setError(getFriendlyMfaError(err));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const copySecret = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      toast({ title: 'Chave copiada' });
    } catch {
      toast({ title: 'Não foi possível copiar. Selecione a chave e copie manualmente.', variant: 'destructive' });
    }
  };

  const groupedSecret = secret ? secret.replace(/(.{4})/g, '$1 ').trim() : '';

  return (
    <div className="space-y-5">
      <ol className="flex items-center gap-2 text-xs text-muted-foreground" aria-label="Etapas">
        {[1, 2, 3].map((n) => (
          <li
            key={n}
            aria-current={step === n ? 'step' : undefined}
            className={`rounded-full px-2.5 py-1 ${step === n ? 'bg-primary text-primary-foreground font-medium' : 'bg-muted'}`}
          >
            Passo {n}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <Smartphone className="h-5 w-5 mt-0.5 text-primary" aria-hidden="true" />
            <p className="text-sm">
              Instale um aplicativo autenticador no celular, como Google Authenticator, Microsoft Authenticator
              ou Authy. Depois, continue.
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={startEnroll} disabled={busy}>
              {busy ? 'Preparando...' : 'Já instalei, continuar'}
            </Button>
            {onCancel && (
              <Button variant="ghost" onClick={onCancel} disabled={busy}>
                Cancelar
              </Button>
            )}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <QrCode className="h-5 w-5 mt-0.5 text-primary" aria-hidden="true" />
            <p className="text-sm">No aplicativo, adicione uma conta escaneando o QR code abaixo.</p>
          </div>
          {qr && (
            <img
              src={qr}
              alt="QR code para cadastrar o aplicativo autenticador"
              className="mx-auto h-44 w-44 rounded-md border bg-white p-2"
            />
          )}
          {secret && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Não consegue escanear? Digite esta chave no aplicativo:</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-md bg-muted px-3 py-2 text-sm tracking-wider break-all">
                  {groupedSecret}
                </code>
                <Button type="button" variant="outline" size="icon" onClick={copySecret} aria-label="Copiar chave">
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
          <Button onClick={() => { setError(null); setStep(3); }}>Já adicionei, continuar</Button>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="h-5 w-5 mt-0.5 text-primary" aria-hidden="true" />
            <p className="text-sm">Digite o código de 6 dígitos que o aplicativo está mostrando agora.</p>
          </div>
          <InputOTP
            maxLength={6}
            value={code}
            onChange={setCode}
            onComplete={verify}
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
          <div className="flex gap-2">
            <Button onClick={() => verify(code)} disabled={busy || code.length !== 6}>
              {busy ? 'Verificando...' : 'Ativar'}
            </Button>
            <Button variant="ghost" onClick={() => { setError(null); setCode(''); setStep(2); }} disabled={busy}>
              Voltar ao QR code
            </Button>
          </div>
        </div>
      )}

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
