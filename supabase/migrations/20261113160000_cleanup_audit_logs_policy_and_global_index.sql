-- Sprint S2, Fase 0: dois achados do diagnóstico de audit_logs (RLS validado
-- com BEGIN...ROLLBACK simulando JWT de usuários não-master, sem gravar nada).

-- 1) A policy comparava role com 'owner', mas esse valor nunca existe no enum
-- app_role (só 'admin', 'financial', 'teacher') — o dono da escola carrega
-- role='admin' em user_roles, identificado por schools.owner_user_id. O
-- ramo 'owner' era código morto, inofensivo (owner já passa por 'admin'),
-- mas enganoso pra quem lê a policy depois. Recriada sem ele.
drop policy if exists audit_logs_select on public.audit_logs;

create policy audit_logs_select on public.audit_logs
  for select
  using (
    (school_id = public.get_user_school_id() and public.get_current_user_role() = 'admin')
    or public.is_master_admin()
  );

-- 2) Índice em (school_id, created_at desc) já cobre o histórico do owner.
-- O painel global do master (Fase 1 da S2) às vezes lista sem filtrar por
-- escola, ordenado por created_at desc; sem esse índice cairia num seq scan
-- quando audit_logs crescer.
create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);
