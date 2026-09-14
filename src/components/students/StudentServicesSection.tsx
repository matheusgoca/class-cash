import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { AddServiceChargeDialog } from '@/components/services/AddServiceChargeDialog';
import { getFriendlyErrorMessage } from '@/lib/friendlyError';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface StudentCharge {
  id: string;
  serviceName: string;
  amount: number;
  due_date: string;
  status: string;
}

interface StudentServicesSectionProps {
  studentId: string;
  schoolId: string;
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendente',
  paid: 'Paga',
  overdue: 'Atrasada',
  cancelled: 'Cancelada',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  paid: 'bg-green-100 text-green-700 border-green-200',
  overdue: 'bg-red-100 text-red-700 border-red-200',
  cancelled: 'bg-slate-100 text-slate-500 border-slate-200',
};

export function StudentServicesSection({ studentId, schoolId }: StudentServicesSectionProps) {
  const { toast } = useToast();
  const [charges, setCharges] = useState<StudentCharge[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    fetchCharges();
  }, [studentId]);

  const fetchCharges = async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('service_charges')
        .select('id, amount, due_date, status, school_services(name)')
        .eq('student_id', studentId)
        .neq('status', 'cancelled')
        .order('due_date', { ascending: false })
        .limit(10);
      if (error) throw error;
      setCharges((data || []).map((c: any) => ({
        id: c.id,
        serviceName: c.school_services?.name ?? 'N/A',
        amount: Number(c.amount),
        due_date: c.due_date,
        status: c.status,
      })));
    } catch (error) {
      console.error('Error fetching student service charges:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">Serviços Avulsos</p>
        <Button type="button" size="sm" variant="outline" onClick={() => setShowAdd(true)} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Cobrar serviço
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-4">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
        </div>
      ) : charges.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma cobrança de serviço.</p>
      ) : (
        <div className="space-y-2">
          {charges.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline">{c.serviceName}</Badge>
                <span className="text-sm text-muted-foreground">{formatCurrency(c.amount)}</span>
                <span className="text-xs text-muted-foreground">
                  venc. {format(new Date(c.due_date + 'T00:00:00'), 'dd/MM/yyyy', { locale: ptBR })}
                </span>
              </div>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${STATUS_COLORS[c.status] ?? ''}`}>
                {STATUS_LABELS[c.status] ?? c.status}
              </span>
            </div>
          ))}
        </div>
      )}

      <AddServiceChargeDialog
        open={showAdd}
        onOpenChange={setShowAdd}
        schoolId={schoolId}
        fixedStudentId={studentId}
        onSuccess={fetchCharges}
      />
    </div>
  );
}
