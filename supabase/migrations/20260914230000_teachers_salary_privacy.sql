-- ================================================================
-- teachers_select só checava school_id, não role — qualquer membro
-- da escola (incluindo "teacher") podia ler o salário de todo mundo
-- via API direta. Mas restringir a leitura da tabela inteira pra
-- admin/financial quebraria a tela de Turmas, que qualquer membro
-- (inclusive professor) pode acessar e precisa mostrar o nome do
-- professor responsável por cada turma.
--
-- Solução: uma view sem a coluna salary (nem email/telefone, que
-- também não são necessários ali), liberada pra qualquer membro da
-- escola; a tabela base fica restrita a admin/financial.
-- ================================================================

CREATE VIEW public.teachers_directory
WITH (security_invoker = false)
AS
SELECT id, school_id, full_name, status
FROM public.teachers
WHERE school_id = public.get_user_school_id() OR public.is_master_admin();

GRANT SELECT ON public.teachers_directory TO authenticated;

DROP POLICY "teachers_select" ON public.teachers;
CREATE POLICY "teachers_select"
  ON public.teachers FOR SELECT
  USING (school_id = get_user_school_id() AND get_current_user_role() = ANY (ARRAY['admin', 'financial']));

-- Dashboard (/dashboard) é aberto pra qualquer role, inclusive professor, e
-- soma salário de professores ativos pra calcular custo total — precisa do
-- agregado sem expor o salário individual de cada um.
CREATE FUNCTION public.get_active_teachers_salary_sum(p_school_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(salary), 0)
  FROM public.teachers
  WHERE school_id = p_school_id
    AND status = 'active'
    AND (p_school_id = public.get_user_school_id() OR public.is_master_admin());
$$;

