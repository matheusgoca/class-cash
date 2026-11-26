import { useState } from 'react';
import { Mail } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Switch } from '@/components/ui/switch';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { getFriendlyErrorMessage } from '@/lib/friendlyError';

/** Retorno de set_school_email_enabled: `skipped` = itens da fila pulados ao desligar. */
interface SetEmailResult {
  email_enabled?: boolean;
  skipped?: number;
}

interface SchoolEmailSwitchProps {
  schoolId: string;
  schoolName: string;
  enabled: boolean;
  onChanged: (enabled: boolean) => void;
}

/**
 * Interruptor de e-mail por escola (S6, bloco 1). Só o master altera (RPC set_school_email_enabled; o banco também
 * barra admin e financeiro por UPDATE direto). Ligar NÃO envia nada sozinho: as demais travas (interruptor global da função,
 * allowlist, preferências confirmadas, e-mail ligado no evento) continuam valendo.
 */
export function SchoolEmailSwitch({ schoolId, schoolName, enabled, onChanged }: SchoolEmailSwitchProps) {
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const turningOn = !enabled;

  const apply = async () => {
    setLoading(true);
    try {
      // O RPC ainda não está nos tipos gerados do Supabase: o nome e os parâmetros vão com `as never` e o retorno é tipado aqui.
      const { data, error } = await supabase.rpc('set_school_email_enabled' as never, { p_school_id: schoolId, p_enabled: turningOn } as never);
      if (error) throw error;
      const skipped = Number((data as SetEmailResult | null)?.skipped ?? 0);
      toast({
        title: turningOn ? 'E-mail ligado' : 'E-mail desligado',
        description: turningOn
          ? `${schoolName}: o e-mail de avisos está ligado (as demais travas continuam valendo).`
          : `${schoolName}: e-mail desligado${skipped > 0 ? `; ${skipped} ${skipped === 1 ? 'item pulado' : 'itens pulados'} na fila` : ''}.`,
      });
      onChanged(turningOn);
      setConfirming(false);
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string } | null;
      const msg = err?.code === '42501' || /NOT_ALLOWED|suporte/i.test(err?.message ?? '')
        ? 'Somente o suporte Class Cash altera o e-mail de avisos.'
        : getFriendlyErrorMessage(error, 'Não foi possível alterar o e-mail de avisos.');
      toast({ title: 'Erro', description: msg, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Mail className="h-4 w-4" />
          E-mail de avisos: <span className={enabled ? 'font-medium text-green-700' : 'font-medium text-foreground'}>{enabled ? 'Ligado' : 'Desligado'}</span>
        </span>
        <Switch checked={enabled} onCheckedChange={() => setConfirming(true)} disabled={loading} aria-label={`E-mail de avisos de ${schoolName}`} />
      </div>

      {confirming && (
        <AlertDialog open onOpenChange={(open) => { if (!open && !loading) setConfirming(false); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{turningOn ? 'Ligar' : 'Desligar'} o e-mail de avisos?</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2">
                  <p>Escola: <span className="font-medium text-foreground">{schoolName}</span>.</p>
                  {turningOn ? (
                    <p>Ligar libera esta escola para o envio, mas nada sai sozinho: o envio global da função, a lista de e-mails permitidos, as preferências confirmadas pelos usuários e o e-mail ligado em cada evento continuam valendo.</p>
                  ) : (
                    <p>Os avisos desta escola que ainda estão na fila (reivindicados ou com falha) serão pulados, sem apagar, e nada novo será enviado. E-mails já enviados não mudam.</p>
                  )}
                  <p className="text-xs">A mudança fica registrada na auditoria como ação do suporte.</p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={loading}>Cancelar</AlertDialogCancel>
              <AlertDialogAction disabled={loading} onClick={(e) => { e.preventDefault(); apply(); }}>
                {loading ? 'Salvando…' : turningOn ? 'Ligar e-mail' : 'Desligar e-mail'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
