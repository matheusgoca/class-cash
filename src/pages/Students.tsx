import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useSchool } from '@/contexts/SchoolContext';
import { StudentForm } from '@/components/students/StudentForm';
import { buildStudentPayload } from '@/lib/studentPayload';
import { pickCurrentContract, studentTuitionView } from '@/lib/studentTuition';
import { StudentTable } from '@/components/students/StudentTable';
import { getFriendlyErrorMessage } from '@/lib/friendlyError';
import { PlanLimitBanner } from '@/components/PlanLimitBanner';
import { isOverPlanLimit, STARTER_LIMITS } from '@/lib/planLimits';
import { toDateStr } from '@/lib/dateUtils';

const Students = () => {
  const { schoolId, school } = useSchool();
  const [students, setStudents] = useState([]);
  const [classes, setClasses] = useState([]);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    if (schoolId) {
      fetchStudents();
      fetchClasses();
    }
  }, [schoolId]);

  const fetchStudents = async () => {
    try {
      // Fetch all students
      const { data: studentsData, error: studentsError } = await supabase
        .from('students')
        .select('*')
        .eq('school_id', schoolId)
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

      // Item I: o contrato é a fonte do valor. A coluna "Mensalidade" mostra o valor do contrato vigente
      // ou, sem contrato, a referência da turma; os campos legados do cadastro do aluno não são usados.
      const { data: contractsData, error: contractsError } = await (supabase as any)
        .from('contracts')
        .select('id, student_id, status, start_date, end_date, final_amount, discount')
        .eq('school_id', schoolId)
        .eq('status', 'active');

      if (contractsError) throw contractsError;

      // Merge student data with enrollment and active-contract data
      const studentsWithClasses = (studentsData || []).map(student => {
        const enrollment = (enrollmentsData || []).find((e: any) => e.student_id === student.id);
        return {
          ...student,
          enrollment_class_id: enrollment?.classes?.id,
          enrollment_class_name: enrollment?.classes?.name,
          active_contracts: (contractsData || []).filter((c: any) => c.student_id === student.id),
        };
      });

      setStudents(studentsWithClasses);
    } catch (error: any) {
      toast({
        title: 'Erro',
        description: getFriendlyErrorMessage(error, 'Erro ao carregar alunos: ' + error.message),
        variant: 'destructive',
      });
    }
  };

  const fetchClasses = async () => {
    try {
      const { data, error } = await supabase
        .from('classes')
        .select('*')
        .eq('school_id', schoolId)
        .order('name');

      if (error) throw error;
      setClasses(data || []);
    } catch (error: any) {
      toast({
        title: 'Erro',
        description: getFriendlyErrorMessage(error, 'Erro ao carregar turmas: ' + error.message),
        variant: 'destructive',
      });
    }
  };

  const handleSubmit = async (formData) => {
    setIsLoading(true);
    try {
      // Item I: o aluno não grava valor (nem calcula final_tuition_value); ver studentPayload.ts.
      const { payload: dataToSubmit, classId: class_id } = buildStudentPayload(formData, schoolId);

      if (editingStudent) {
        // Update student
        const { error: studentError } = await supabase
          .from('students')
          .update(dataToSubmit)
          .eq('id', editingStudent.id)
          .eq('school_id', schoolId);

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

        toast({ title: 'Sucesso', description: 'Aluno atualizado com sucesso!' });
      } else {
        // Create new student
        const { data: newStudent, error: studentError } = await supabase
          .from('students')
          .insert([dataToSubmit as any])
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

        toast({ title: 'Sucesso', description: 'Aluno criado com sucesso!' });
      }

      fetchStudents();
      setIsFormOpen(false);
      setEditingStudent(null);
    } catch (error: any) {
      toast({
        title: 'Erro',
        description: getFriendlyErrorMessage(error, 'Erro ao salvar aluno: ' + error.message),
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
        .eq('id', studentId)
        .eq('school_id', schoolId);

      if (error) throw error;

      toast({ title: 'Sucesso', description: 'Aluno excluído com sucesso!' });
      fetchStudents();
    } catch (error: any) {
      toast({
        title: 'Erro',
        description: getFriendlyErrorMessage(error, 'Erro ao excluir aluno: ' + error.message),
        variant: 'destructive',
      });
    }
  };

  // Item I: valor do contrato vigente ou referência da turma (meio período). Calculado aqui porque
  // as turmas e os contratos chegam por consultas separadas.
  const today = toDateStr(new Date());
  const studentsWithTuition = students.map((student: any) => ({
    ...student,
    tuition: studentTuitionView(
      pickCurrentContract(student.active_contracts ?? [], today),
      classes.find((c: any) => c.id === student.enrollment_class_id)?.monthly_fee,
    ),
  }));

  const filteredStudents = studentsWithTuition.filter(student => {
    const matchesSearch = ( student.full_name ?? '').toLowerCase().includes(searchTerm.toLowerCase());
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
          {isFormOpen && (
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
          )}
        </Dialog>
      </div>

      {isOverPlanLimit(school?.plan, 'students', students.length) && (
        <PlanLimitBanner
          message={`Você atingiu o limite de ${STARTER_LIMITS.students} alunos do plano Starter.`}
        />
      )}

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
    </div>
  );
};

export default Students;
