import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { StudentForm } from '@/components/students/StudentForm';
import { StudentTable } from '@/components/students/StudentTable';

const Students = () => {
  const [students, setStudents] = useState([]);
  const [classes, setClasses] = useState([]);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    fetchStudents();
    fetchClasses();
  }, []);

  const fetchStudents = async () => {
    try {
      const { data, error } = await supabase
        .from('students')
        .select(`
          *,
          classes:class_id (
            name
          )
        `)
        .order('name');

      if (error) throw error;
      setStudents(data || []);
    } catch (error) {
      toast({
        title: 'Erro',
        description: 'Erro ao carregar alunos: ' + error.message,
        variant: 'destructive',
      });
    }
  };

  const fetchClasses = async () => {
    try {
      const { data, error } = await supabase
        .from('classes')
        .select('*')
        .order('name');

      if (error) throw error;
      setClasses(data || []);
    } catch (error) {
      toast({
        title: 'Erro',
        description: 'Erro ao carregar turmas: ' + error.message,
        variant: 'destructive',
      });
    }
  };

  const handleSubmit = async (formData) => {
    setIsLoading(true);
    try {
      const dataToSubmit = {
        ...formData,
        class_id: formData.class_id || null,
      };

      if (editingStudent) {
        const { error } = await supabase
          .from('students')
          .update(dataToSubmit)
          .eq('id', editingStudent.id);

        if (error) throw error;

        toast({
          title: 'Sucesso',
          description: 'Aluno atualizado com sucesso!',
        });
      } else {
        const { error } = await supabase
          .from('students')
          .insert([dataToSubmit]);

        if (error) throw error;

        toast({
          title: 'Sucesso',
          description: 'Aluno criado com sucesso!',
        });
      }

      fetchStudents();
      setIsFormOpen(false);
      setEditingStudent(null);
    } catch (error) {
      toast({
        title: 'Erro',
        description: 'Erro ao salvar aluno: ' + error.message,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleEdit = (student) => {
    setEditingStudent(student);
    setIsFormOpen(true);
  };

  const handleDelete = async (studentId) => {
    try {
      const { error } = await supabase
        .from('students')
        .delete()
        .eq('id', studentId);

      if (error) throw error;

      toast({
        title: 'Sucesso',
        description: 'Aluno excluído com sucesso!',
      });

      fetchStudents();
    } catch (error) {
      toast({
        title: 'Erro',
        description: 'Erro ao excluir aluno: ' + error.message,
        variant: 'destructive',
      });
    }
  };

  const filteredStudents = students.filter(student => {
    const matchesSearch = student.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesClass = !classFilter || student.class_id === classFilter;
    return matchesSearch && matchesClass;
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Gestão de Alunos</h1>
          <p className="text-muted-foreground">
            Gerencie os alunos matriculados na escola
          </p>
        </div>
        <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => setEditingStudent(null)}>
              <Plus className="h-4 w-4 mr-2" />
              Novo Aluno
            </Button>
          </DialogTrigger>
          <StudentForm
            student={editingStudent}
            onSubmit={handleSubmit}
            onCancel={() => {
              setIsFormOpen(false);
              setEditingStudent(null);
            }}
            classes={classes}
            isLoading={isLoading}
          />
        </Dialog>
      </div>

      <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-6">
        <StudentTable
          students={filteredStudents}
          classes={classes}
          onEdit={handleEdit}
          onDelete={handleDelete}
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          classFilter={classFilter}
          onClassFilterChange={setClassFilter}
        />
      </div>

      {/* Delete confirmation would go here */}
    </div>
  );
};

export default Students;