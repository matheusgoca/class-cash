import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';

const classSchema = z.object({
  name: z.string().min(2, 'Nome da turma deve ter pelo menos 2 caracteres'),
  grade: z.string().nullable(),
  description: z.string().optional(),
  teacher_id: z.string().nullable(),
  max_capacity: z.number().min(1, 'Capacidade máxima deve ser pelo menos 1').max(50, 'Capacidade máxima não pode exceder 50'),
  monthly_fee: z.number().min(0, 'Mensalidade da turma deve ser positiva').optional(),
  tuition_per_student: z.number().min(0, 'Valor da mensalidade deve ser positivo').optional(),
  color: z.string().min(1, 'Cor é obrigatória'),
});

type ClassFormData = z.infer<typeof classSchema>;

interface ClassFormProps {
  classData?: any;
  onSubmit: (data: ClassFormData) => Promise<void>;
  onCancel: () => void;
  teachers: any[];
  isLoading?: boolean;
}

const classColors = [
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
  classData,
  onSubmit,
  onCancel,
  teachers,
  isLoading
}) => {
  const form = useForm<ClassFormData>({
    resolver: zodResolver(classSchema),
    defaultValues: {
      name: classData?.name || '',
      grade: classData?.grade || null,
      description: classData?.description || '',
      teacher_id: classData?.teacher_id || null,
      max_capacity: classData?.max_capacity || 30,
      monthly_fee: classData?.monthly_fee || 0,
      tuition_per_student: classData?.tuition_per_student || 0,
      color: classData?.color || '#3B82F6',
    },
  });

  return (
    <DialogContent className="sm:max-w-[600px]">
      <DialogHeader>
        <DialogTitle>
          {classData ? 'Editar Turma' : 'Nova Turma'}
        </DialogTitle>
      </DialogHeader>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nome da Turma</FormLabel>
                <FormControl>
                  <Input placeholder="Ex: 1º Ano A, 2º Ano B..." {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="grade"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Série/Ano</FormLabel>
                <Select onValueChange={(value) => field.onChange(value)} value={field.value || undefined}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione a série" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="1º Ano">1º Ano</SelectItem>
                    <SelectItem value="2º Ano">2º Ano</SelectItem>
                    <SelectItem value="3º Ano">3º Ano</SelectItem>
                    <SelectItem value="4º Ano">4º Ano</SelectItem>
                    <SelectItem value="5º Ano">5º Ano</SelectItem>
                    <SelectItem value="6º Ano">6º Ano</SelectItem>
                    <SelectItem value="7º Ano">7º Ano</SelectItem>
                    <SelectItem value="8º Ano">8º Ano</SelectItem>
                    <SelectItem value="9º Ano">9º Ano</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Descrição</FormLabel>
                <FormControl>
                  <Input placeholder="Descrição da turma (opcional)" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="teacher_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Professor Responsável</FormLabel>
                <Select onValueChange={(value) => field.onChange(value)} value={field.value || undefined}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione um professor" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {teachers.map((teacher) => (
                      <SelectItem key={teacher.id} value={teacher.id}>
                        {teacher.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="monthly_fee"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Mensalidade da Turma (R$)</FormLabel>
                <FormControl>
                  <Input 
                    type="number" 
                    min="0" 
                    step="0.01"
                    placeholder="1500.00"
                    {...field}
                    value={field.value}
                    onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="tuition_per_student"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Mensalidade por Aluno (R$)</FormLabel>
                <FormControl>
                  <Input 
                    type="number" 
                    min="0" 
                    step="0.01"
                    placeholder="500.00"
                    {...field}
                    value={field.value}
                    onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="max_capacity"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Capacidade Máxima</FormLabel>
                <FormControl>
                  <Input 
                    type="number" 
                    min="1" 
                    max="50" 
                    {...field}
                    value={field.value}
                    onChange={(e) => field.onChange(parseInt(e.target.value) || 30)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="color"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Cor da Turma</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {classColors.map((color) => (
                      <SelectItem key={color.value} value={color.value}>
                        <div className="flex items-center gap-2">
                          <div 
                            className="w-4 h-4 rounded-full" 
                            style={{ backgroundColor: color.value }}
                          />
                          {color.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Salvando...' : classData ? 'Atualizar' : 'Criar'}
            </Button>
          </DialogFooter>
        </form>
      </Form>
    </DialogContent>
  );
};