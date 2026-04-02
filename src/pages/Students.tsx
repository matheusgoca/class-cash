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
      // Fetch all students
      const { data: studentsData, error: studentsError } = await supabase
        .from('students')
        .select('*')
        .order('name');

      if (studentsError) throw studentsError;

      // Fetch enrollments with class info
      const { data: enrollmentsData, error: enrollmentsError } = await supabase
        .from('enrollments' as any)
        .select(`
          student_id,
          classes (
            id,
            name
          )
        `) as any;

      if (enrollmentsError) throw enrollmentsError;

      // Merge student data with enrollment data
      const studentsWithClasses = (studentsData || []).map(student => {
        const enrollment = (enrollmentsData || []).find((e: any) => e.student_id === student.id);
        return {
          ...student,
          enrollment_class_id: enrollment?.classes?.id,
          enrollment_class_name: enrollment?.classes?.name,
        };
      });

      setStudents(studentsWithClasses);
    } catch (error: any) {
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
      // Calculate final_tuition_value server-side (authoritative)
      const finalTuitionValue = formData.full_tuition_value * (1 - (formData.discount || 0) / 100);
      
      // Remove class_id from student data, convert dates to strings
      const { class_id, birth_date, enrollment_date, ...studentData } = formData;
      const dataToSubmit = {
        ...studentData,
        full_name: studentData.name, // full_name is required (NOT NULL)
        birth_date: birth_date instanceof Date ? birth_date.toISOString().split('T')[0] : birth_date,
        enrollment_date: enrollment_date instanceof Date ? enrollment_date.toISOString().split('T')[0] : enrollment_date,
        final_tuition_value: finalTuitionValue,
      };

      if (editingStudent) {
        // Update student
        const { error: studentError } = await supabase
          .from('students')
          .update(dataToSubmit)
          .eq('id', editingStudent.id);

        if (studentError) throw studentError;

        // Handle enrollment
        if (class_id) {
          // Check if enrollment exists
          const { data: existingEnrollment } = await supabase
            .from('enrollments' as any)
            .select('id')
            .eq('student_id', editingStudent.id)
            .maybeSingle() as any;

          if (existingEnrollment) {
            // Update existing enrollment
            const { error: enrollmentError } = await supabase
              .from('enrollments' as any)
              .update({ class_id })
              .eq('student_id', editingStudent.id) as any;

            if (enrollmentError) throw enrollmentError;
          } else {
            // Create new enrollment
            const { error: enrollmentError } = await supabase
              .from('enrollments' as any)
              .insert({ student_id: editingStudent.id, class_id }) as any;

            if (enrollmentError) throw enrollmentError;
          }
        } else {
          // Remove enrollment if class_id is null
          await supabase
            .from('enrollments' as any)
            .delete()
            .eq('student_id', editingStudent.id) as any;
        }

        toast({
          title: 'Sucesso',
          description: 'Aluno atualizado com sucesso!',
        });
      } else {
        // Create new student
        const { data: newStudent, error: studentError } = await supabase
          .from('students')
          .insert([dataToSubmit])
          .select()
          .single();

        if (studentError) throw studentError;

        // Create enrollment if class_id provided
        if (class_id && newStudent) {
          const { error: enrollmentError } = await supabase
            .from('enrollments' as any)
            .insert({ student_id: newStudent.id, class_id }) as any;

          if (enrollmentError) throw enrollmentError;
        }

        toast({
          title: 'Sucesso',
          description: 'Aluno criado com sucesso!',
        });
      }

      fetchStudents();
      setIsFormOpen(false);
      setEditingStudent(null);
    } catch (error: any) {
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
    } catch (error: any) {
      toast({
        title: 'Erro',
        description: 'Erro ao excluir aluno: ' + error.message,
        variant: 'destructive',
      });
    }
  };

  const filteredStudents = students.filter(student => {
    const matchesSearch = student.full_name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesClass = !classFilter || classFilter === 'all' || student.enrollment_class_id === classFilter;
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