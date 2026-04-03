import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';

const classSchema = z.object({
  name:         z.string().min(2, 'Nome da turma deve ter pelo menos 2 caracteres'),
  grade:        z.string().nullable(),
  description:  z.string().optional(),
  max_capacity: z.number().min(1).max(50),
  monthly_fee:  z.number().min(0).optional(),
  color:        z.string().min(1, 'Cor é obrigatória'),
  teacher_ids:  z.array(z.string()),
});

type ClassFormData = z.infer<typeof classSchema>;

interface ClassFormProps {
  classData?: any;
  onSubmit: (data: ClassFormData) => Promise<void>;
  onCancel: () => void;
  teachers: any[];
  isLoading?: boolean;
}

const CLASS_COLORS = [
  { value: '#3B82F6', label: 'Azul' },
  { value: '#10B981', label: 'Verde' },
  { value: '#F59E0B', label: 'Amarelo' },
  { value: '#EF4444', label: 'Vermelho' },
  { value: '#8B5CF6', label: 'Roxo' },
  { value: '#F97316', label: 'Laranja' },
  { value: '#06B6D4', label: 'Ciano' },
  { value: '#84CC16', label: 'Lima' },
];

export const ClassForm: React.FC<ClassFormProps> = ({
  classData, onSubmit, onCancel, teachers, isLoading,
}) => {
  // Pre-populate teacher_ids from class_teachers join
  const existingTeacherIds: string[] = (classData?.class_teachers ?? [])
    .map((ct: any) => ct.teacher_id ?? ct.teachers?.id)
    .filter(Boolean);

  const form = useForm<ClassFormData>({
    resolver: zodResolver(classSchema),
    defaultValues: {
      name:         classData?.name        ?? '',
      grade:        classData?.grade       ?? null,
      description:  classData?.description ?? '',
      max_capacity: classData?.max_capacity ?? 30,
      monthly_fee:  classData?.monthly_fee  ?? 0,
      color:        classData?.color        ?? '#3B82F6',
      teacher_ids:  existingTeacherIds,
    },
  });

  const selectedTeachers = form.watch('teacher_ids');

  const toggleTeacher = (id: string) => {
    const current = form.getValues('teacher_ids');
    form.setValue(
      'teacher_ids',
      current.includes(id) ? current.filter(t => t !== id) : [...current, id],
    );
  };

  return (
    <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{classData ? 'Editar Turma' : 'Nova Turma'}</DialogTitle>
      </DialogHeader>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>Nome da Turma <span className="text-destructive">*</span></FormLabel>
                <FormControl><Input placeholder="Ex: 1º Ano A" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="grade" render={({ field }) => (
              <FormItem>
                <FormLabel>Série/Ano</FormLabel>
                <Select onValueChange={field.onChange} value={field.value ?? undefined}>
                  <FormControl>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {['1º Ano','2º Ano','3º Ano','4º Ano','5º Ano','6º Ano','7º Ano','8º Ano','9º Ano'].map(g => (
                      <SelectItem key={g} value={g}>{g}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="color" render={({ field }) => (
              <FormItem>
                <FormLabel>Cor <span className="text-destructive">*</span></FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue>
                        {field.value && (
                          <div className="flex items-center gap-2">
                            <div className="w-4 h-4 rounded-full" style={{ backgroundColor: field.value }} />
                            {CLASS_COLORS.find(c => c.value === field.value)?.label}
                          </div>
                        )}
                      </SelectValue>
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {CLASS_COLORS.map(c => (
                      <SelectItem key={c.value} value={c.value}>
                        <div className="flex items-center gap-2">
                          <div className="w-4 h-4 rounded-full" style={{ backgroundColor: c.value }} />
                          {c.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="max_capacity" render={({ field }) => (
              <FormItem>
                <FormLabel>Capacidade máxima</FormLabel>
                <FormControl>
                  <Input type="number" min="1" max="50" {...field}
                    onChange={e => field.onChange(parseInt(e.target.value) || 30)} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="monthly_fee" render={({ field }) => (
              <FormItem>
                <FormLabel>Mensalidade base (R$)</FormLabel>
                <FormControl>
                  <Input type="number" min="0" step="0.01" placeholder="0.00" {...field}
                    onChange={e => field.onChange(parseFloat(e.target.value) || 0)} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>Descrição</FormLabel>
                <FormControl><Input placeholder="Opcional" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </div>

          {/* Professores */}
          <FormField control={form.control} name="teacher_ids" render={() => (
            <FormItem>
              <FormLabel>Professores</FormLabel>
              {teachers.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum professor cadastrado.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-md border p-3">
                  {teachers.map(t => (
                    <div key={t.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`teacher-${t.id}`}
                        checked={selectedTeachers.includes(t.id)}
                        onCheckedChange={() => toggleTeacher(t.id)}
                      />
                      <label htmlFor={`teacher-${t.id}`} className="text-sm cursor-pointer">
                        {t.full_name}
                      </label>
                    </div>
                  ))}
                </div>
              )}
              <FormMessage />
            </FormItem>
          )} />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Salvando...' : classData ? 'Atualizar' : 'Criar Turma'}
            </Button>
          </DialogFooter>
        </form>
      </Form>
    </DialogContent>
  );
};
