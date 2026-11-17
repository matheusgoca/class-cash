import { useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Check, Circle, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { evaluatePassword } from '@/lib/passwordRules';
import { getFriendlyPasswordError } from '@/lib/friendlyError';

type Step = 1 | 2 | 3;

/**
 * Confere a senha atual SEM tocar na sessão do usuário. signInWithPassword no
 * cliente principal trocaria a sessão por uma nova em aal1 — para quem tem 2FA
 * isso derrubaria o aal2 e travaria a própria troca. Um cliente descartável,
 * sem persistência e com storageKey próprio, não emite nada para o principal.
 */
async function verifyCurrentPassword(email: string, password: string): Promise<'ok' | 'wrong' | 'error'> {
  const probe = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: 'class-cash-password-probe',
      },
    },
  );
  const { error } = await probe.auth.signInWithPassword({ email, password });
  if (!error) {
    // Encerra só a sessão descartável criada pela conferência.
    await probe.auth.signOut({ scope: 'local' }).catch(() => undefined);
    return 'ok';
  }
  if (error.code === 'invalid_credentials' || /invalid login credentials/i.test(error.message)) return 'wrong';
  return 'error';
}

export function PasswordChangeFlow() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [step, setStep] = useState<Step>(1);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { rules, valid } = evaluatePassword(next);
  const matches = next.length > 0 && next === confirm;

  const reset = () => {
    setStep(1);
    setCurrent('');
    setNext('');
    setConfirm('');
    setError(null);
  };

  const checkCurrent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.email || !current) return;
    setBusy(true);
    setError(null);
    try {
      const result = await verifyCurrentPassword(user.email, current);
      if (result === 'wrong') {
        setError('Senha atual incorreta.');
      } else if (result === 'error') {
        setError('Não foi possível confirmar a senha agora. Tente novamente.');
      } else {
        setStep(2);
      }
    } finally {
      setBusy(false);
    }
  };

  const goConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || !matches) return;
    setError(null);
    setStep(3);
  };

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: next });
      if (updateError) throw updateError;

      // Encerra todos os outros dispositivos; esta sessão continua.
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'others' });
      if (signOutError) {
        toast({
          title: 'Senha alterada',
          description: 'Não foi possível encerrar as outras sessões. Saia dos outros dispositivos manualmente.',
          variant: 'destructive',
        });
      } else {
        toast({ title: 'Senha alterada', description: 'As outras sessões foram encerradas.' });
      }
      reset();
    } catch (err) {
      // Nunca logar a senha digitada.
      setError(getFriendlyPasswordError(err));
      setStep(2);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-primary" aria-hidden="true" />
          <CardTitle>Trocar senha</CardTitle>
        </div>
        <CardDescription>Em 3 passos. Ao final, os outros dispositivos são desconectados.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <ol className="flex items-center gap-2 text-xs text-muted-foreground" aria-label="Etapas">
          {['Senha atual', 'Nova senha', 'Confirmar'].map((label, i) => (
            <li
              key={label}
              aria-current={step === i + 1 ? 'step' : undefined}
              className={`rounded-full px-2.5 py-1 ${step === i + 1 ? 'bg-primary text-primary-foreground font-medium' : 'bg-muted'}`}
            >
              {i + 1}. {label}
            </li>
          ))}
        </ol>

        {step === 1 && (
          <form onSubmit={checkCurrent} className="space-y-3 max-w-sm">
            <div className="space-y-1">
              <Label htmlFor="pwd-current">Senha atual</Label>
              <Input
                id="pwd-current"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                disabled={busy}
              />
            </div>
            <Button type="submit" disabled={busy || !current}>
              {busy ? 'Conferindo...' : 'Continuar'}
            </Button>
          </form>
        )}

        {step === 2 && (
          <form onSubmit={goConfirm} className="space-y-4 max-w-sm">
            <div className="space-y-1">
              <Label htmlFor="pwd-new">Nova senha</Label>
              <Input
                id="pwd-new"
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                aria-describedby="pwd-rules"
              />
            </div>
            <ul id="pwd-rules" className="space-y-1 text-sm">
              {rules.map((r) => (
                <li key={r.id} className={`flex items-center gap-2 ${r.ok ? 'text-primary' : 'text-muted-foreground'}`}>
                  {r.ok ? <Check className="h-4 w-4" aria-hidden="true" /> : <Circle className="h-4 w-4" aria-hidden="true" />}
                  <span>{r.label}</span>
                  <span className="sr-only">{r.ok ? '(atendido)' : r.required ? '(pendente)' : '(opcional)'}</span>
                </li>
              ))}
            </ul>
            <div className="space-y-1">
              <Label htmlFor="pwd-confirm">Confirmar nova senha</Label>
              <Input
                id="pwd-confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              {confirm.length > 0 && !matches && (
                <p className="text-xs text-destructive">As senhas não coincidem.</p>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={!valid || !matches}>
                Continuar
              </Button>
              <Button type="button" variant="ghost" onClick={reset}>
                Cancelar
              </Button>
            </div>
          </form>
        )}

        {step === 3 && (
          <div className="space-y-4 max-w-md">
            <p className="text-sm">
              Ao confirmar, sua senha será alterada e <strong>todos os outros dispositivos serão desconectados</strong>.
              Este continua conectado.
            </p>
            <div className="flex gap-2">
              <Button onClick={apply} disabled={busy}>
                {busy ? 'Alterando...' : 'Confirmar e trocar senha'}
              </Button>
              <Button variant="ghost" onClick={() => setStep(2)} disabled={busy}>
                Voltar
              </Button>
            </div>
          </div>
        )}

        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
