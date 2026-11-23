-- Matriz de cenários do gate de 2FA (Fase 3, S2).
--
-- Tudo roda dentro de BEGIN ... ROLLBACK: nada persiste em produção.
-- Escolhe usuários/escolas existentes por consulta (só leitura); todo INSERT/UPDATE de
-- teste (fator fake, carência, require_2fa) é desfeito pelo ROLLBACK.
--
-- Como rodar:
--   Migration já aplicada:  supabase db query --linked -f supabase/tests/mfa_gate_matrix.sql
--   Migration NÃO aplicada: gerar um arquivo que substitui a linha marcadora
--     "-- @@MIGRATION@@" pelo conteúdo da migration, e rodar esse arquivo.
-- Saída: uma linha por verificação; a coluna "ok" deve ser true em TODAS.

begin;

-- @@MIGRATION@@

create temp table t_res (n serial, cenario text, got text, esperado text, ok boolean);

create function pg_temp.as_user(p_uid uuid, p_aal text) returns void language sql as $f$
  select set_config('request.jwt.claims',
         json_build_object('sub', p_uid, 'aal', p_aal, 'role', 'authenticated')::text, true)
$f$;
create function pg_temp.as_service() returns void language sql as $f$
  select set_config('request.jwt.claims', '', true)
$f$;
create function pg_temp.rec(p_cenario text, p_got text, p_esperado text) returns void language sql as $f$
  insert into t_res (cenario, got, esperado, ok) values (p_cenario, p_got, p_esperado, p_got = p_esperado)
$f$;

do $$
declare
  -- personagens: escolhidos por consulta no início do bloco (nenhum id fixo no arquivo)
  u_master   uuid; -- master (profiles.is_master_admin); a escola A é a escola do perfil dele
  u_admin_a  uuid; -- admin (user_roles), não-master, da escola A
  u_fin_a    uuid; -- financial, da escola A
  u_owner_b  uuid; -- owner da escola B (outra escola) + role admin, não-master
  u_fin_b    uuid; -- financial da escola B
  s_a    uuid; -- escola A
  s_b   uuid; -- escola B
  v_until    timestamptz;
  v_n        int;
  v_msg      text;
begin
  perform pg_temp.as_service();

  select p.user_id, p.school_id into u_master, s_a
    from public.profiles p where p.is_master_admin and p.school_id is not null order by p.user_id limit 1;
  select p.user_id into u_admin_a from public.profiles p join public.user_roles r on r.user_id = p.user_id
   where p.school_id = s_a and not p.is_master_admin and r.role = 'admin' order by p.user_id limit 1;
  select p.user_id into u_fin_a from public.profiles p join public.user_roles r on r.user_id = p.user_id
   where p.school_id = s_a and not p.is_master_admin and r.role = 'financial' order by p.user_id limit 1;
  select s.id, s.owner_user_id into s_b, u_owner_b from public.schools s
    join public.profiles p on p.user_id = s.owner_user_id and p.school_id = s.id
    join public.user_roles r on r.user_id = p.user_id and r.role = 'admin'
   where s.id <> s_a and not p.is_master_admin order by s.id limit 1;
  select p.user_id into u_fin_b from public.profiles p join public.user_roles r on r.user_id = p.user_id
   where p.school_id = s_b and not p.is_master_admin and r.role = 'financial' order by p.user_id limit 1;
  if u_master is null or u_admin_a is null or u_fin_a is null or u_owner_b is null or u_fin_b is null then
    raise exception 'personagens não encontrados em produção (master/admin/financeiro da escola A, owner/financeiro da escola B)';
  end if;

  -- O teste não pode depender do estado real (o master, por exemplo, já pode ter
  -- fator verificado e carência em produção). Dentro da transação, limpa os dos
  -- usuários de teste; o ROLLBACK devolve tudo.
  delete from auth.mfa_factors where user_id in (u_master, u_admin_a, u_fin_a, u_owner_b, u_fin_b);
  delete from public.mfa_grace  where user_id in (u_master, u_admin_a, u_fin_a, u_owner_b, u_fin_b);

  -- C1: nenhuma escola exige → aal1 passa, para qualquer um (exceto master, C8)
  perform pg_temp.as_user(u_admin_a, 'aal1');
  perform pg_temp.rec('C1  escola não exige, admin aal1', public.mfa_gate_ok()::text, 'true');
  perform pg_temp.as_user(u_owner_b, 'aal1');
  perform pg_temp.rec('C1b escola não exige, owner aal1', public.mfa_gate_ok()::text, 'true');

  -- liga a exigência na escola B (como service role: sem usuário, o guard deixa passar)
  perform pg_temp.as_service();
  update public.schools set require_2fa = true where id = s_b;

  -- C2: exige + owner + sem fator + sem carência → bloqueado
  perform pg_temp.as_user(u_owner_b, 'aal1');
  perform pg_temp.rec('C2  exige, owner, sem fator, sem carência', public.mfa_gate_ok()::text, 'false');

  -- C9: owner sem linha em user_roles continua sendo tratado como admin
  perform pg_temp.as_service();
  delete from public.user_roles where user_id = u_owner_b;
  perform pg_temp.as_user(u_owner_b, 'aal1');
  perform pg_temp.rec('C9  owner sem linha em user_roles → exigido', public.mfa_gate_ok()::text, 'false');

  -- start_mfa_grace: cria 7 dias, idempotente
  select public.start_mfa_grace() into v_until;
  perform pg_temp.rec('SG1 start_mfa_grace cria ~7 dias',
    (v_until between now() + interval '6 days 23 hours' and now() + interval '7 days 1 hour')::text, 'true');
  perform pg_temp.rec('SG2 start_mfa_grace é idempotente',
    (public.start_mfa_grace() = v_until)::text, 'true');

  -- C3: dentro da carência → passa
  perform pg_temp.rec('C3  carência futura', public.mfa_gate_ok()::text, 'true');

  -- C4: carência vencida → bloqueia
  perform pg_temp.as_service();
  update public.mfa_grace set grace_until = now() - interval '1 day' where user_id = u_owner_b;
  perform pg_temp.as_user(u_owner_b, 'aal1');
  perform pg_temp.rec('C4  carência vencida', public.mfa_gate_ok()::text, 'false');

  -- C5/C6: fator verificado → aal1 bloqueia, aal2 libera
  perform pg_temp.as_service();
  insert into auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at, friendly_name)
  values (gen_random_uuid(), u_owner_b, 'totp', 'verified', now(), now(), 'teste');
  perform pg_temp.as_user(u_owner_b, 'aal1');
  perform pg_temp.rec('C5  fator verificado + aal1', public.mfa_gate_ok()::text, 'false');
  perform pg_temp.as_user(u_owner_b, 'aal2');
  perform pg_temp.rec('C6  fator verificado + aal2', public.mfa_gate_ok()::text, 'true');
  perform pg_temp.as_user(u_owner_b, 'aal1');
  perform pg_temp.rec('SG3 com fator, start_mfa_grace devolve null', coalesce(public.start_mfa_grace()::text, 'null'), 'null');

  -- assert_mfa_gate: lança MFA_REQUIRED quando bloqueado
  begin
    perform public.assert_mfa_gate();
    perform pg_temp.rec('AS1 assert_mfa_gate bloqueado lança', 'não lançou', 'MFA_REQUIRED');
  exception when others then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.rec('AS1 assert_mfa_gate bloqueado lança', v_msg, 'MFA_REQUIRED');
  end;
  perform pg_temp.as_user(u_owner_b, 'aal2');
  begin
    perform public.assert_mfa_gate();
    perform pg_temp.rec('AS2 assert_mfa_gate liberado não lança', 'ok', 'ok');
  exception when others then
    perform pg_temp.rec('AS2 assert_mfa_gate liberado não lança', sqlerrm, 'ok');
  end;

  -- C7: financeiro da escola que exige → não é exigido
  perform pg_temp.as_user(u_fin_b, 'aal1');
  perform pg_temp.rec('C7  financeiro, escola exige', public.mfa_gate_ok()::text, 'true');
  perform pg_temp.rec('SG4 financeiro: start_mfa_grace devolve null', coalesce(public.start_mfa_grace()::text, 'null'), 'null');

  -- C8: master é SEMPRE exigido (mesmo com escola que não exige)
  perform pg_temp.as_user(u_master, 'aal1');
  perform pg_temp.rec('C8  master sem fator/carência → bloqueado', public.mfa_gate_ok()::text, 'false');
  select public.start_mfa_grace() into v_until;
  perform pg_temp.rec('C8b master: start_mfa_grace cria carência', (v_until is not null)::text, 'true');
  perform pg_temp.rec('C8c master dentro da carência → passa', public.mfa_gate_ok()::text, 'true');
  perform pg_temp.as_service();
  insert into auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at, friendly_name)
  values (gen_random_uuid(), u_master, 'totp', 'verified', now(), now(), 'teste');
  perform pg_temp.as_user(u_master, 'aal1');
  perform pg_temp.rec('C8d master com fator + aal1 → bloqueado', public.mfa_gate_ok()::text, 'false');
  perform pg_temp.as_user(u_master, 'aal2');
  perform pg_temp.rec('C8e master com fator + aal2 → passa', public.mfa_gate_ok()::text, 'true');

  -- C8f: usuário sem escola e não-master (onboarding) → não é exigido
  perform pg_temp.as_service();
  update public.profiles set school_id = null where user_id = u_fin_a;
  perform pg_temp.as_user(u_fin_a, 'aal1');
  perform pg_temp.rec('C8f sem escola, não-master', public.mfa_gate_ok()::text, 'true');

  -- C10: guarda do toggle
  perform pg_temp.as_service();
  insert into public.mfa_grace (user_id, grace_until) values (u_admin_a, now() + interval '3 days');
  perform pg_temp.as_user(u_admin_a, 'aal1');
  begin
    update public.schools set require_2fa = true where id = s_a;
    perform pg_temp.rec('C10a toggle com aal1 deve falhar', 'não falhou', 'erro');
  exception when others then
    perform pg_temp.rec('C10a toggle com aal1 deve falhar', 'erro', 'erro');
  end;
  perform pg_temp.as_user(u_admin_a, 'aal2');
  update public.schools set require_2fa = true where id = s_a;
  perform pg_temp.rec('C10b toggle com aal2 funciona',
    (select require_2fa::text from public.schools where id = s_a), 'true');
  perform pg_temp.as_service();
  select count(*) into v_n from public.mfa_grace g join public.profiles p on p.user_id = g.user_id
   where p.school_id = s_a;
  perform pg_temp.rec('C10c ligar o toggle zera carências da escola', v_n::text, '0');

  -- C10d: editar OUTRO campo da escola com aal1 continua livre (guard não interfere)
  perform pg_temp.as_user(u_admin_a, 'aal1');
  update public.schools set name = name where id = s_a;
  perform pg_temp.rec('C10d editar outro campo com aal1 não é barrado', 'ok', 'ok');

  -- Permissões: anon/authenticated não chamam os helpers internos
  perform pg_temp.rec('P1  anon NÃO executa mfa_is_admin_or_owner',
    has_function_privilege('anon', 'public.mfa_is_admin_or_owner(uuid,uuid)', 'execute')::text, 'false');
  perform pg_temp.rec('P2  authenticated NÃO executa mfa_is_admin_or_owner',
    has_function_privilege('authenticated', 'public.mfa_is_admin_or_owner(uuid,uuid)', 'execute')::text, 'false');
  perform pg_temp.rec('P3  authenticated executa mfa_gate_ok',
    has_function_privilege('authenticated', 'public.mfa_gate_ok()', 'execute')::text, 'true');
  perform pg_temp.rec('P4  anon NÃO executa mfa_gate_ok',
    has_function_privilege('anon', 'public.mfa_gate_ok()', 'execute')::text, 'false');
  perform pg_temp.rec('P5  anon NÃO executa start_mfa_grace',
    has_function_privilege('anon', 'public.start_mfa_grace()', 'execute')::text, 'false');
end $$;

select n, cenario, got, esperado, ok from t_res order by n;

rollback;
