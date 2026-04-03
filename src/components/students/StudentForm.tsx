import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

const studentSchema = z.object({
  full_name:        z.string().min(2, 'Nome deve ter pelo menos 2 caracteres'),
  email:            z.string().email('Email inválido').optional().or(z.literal('')),
  phone:            z.string().optional(),
  birth_date:       z.date({ required_error: 'Data de nascimento é obrigatória' }),
  enrollment_date:  z.date({ required_error: 'Data de matrícula é obrigatória' }),
  guardian_contact: z.string().optional(),
  class_id:         z.string().nullable(),
  full_tuition_value: z.number().min(0, 'Valor deve ser positivo'),
  discount:         z.number().min(0).max(100).optional(),
  status:           z.enum(['active', 'inactive']),
});

type StudentFormData = z.infer<typeof studentSchema>;

interface StudentFormProps {
  student?: any;
  onSubmit: (data: StudentFormData) => Promise<void>;
  onCancel: () => void;
  classes: any[];
  isLoading?: boolean;
}

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

export const StudentForm: React.FC<StudentFormProps> = ({
  student, onSubmit, onCancel, classes, isLoading,
}) => {
  const form = useForm<StudentFormData>({
    resolver: zodResolver(studentSchema),
    defaultValues: {
      full_name:          student?.full_name ?? '',
      email:              student?.email ?? '',
      phone:              student?.phone ?? '',
      birth_date:         student?.birth_date ? new Date(student.birth_date) : undefined,
      enrollment_date:    student?.enrollment_date ? new Date(student.enrollment_date) : new Date(),
      guardian_contact:   student?.guardian_contact ?? '',
      class_id:           student?.enrollment_class_id ?? null,
      full_tuition_value: student?.full_tuition_value ?? 0,
      discount:           student?.discount ?? 0,
      status:             student?.status ?? 'active',
    },
  });

  const fullTuitionValue = form.watch('full_tuition_value');
  const discount         = form.watch('discount') ?? 0;
  const finalValue       = fullTuitionValue * (1 - discount / 100);

  return (
    <DialogContent className="sm:max-w-[640px] max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{student ? 'Editar Aluno' : 'Novo Aluno'}</DialogTitle>
      </DialogHeader>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">

          {/* ── Dados pessoais ── */}
          <div>
            <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wider mb-3">Dados Pessoais</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

              <FormField control={form.control} name="full_name" render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Nome Completo <span className="text-destructive">*</span></FormLabel>
                  <FormControl><Input placeholder="Ex: João da Silva" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="birth_date" render={({ field }) => (
                <FormItem>
                  <FormLabel>Data de Nascimento <span className="text-destructive">*</span></FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button variant="outline" className={cn('w-full justify-start text-left font-normal', !field.value && 'text-muted-foreground')}>
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {field.value ? format(field.value, 'dd/MM/yyyy', { locale: ptBR }) : 'Selecione'}
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={field.value} onSelect={field.onChange}
                        captionLayout="dropdown-buttons" fromYear={1950} toYear={new Date().getFullYear()} initialFocus />
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="enrollment_date" render={({ field }) => (
                <FormItem>
                  <FormLabel>Data de Matrícula <span className="text-destructive">*</span></FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button variant="outline" className={cn('w-full justify-start text-left font-normal', !field.value && 'text-muted-foreground')}>
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {field.value ? format(field.value, 'dd/MM/yyyy', { locale: ptBR }) : 'Selecione'}
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={field.value} onSelect={field.onChange}
                        captionLayout="dropdown-buttons" fromYear={2000} toYear={new Date().getFullYear() + 1} initialFocus />
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl><Input type="email" placeholder="email@exemplo.com" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Telefone</FormLabel>
                  <FormControl><Input placeholder="(11) 99999-9999" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="guardian_contact" render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Contato do Responsável</FormLabel>
                  <FormControl><Input placeholder="Nome e telefone do responsável" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
          </div>

          <Separator />

          {/* ── Matrícula e financeiro ── */}
          <div>
            <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wider mb-3">Matrícula & Financeiro</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

              <FormField control={form.control} name="class_id" render={({ field }) => (
                <FormItem>
                  <FormLabel>Turma</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? undefined}>
                    <FormControl>
                      <SelectTrigger><SelectValue placeholder="Selecione uma turma" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {classes.map((cls) => (
                        <SelectItem key={cls.id} value={cls.id}>{cls.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="status" render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="active">Ativo</SelectItem>
                      <SelectItem value="inactive">Inativo</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="full_tuition_value" render={({ field }) => (
                <FormItem>
                  <FormLabel>Mensalidade base (R$)</FormLabel>
                  <FormControl>
                    <Input type="number" min="0" step="0.01" placeholder="500.00"
                      {...field} value={field.value}
                      onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="discount" render={({ field }) => (
                <FormItem>
                  <FormLabel>Desconto (%)</FormLabel>
                  <FormControl>
                    <Input type="number" min="0" max="100" step="0.01" placeholder="0"
                      {...field} value={field.value}
                      onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            {/* Valor final calculado */}
            <div className="mt-4 flex items-center justify-between rounded-lg bg-muted px-4 py-3">
              <div>
                <p className="text-sm font-medium">Valor final da mensalidade</p>
                <p className="text-xs text-muted-foreground">Após {discount}% de desconto</p>
              </div>
              <p className="text-2xl font-bold">{fmt(finalValue)}</p>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Salvando...' : student ? 'Atualizar' : 'Criar Aluno'}
            </Button>
          </DialogFooter>
        </form>
      </Form>
    </DialogContent>
  );
};
