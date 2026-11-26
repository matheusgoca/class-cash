import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { propagationSummary, type AmountsResult } from '@/lib/contractAmounts';
import { formatCurrency } from '@/lib/calculations';

interface ContractAmountsDialogProps {
  result: AmountsResult;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirmação da edição de valor/desconto do contrato, com a divisão do que será atualizado (resultado do dry-run do RPC). */
export function ContractAmountsDialog({ result, loading = false, onConfirm, onCancel }: ContractAmountsDialogProps) {
  const s = propagationSummary(result);
  return (
    <AlertDialog open onOpenChange={(open) => { if (!open && !loading) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Atualizar o valor do contrato?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>A mensalidade do contrato passa de {formatCurrency(Number(result.old_final))} para {formatCurrency(Number(result.new_final))}.</p>
              <p className="font-medium text-foreground">{s.headline}</p>
              {s.unchanged && <p>{s.unchanged}</p>}
              <p className="text-xs">Corrigir o cadastro não é reajuste: para reajustar o próximo ano, use a renovação. A alteração fica registrada na auditoria.</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancelar</AlertDialogCancel>
          <AlertDialogAction disabled={loading} onClick={(e) => { e.preventDefault(); onConfirm(); }}>
            {loading ? 'Atualizando…' : 'Atualizar contrato e mensalidades'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
