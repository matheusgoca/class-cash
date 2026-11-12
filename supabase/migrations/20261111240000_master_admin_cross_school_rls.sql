-- Mesmo gap encontrado em save_class_with_teachers/renegotiate_tuitions
-- (migrations 20261111220000/20261111230000), só que na camada de RLS:
-- get_user_school_id() sempre retorna a escola "de casa" do perfil, nunca
-- a escola que o master admin está visualizando (viewingSchoolId é estado
-- só do client, não existe no lado do banco). Toda policy abaixo comparava
-- school_id == get_user_school_id() sem nenhuma exceção para master admin —
-- isso incluía SELECT, então master admin via outra escola provavelmente
-- enxergava listas vazias (sem erro nenhum) em quase toda tela do sistema,
-- além de não conseguir escrever. Segue o mesmo padrão já usado em
-- get_active_teachers_salary_sum / debug_reports: adiciona
-- "OR public.is_master_admin()" preservando a lógica original de cada
-- policy.

-- class_teachers
ALTER POLICY class_teachers_select ON public.class_teachers
  USING ((school_id = get_user_school_id()) OR public.is_master_admin());
ALTER POLICY class_teachers_insert ON public.class_teachers
  WITH CHECK (((school_id = get_user_school_id()) AND (get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text]))) OR public.is_master_admin());
ALTER POLICY class_teachers_update ON public.class_teachers
  USING (((school_id = get_user_school_id()) AND (get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text]))) OR public.is_master_admin());
ALTER POLICY class_teachers_delete ON public.class_teachers
  USING (((school_id = get_user_school_id()) AND (get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text]))) OR public.is_master_admin());

-- classes
ALTER POLICY classes_select ON public.classes
  USING ((school_id = get_user_school_id()) OR public.is_master_admin());
ALTER POLICY classes_insert ON public.classes
  WITH CHECK (((school_id = get_user_school_id()) AND (get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text]))) OR public.is_master_admin());
ALTER POLICY classes_update ON public.classes
  USING (((school_id = get_user_school_id()) AND (get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text]))) OR public.is_master_admin());
ALTER POLICY classes_delete ON public.classes
  USING (((school_id = get_user_school_id()) AND (get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text]))) OR public.is_master_admin());

-- contracts
ALTER POLICY contracts_select ON public.contracts
  USING ((school_id = get_user_school_id()) OR public.is_master_admin());
ALTER POLICY contracts_insert ON public.contracts
  WITH CHECK (((school_id = get_user_school_id()) AND (get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text]))) OR public.is_master_admin());
ALTER POLICY contracts_update ON public.contracts
  USING (((school_id = get_user_school_id()) AND (get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text]))) OR public.is_master_admin());
ALTER POLICY contracts_delete ON public.contracts
  USING (((school_id = get_user_school_id()) AND (get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text]))) OR public.is_master_admin());

-- enrollments (regra passa por students, não tem school_id direto)
ALTER POLICY enrollments_select ON public.enrollments
  USING ((student_id IN (SELECT students.id FROM public.students WHERE students.school_id = get_user_school_id())) OR public.is_master_admin());
ALTER POLICY enrollments_insert ON public.enrollments
  WITH CHECK (((get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text])) AND (student_id IN (SELECT students.id FROM public.students WHERE students.school_id = get_user_school_id()))) OR public.is_master_admin());
ALTER POLICY enrollments_update ON public.enrollments
  USING (((get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text])) AND (student_id IN (SELECT students.id FROM public.students WHERE students.school_id = get_user_school_id()))) OR public.is_master_admin())
  WITH CHECK (((get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text])) AND (student_id IN (SELECT students.id FROM public.students WHERE students.school_id = get_user_school_id()))) OR public.is_master_admin());
ALTER POLICY enrollments_delete ON public.enrollments
  USING (((get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text])) AND (student_id IN (SELECT students.id FROM public.students WHERE students.school_id = get_user_school_id()))) OR public.is_master_admin());

-- expense_categories
ALTER POLICY "Admin can manage expense categories" ON public.expense_categories
  USING (((school_id = get_user_school_id()) AND (get_current_user_role() = 'admin'::text)) OR public.is_master_admin())
  WITH CHECK (((school_id = get_user_school_id()) AND (get_current_user_role() = 'admin'::text)) OR public.is_master_admin());
ALTER POLICY "School members can view expense categories" ON public.expense_categories
  USING (((school_id = get_user_school_id()) AND (get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text]))) OR public.is_master_admin());

-- expenses
ALTER POLICY "Admin and financial can manage expenses" ON public.expenses
  USING (((school_id = get_user_school_id()) AND (get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text]))) OR public.is_master_admin())
  WITH CHECK (((school_id = get_user_school_id()) AND (get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text]))) OR public.is_master_admin());
ALTER POLICY "Admin and financial can view expenses" ON public.expenses
  USING (((school_id = get_user_school_id()) AND (get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text]))) OR public.is_master_admin());

-- invitations
ALTER POLICY invitations_select ON public.invitations
  USING ((email = auth.email()) OR (school_id = get_user_school_id()) OR public.is_master_admin());
ALTER POLICY invitations_insert ON public.invitations
  WITH CHECK ((school_id = get_user_school_id()) OR public.is_master_admin());
ALTER POLICY invitations_update ON public.invitations
  USING ((email = ((SELECT users.email FROM auth.users WHERE users.id = auth.uid()))::text) OR (school_id = get_user_school_id()) OR public.is_master_admin());
ALTER POLICY invitations_delete ON public.invitations
  USING ((school_id = get_user_school_id()) OR public.is_master_admin());

-- recurring_expenses
ALTER POLICY "Admin and financial can manage recurring expenses" ON public.recurring_expenses
  USING (((school_id = get_user_school_id()) AND (get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text]))) OR public.is_master_admin())
  WITH CHECK (((school_id = get_user_school_id()) AND (get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text]))) OR public.is_master_admin());
ALTER POLICY "Admin and financial can view recurring expenses" ON public.recurring_expenses
  USING (((school_id = get_user_school_id()) AND (get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text]))) OR public.is_master_admin());

-- renegotiations
ALTER POLICY "School members can insert renegotiations" ON public.renegotiations
  WITH CHECK (((school_id = get_user_school_id()) AND (get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text]))) OR public.is_master_admin());
ALTER POLICY "School members can view own renegotiations" ON public.renegotiations
  USING ((school_id = get_user_school_id()) OR public.is_master_admin());

-- school_services
ALTER POLICY "Admin and financial can manage school services" ON public.school_services
  USING (((school_id = get_user_school_id()) AND (get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text]))) OR public.is_master_admin())
  WITH CHECK (((school_id = get_user_school_id()) AND (get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text]))) OR public.is_master_admin());
ALTER POLICY "Admin and financial can view school services" ON public.school_services
  USING (((school_id = get_user_school_id()) AND (get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text]))) OR public.is_master_admin());

-- service_charges
ALTER POLICY "Admin and financial can manage service charges" ON public.service_charges
  USING (((school_id = get_user_school_id()) AND (get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text]))) OR public.is_master_admin())
  WITH CHECK (((school_id = get_user_school_id()) AND (get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text]))) OR public.is_master_admin());
ALTER POLICY "Admin and financial can view service charges" ON public.service_charges
  USING (((school_id = get_user_school_id()) AND (get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text]))) OR public.is_master_admin());

-- student_services
ALTER POLICY "Admin and financial can manage student services" ON public.student_services
  USING (((school_id = get_user_school_id()) AND (get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text]))) OR public.is_master_admin())
  WITH CHECK (((school_id = get_user_school_id()) AND (get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text]))) OR public.is_master_admin());
ALTER POLICY "Admin and financial can view student services" ON public.student_services
  USING (((school_id = get_user_school_id()) AND (get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text]))) OR public.is_master_admin());

-- students
ALTER POLICY students_select ON public.students
  USING ((school_id = get_user_school_id()) OR public.is_master_admin());
ALTER POLICY students_insert ON public.students
  WITH CHECK (((school_id = get_user_school_id()) AND (get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text]))) OR public.is_master_admin());
ALTER POLICY students_update ON public.students
  USING (((school_id = get_user_school_id()) AND (get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text]))) OR public.is_master_admin());
ALTER POLICY students_delete ON public.students
  USING (((school_id = get_user_school_id()) AND (get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text]))) OR public.is_master_admin());

-- teachers
ALTER POLICY teachers_select ON public.teachers
  USING (((school_id = get_user_school_id()) AND (get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text]))) OR public.is_master_admin());
ALTER POLICY teachers_insert ON public.teachers
  WITH CHECK (((school_id = get_user_school_id()) AND (get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text]))) OR public.is_master_admin());
ALTER POLICY teachers_update ON public.teachers
  USING (((school_id = get_user_school_id()) AND (get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text]))) OR public.is_master_admin());
ALTER POLICY teachers_delete ON public.teachers
  USING (((school_id = get_user_school_id()) AND (get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text]))) OR public.is_master_admin());

-- tuitions
ALTER POLICY tuitions_select ON public.tuitions
  USING ((school_id = get_user_school_id()) OR public.is_master_admin());
ALTER POLICY tuitions_insert ON public.tuitions
  WITH CHECK (((school_id = get_user_school_id()) AND (get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text]))) OR public.is_master_admin());
ALTER POLICY tuitions_update ON public.tuitions
  USING (((school_id = get_user_school_id()) AND (get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text]))) OR public.is_master_admin());
ALTER POLICY tuitions_delete ON public.tuitions
  USING (((school_id = get_user_school_id()) AND (get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text]))) OR public.is_master_admin());
