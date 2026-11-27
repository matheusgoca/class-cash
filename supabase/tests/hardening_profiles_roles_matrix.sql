-- Matriz do endurecimento de profiles e user_roles (migration 20261127200000): bloqueios, fluxos legítimos e reversão.
--
-- Tudo dentro de BEGIN ... ROLLBACK (nada persiste, inclusive os ajustes de cenário feitos como postgres).
-- Para rodar antes de aplicar: gerar um arquivo trocando a linha marcadora MIG1 pelo conteúdo da migration e a
-- linha marcadora REV pelo conteúdo do script de reversão (docs/db/reversao_...). Com a migration já aplicada,
-- tirar as duas linhas marcadoras.
-- Esperado 'BLOQ' = escrita bloqueada (0 linhas ou erro 42501); número = linhas afetadas; 'OK' = sem erro.
-- Saída: uma linha por célula; "ok" deve ser true em TODAS as linhas da fase final.

begin;

create temp table t_res (n serial, fase text, cenario text, got text, esperado text, ok boolean);
create temp table t_p (k text primary key, v uuid);

-- p_role: authenticated (cliente) | service_role | postgres (sem troca de papel; contexto de migration/cascata)
create function pg_temp.run_w(p_uid uuid, p_aal text, p_sql text, p_role text default 'authenticated') returns text language plpgsql as $f$
declare v text; n int := 0;
begin
  perform set_config('request.jwt.claims', case when p_uid is null then '' else json_build_object('sub', p_uid, 'aal', p_aal, 'role', p_role)::text end, true);
  if p_role <> 'postgres' then execute format('set local role %I', p_role); end if;
  begin
    execute p_sql;
    get diagnostics n = row_count;
    raise exception 'probe_rollback';
  exception when others then
    if sqlerrm = 'probe_rollback' then v := n::text; else v := 'ERR:' || sqlstate; end if;
  end;
  reset role;
  return v;
end $f$;

create function pg_temp.rec(p_fase text, p_cenario text, p_got text, p_esperado text) returns void language sql as $f$
  insert into t_res (fase, cenario, got, esperado, ok)
  values (p_fase, p_cenario, p_got, p_esperado,
          p_got = p_esperado
          or (p_esperado = 'BLOQ' and p_got in ('0', 'ERR:42501'))
          or (p_esperado = 'OK' and p_got not like 'ERR:%'))
$f$;

insert into t_p select 'master', user_id from public.profiles where is_master_admin limit 1;
insert into t_p select 'teste', school_id from public.profiles where is_master_admin limit 1;
insert into t_p select 'pensar', id from public.schools where name = 'Colégio Pensar';
insert into t_p select 'estrela', id from public.schools where name = 'Colégio Estrela';
insert into t_p select 'p_admin', p.user_id from public.profiles p join public.user_roles r on r.user_id = p.user_id
 where p.school_id = (select v from t_p where k='pensar') and r.role = 'admin' limit 1;
insert into t_p select 'p_fin1', p.user_id from public.profiles p join public.user_roles r on r.user_id = p.user_id
 where p.school_id = (select v from t_p where k='pensar') and r.role = 'financial' order by p.user_id limit 1;
insert into t_p select 'p_fin2', p.user_id from public.profiles p join public.user_roles r on r.user_id = p.user_id
 where p.school_id = (select v from t_p where k='pensar') and r.role = 'financial' order by p.user_id desc limit 1;
insert into t_p select 't_a1', p.user_id from public.profiles p join public.user_roles r on r.user_id = p.user_id
 where p.school_id = (select v from t_p where k='teste') and r.role = 'admin' and not p.is_master_admin order by p.user_id limit 1;
insert into t_p select 't_a2', p.user_id from public.profiles p join public.user_roles r on r.user_id = p.user_id
 where p.school_id = (select v from t_p where k='teste') and r.role = 'admin' and not p.is_master_admin order by p.user_id desc limit 1;
-- usuário sem escola nem papel (onboarding)
insert into t_p select 'novo', p.user_id from public.profiles p
 where p.school_id is null and not p.is_master_admin and not exists (select 1 from public.user_roles r where r.user_id = p.user_id) limit 1;

create function pg_temp.bloqueios(p_fase text) returns void language plpgsql as $f$
declare
  pen text := (select v::text from t_p where k='pensar');
  tst text := (select v::text from t_p where k='teste');
  mst text := (select v::text from t_p where k='master');
  pa text := (select v::text from t_p where k='p_admin');
  pf1 text := (select v::text from t_p where k='p_fin1');
  a1 text := (select v::text from t_p where k='t_a1');
  a2 text := (select v::text from t_p where k='t_a2');
  nv text := (select v::text from t_p where k='novo');
  d text := p_fase;
begin
  perform pg_temp.rec(d, 'B1 financeiro: altera is_master_admin do próprio perfil', pg_temp.run_w(pf1::uuid,'aal1','update public.profiles set is_master_admin=true where user_id='''||pf1||''''), 'BLOQ');
  perform pg_temp.rec(d, 'B2 admin: altera is_master_admin do próprio perfil', pg_temp.run_w(a1::uuid,'aal1','update public.profiles set is_master_admin=true where user_id='''||a1||''''), 'BLOQ');
  perform pg_temp.rec(d, 'B3 admin: troca o próprio school_id', pg_temp.run_w(pa::uuid,'aal1','update public.profiles set school_id='''||tst||''' where user_id='''||pa||''''), 'BLOQ');
  perform pg_temp.rec(d, 'B4 financeiro: zera o próprio school_id', pg_temp.run_w(pf1::uuid,'aal1','update public.profiles set school_id=null where user_id='''||pf1||''''), 'BLOQ');
  perform pg_temp.rec(d, 'B5 usuário sem escola: define school_id para escola da qual não é owner', pg_temp.run_w(nv::uuid,'aal1','update public.profiles set school_id='''||pen||''' where user_id='''||nv||''''), 'BLOQ');
  perform pg_temp.rec(d, 'B6 usuário: troca o próprio user_id', pg_temp.run_w(pf1::uuid,'aal1','update public.profiles set user_id=gen_random_uuid() where user_id='''||pf1||''''), 'BLOQ');
  perform pg_temp.rec(d, 'B7 cliente: cria perfil com is_master_admin', pg_temp.run_w(pf1::uuid,'aal1','insert into public.profiles (user_id, is_master_admin) values ('''||pf1||''', true)'), 'BLOQ');
  perform pg_temp.rec(d, 'B8 cliente: cria perfil com school_id de escola da qual não é owner', pg_temp.run_w(pf1::uuid,'aal1','insert into public.profiles (user_id, school_id) values ('''||pf1||''','''||tst||''')'), 'BLOQ');
  perform pg_temp.rec(d, 'B9 único admin do Pensar (owner): rebaixa a si mesmo', pg_temp.run_w(pa::uuid,'aal1','update public.user_roles set role=''financial'' where user_id='''||pa||''''), 'BLOQ');
  perform pg_temp.rec(d, 'B10 único admin do Pensar (owner): remove o próprio papel', pg_temp.run_w(pa::uuid,'aal1','delete from public.user_roles where user_id='''||pa||''''), 'BLOQ');
  perform pg_temp.rec(d, 'B11 admin: troca o user_id de uma linha de papel', pg_temp.run_w(pa::uuid,'aal1','update public.user_roles set user_id=gen_random_uuid() where user_id='''||pa||''''), 'BLOQ');
end $f$;

select pg_temp.bloqueios('antes');

-- @@MIG1@@

select pg_temp.bloqueios('depois');

-- ===== Cenários com ajuste (como postgres, desfeitos no ROLLBACK) =====
select set_config('request.jwt.claims', '', true);
-- 2º admin no Pensar tenta rebaixar/remover o owner. Sem a política de visibilidade (migration 2) o 2º admin não
-- enxerga o owner e a escrita já dá 0; o bloqueio do trigger é provado com o JWT do owner/auto-ação (B9/B10) e
-- aqui com um papel que enxerga a linha: o próprio 2º admin rebaixando a si mesmo seria permitido (há outro admin).
update public.user_roles set role = 'admin' where user_id = (select v from t_p where k='p_fin1');
select pg_temp.rec('depois', 'B12 2º admin do Pensar rebaixa a si mesmo (permitido: há outro admin)',
  pg_temp.run_w((select v from t_p where k='p_fin1'),'aal1','update public.user_roles set role=''financial'' where user_id='''||(select v from t_p where k='p_fin1')||''''), '1');
select pg_temp.rec('depois', 'B13 owner rebaixa a si mesmo com 2º admin presente (bloqueado: é o owner)',
  pg_temp.run_w((select v from t_p where k='p_admin'),'aal1','update public.user_roles set role=''financial'' where user_id='''||(select v from t_p where k='p_admin')||''''), 'BLOQ');
update public.user_roles set role = 'financial' where user_id = (select v from t_p where k='p_fin1');

-- Fluxos legítimos
-- onboarding: o usuário cria a própria escola e liga o perfil a ela
select pg_temp.rec('depois', 'R1 onboarding: cliente cria a própria escola',
  pg_temp.run_w((select v from t_p where k='novo'),'aal1','insert into public.schools (name, segments, owner_user_id) values (''Escola Regressao'', array[''fundamental_1''], '''||(select v::text from t_p where k='novo')||''')'), '1');
insert into public.schools (name, segments, owner_user_id) values ('Escola Regressao', array['fundamental_1'], (select v from t_p where k='novo'));
insert into t_p select 'nova_escola', id from public.schools where name = 'Escola Regressao';
select pg_temp.rec('depois', 'R2 onboarding: perfil liga (de NULL) à escola da qual é owner',
  pg_temp.run_w((select v from t_p where k='novo'),'aal1','update public.profiles set school_id='''||(select v::text from t_p where k='nova_escola')||''' where user_id='''||(select v::text from t_p where k='novo')||''''), '1');
update public.profiles set school_id = (select v from t_p where k='nova_escola') where user_id = (select v from t_p where k='novo');
select pg_temp.rec('depois', 'R3 onboarding: owner grava o próprio papel admin (upsert, sem mudança)',
  pg_temp.run_w((select v from t_p where k='novo'),'aal1','insert into public.user_roles (user_id, role) values ('''||(select v::text from t_p where k='novo')||''', ''admin'') on conflict (user_id) do update set role = ''admin'''), 'OK');
-- accept-invite / invite-school-owner / remove-user / reset-user-mfa: service role (Edge Functions)
select pg_temp.rec('depois', 'R4 service role: liga perfil a uma escola (accept-invite)',
  pg_temp.run_w(null,'','update public.profiles set school_id='''||(select v::text from t_p where k='teste')||''' where user_id='''||(select v::text from t_p where k='p_fin2')||'''','service_role'), '1');
select pg_temp.rec('depois', 'R5 service role: define o papel de um membro',
  pg_temp.run_w(null,'','update public.user_roles set role=''teacher'' where user_id='''||(select v::text from t_p where k='p_fin2')||'''','service_role'), '1');
select pg_temp.rec('depois', 'R6 service role: remove o papel e o perfil do owner/último admin (remove-user decide as guardas)',
  pg_temp.run_w(null,'','with a as (delete from public.user_roles where user_id='''||(select v::text from t_p where k='p_admin')||''' returning 1), b as (delete from public.profiles where user_id='''||(select v::text from t_p where k='p_admin')||''' returning 1) select 1','service_role'), 'OK');
-- cascata e criação: contexto sem papel de cliente
-- escola vazia (Estrela) com um admin que NÃO é owner e é o único admin dela
insert into auth.users (id, instance_id, aud, role, email) values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'regressao2@example.invalid');
update public.profiles set school_id = (select v from t_p where k='estrela') where user_id = '11111111-1111-1111-1111-111111111111';
insert into public.user_roles (user_id, role) values ('11111111-1111-1111-1111-111111111111', 'admin');
select pg_temp.rec('depois', 'R7 cascata: excluir o usuário que é o único admin de uma escola (auth.users) não é bloqueado',
  pg_temp.run_w(null,'','delete from auth.users where id=''11111111-1111-1111-1111-111111111111''','postgres'), 'OK');
select pg_temp.rec('depois', 'R8 limpeza de escola (papéis e perfis dos membros, em lote como postgres) não é bloqueada',
  pg_temp.run_w(null,'','with a as (delete from public.user_roles where user_id='''||(select v::text from t_p where k='novo')||''' returning 1), b as (delete from public.profiles where user_id='''||(select v::text from t_p where k='novo')||''' returning 1) select 1','postgres'), 'OK');
select pg_temp.rec('depois', 'R9 cadastro novo (handle_new_user) cria o perfil sem erro',
  pg_temp.run_w(null,'','insert into auth.users (id, instance_id, aud, role, email) values (gen_random_uuid(), ''00000000-0000-0000-0000-000000000000'', ''authenticated'', ''authenticated'', ''regressao@example.invalid'')','postgres'), 'OK');
-- master (cliente, aal2) mantém os poderes
select pg_temp.rec('depois', 'R10 master (cliente): mover usuário de escola já não é possível por RLS (profiles_update é só do próprio); sem mudança',
  pg_temp.run_w((select v from t_p where k='master'),'aal2','update public.profiles set school_id='''||(select v::text from t_p where k='pensar')||''' where user_id='''||(select v::text from t_p where k='t_a2')||'''','authenticated'), '0');
select pg_temp.rec('depois', 'R11 master: rebaixa o owner do Pensar',
  pg_temp.run_w((select v from t_p where k='master'),'aal2','update public.user_roles set role=''financial'' where user_id='''||(select v::text from t_p where k='p_admin')||'''','authenticated'), '1');
select pg_temp.rec('depois', 'R12 master: edita o próprio perfil (nome)',
  pg_temp.run_w((select v from t_p where k='master'),'aal2','update public.profiles set full_name=full_name where user_id='''||(select v::text from t_p where k='master')||'''','authenticated'), '1');

-- ===== Reversão =====
-- @@REV@@
select pg_temp.rec('reversao', 'V1 triggers removidos',
  (select count(*)::text from pg_trigger where tgname in ('profiles_protect_columns','user_roles_protect_admin') and not tgisinternal), '0');
select pg_temp.rec('reversao', 'V2 funções removidas',
  (select count(*)::text from pg_proc where proname in ('profiles_protect_columns','user_roles_protect_admin','admin_role_loss_reason','is_school_owner') and pronamespace='public'::regnamespace), '0');
select pg_temp.rec('reversao', 'V3 comportamento anterior restaurado (cliente volta a conseguir a escrita que o trigger bloqueava)',
  pg_temp.run_w((select v from t_p where k='p_fin1'),'aal1','update public.profiles set is_master_admin=true where user_id='''||(select v::text from t_p where k='p_fin1')||''''), '1');

select n, fase, cenario, got, esperado, ok from t_res order by case fase when 'antes' then 1 when 'depois' then 2 else 3 end, n;

rollback;
