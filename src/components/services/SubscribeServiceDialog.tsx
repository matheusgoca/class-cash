import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { subscribeStudentToService } from '@/lib/studentServices';
import { getFriendlyErrorMessage } from '@/lib/friendlyError';

interface SubscribeServiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schoolId: string;
  fixedStudentId?: string;
  onSuccess: () => void;
}

interface ServiceOption {
  id: string;
  name: string;
  price: number;
}

interface StudentOption {
  id: string;
  name: string;
}

const todayStr = () => new Date().toISOString().slice(0, 10);

export function SubscribeServiceDialog({
  open, onOpenChange, schoolId, fixedStudentId, onSuccess,
}: SubscribeServiceDialogProps) {
  const { toast } = useToast();
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [studentId, setStudentId] = useState(fixedStudentId ?? '');
  const [serviceId, setServiceId] = useState('');
  const [dueDay, setDueDay] = useState('10');
  const [startDate, setStartDate] = useState(todayStr());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStudentId(fixedStudentId ?? '');
    setServiceId('');
    setDueDay('10');
    setStartDate(todayStr());

    (supabase as any)
      .from('school_services')
      .select('id, name, price')
      .eq('school_id', schoolId)
      .eq('active', true)
      .order('name')
      .then(({ data }: any) => setServices(data || []));

    if (!fixedStudentId) {
      (supabase as any)
        .from('students')
        .select('id, full_name')
        .eq('school_id', schoolId)
        .eq('status', 'active')
        .order('full_name')
        .then(({ data }: any) => setStudents((data || []).map((s: any) => ({ id: s.id, name: s.full_name }))));
    }
  }, [open, schoolId, fixedStudentId]);

  const selectedService = services.find((s) => s.id === serviceId);

  const handleSubmit = async () => {
    if (!studentId || !serviceId || !selectedService) {
      toast({ title: 'Preencha aluno e serviço', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      const { inserted } = await subscribeStudentToService({
        schoolId,
        studentId,
        serviceId,
        price: selectedService.price,
        dueDay: Number(dueDay),
        startDate,
      });
      toast({
        title: 'Assinatura criada!',
        description: `${inserted} cobrança${inserted !== 1 ? 's' : ''} gerada${inserted !== 1 ? 's' : ''}.`,
      });
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      toast({
        title: 'Erro',
        description: getFriendlyErrorMessage(error, 'Erro ao assinar serviço'),
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assinar serviço</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {!fixedStudentId && (
              <div className="space-y-2">
                <Label>Aluno</Label>
                <Select value={studentId} onValueChange={setStudentId}>
                  <SelectTrigger><SelectValue placeholder="Selecione um aluno" /></SelectTrigger>
                  <SelectContent>
                    {students.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>Serviço</Label>
              <Select value={serviceId} onValueChange={setServiceId}>
                <SelectTrigger><SelectValue placeholder="Selecione um serviço" /></SelectTrigger>
                <SelectContent>
                  {services.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} — {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(s.price)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Dia de vencimento</Label>
                <Input type="number" min="1" max="28" value={dueDay} onChange={(e) => setDueDay(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Início</Label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="button" onClick={handleSubmit} disabled={submitting}>
              {submitting ? 'Assinando...' : 'Assinar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
