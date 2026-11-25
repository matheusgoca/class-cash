import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useSchool } from '@/contexts/SchoolContext';
import { toDateStr } from '@/lib/dateUtils';
import { formatCurrency } from '@/lib/calculations';
import { cn } from '@/lib/utils';
import {
  CLASS_REFERENCE_LABEL, CONTRACT_VALUE_LABEL, NO_CONTRACT_NOTE,
  pickCurrentContract, studentTuitionView, type StudentContract,
} from '@/lib/studentTuition';

interface Props {
  /** Aluno em edição; sem id (aluno novo) não há contrato a consultar. */
  studentId?: string;
  /** Turma escolhida no formulário (reativa). */
  classId: string | null;
  classes: Array<{ id: string; monthly_fee?: number | string | null }>;
  className?: string;
}

const day = (s: string) => format(parseISO(s), 'dd/MM/yyyy');

/**
 * Item I (opção A): o aluno não digita valor. Mostra, somente leitura, o VALOR DO CONTRATO vigente ou,
 * sem contrato, a REFERÊNCIA DA TURMA (meio período). Os dois rótulos são textos diferentes e os dois
 * blocos têm aparência diferente (sólido x tracejado), sem depender só de cor.
 */
export function StudentTuitionInfo({ studentId, classId, classes, className }: Props) {
  const { schoolId } = useSchool();
  const [contracts, setContracts] = useState<StudentContract[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    setContracts([]);
    setLoadFailed(false);
    if (!studentId || !schoolId) return;
    let cancelled = false;
    (supabase as any)
      .from('contracts')
      .select('id, student_id, status, start_date, end_date, final_amount, discount')
      .eq('school_id', schoolId)
      .eq('student_id', studentId)
      .then(({ data, error }: { data: StudentContract[] | null; error: unknown }) => {
        if (cancelled) return;
        if (error) { setLoadFailed(true); return; }
        setContracts(data ?? []);
      });
    return () => { cancelled = true; };
  }, [studentId, schoolId]);

  const current = pickCurrentContract(contracts, toDateStr(new Date()));
  const classFee = classes.find((c) => c.id === classId)?.monthly_fee ?? null;
  const view = studentTuitionView(current, classFee);

  if (view.kind === 'contract') {
    return (
      <div
        role="group"
        aria-label={CONTRACT_VALUE_LABEL}
        className={cn('flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted px-4 py-3', className)}
      >
        <div className="min-w-0">
          <p className="text-sm font-medium">{CONTRACT_VALUE_LABEL}</p>
          <p className="text-xs text-muted-foreground">
            {view.discount > 0 ? `Após ${view.discount}% de desconto · ` : ''}
            Vigência {day(view.start)} a {day(view.end)}
          </p>
          <Link to="/contratos" className="text-xs font-medium underline underline-offset-2">Ver contrato</Link>
        </div>
        <p className="text-2xl font-bold">{formatCurrency(view.value)}</p>
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label={CLASS_REFERENCE_LABEL}
      className={cn('rounded-lg border border-dashed px-4 py-3', className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-sm font-medium text-muted-foreground">{CLASS_REFERENCE_LABEL}</p>
        <p className="text-xl font-semibold text-muted-foreground">
          {view.kind === 'class_reference' ? formatCurrency(view.value) : '—'}
        </p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{NO_CONTRACT_NOTE}</p>
      {loadFailed && (
        <p className="mt-1 text-xs text-destructive">Não foi possível verificar o contrato deste aluno. Recarregue a página.</p>
      )}
    </div>
  );
}
