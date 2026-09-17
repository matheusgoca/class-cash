import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useSchool } from '@/contexts/SchoolContext';
import { ClassForm } from '@/components/classes/ClassForm';
import { ClassTable } from '@/components/classes/ClassTable';
import { getFriendlyErrorMessage } from '@/lib/friendlyError';
import { PlanLimitBanner } from '@/components/PlanLimitBanner';
import { isOverPlanLimit, STARTER_LIMITS } from '@/lib/planLimits';

const Classes = () => {
  const { schoolId, school } = useSchool();
  const [classes, setClasses] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingClass, setEditingClass] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    if (schoolId) {
      fetchClasses();
      fetchTeachers();
    }
  }, [schoolId]);

  const fetchClasses = async () => {
    try {
      const { data: classData, error: classError } = await (supabase as any)
        .from('classes')
        .select(`
          *,
          class_teachers (
            teacher_id,
            weekly_hours,
            teachers (
              id,
              full_name,
              email,
              status
            )
          )
        `)
        .eq('school_id', schoolId)
        .order('name');

      if (classError) throw classError;

      // Get student counts for each class via enrollments
      // enrollments has no school_id — class_ids already scoped to this school above
      const { data: enrollments, error: enrollmentError } = await (supabase as any)
        .from('enrollments')
        .select('class_id');

      if (enrollmentError) throw enrollmentError;

      const counts = (enrollments || []).reduce((acc: any, enrollment: any) => {
        if (enrollment.class_id) {
          acc[enrollment.class_id] = (acc[enrollment.class_id] || 0) + 1;
        }
        return acc;
      }, {});

      const classesWithCounts = (classData || []).map(cls => ({
        ...cls,
        student_count: counts[cls.id] || 0,
      }));

      setClasses(classesWithCounts);
    } catch (error) {
      toast({
        title: 'Erro',
        description: 'Erro ao carregar turmas: ' + error.message,
        variant: 'destructive',
      });
    }
  };

  const fetchTeachers = async () => {
    try {
      // Turmas é acessível a qualquer role (inclusive professor), e
      // teachers.salary agora é restrito a admin/financial no RLS — usa a
      // view sem salário, que é tudo que o checkbox de professor precisa.
      const { data, error } = await (supabase as any)
        .from('teachers_directory')
        .select('id, full_name, status')
        .eq('school_id', schoolId)
        .eq('status', 'active')
        .order('full_name');

      if (error) throw error;
      setTeachers(data || []);
    } catch (error) {
      toast({
        title: 'Erro',
        description: 'Erro ao carregar professores: ' + error.message,
        variant: 'destructive',
      });
    }
  };

  const handleSubmit = async (formData) => {
    setIsLoading(true);
    try {
      const { teacher_ids, teacher_hours, ...classFields } = formData;

      // Creating/editing a class + syncing its teachers used to be two
      // separate writes from here — if the second one failed, the first had
      // already committed, leaving a class with no teacher (QA #9). Both now
      // happen inside a single Postgres function call, so either both
      // succeed or neither does.
      const { error } = await (supabase as any).rpc('save_class_with_teachers', {
        p_class_id: editingClass?.id ?? null,
        p_school_id: schoolId,
        p_name: classFields.name,
        p_grade: classFields.grade ?? null,
        p_description: classFields.description ?? null,
        p_max_capacity: classFields.max_capacity,
        p_monthly_fee: classFields.monthly_fee ?? null,
        p_monthly_fee_integral: classFields.monthly_fee_integral ?? null,
        p_color: classFields.color,
        p_teacher_ids: teacher_ids ?? [],
        // Array paralelo a p_teacher_ids (mesma ordem/índice) — a RPC faz
        // unnest(p_teacher_ids, p_teacher_hours) pra parear os dois.
        p_teacher_hours: (teacher_ids ?? []).map((id: string) => teacher_hours?.[id] ?? null),
      });

      if (error) throw error;

      toast({
        title: 'Sucesso',
        description: editingClass ? 'Turma atualizada com sucesso!' : 'Turma criada com sucesso!',
      });

      fetchClasses();
      setIsFormOpen(false);
      setEditingClass(null);
    } catch (error) {
      toast({
        title: 'Erro',
        description: getFriendlyErrorMessage(error, 'Erro ao salvar turma: ' + error.message),
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleEdit = (classData) => {
    setEditingClass(classData);
    setIsFormOpen(true);
  };

  const handleDelete = async (classId) => {
    try {
      // Check if class has students via enrollments
      const { data: enrollments, error: enrollmentsError } = await (supabase as any)
        .from('enrollments')
        .select('id')
        .eq('class_id', classId);

      if (enrollmentsError) throw enrollmentsError;

      if (enrollments && enrollments.length > 0) {
        toast({
          title: 'Erro',
          description: 'Não é possível excluir uma turma que possui alunos matriculados.',
          variant: 'destructive',
        });
        return;
      }

      const { error } = await supabase
        .from('classes')
        .delete()
        .eq('id', classId);

      if (error) throw error;

      toast({ title: 'Sucesso', description: 'Turma excluída com sucesso!' });
      fetchClasses();
    } catch (error) {
      toast({
        title: 'Erro',
        description: 'Erro ao excluir turma: ' + error.message,
        variant: 'destructive',
      });
    }
  };

  const filteredClasses = classes.filter(cls =>
    (cls.name ?? '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Gestão de Turmas</h1>
          <p className="text-muted-foreground">
            Gerencie as turmas e suas configurações
          </p>
        </div>
        <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => setEditingClass(null)}>
              <Plus className="h-4 w-4 mr-2" />
              Nova Turma
            </Button>
          </DialogTrigger>
          {/* Only mount the form while the dialog is actually open — same fix
              as Teachers.tsx, same bug: Radix kept the previous form instance
              alive during the close animation, so react-hook-form's state
              survived from one "Nova Turma" click to the next (QA #8). */}
          {isFormOpen && (
            <ClassForm
              classData={editingClass}
              onSubmit={handleSubmit}
              onCancel={() => {
                setIsFormOpen(false);
                setEditingClass(null);
              }}
              teachers={teachers}
              isLoading={isLoading}
            />
          )}
        </Dialog>
      </div>

      {isOverPlanLimit(school?.plan, 'classes', classes.length) && (
        <PlanLimitBanner
          message={`Você atingiu o limite de ${STARTER_LIMITS.classes} turmas do plano Starter.`}
        />
      )}

      <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-6">
        <ClassTable
          classes={filteredClasses}
          onEdit={handleEdit}
          onDelete={handleDelete}
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
        />
      </div>
    </div>
  );
};

export default Classes;
