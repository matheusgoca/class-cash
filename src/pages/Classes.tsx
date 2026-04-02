import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useSchool } from '@/contexts/SchoolContext';
import { ClassForm } from '@/components/classes/ClassForm';
import { ClassTable } from '@/components/classes/ClassTable';

const Classes = () => {
  const { schoolId } = useSchool();
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
      const { data: classData, error: classError } = await supabase
        .from('classes')
        .select(`
          *,
          teachers:teacher_id (
            full_name,
            specialization
          )
        `)
        .eq('school_id', schoolId)
        .order('name');

      if (classError) throw classError;

      const { data: studentCounts, error: studentError } = await supabase
        .from('students')
        .select('class_id')
        .eq('school_id', schoolId)
        .eq('status', 'active');

      if (studentError) throw studentError;

      const counts = studentCounts.reduce((acc, student) => {
        if (student.class_id) {
          acc[student.class_id] = (acc[student.class_id] || 0) + 1;
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
      const { data, error } = await supabase
        .from('teachers')
        .select('*')
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
      const dataToSubmit = {
        ...formData,
        teacher_id: formData.teacher_id || null,
        school_id: schoolId,
      };

      if (editingClass) {
        const { error } = await supabase
          .from('classes')
          .update(dataToSubmit)
          .eq('id', editingClass.id);

        if (error) throw error;
        toast({ title: 'Sucesso', description: 'Turma atualizada com sucesso!' });
      } else {
        const { error } = await supabase
          .from('classes')
          .insert([dataToSubmit]);

        if (error) throw error;
        toast({ title: 'Sucesso', description: 'Turma criada com sucesso!' });
      }

      fetchClasses();
      setIsFormOpen(false);
      setEditingClass(null);
    } catch (error) {
      toast({
        title: 'Erro',
        description: 'Erro ao salvar turma: ' + error.message,
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
      const { data: students, error: studentsError } = await supabase
        .from('students')
        .select('id')
        .eq('class_id', classId)
        .eq('school_id', schoolId);

      if (studentsError) throw studentsError;

      if (students && students.length > 0) {
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
        </Dialog>
      </div>

      <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-6">
        <ClassTable
          classes={filteredClasses}
          teachers={teachers}
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
