import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';

const studentSchema = z.object({
  name: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres'),
  birth_date: z.string().min(1, 'Data de nascimento é obrigatória'),
  guardian_contact: z.string().min(10, 'Contato do responsável deve ter pelo menos 10 caracteres'),
  class_id: z.string().nullable(),
  status: z.enum(['active', 'inactive']),
});

type StudentFormData = z.infer<typeof studentSchema>;

interface StudentFormProps {
  student?: any;
  onSubmit: (data: StudentFormData) => Promise<void>;
  onCancel: () => void;
  classes: any[];
  isLoading?: boolean;
}

export const StudentForm: React.FC<StudentFormProps> = ({
  student,
  onSubmit,
  onCancel,
  classes,
  isLoading
}) => {
  const form = useForm<StudentFormData>({
    resolver: zodResolver(studentSchema),
    defaultValues: {
      name: student?.name || '',
      birth_date: student?.birth_date || '',
      guardian_contact: student?.guardian_contact || '',
      class_id: student?.class_id || null,
      status: student?.status || 'active',
    },
  });

  return (
    <DialogContent className="sm:max-w-[425px]">
      <DialogHeader>
        <DialogTitle>
          {student ? 'Editar Aluno' : 'Novo Aluno'}
        </DialogTitle>
      </DialogHeader>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nome Completo</FormLabel>
                <FormControl>
                  <Input placeholder="Digite o nome completo" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="birth_date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Data de Nascimento</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="guardian_contact"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Contato do Responsável</FormLabel>
                <FormControl>
                  <Input placeholder="Telefone ou email do responsável" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="class_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Turma</FormLabel>
                <Select onValueChange={(value) => field.onChange(value || null)} value={field.value || ''}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione uma turma" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="">Nenhuma turma</SelectItem>
                    {classes.map((cls) => (
                      <SelectItem key={cls.id} value={cls.id}>
                        {cls.name}
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
            name="status"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="active">Ativo</SelectItem>
                    <SelectItem value="inactive">Inativo</SelectItem>
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
              {isLoading ? 'Salvando...' : student ? 'Atualizar' : 'Criar'}
            </Button>
          </DialogFooter>
        </form>
      </Form>
    </DialogContent>
  );
};