-- Matriz de cenários do gate de 2FA (Fase 3, S2).
--
-- Tudo roda dentro de BEGIN ... ROLLBACK: nada persiste em produção.
-- Usa usuários/escolas REAIS só para leitura de ids; todo INSERT/UPDATE de
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
  -- usuários reais (ids lidos do diagnóstico de 17/11/2026)
  u_master   uuid := '52d00ab5-567f-4537-b33a-22c2bd44e14d'; -- master + owner + admin, Colegio Teste
  u_admin_t  uuid := 'e0185312-eea9-4273-a9a8-ad9d575d4781'; -- admin, Colegio Teste
  u_fin_t    uuid := 'b7ba4eb2-c7a2-4129-83a8-de8e7175c446'; -- financial, Colegio Teste
  u_owner_p  uuid := '03065019-c9b4-4163-a4c9-b89a6cd12986'; -- owner+admin, Colégio Pensar
  u_fin_p    uuid := '77acd93b-6112-4373-b748-9800c0080a04'; -- financial, Colégio Pensar
  s_teste    uuid := 'aaaf9993-908f-43f2-9d3d-dc12357d7468';
  s_pensar   uuid := '2b1e5eba-6cf9-4cb1-a742-eecca53ab5d5';
  v_until    timestamptz;
  v_n        int;
  v_msg      text;
begin
  perform pg_temp.as_service();

  -- O teste não pode depender do estado real (o master, por exemplo, já tem
  -- fator verificado e carência em produção). Dentro da transação, limpa os dos
  -- usuários de teste; o ROLLBACK devolve tudo.
  delete from auth.mfa_factors where user_id in (u_master, u_admin_t, u_fin_t, u_owner_p, u_fin_p);
  delete from public.mfa_grace  where user_id in (u_master, u_admin_t, u_fin_t, u_owner_p, u_fin_p);

  -- C1: nenhuma escola exige → aal1 passa, para qualquer um (exceto master, C8)
  perform pg_temp.as_user(u_admin_t, 'aal1');
  perform pg_temp.rec('C1  escola não exige, admin aal1', public.mfa_gate_ok()::text, 'true');
  perform pg_temp.as_user(u_owner_p, 'aal1');
  perform pg_temp.rec('C1b escola não exige, owner aal1', public.mfa_gate_ok()::text, 'true');

  -- liga a exigência em Pensar (como service role: sem usuário, o guard deixa passar)
  perform pg_temp.as_service();
  update public.schools set require_2fa = true where id = s_pensar;

  -- C2: exige + owner + sem fator + sem carência → bloqueado
  perform pg_temp.as_user(u_owner_p, 'aal1');
  perform pg_temp.rec('C2  exige, owner, sem fator, sem carência', public.mfa_gate_ok()::text, 'false');

  -- C9: owner sem linha em user_roles continua sendo tratado como admin
  perform pg_temp.as_service();
  delete from public.user_roles where user_id = u_owner_p;
  perform pg_temp.as_user(u_owner_p, 'aal1');
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
  update public.mfa_grace set grace_until = now() - interval '1 day' where user_id = u_owner_p;
  perform pg_temp.as_user(u_owner_p, 'aal1');
  perform pg_temp.rec('C4  carência vencida', public.mfa_gate_ok()::text, 'false');

  -- C5/C6: fator verificado → aal1 bloqueia, aal2 libera
  perform pg_temp.as_service();
  insert into auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at, friendly_name)
  values (gen_random_uuid(), u_owner_p, 'totp', 'verified', now(), now(), 'teste');
  perform pg_temp.as_user(u_owner_p, 'aal1');
  perform pg_temp.rec('C5  fator verificado + aal1', public.mfa_gate_ok()::text, 'false');
  perform pg_temp.as_user(u_owner_p, 'aal2');
  perform pg_temp.rec('C6  fator verificado + aal2', public.mfa_gate_ok()::text, 'true');
  perform pg_temp.as_user(u_owner_p, 'aal1');
  perform pg_temp.rec('SG3 com fator, start_mfa_grace devolve null', coalesce(public.start_mfa_grace()::text, 'null'), 'null');

  -- assert_mfa_gate: lança MFA_REQUIRED quando bloqueado
  begin
    perform public.assert_mfa_gate();
    perform pg_temp.rec('AS1 assert_mfa_gate bloqueado lança', 'não lançou', 'MFA_REQUIRED');
  exception when others then
    get stacked diagnostics v_msg = message_text;
    perform pg_temp.rec('AS1 assert_mfa_gate bloqueado lança', v_msg, 'MFA_REQUIRED');
  end;
  perform pg_temp.as_user(u_owner_p, 'aal2');
  begin
    perform public.assert_mfa_gate();
    perform pg_temp.rec('AS2 assert_mfa_gate liberado não lança', 'ok', 'ok');
  exception when others then
    perform pg_temp.rec('AS2 assert_mfa_gate liberado não lança', sqlerrm, 'ok');
  end;

  -- C7: financeiro da escola que exige → não é exigido
  perform pg_temp.as_user(u_fin_p, 'aal1');
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
  update public.profiles set school_id = null where user_id = u_fin_t;
  perform pg_temp.as_user(u_fin_t, 'aal1');
  perform pg_temp.rec('C8f sem escola, não-master', public.mfa_gate_ok()::text, 'true');

  -- C10: guarda do toggle
  perform pg_temp.as_service();
  insert into public.mfa_grace (user_id, grace_until) values (u_admin_t, now() + interval '3 days');
  perform pg_temp.as_user(u_admin_t, 'aal1');
  begin
    update public.schools set require_2fa = true where id = s_teste;
    perform pg_temp.rec('C10a toggle com aal1 deve falhar', 'não falhou', 'erro');
  exception when others then
    perform pg_temp.rec('C10a toggle com aal1 deve falhar', 'erro', 'erro');
  end;
  perform pg_temp.as_user(u_admin_t, 'aal2');
  update public.schools set require_2fa = true where id = s_teste;
  perform pg_temp.rec('C10b toggle com aal2 funciona',
    (select require_2fa::text from public.schools where id = s_teste), 'true');
  perform pg_temp.as_service();
  select count(*) into v_n from public.mfa_grace g join public.profiles p on p.user_id = g.user_id
   where p.school_id = s_teste;
  perform pg_temp.rec('C10c ligar o toggle zera carências da escola', v_n::text, '0');

  -- C10d: editar OUTRO campo da escola com aal1 continua livre (guard não interfere)
  perform pg_temp.as_user(u_admin_t, 'aal1');
  update public.schools set name = name where id = s_teste;
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
