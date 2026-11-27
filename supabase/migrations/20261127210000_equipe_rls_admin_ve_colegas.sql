-- Tela Equipe: o admin da escola passa a ver os colegas da PRÓPRIA escola (perfis e papéis).
--
-- Causa: em produção, profiles_select e user_roles_select só liberam a linha do próprio usuário (e o master por
-- outra política). O admin via só a si mesmo. As políticas atuais NÃO estão no histórico de migrations (drift);
-- o snapshot de leitura delas está em docs/db/rls_snapshot_profiles_user_roles_invitations_2026-11-27.sql.
--
-- Esta migration só ADICIONA duas políticas de SELECT e uma função auxiliar. Não altera nem remove política
-- existente (idempotente: drop policy if exists só nas políticas novas).
--
-- Regras da política nova:
--  * só quem tem papel 'admin' (o owner tem esse papel);
--  * só linhas de membros da MESMA escola (get_user_school_id());
--  * NUNCA o perfil do master (o master do Class Cash tem school_id de uma escola cliente);
--  * respeita o gate de 2FA: admin sem o 2FA exigido pela escola continua vendo só a si mesmo.
-- Financeiro e professor não ganham nada (a tela /equipe é só de admin).

-- Membro da escola de quem chama, que não é master. Só booleano; search_path vazio (tudo qualificado).
create or replace function public.is_school_member(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles p
     where p.user_id = p_user
       and p.school_id is not null
       and p.school_id = public.get_user_school_id()
       and not coalesce(p.is_master_admin, false)
  );
$$;

revoke all on function public.is_school_member(uuid) from public;
revoke all on function public.is_school_member(uuid) from anon;
revoke all on function public.is_school_member(uuid) from service_role;
grant execute on function public.is_school_member(uuid) to authenticated;

drop policy if exists "profiles_select_school_admin" on public.profiles;
create policy "profiles_select_school_admin" on public.profiles
  as permissive for select to authenticated
  using (
    public.get_current_user_role() = 'admin'
    and (select public.mfa_gate_ok())
    and public.is_school_member(user_id)
  );

drop policy if exists "user_roles_select_school_admin" on public.user_roles;
create policy "user_roles_select_school_admin" on public.user_roles
  as permissive for select to authenticated
  using (
    public.get_current_user_role() = 'admin'
    and (select public.mfa_gate_ok())
    and public.is_school_member(user_id)
  );
