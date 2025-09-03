import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface Student {
  id: string;
  name: string;
  classes?: {
    name: string;
  };
}

interface TuitionFormData {
  student_id: string;
  amount: number;
  due_date: Date;
  description: string;
  payment_method?: string;
  status: "pending" | "paid" | "overdue";
  paid_date?: Date;
}

interface TuitionFormProps {
  tuition?: any;
  onSubmit: () => void;
  onCancel: () => void;
}

export function TuitionForm({ tuition, onSubmit, onCancel }: TuitionFormProps) {
  const { toast } = useToast();
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [formData, setFormData] = useState<TuitionFormData>({
    student_id: tuition?.student_id || "",
    amount: tuition?.amount || 0,
    due_date: tuition?.due_date ? new Date(tuition.due_date) : new Date(),
    description: tuition?.description || `Mensalidade ${format(new Date(), "MM/yyyy", { locale: ptBR })}`,
    payment_method: tuition?.payment_method || "",
    status: tuition?.status || "pending",
    paid_date: tuition?.paid_date ? new Date(tuition.paid_date) : undefined,
  });

  useEffect(() => {
    fetchStudents();
  }, []);

  const fetchStudents = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('students')
        .select(`
          id,
          name,
          classes (
            name
          )
        `)
        .eq('status', 'active')
        .order('name');

      if (error) throw error;
      setStudents(data || []);
    } catch (error) {
      console.error('Error fetching students:', error);
      toast({
        title: "Erro",
        description: "Erro ao carregar alunos",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.student_id || !formData.amount || !formData.due_date) {
      toast({
        title: "Erro",
        description: "Preencha todos os campos obrigatórios",
        variant: "destructive",
      });
      return;
    }

    try {
      setSubmitting(true);

      const submitData = {
        student_id: formData.student_id,
        amount: formData.amount,
        due_date: format(formData.due_date, 'yyyy-MM-dd'),
        description: formData.description,
        payment_method: formData.payment_method || null,
        status: formData.status,
        paid_date: formData.status === 'paid' && formData.paid_date 
          ? format(formData.paid_date, 'yyyy-MM-dd') 
          : null,
      };

      let error;
      
      if (tuition) {
        // Update existing tuition
        const { error: updateError } = await supabase
          .from('tuitions')
          .update(submitData)
          .eq('id', tuition.id);
        error = updateError;
      } else {
        // Create new tuition
        const { error: insertError } = await supabase
          .from('tuitions')
          .insert([submitData]);
        error = insertError;
      }

      if (error) throw error;

      toast({
        title: "Sucesso",
        description: tuition ? "Mensalidade atualizada com sucesso!" : "Mensalidade criada com sucesso!",
      });

      onSubmit();
    } catch (error) {
      console.error('Error saving tuition:', error);
      toast({
        title: "Erro",
        description: "Erro ao salvar mensalidade",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = (newStatus: string) => {
    setFormData(prev => ({
      ...prev,
      status: newStatus as "pending" | "paid" | "overdue",
      paid_date: newStatus === 'paid' ? new Date() : undefined
    }));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {tuition ? 'Editar Mensalidade' : 'Nova Mensalidade'}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="student">Aluno *</Label>
            <Select
              value={formData.student_id}
              onValueChange={(value) => setFormData(prev => ({ ...prev, student_id: value }))}
              disabled={loading}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione um aluno" />
              </SelectTrigger>
              <SelectContent>
                {students.map((student) => (
                  <SelectItem key={student.id} value={student.id}>
                    {student.name} {student.classes?.name && `(${student.classes.name})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="amount">Valor (R$) *</Label>
            <Input
              id="amount"
              type="number"
              step="0.01"
              min="0"
              value={formData.amount}
              onChange={(e) => setFormData(prev => ({ ...prev, amount: parseFloat(e.target.value) || 0 }))}
              placeholder="0,00"
              required
            />
          </div>

          <div>
            <Label>Data de Vencimento *</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !formData.due_date && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {formData.due_date ? format(formData.due_date, "dd/MM/yyyy", { locale: ptBR }) : "Selecione a data"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={formData.due_date}
                  onSelect={(date) => date && setFormData(prev => ({ ...prev, due_date: date }))}
                  initialFocus
                  className="p-3 pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </div>

          <div>
            <Label htmlFor="description">Descrição</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Descrição da mensalidade"
              rows={3}
            />
          </div>

          <div>
            <Label htmlFor="payment_method">Forma de Pagamento</Label>
            <Select
              value={formData.payment_method || "none"}
              onValueChange={(value) => setFormData(prev => ({ ...prev, payment_method: value === "none" ? "" : value }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione a forma de pagamento" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Não informado</SelectItem>
                <SelectItem value="Dinheiro">Dinheiro</SelectItem>
                <SelectItem value="PIX">PIX</SelectItem>
                <SelectItem value="Cartão de Débito">Cartão de Débito</SelectItem>
                <SelectItem value="Cartão de Crédito">Cartão de Crédito</SelectItem>
                <SelectItem value="Transferência">Transferência</SelectItem>
                <SelectItem value="Boleto">Boleto</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {tuition && (
            <div>
              <Label>Status</Label>
              <Select
                value={formData.status}
                onValueChange={handleStatusChange}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pendente</SelectItem>
                  <SelectItem value="paid">Pago</SelectItem>
                  <SelectItem value="overdue">Atrasado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {formData.status === 'paid' && (
            <div>
              <Label>Data de Pagamento</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !formData.paid_date && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {formData.paid_date 
                      ? format(formData.paid_date, "dd/MM/yyyy", { locale: ptBR }) 
                      : "Selecione a data de pagamento"
                    }
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={formData.paid_date}
                    onSelect={(date) => date && setFormData(prev => ({ ...prev, paid_date: date }))}
                    initialFocus
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
          )}

          <div className="flex gap-2 pt-4">
            <Button type="submit" disabled={submitting || loading}>
              {submitting ? 'Salvando...' : (tuition ? 'Atualizar' : 'Criar Mensalidade')}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancelar
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}