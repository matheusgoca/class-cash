-- Função de trigger genérica — uma só função serve as 14 tabelas da Fase 2,
-- aplicada via CREATE TRIGGER em 20261112192000_audit_triggers.sql.

create or replace function public.audit_trigger_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_record_id uuid;
  v_school_id uuid;
  v_changed_fields text[];
  v_actor_role text;
  v_home_school_id uuid;
  v_is_master boolean;
  v_source text;
begin
  v_old := case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(OLD) else null end;
  v_new := case when TG_OP in ('INSERT', 'UPDATE') then to_jsonb(NEW) else null end;
  v_row := coalesce(v_new, v_old);
  v_record_id := (v_row ->> 'id')::uuid;

  -- school_id: direto na linha para a maioria das tabelas; dois casos
  -- especiais onde a coluna não existe ou não é a resposta certa.
  if TG_TABLE_NAME = 'schools' then
    v_school_id := v_record_id; -- a própria linha É a escola
  elsif TG_TABLE_NAME = 'user_roles' then
    -- user_roles não tem school_id — resolve pelo usuário afetado, mesmo
    -- lookup de get_user_school_id() (profiles, com fallback a schools.owner_user_id
    -- para owners, que não têm linha em profiles.school_id).
    select coalesce(
      (select school_id from public.profiles where user_id = (v_row ->> 'user_id')::uuid),
      (select id from public.schools where owner_user_id = (v_row ->> 'user_id')::uuid)
    ) into v_school_id;
  else
    v_school_id := nullif(v_row ->> 'school_id', '')::uuid;
  end if;

  if TG_OP = 'UPDATE' then
    select array_agg(k.key) into v_changed_fields
    from jsonb_each(v_new) as k
    where k.value is distinct from (v_old -> k.key);

    -- Ruído: tuitions muda de status/datas o tempo todo (confirmação de
    -- pagamento, renegociação); só vale logar quando os campos que importam
    -- pro histórico financeiro mudam, não qualquer touch na linha.
    if TG_TABLE_NAME = 'tuitions'
       and not (v_changed_fields && array['status', 'amount', 'final_amount', 'discount_applied', 'penalty_amount', 'due_date', 'paid_date'])
    then
      return null; -- AFTER trigger: valor de retorno é ignorado pelo Postgres, só encerra a função
    end if;
  end if;

  v_actor_role := public.get_current_user_role();
  v_home_school_id := public.get_user_school_id();
  v_is_master := public.is_master_admin() and (v_home_school_id is distinct from v_school_id);
  -- Setado por RPCs específicas (insert_generated_tuitions, import_student, etc.)
  -- via set_config(..., true) — local à transação da própria RPC, nunca
  -- vaza entre conexões do pool. Ausente (ação manual direto na tela) → 'manual'.
  v_source := coalesce(current_setting('app.audit_source', true), 'manual');

  insert into public.audit_logs (
    school_id, actor_user_id, actor_role, is_master_action,
    table_name, record_id, action, changed_fields, old_data, new_data, source
  ) values (
    v_school_id, auth.uid(), v_actor_role, v_is_master,
    TG_TABLE_NAME, v_record_id, lower(TG_OP), v_changed_fields, v_old, v_new, v_source
  );

  return null;
end;
$$;

comment on function public.audit_trigger_fn() is
  'Trigger genérica AFTER INSERT/UPDATE/DELETE usada pelas 14 tabelas auditadas (ver 20261112192000_audit_triggers.sql). Não editar o comportamento de uma tabela só sem revisar as outras 13.';
