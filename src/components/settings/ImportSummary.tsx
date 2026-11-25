import { XCircle, CheckCircle2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { ImportRowError } from '@/lib/import/types';

const linhas = (n: number) => (n === 1 ? '1 linha' : `${n} linhas`);

function RowReasons({ rows, className }: { rows: ImportRowError[]; className?: string }) {
  return (
    <div className={className ?? 'max-h-56 overflow-y-auto mt-2 space-y-1'}>
      {rows.map((e, i) => (
        <p key={i} className="text-xs">
          <span className="font-semibold">Linha {e.row}{e.field ? ` (${e.field})` : ''}:</span> {e.message}
        </p>
      ))}
    </div>
  );
}

/**
 * Prévia da importação: destaca QUANTAS linhas serão ignoradas e o MOTIVO de cada uma.
 * Regra mantida: a linha com erro não é importada e as válidas seguem.
 */
export function IgnoredRowsAlert({ errors, validCount }: { errors: ImportRowError[]; validCount: number }) {
  if (errors.length === 0) return null;
  return (
    <Alert variant="destructive">
      <XCircle className="h-4 w-4" />
      <AlertTitle>{linhas(errors.length)} {errors.length === 1 ? 'ignorada' : 'ignoradas'}</AlertTitle>
      <AlertDescription>
        <p className="text-xs">
          {errors.length === 1 ? 'Ela não será importada' : 'Elas não serão importadas'}.{' '}
          {validCount === 0
            ? 'Nenhuma linha válida: nada será importado.'
            : validCount === 1
              ? 'A outra linha válida segue normalmente.'
              : `As outras ${validCount} linhas válidas seguem normalmente.`}
        </p>
        <RowReasons rows={errors} />
        <p className="text-xs mt-2">Corrija essas linhas na planilha e envie novamente: só elas precisam ser reenviadas.</p>
      </AlertDescription>
    </Alert>
  );
}

/** Resultado final: repete o total importado e o total ignorado (com os motivos), separando as falhas de gravação. */
export function ImportResultSummary({ imported, ignored, failed }: { imported: number; ignored: ImportRowError[]; failed: number }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-4 text-sm">
        <span className="flex items-center gap-1.5 text-emerald-600">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> <span>Importados: {imported}</span>
        </span>
        <span className={`flex items-center gap-1.5 ${ignored.length > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
          <XCircle className="h-4 w-4" aria-hidden="true" /> <span>Ignorados: {ignored.length}</span>
        </span>
        {failed > 0 && (
          <span className="flex items-center gap-1.5 text-destructive">
            <XCircle className="h-4 w-4" aria-hidden="true" /> <span>Falharam ao gravar: {failed}</span>
          </span>
        )}
      </div>
      {ignored.length > 0 && (
        <Alert>
          <AlertTitle>Linhas ignoradas (não foram importadas)</AlertTitle>
          <AlertDescription>
            <RowReasons rows={ignored} className="max-h-40 overflow-y-auto mt-2 space-y-1" />
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
