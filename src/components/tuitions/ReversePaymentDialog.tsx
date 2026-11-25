import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { reversalImpact } from '@/lib/tuitionReversal';

interface ReversePaymentDialogProps {
  studentName: string;
  description: string;
  paidDate: string;
  finalAmount: number | null;
  amount: number;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirmação do estorno de baixa, com o aviso do impacto no Realizado do mês. */
export function ReversePaymentDialog({ studentName, description, paidDate, finalAmount, amount, loading = false, onConfirm, onCancel }: ReversePaymentDialogProps) {
  const impact = reversalImpact({ paid_date: paidDate, final_amount: finalAmount, amount });
  return (
    <AlertDialog open onOpenChange={(open) => { if (!open && !loading) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Estornar baixa?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p><span className="font-medium text-foreground">{studentName}</span> — {description}</p>
              <p>{impact.message}</p>
              <p>A data, o valor e a forma de pagamento da baixa são apagados. O estorno fica registrado na auditoria.</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancelar</AlertDialogCancel>
          <AlertDialogAction disabled={loading} onClick={(e) => { e.preventDefault(); onConfirm(); }}>
            {loading ? 'Estornando…' : 'Estornar baixa'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
