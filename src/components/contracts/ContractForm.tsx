import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { CalendarIcon, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { generateTuitions } from "@/lib/generateTuitions";

const contractSchema = z.object({
  student_id:     z.string().min(1, "Aluno é obrigatório"),
  class_id:       z.string().optional(),
  start_date:     z.date({ message: "Data de início é obrigatória" }),
  end_date:       z.date({ message: "Data de término é obrigatória" }),
  monthly_amount: z.number().min(0, "Valor deve ser maior que zero"),
  discount:       z.number().min(0).max(100, "Desconto deve ser entre 0 e 100%"),
  due_day:        z.number().int().min(1).max(28),
  status:         z.enum(["active", "suspended", "cancelled"]),
});

type ContractFormData = z.infer<typeof contractSchema>;

interface ContractFormProps {
  contract?: any;
  onSubmit: () => void;
  onCancel: () => void;
}

interface Student {
  id: string;
  name: string;
}

interface Class {
  id: string;
  name: string;
}

export function ContractForm({ contract, onSubmit, onCancel }: ContractFormProps) {
  const { toast } = useToast();
  const { schoolId } = useSchool();
  const [loading, setLoading] = useState(false);
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(true);
  const [loadingClasses, setLoadingClasses] = useState(true);

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
    reset,
  } = useForm<ContractFormData>({
    resolver: zodResolver(contractSchema),
    defaultValues: {
      status:  "active",
      due_day: 10,
    },
  });

  const watchStartDate    = watch("start_date");
  const watchMonthly      = watch("monthly_amount") ?? 0;
  const watchDiscount     = watch("discount") ?? 0;
  const previewFinalValue = watchMonthly * (1 - watchDiscount / 100);

  const fmt = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

  useEffect(() => {
    fetchStudents();
    fetchClasses();
  }, []);

  useEffect(() => {
    if (contract) {
      reset({
        student_id:     contract.student_id,
        class_id:       contract.class_id || "",
        start_date:     new Date(contract.start_date),
        end_date:       new Date(contract.end_date),
        monthly_amount: Number(contract.monthly_amount),
        discount:       Number(contract.discount),
        due_day:        Number(contract.due_day ?? 10),
        status:         contract.status,
      });
    }
  }, [contract, reset]);

  useEffect(() => {
    // Auto-calculate end_date as 1 year after start_date
    if (watchStartDate && !contract) {
      // Last day of the 12th month after start (e.g. Apr 2026 → Mar 31 2027)
      const endDate = new Date(watchStartDate.getFullYear(), watchStartDate.getMonth() + 12, 0);
      setValue("end_date", endDate);
    }
  }, [watchStartDate, setValue, contract]);

  const fetchStudents = async () => {
    try {
      const { data, error } = await (supabase as any)
        .from('students')
        .select('id, name, full_name')
        .eq('school_id', schoolId)
        .eq('status', 'active')
        .order('full_name');

      if (error) throw error;
      setStudents((data || []).map((s: any) => ({ id: s.id, name: s.full_name })));
    } catch (error) {
      console.error('Error fetching students:', error);
      toast({
        title: "Erro",
        description: "Erro ao carregar alunos",
        variant: "destructive",
      });
    } finally {
      setLoadingStudents(false);
    }
  };

  const fetchClasses = async () => {
    try {
      const { data, error } = await supabase
        .from('classes')
        .select('id, name')
        .eq('school_id', schoolId)
        .order('name');

      if (error) throw error;
      setClasses(data || []);
    } catch (error) {
      console.error('Error fetching classes:', error);
      toast({
        title: "Erro",
        description: "Erro ao carregar turmas",
        variant: "destructive",
      });
    } finally {
      setLoadingClasses(false);
    }
  };

  const onFormSubmit = async (data: ContractFormData) => {
    try {
      setLoading(true);

      const contractData = {
        student_id:     data.student_id,
        class_id:       data.class_id || null,
        start_date:     data.start_date.toISOString().split('T')[0],
        end_date:       data.end_date.toISOString().split('T')[0],
        monthly_amount: data.monthly_amount,
        discount:       data.discount,
        due_day:        data.due_day,
        status:         data.status,
        school_id:      schoolId,
      };

      if (contract) {
        const { error } = await supabase
          .from('contracts')
          .update(contractData)
          .eq('id', contract.id);

        if (error) throw error;

        // If status changed to active, generate missing tuitions
        if (data.status === 'active') {
          await generateTuitions(contract.id);
        }

        toast({ title: "Sucesso", description: "Contrato atualizado com sucesso" });
      } else {
        const { data: created, error } = await supabase
          .from('contracts')
          .insert([contractData])
          .select('id')
          .single();

        if (error) throw error;

        // Generate tuitions for active contracts
        if (data.status === 'active' && created?.id) {
          const { inserted, error: genError } = await generateTuitions(created.id);
          if (genError) {
            console.error('generateTuitions error:', genError);
            toast({
              title: "Contrato criado",
              description: `Contrato salvo, mas houve um erro ao gerar mensalidades: ${genError}`,
              variant: "destructive",
            });
          } else {
            toast({
              title: "Contrato criado!",
              description: `${inserted} mensalidade${inserted !== 1 ? 's' : ''} gerada${inserted !== 1 ? 's' : ''} automaticamente.`,
            });
          }
        } else {
          toast({ title: "Contrato criado!", description: "Contrato salvo com sucesso." });
        }
      }

      onSubmit();
    } catch (error: any) {
      console.error('Error saving contract:', error);
      toast({ title: "Erro", description: error.message ?? "Erro ao salvar contrato", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleRenew = async () => {
    if (!contract) return;

    try {
      setLoading(true);

      const renewalData = {
        student_id: contract.student_id,
        class_id: contract.class_id,
        start_date: new Date().toISOString().split('T')[0],
        end_date: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().split('T')[0],
        monthly_amount: contract.monthly_amount,
        discount: contract.discount,
        status: 'active' as const,
        school_id: schoolId,
      };

      const { error } = await supabase
        .from('contracts')
        .insert([renewalData]);

      if (error) throw error;

      toast({
        title: "Sucesso",
        description: "Contrato renovado com sucesso. Novas mensalidades foram geradas.",
      });

      onSubmit();
    } catch (error) {
      console.error('Error renewing contract:', error);
      toast({
        title: "Erro",
        description: "Erro ao renovar contrato",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="student_id">Aluno *</Label>
          <Select
            onValueChange={(value) => setValue("student_id", value)}
            defaultValue={contract?.student_id}
          >
            <SelectTrigger>
              <SelectValue placeholder={loadingStudents ? "Carregando..." : "Selecione um aluno"} />
            </SelectTrigger>
            <SelectContent>
              {students.map((student) => (
                <SelectItem key={student.id} value={student.id}>
                  {student.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.student_id && (
            <p className="text-sm text-destructive">{errors.student_id.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="class_id">Turma</Label>
          <Select
            onValueChange={(value) => setValue("class_id", value === "none" ? "" : value)}
            defaultValue={contract?.class_id || "none"}
          >
            <SelectTrigger>
              <SelectValue placeholder={loadingClasses ? "Carregando..." : "Selecione uma turma"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Sem turma</SelectItem>
              {classes.map((classItem) => (
                <SelectItem key={classItem.id} value={classItem.id}>
                  {classItem.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Data de Início *</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-full justify-start text-left font-normal",
                  !watchStartDate && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {watchStartDate ? format(watchStartDate, "dd/MM/yyyy") : "Selecione a data"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0">
              <Calendar
                mode="single"
                selected={watchStartDate}
                onSelect={(date) => setValue("start_date", date!)}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
          {errors.start_date && (
            <p className="text-sm text-destructive">{errors.start_date.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label>Data de Término *</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-full justify-start text-left font-normal",
                  !watch("end_date") && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {watch("end_date") ? format(watch("end_date"), "dd/MM/yyyy") : "Selecione a data"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0">
              <Calendar
                mode="single"
                selected={watch("end_date")}
                onSelect={(date) => setValue("end_date", date!)}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
          {errors.end_date && (
            <p className="text-sm text-destructive">{errors.end_date.message}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label htmlFor="monthly_amount">Valor Mensal (R$) *</Label>
          <Input
            id="monthly_amount"
            type="number"
            step="0.01"
            placeholder="500.00"
            {...register("monthly_amount", { valueAsNumber: true })}
          />
          {errors.monthly_amount && (
            <p className="text-sm text-destructive">{errors.monthly_amount.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="discount">Desconto (%)</Label>
          <Input
            id="discount"
            type="number"
            step="0.01"
            min="0"
            max="100"
            placeholder="0"
            {...register("discount", { setValueAs: (v) => v === '' || v === undefined ? 0 : Number(v) })}
          />
          {errors.discount && (
            <p className="text-sm text-destructive">{errors.discount.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="due_day">Dia de vencimento</Label>
          <Input
            id="due_day"
            type="number"
            min="1"
            max="28"
            placeholder="10"
            {...register("due_day", { valueAsNumber: true })}
          />
          <p className="text-xs text-muted-foreground">Dia do mês (1–28)</p>
          {errors.due_day && (
            <p className="text-sm text-destructive">{errors.due_day.message}</p>
          )}
        </div>
      </div>

      {/* Valor final calculado */}
      <div className="flex items-center justify-between rounded-lg bg-muted px-4 py-3">
        <div>
          <p className="text-sm font-medium">Valor final da mensalidade</p>
          <p className="text-xs text-muted-foreground">Após {watchDiscount}% de desconto</p>
        </div>
        <p className="text-2xl font-bold">{fmt(previewFinalValue)}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="status">Status *</Label>
        <Select
          onValueChange={(value) => setValue("status", value as "active" | "suspended" | "cancelled")}
          defaultValue={contract?.status || "active"}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Ativo</SelectItem>
            <SelectItem value="suspended">Suspenso</SelectItem>
            <SelectItem value="cancelled">Cancelado</SelectItem>
          </SelectContent>
        </Select>
        {errors.status && (
          <p className="text-sm text-destructive">{errors.status.message}</p>
        )}
      </div>

      <div className="flex justify-between pt-6">
        <div className="space-x-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          {contract && (
            <Button type="button" variant="secondary" onClick={handleRenew} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Renovar"}
            </Button>
          )}
        </div>
        <Button type="submit" disabled={loading}>
          {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          {contract ? "Atualizar" : "Criar"} Contrato
        </Button>
      </div>
    </form>
  );
}