-- ================================================================
-- Hardening de RLS achado numa revisão de segurança.
--
-- 1. CRÍTICO: user_roles_insert/delete checavam "existe um profile meu
--    na minha própria escola?" — sempre verdadeiro pra qualquer membro
--    onboardado, sem relação nenhuma com a linha sendo escrita.
--    Qualquer usuário podia se auto-promover a admin. Também faltava
--    policy de UPDATE inteiramente (o upsert de troca de role em
--    Team.tsx dependia dela pro caminho de conflito).
--
-- 2. contracts/tuitions/students/teachers/classes/class_teachers só
--    checavam school_id, sem checar role — um usuário "teacher" podia
--    escrever nessas tabelas via API direta, mesmo a UI nunca
--    oferecendo essa opção pra esse perfil. Alinhado agora ao mesmo
--    padrão já usado em expenses/school_services (só admin/financial
--    escrevem). Confirmado: todo dono de escola sempre tem uma linha
--    em user_roles com role='admin' via o trigger
--    ensure_owner_is_admin_trigger, então essa restrição não afeta
--    donos de escola.
-- ================================================================

-- 1. user_roles ------------------------------------------------------

DROP POLICY "user_roles_insert" ON public.user_roles;
CREATE POLICY "user_roles_insert"
  ON public.user_roles FOR INSERT
  WITH CHECK (
    is_master_admin()
    OR (
      get_current_user_role() = 'admin'
      AND EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.user_id = user_roles.user_id
        AND profiles.school_id = get_user_school_id()
      )
    )
  );

CREATE POLICY "user_roles_update"
  ON public.user_roles FOR UPDATE
  USING (
    is_master_admin()
    OR (
      get_current_user_role() = 'admin'
      AND EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.user_id = user_roles.user_id
        AND profiles.school_id = get_user_school_id()
      )
    )
  )
  WITH CHECK (
    is_master_admin()
    OR (
      get_current_user_role() = 'admin'
      AND EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.user_id = user_roles.user_id
        AND profiles.school_id = get_user_school_id()
      )
    )
  );

DROP POLICY "user_roles_delete" ON public.user_roles;
CREATE POLICY "user_roles_delete"
  ON public.user_roles FOR DELETE
  USING (
    is_master_admin()
    OR (
      get_current_user_role() = 'admin'
      AND EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.user_id = user_roles.user_id
        AND profiles.school_id = get_user_school_id()
      )
    )
  );

-- 2. Escrita restrita a admin/financial --------------------------------

DROP POLICY "students_insert" ON public.students;
CREATE POLICY "students_insert" ON public.students FOR INSERT
  WITH CHECK (school_id = get_user_school_id() AND get_current_user_role() = ANY (ARRAY['admin', 'financial']));

DROP POLICY "students_update" ON public.students;
CREATE POLICY "students_update" ON public.students FOR UPDATE
  USING (school_id = get_user_school_id() AND get_current_user_role() = ANY (ARRAY['admin', 'financial']));

DROP POLICY "students_delete" ON public.students;
CREATE POLICY "students_delete" ON public.students FOR DELETE
  USING (school_id = get_user_school_id() AND get_current_user_role() = ANY (ARRAY['admin', 'financial']));

DROP POLICY "teachers_insert" ON public.teachers;
CREATE POLICY "teachers_insert" ON public.teachers FOR INSERT
  WITH CHECK (school_id = get_user_school_id() AND get_current_user_role() = ANY (ARRAY['admin', 'financial']));

DROP POLICY "teachers_update" ON public.teachers;
CREATE POLICY "teachers_update" ON public.teachers FOR UPDATE
  USING (school_id = get_user_school_id() AND get_current_user_role() = ANY (ARRAY['admin', 'financial']));

DROP POLICY "teachers_delete" ON public.teachers;
CREATE POLICY "teachers_delete" ON public.teachers FOR DELETE
  USING (school_id = get_user_school_id() AND get_current_user_role() = ANY (ARRAY['admin', 'financial']));

DROP POLICY "classes_insert" ON public.classes;
CREATE POLICY "classes_insert" ON public.classes FOR INSERT
  WITH CHECK (school_id = get_user_school_id() AND get_current_user_role() = ANY (ARRAY['admin', 'financial']));

DROP POLICY "classes_update" ON public.classes;
CREATE POLICY "classes_update" ON public.classes FOR UPDATE
  USING (school_id = get_user_school_id() AND get_current_user_role() = ANY (ARRAY['admin', 'financial']));

DROP POLICY "classes_delete" ON public.classes;
CREATE POLICY "classes_delete" ON public.classes FOR DELETE
  USING (school_id = get_user_school_id() AND get_current_user_role() = ANY (ARRAY['admin', 'financial']));

DROP POLICY "class_teachers_insert" ON public.class_teachers;
CREATE POLICY "class_teachers_insert" ON public.class_teachers FOR INSERT
  WITH CHECK (school_id = get_user_school_id() AND get_current_user_role() = ANY (ARRAY['admin', 'financial']));

DROP POLICY "class_teachers_update" ON public.class_teachers;
CREATE POLICY "class_teachers_update" ON public.class_teachers FOR UPDATE
  USING (school_id = get_user_school_id() AND get_current_user_role() = ANY (ARRAY['admin', 'financial']));

DROP POLICY "class_teachers_delete" ON public.class_teachers;
CREATE POLICY "class_teachers_delete" ON public.class_teachers FOR DELETE
  USING (school_id = get_user_school_id() AND get_current_user_role() = ANY (ARRAY['admin', 'financial']));

DROP POLICY "contracts_insert" ON public.contracts;
CREATE POLICY "contracts_insert" ON public.contracts FOR INSERT
  WITH CHECK (school_id = get_user_school_id() AND get_current_user_role() = ANY (ARRAY['admin', 'financial']));

DROP POLICY "contracts_update" ON public.contracts;
CREATE POLICY "contracts_update" ON public.contracts FOR UPDATE
  USING (school_id = get_user_school_id() AND get_current_user_role() = ANY (ARRAY['admin', 'financial']));

DROP POLICY "contracts_delete" ON public.contracts;
CREATE POLICY "contracts_delete" ON public.contracts FOR DELETE
  USING (school_id = get_user_school_id() AND get_current_user_role() = ANY (ARRAY['admin', 'financial']));

DROP POLICY "tuitions_insert" ON public.tuitions;
CREATE POLICY "tuitions_insert" ON public.tuitions FOR INSERT
  WITH CHECK (school_id = get_user_school_id() AND get_current_user_role() = ANY (ARRAY['admin', 'financial']));

DROP POLICY "tuitions_update" ON public.tuitions;
CREATE POLICY "tuitions_update" ON public.tuitions FOR UPDATE
  USING (school_id = get_user_school_id() AND get_current_user_role() = ANY (ARRAY['admin', 'financial']));

DROP POLICY "tuitions_delete" ON public.tuitions;
CREATE POLICY "tuitions_delete" ON public.tuitions FOR DELETE
  USING (school_id = get_user_school_id() AND get_current_user_role() = ANY (ARRAY['admin', 'financial']));

DROP POLICY "School members can insert renegotiations" ON public.renegotiations;
CREATE POLICY "School members can insert renegotiations" ON public.renegotiations FOR INSERT
  WITH CHECK (school_id = get_user_school_id() AND get_current_user_role() = ANY (ARRAY['admin', 'financial']));

-- enrollments segue o mesmo padrão de students — mudar a turma de um aluno é
-- equivalente a editar students.class_id, então fica sob a mesma restrição.
DROP POLICY "enrollments_insert" ON public.enrollments;
CREATE POLICY "enrollments_insert" ON public.enrollments FOR INSERT
  WITH CHECK (
    get_current_user_role() = ANY (ARRAY['admin', 'financial'])
    AND student_id IN (SELECT students.id FROM public.students WHERE students.school_id = get_user_school_id())
  );

DROP POLICY "enrollments_update" ON public.enrollments;
CREATE POLICY "enrollments_update" ON public.enrollments FOR UPDATE
  USING (
    get_current_user_role() = ANY (ARRAY['admin', 'financial'])
    AND student_id IN (SELECT students.id FROM public.students WHERE students.school_id = get_user_school_id())
  )
  WITH CHECK (
    get_current_user_role() = ANY (ARRAY['admin', 'financial'])
    AND student_id IN (SELECT students.id FROM public.students WHERE students.school_id = get_user_school_id())
  );

DROP POLICY "enrollments_delete" ON public.enrollments;
CREATE POLICY "enrollments_delete" ON public.enrollments FOR DELETE
  USING (
    get_current_user_role() = ANY (ARRAY['admin', 'financial'])
    AND student_id IN (SELECT students.id FROM public.students WHERE students.school_id = get_user_school_id())
  );
