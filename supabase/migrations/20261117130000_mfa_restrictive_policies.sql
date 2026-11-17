-- Fase 3 (S2): a partir daqui o gate de 2FA VALE no banco.
--
-- ORDEM DE ROLLOUT (obrigatória): só aplicar depois de (1) o front da Fase 3
-- estar no ar, porque é ele que chama start_mfa_grace() e dá a carência a quem
-- é exigido, e (2) o master ter ativado o próprio 2FA. Sem linha em mfa_grace,
-- um usuário exigido fica bloqueado por esta migration.

-- 1. Policy RESTRICTIVE por tabela ------------------------------------------
-- Uma policy RESTRICTIVE é combinada com AND às permissivas já existentes: não
-- reescreve nenhuma das ~95 policies atuais.
--
-- `(select public.mfa_gate_ok())` e não `public.mfa_gate_ok()` puro: com o
-- select, o Postgres avalia a função UMA vez por consulta (InitPlan) em vez de
-- uma vez por linha, e ela faz 3 consultas por chamada.
--
-- FORA do gate, de propósito:
--   profiles, schools, user_roles, invitations  → a própria tela de ativação do
--       2FA e o SchoolContext dependem delas para funcionar com a sessão aal1.
--   debug_reports                               → relatório de bug precisa
--       funcionar mesmo na tela de bloqueio.
--   mfa_grace                                   → tem a própria policy (só o dono lê).
do $$
declare t text;
begin
  foreach t in array array[
    'students', 'teachers', 'classes', 'class_teachers', 'contracts', 'enrollments',
    'tuitions', 'expenses', 'expense_categories', 'recurring_expenses', 'service_charges',
    'school_services', 'student_services', 'renegotiations', 'audit_logs'
  ] loop
    execute format('drop policy if exists mfa_gate on public.%I', t);
    execute format(
      'create policy mfa_gate on public.%I as restrictive for all to authenticated
         using ((select public.mfa_gate_ok())) with check ((select public.mfa_gate_ok()))', t);
  end loop;
end $$;

-- 2. teachers_directory ------------------------------------------------------
-- A view roda como dono (security_invoker=false), então ignora o RLS de
-- teachers e, portanto, o gate acima. Dois ajustes:
--
-- (a) Gate dentro da própria view.
create or replace view public.teachers_directory as
  select id, school_id, full_name, status
    from public.teachers
   where (school_id = public.get_user_school_id() or public.is_master_admin())
     and (select public.mfa_gate_ok());

-- (b) CORREÇÃO DE UM BYPASS DE RLS JÁ EXISTENTE (independe do 2FA). Por ser
-- uma view simples, ela é auto-atualizável e, rodando como dono, deixava
-- QUALQUER usuário da escola (inclusive o papel 'teacher', que nem consegue
-- ler a tabela teachers) fazer UPDATE e DELETE nos professores pela view.
-- Validado em BEGIN...ROLLBACK em 17/11/2026: role 'teacher' leu 0 linhas em
-- teachers, mas atualizou e apagou as 17 de uma escola via teachers_directory.
-- O front só faz SELECT na view (ClassHealthCards, FinancialMetrics, Classes).
revoke insert, update, delete, truncate, references, trigger
  on public.teachers_directory from anon, authenticated;
revoke select on public.teachers_directory from anon;
