import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { SubscribeServiceDialog } from '@/components/services/SubscribeServiceDialog';
import { cancelStudentService } from '@/lib/studentServices';
import { getFriendlyErrorMessage } from '@/lib/friendlyError';

interface StudentSubscription {
  id: string;
  price: number;
  serviceName: string;
}

interface StudentServicesSectionProps {
  studentId: string;
  schoolId: string;
}

export function StudentServicesSection({ studentId, schoolId }: StudentServicesSectionProps) {
  const { toast } = useToast();
  const [subscriptions, setSubscriptions] = useState<StudentSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSubscribe, setShowSubscribe] = useState(false);

  useEffect(() => {
    fetchSubscriptions();
  }, [studentId]);

  const fetchSubscriptions = async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('student_services')
        .select('id, price, school_services(name)')
        .eq('student_id', studentId)
        .eq('active', true)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setSubscriptions((data || []).map((s: any) => ({
        id: s.id,
        price: Number(s.price),
        serviceName: s.school_services?.name ?? 'N/A',
      })));
    } catch (error) {
      console.error('Error fetching student services:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async (subscriptionId: string) => {
    try {
      await cancelStudentService(subscriptionId);
      toast({ title: 'Assinatura cancelada' });
      fetchSubscriptions();
    } catch (error) {
      toast({
        title: 'Erro',
        description: getFriendlyErrorMessage(error, 'Erro ao cancelar assinatura'),
        variant: 'destructive',
      });
    }
  };

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">Serviços Contratados</p>
        <Button type="button" size="sm" variant="outline" onClick={() => setShowSubscribe(true)} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Assinar serviço
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-4">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
        </div>
      ) : subscriptions.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum serviço contratado.</p>
      ) : (
        <div className="space-y-2">
          {subscriptions.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{s.serviceName}</Badge>
                <span className="text-sm text-muted-foreground">{formatCurrency(s.price)}/mês</span>
              </div>
              <Button type="button" size="sm" variant="ghost" onClick={() => handleCancel(s.id)}>
                Cancelar
              </Button>
            </div>
          ))}
        </div>
      )}

      <SubscribeServiceDialog
        open={showSubscribe}
        onOpenChange={setShowSubscribe}
        schoolId={schoolId}
        fixedStudentId={studentId}
        onSuccess={fetchSubscriptions}
      />
    </div>
  );
}
