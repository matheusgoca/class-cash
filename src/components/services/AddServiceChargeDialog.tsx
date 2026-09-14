import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { getFriendlyErrorMessage } from '@/lib/friendlyError';
import { subscribeStudentToService } from '@/lib/studentServices';

interface AddServiceChargeDialogProps {
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
  type: 'avulso' | 'mensal';
}

const todayStr = () => new Date().toISOString().slice(0, 10);

export function AddServiceChargeDialog({
  open, onOpenChange, schoolId, fixedStudentId, onSuccess,
}: AddServiceChargeDialogProps) {
  const { toast } = useToast();
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [students, setStudents] = useState<{ id: string; name: string }[]>([]);
  const [studentId, setStudentId] = useState(fixedStudentId ?? '');
  const [serviceId, setServiceId] = useState('');
  const [amount, setAmount] = useState('');
  // avulso fields
  const [dueDate, setDueDate] = useState(todayStr());
  // mensal fields
  const [dueDay, setDueDay] = useState('10');
  const [startDate, setStartDate] = useState(todayStr());
  const [submitting, setSubmitting] = useState(false);

  const selectedService = services.find((s) => s.id === serviceId);
  const isMensal = selectedService?.type === 'mensal';

  useEffect(() => {
    if (!open) return;
    setStudentId(fixedStudentId ?? '');
    setServiceId('');
    setAmount('');
    setDueDate(todayStr());
    setDueDay('10');
    setStartDate(todayStr());

    (supabase as any)
      .from('school_services')
      .select('id, name, price, type')
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
        .then(({ data }: any) =>
          setStudents((data || []).map((s: any) => ({ id: s.id, name: s.full_name }))),
        );
    }
  }, [open, schoolId, fixedStudentId]);

  const handleServiceChange = (id: string) => {
    setServiceId(id);
    const svc = services.find((s) => s.id === id);
    if (svc) setAmount(String(svc.price));
  };

  const handleSubmit = async () => {
    if (!studentId || !serviceId || !amount) {
      toast({ title: 'Preencha todos os campos', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      if (isMensal) {
        const { inserted } = await subscribeStudentToService({
          schoolId,
          studentId,
          serviceId,
          price: Number(amount),
          dueDay: Number(dueDay),
          startDate,
        });
        toast({
          title: 'Assinatura criada!',
          description: `${inserted} cobrança${inserted !== 1 ? 's' : ''} gerada${inserted !== 1 ? 's' : ''}.`,
        });
      } else {
        const isOverdue = new Date(dueDate + 'T00:00:00') < new Date(new Date().toDateString());
        const { error } = await (supabase as any).from('service_charges').insert({
          school_id: schoolId,
          student_id: studentId,
          service_id: serviceId,
          description: selectedService?.name ?? 'Serviço',
          amount: Number(amount),
          due_date: dueDate,
          status: isOverdue ? 'overdue' : 'pending',
        });
        if (error) throw error;
        toast({ title: 'Cobrança criada!' });
      }
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      toast({
        title: 'Erro',
        description: getFriendlyErrorMessage(error, 'Erro ao criar cobrança'),
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const fmt = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nova cobrança de serviço</DialogTitle>
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
              <Select value={serviceId} onValueChange={handleServiceChange}>
                <SelectTrigger><SelectValue placeholder="Selecione um serviço" /></SelectTrigger>
                <SelectContent>
                  {services.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      <span className="flex items-center gap-2">
                        {s.name} — {fmt(s.price)}
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                          s.type === 'mensal'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-slate-100 text-slate-600'
                        }`}>
                          {s.type === 'mensal' ? 'mensal' : 'avulso'}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedService && (
                <Badge variant="outline" className={isMensal ? 'border-blue-300 text-blue-700' : ''}>
                  {isMensal ? 'Cobrança recorrente mensal' : 'Cobrança única'}
                </Badge>
              )}
            </div>

            <div className="space-y-2">
              <Label>Valor (R$)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0,00"
              />
            </div>

            {isMensal ? (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Dia de vencimento</Label>
                  <Input
                    type="number"
                    min="1"
                    max="28"
                    value={dueDay}
                    onChange={(e) => setDueDay(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Data de início</Label>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Vencimento</Label>
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={handleSubmit} disabled={submitting}>
              {submitting
                ? 'Criando...'
                : isMensal
                  ? 'Criar assinatura'
                  : 'Criar cobrança'}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
