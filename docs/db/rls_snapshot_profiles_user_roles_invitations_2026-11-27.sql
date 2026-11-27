-- Snapshot de LEITURA das políticas RLS em produção (27/11/2026), ANTES da correção da tela Equipe.
-- Gerado de pg_policies; não é migration. Motivo: o histórico de migrations não reflete estas políticas (drift).

-- invitations | Master admin can manage all invitations | PERMISSIVE | ALL
create policy "Master admin can manage all invitations" on public.invitations as permissive for all to public
  using (is_master_admin());

-- invitations | invitations_delete | PERMISSIVE | DELETE
create policy "invitations_delete" on public.invitations as permissive for delete to public
  using (((school_id = get_user_school_id()) OR is_master_admin()));

-- invitations | invitations_insert | PERMISSIVE | INSERT
create policy "invitations_insert" on public.invitations as permissive for insert to public
  with check (((school_id = get_user_school_id()) OR is_master_admin()));

-- invitations | invitations_select | PERMISSIVE | SELECT
create policy "invitations_select" on public.invitations as permissive for select to public
  using (((email = auth.email()) OR (school_id = get_user_school_id()) OR is_master_admin()));

-- invitations | invitations_update | PERMISSIVE | UPDATE
create policy "invitations_update" on public.invitations as permissive for update to public
  using (((email = (( SELECT users.email FROM auth.users WHERE (users.id = auth.uid())))::text) OR (school_id = get_user_school_id()) OR is_master_admin()));

-- profiles | profiles_insert | PERMISSIVE | INSERT
create policy "profiles_insert" on public.profiles as permissive for insert to public
  with check ((user_id = auth.uid()));

-- profiles | master_admin_bypass_profiles | PERMISSIVE | SELECT
create policy "master_admin_bypass_profiles" on public.profiles as permissive for select to public
  using ((is_master_admin() OR (user_id = auth.uid())));

-- profiles | profiles_select | PERMISSIVE | SELECT
create policy "profiles_select" on public.profiles as permissive for select to public
  using ((user_id = auth.uid()));

-- profiles | profiles_update | PERMISSIVE | UPDATE
create policy "profiles_update" on public.profiles as permissive for update to public
  using ((user_id = auth.uid()));

-- user_roles | user_roles_delete | PERMISSIVE | DELETE
create policy "user_roles_delete" on public.user_roles as permissive for delete to public
  using ((is_master_admin() OR ((get_current_user_role() = 'admin'::text) AND (EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.user_id = user_roles.user_id) AND (profiles.school_id = get_user_school_id())))))));

-- user_roles | user_roles_insert | PERMISSIVE | INSERT
create policy "user_roles_insert" on public.user_roles as permissive for insert to public
  with check ((is_master_admin() OR ((get_current_user_role() = 'admin'::text) AND (EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.user_id = user_roles.user_id) AND (profiles.school_id = get_user_school_id())))))));

-- user_roles | user_roles_select | PERMISSIVE | SELECT
create policy "user_roles_select" on public.user_roles as permissive for select to public
  using (((user_id = auth.uid()) OR is_master_admin()));

-- user_roles | user_roles_update | PERMISSIVE | UPDATE
create policy "user_roles_update" on public.user_roles as permissive for update to public
  using ((is_master_admin() OR ((get_current_user_role() = 'admin'::text) AND (EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.user_id = user_roles.user_id) AND (profiles.school_id = get_user_school_id())))))))
  with check ((is_master_admin() OR ((get_current_user_role() = 'admin'::text) AND (EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.user_id = user_roles.user_id) AND (profiles.school_id = get_user_school_id())))))));
