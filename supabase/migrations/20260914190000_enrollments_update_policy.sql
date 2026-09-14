-- ================================================================
-- enrollments tinha SELECT/INSERT/DELETE pra usuário comum, mas
-- nenhuma policy de UPDATE (só o bypass de master admin cobria).
-- Students.tsx troca a turma de um aluno já matriculado via
-- .update({class_id}) — sem essa policy, o Postgres nega em silêncio
-- (Supabase não lança erro em update com 0 linhas afetadas), então o
-- toast dizia "Aluno atualizado com sucesso!" mas a matrícula nunca
-- mudava de verdade.
-- ================================================================

CREATE POLICY "enrollments_update"
  ON public.enrollments FOR UPDATE
  USING (student_id IN (SELECT students.id FROM public.students WHERE students.school_id = public.get_user_school_id()))
  WITH CHECK (student_id IN (SELECT students.id FROM public.students WHERE students.school_id = public.get_user_school_id()));
