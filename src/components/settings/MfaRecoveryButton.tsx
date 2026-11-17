import { useState } from 'react';
import { ShieldOff } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface MfaRecoveryButtonProps {
  userId: string;
  fullName: string;
}

/**
 * Admin remove o(s) fator(es) 2FA de um membro que perdeu o aparelho. Roda na
 * Edge Function reset-user-mfa (precisa da service role, que nunca vai ao
 * navegador); a função confere quem chama e grava no audit_logs.
 */
export function MfaRecoveryButton({ userId, fullName }: MfaRecoveryButtonProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const reset = async () => {
    setBusy(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/reset-user-mfa`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ user_id: userId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: 'Erro', description: json.error ?? 'Não foi possível redefinir o 2FA.', variant: 'destructive' });
        return;
      }
      if (json.removed === 0) {
        toast({ title: 'Nada a redefinir', description: `${fullName} não tinha o 2FA ativo.` });
        setOpen(false);
        return;
      }
      toast({
        title: '2FA redefinido',
        description: `${fullName} precisará ativar a verificação em duas etapas de novo no próximo acesso.`,
      });
      setOpen(false);
    } catch {
      toast({ title: 'Erro', description: 'Não foi possível redefinir o 2FA.', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setOpen(true)}
        title="Redefinir 2FA (perdeu o celular)"
        aria-label={`Redefinir 2FA de ${fullName}`}
      >
        <ShieldOff className="h-4 w-4" />
      </Button>

      <AlertDialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Redefinir o 2FA de {fullName}?</AlertDialogTitle>
            <AlertDialogDescription>
              O autenticador atual será removido. No próximo acesso, {fullName} precisará ativar a verificação em duas
              etapas de novo. Use isto quando a pessoa perdeu o celular. A ação fica registrada no histórico.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void reset();
              }}
              disabled={busy}
            >
              {busy ? 'Redefinindo...' : 'Redefinir 2FA'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
