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
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { CalendarIcon, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { generateTuitions } from "@/lib/generateTuitions";
import { getFriendlyErrorMessage } from "@/lib/friendlyError";

// Local date as 'YYYY-MM-DD' — nunca toISOString(), que converte pra UTC
// primeiro e pode voltar um dia em fusos positivos (mesmo cuidado do
// generateTuitions.ts).
function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const contractSchema = z.object({
  student_id:     z.string().min(1, "Aluno é obrigatório"),
  class_id:       z.string().optional(),
  period:         z.enum(["meio_periodo", "integral"]),
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
  monthly_fee: number | null;
  monthly_fee_integral: number | null;
}

export function ContractForm({ contract, onSubmit, onCancel }: ContractFormProps) {
  const { toast } = useToast();
  const { schoolId } = useSchool();
  const [loading, setLoading] = useState(false);
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(true);
  const [loadingClasses, setLoadingClasses] = useState(true);
  // Taxa de rematrícula (opcional) — cobrança avulsa via o módulo de Serviços
  const [avulsoServices, setAvulsoServices] = useState<{ id: string; name: string; price: number }[]>([]);
  const [chargeRenewalFee, setChargeRenewalFee] = useState(false);
  const [renewalFeeServiceId, setRenewalFeeServiceId] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
    getValues,
    reset,
  } = useForm<ContractFormData>({
    resolver: zodResolver(contractSchema),
    defaultValues: {
      status:  "active",
      period:  "meio_periodo",
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
    if (contract) fetchAvulsoServices();
  }, []);

  const fetchAvulsoServices = async () => {
    const { data, error } = await (supabase as any)
      .from('school_services')
      .select('id, name, price')
      .eq('school_id', schoolId)
      .eq('active', true)
      .eq('type', 'avulso')
      .order('name');
    if (!error) setAvulsoServices(data || []);
  };

  useEffect(() => {
    if (contract) {
      reset({
        student_id:     contract.student_id,
        class_id:       contract.class_id || "",
        period:         contract.period || "meio_periodo",
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

  const watchClassId = watch("class_id");
  const watchPeriod  = watch("period");

  useEffect(() => {
    // Suggest the monthly amount from the class's price for the chosen
    // period — only for new contracts, so editing never silently overwrites
    // an already-customized value.
    if (contract || !watchClassId) return;
    const cls = classes.find((c) => c.id === watchClassId);
    if (!cls) return;
    const suggested = watchPeriod === "integral" ? cls.monthly_fee_integral : cls.monthly_fee;
    if (suggested != null) {
      setValue("monthly_amount", Number(suggested));
    }
  }, [watchClassId, watchPeriod, classes, contract, setValue]);

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
        .select('id, name, monthly_fee, monthly_fee_integral')
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
        period:         data.period,
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

      // Encadeia a partir do término real do contrato atual — não de "hoje" —
      // pra rematrícula processada com antecedência (ex: em novembro para um
      // contrato que só termina em fevereiro) não abrir um contrato torto.
      const [ey, em, ed] = contract.end_date.split('-').map(Number);
      const oldEnd  = new Date(ey, em - 1, ed);
      const newStart = new Date(oldEnd);
      newStart.setDate(newStart.getDate() + 1);
      const newEnd = new Date(newStart.getFullYear(), newStart.getMonth() + 12, 0);

      // Usa os valores atuais do formulário (não os originais do contrato) —
      // assim reajuste de valor e troca de turma na tela antes de clicar em
      // "Renovar" são respeitados em vez de ignorados.
      const formValues = getValues();

      const renewalData = {
        student_id:      contract.student_id,
        class_id:        formValues.class_id || null,
        period:          formValues.period,
        start_date:      toDateStr(newStart),
        end_date:        toDateStr(newEnd),
        monthly_amount:  formValues.monthly_amount,
        discount:        formValues.discount,
        due_day:         formValues.due_day,
        status:          'active' as const,
        school_id:       schoolId,
        renewed_from_id: contract.id,
      };

      const { data: created, error } = await supabase
        .from('contracts')
        .insert([renewalData])
        .select('id')
        .single();

      if (error) throw error;

      const { inserted, error: genError } = await generateTuitions(created.id);

      let feeMessage = "";
      if (chargeRenewalFee && renewalFeeServiceId) {
        const service = avulsoServices.find((s) => s.id === renewalFeeServiceId);
        if (service) {
          const { error: feeError } = await (supabase as any).from('service_charges').insert({
            school_id:   schoolId,
            student_id:  contract.student_id,
            service_id:  service.id,
            description: service.name,
            amount:      service.price,
            due_date:    toDateStr(newStart),
            status:      'pending',
          });
          feeMessage = feeError
            ? ` Erro ao criar a cobrança de "${service.name}": ${getFriendlyErrorMessage(feeError)}.`
            : ` Cobrança de "${service.name}" criada.`;
        }
      }

      if (genError) {
        toast({
          title: "Contrato renovado",
          description: `Contrato criado, mas houve um erro ao gerar mensalidades: ${genError}.${feeMessage}`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Sucesso",
          description: `Contrato renovado com sucesso. ${inserted} mensalidade${inserted !== 1 ? 's' : ''} gerada${inserted !== 1 ? 's' : ''}.${feeMessage}`,
        });
      }

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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

        <div className="space-y-2">
          <Label htmlFor="period">Período *</Label>
          <Select
            onValueChange={(value) => setValue("period", value as "meio_periodo" | "integral")}
            defaultValue={contract?.period || "meio_periodo"}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="meio_periodo">Meio período</SelectItem>
              <SelectItem value="integral">Integral</SelectItem>
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

      {contract && avulsoServices.length > 0 && (
        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Checkbox
              id="charge-renewal-fee"
              checked={chargeRenewalFee}
              onCheckedChange={(v) => setChargeRenewalFee(v === true)}
            />
            <Label htmlFor="charge-renewal-fee" className="font-normal cursor-pointer">
              Cobrar taxa de rematrícula ao renovar
            </Label>
          </div>
          {chargeRenewalFee && (
            <Select value={renewalFeeServiceId} onValueChange={setRenewalFeeServiceId}>
              <SelectTrigger><SelectValue placeholder="Selecione o serviço" /></SelectTrigger>
              <SelectContent>
                {avulsoServices.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} — {fmt(s.price)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}

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