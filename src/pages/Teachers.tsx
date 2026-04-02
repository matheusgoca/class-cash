import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useSchool } from '@/contexts/SchoolContext';
import { TeacherForm } from '@/components/teachers/TeacherForm';
import { TeacherTable } from '@/components/teachers/TeacherTable';

const Teachers = () => {
  const { schoolId } = useSchool();
  const [teachers, setTeachers] = useState([]);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingTeacher, setEditingTeacher] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    if (schoolId) fetchTeachers();
  }, [schoolId]);

  const fetchTeachers = async () => {
    try {
      const { data, error } = await supabase
        .from('teachers')
        .select('*')
        .eq('school_id', schoolId)
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
      const dataToSubmit = { ...formData, school_id: schoolId };

      if (editingTeacher) {
        const { error } = await supabase
          .from('teachers')
          .update(dataToSubmit)
          .eq('id', editingTeacher.id);

        if (error) throw error;
        toast({ title: 'Sucesso', description: 'Professor atualizado com sucesso!' });
      } else {
        const { error } = await supabase
          .from('teachers')
          .insert([dataToSubmit]);

        if (error) throw error;
        toast({ title: 'Sucesso', description: 'Professor criado com sucesso!' });
      }

      fetchTeachers();
      setIsFormOpen(false);
      setEditingTeacher(null);
    } catch (error) {
      toast({
        title: 'Erro',
        description: 'Erro ao salvar professor: ' + error.message,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleEdit = (teacher) => {
    setEditingTeacher(teacher);
    setIsFormOpen(true);
  };

  const handleDelete = async (teacherId) => {
    try {
      const { data: classes, error: classError } = await supabase
        .from('classes')
        .select('id')
        .eq('teacher_id', teacherId)
        .eq('school_id', schoolId);

      if (classError) throw classError;

      if (classes && classes.length > 0) {
        toast({
          title: 'Erro',
          description: 'Não é possível excluir um professor que está atribuído a turmas.',
          variant: 'destructive',
        });
        return;
      }

      const { error } = await supabase
        .from('teachers')
        .delete()
        .eq('id', teacherId);

      if (error) throw error;

      toast({ title: 'Sucesso', description: 'Professor excluído com sucesso!' });
      fetchTeachers();
    } catch (error) {
      toast({
        title: 'Erro',
        description: 'Erro ao excluir professor: ' + error.message,
        variant: 'destructive',
      });
    }
  };

  const filteredTeachers = teachers.filter(teacher =>
    (teacher.full_name ?? '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (teacher.specialization ?? '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Gestão de Professores</h1>
          <p className="text-muted-foreground">
            Gerencie os professores da escola
          </p>
        </div>
        <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => setEditingTeacher(null)}>
              <Plus className="h-4 w-4 mr-2" />
              Novo Professor
            </Button>
          </DialogTrigger>
          <TeacherForm
            teacher={editingTeacher}
            onSubmit={handleSubmit}
            onCancel={() => {
              setIsFormOpen(false);
              setEditingTeacher(null);
            }}
            isLoading={isLoading}
          />
        </Dialog>
      </div>

      <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-6">
        <TeacherTable
          teachers={filteredTeachers}
          onEdit={handleEdit}
          onDelete={handleDelete}
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
        />
      </div>
    </div>
  );
};

export default Teachers;
