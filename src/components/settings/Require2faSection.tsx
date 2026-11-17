import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { useSchool } from '@/contexts/SchoolContext';
import { useMfaGate } from '@/contexts/MfaGateContext';
import { supabase } from '@/integrations/supabase/client';

/** Toggle "Exigir 2FA de owner e admin" (só aparece em Configurações, rota de admin). */
export function Require2faSection() {
  const { school, refetch } = useSchool();
  const { refresh } = useMfaGate();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  // Quem altera a política precisa ter 2FA verificado e sessão aal2 (o banco
  // também exige): evita o admin trancar a escola, ele mesmo incluído.
  const [canChange, setCanChange] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [aal, factors] = await Promise.all([
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        supabase.auth.mfa.listFactors(),
      ]);
      if (cancelled) return;
      const ok = aal.data?.currentLevel === 'aal2' && (factors.data?.totp.length ?? 0) > 0;
      setCanChange(ok);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!school) return null;

  const enabled = school.require_2fa;

  const toggle = async (next: boolean) => {
    setSaving(true);
    try {
      const { error } = await supabase.from('schools').update({ require_2fa: next }).eq('id', school.id);
      if (error) {
        const description =
          error.code === '42501'
            ? 'Confirme o seu 2FA (saia e entre de novo com o código) antes de alterar esta política.'
            : 'Não foi possível salvar. Tente novamente.';
        toast({ title: 'Erro ao salvar', description, variant: 'destructive' });
        return;
      }
      await refetch();
      await refresh();
      toast({
        title: next ? 'Exigência de 2FA ligada' : 'Exigência de 2FA desligada',
        description: next ? 'Owner e admins sem 2FA terão 7 dias a partir do próximo acesso.' : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
          <CardTitle>Segurança da escola</CardTitle>
        </div>
        <CardDescription>Política de verificação em duas etapas para quem administra a escola.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="require-2fa">Exigir 2FA de owner e admin</Label>
            <p className="text-sm text-muted-foreground">
              Quem ainda não ativou terá 7 dias, a partir do próximo acesso, antes de ser bloqueado. Financeiro e
              professor não são afetados.
            </p>
          </div>
          <Switch
            id="require-2fa"
            checked={enabled}
            onCheckedChange={toggle}
            disabled={saving || canChange === null || !canChange}
          />
        </div>

        {canChange === false && (
          <Alert>
            <AlertDescription>
              Para alterar esta política, ative primeiro o 2FA da sua própria conta em{' '}
              <Link to="/seguranca" className="font-medium underline underline-offset-2">
                Segurança da conta
              </Link>
              .
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
