-- Matriz da tela Equipe (RLS de profiles/user_roles/invitations): leituras e ESCRITAS por papel.
--
-- Roda dentro de BEGIN ... ROLLBACK: nada persiste (inclui os ajustes de cenário feitos como postgres).
-- Roda o mesmo conjunto de verificações ANTES e DEPOIS da migration 20261127210000. Para a fase "depois", gere
-- um arquivo trocando a linha marcadora entre as duas fases pelo conteúdo da migration; se a migration já estiver
-- aplicada, rode este arquivo direto (as duas fases ficam iguais).
--   supabase db query --linked -f <arquivo>
-- Esperado 'BLOQ' = escrita bloqueada (0 linhas afetadas ou erro 42501).
-- Saída: uma linha por célula; "ok" deve ser true em TODAS as linhas da fase "depois".
-- Personagens por consulta (sem id fixo): master = is_master_admin; Teste = escola do perfil do master;
-- Pensar = escola 'Colégio Pensar'.

begin;

create temp table t_res (n serial, fase text, cenario text, got text, esperado text, ok boolean);
create temp table t_p (k text primary key, v uuid);

-- leitura escalar como usuário simulado (RLS de verdade)
create function pg_temp.run_r(p_uid uuid, p_aal text, p_sql text) returns text language plpgsql as $f$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'aal', p_aal, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    execute p_sql into v;
  exception when others then
    v := 'ERR:' || sqlstate;
  end;
  reset role;
  return v;
end $f$;

-- escrita como usuário simulado: devolve nº de linhas afetadas (ou ERR:<sqlstate>) e DESFAZ a escrita
create function pg_temp.run_w(p_uid uuid, p_aal text, p_sql text) returns text language plpgsql as $f$
declare v text; n int := 0;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'aal', p_aal, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
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
  insert into t_res (fase, cenario, got, esperado, ok) values (p_fase, p_cenario, p_got, p_esperado, p_got = p_esperado or (p_esperado = 'BLOQ' and p_got in ('0', 'ERR:42501')))
$f$;

-- personagens
insert into t_p
select 'master', user_id from public.profiles where is_master_admin limit 1;
insert into t_p
select 'teste', school_id from public.profiles where is_master_admin limit 1;
insert into t_p
select 'pensar', id from public.schools where name = 'Colégio Pensar';
insert into t_p
select 'p_admin', p.user_id from public.profiles p join public.user_roles r on r.user_id = p.user_id
 where p.school_id = (select v from t_p where k='pensar') and r.role = 'admin' limit 1;
insert into t_p
select 'p_fin1', p.user_id from public.profiles p join public.user_roles r on r.user_id = p.user_id
 where p.school_id = (select v from t_p where k='pensar') and r.role = 'financial' order by p.user_id limit 1;
insert into t_p
select 'p_fin2', p.user_id from public.profiles p join public.user_roles r on r.user_id = p.user_id
 where p.school_id = (select v from t_p where k='pensar') and r.role = 'financial' order by p.user_id desc limit 1;
insert into t_p
select 't_a1', p.user_id from public.profiles p join public.user_roles r on r.user_id = p.user_id
 where p.school_id = (select v from t_p where k='teste') and r.role = 'admin' and not p.is_master_admin order by p.user_id limit 1;
insert into t_p
select 't_a2', p.user_id from public.profiles p join public.user_roles r on r.user_id = p.user_id
 where p.school_id = (select v from t_p where k='teste') and r.role = 'admin' and not p.is_master_admin order by p.user_id desc limit 1;

create function pg_temp.u(k text) returns uuid language sql as $f$ select v from t_p where k = $1 $f$;

-- Bloco de verificações. p_fase: 'antes' | 'depois'. p_exp = true grava o esperado da fase "depois".
create function pg_temp.matrix(p_fase text) returns void language plpgsql as $f$
declare
  pen text := (select v::text from t_p where k='pensar');
  tst text := (select v::text from t_p where k='teste');
  mst text := (select v::text from t_p where k='master');
  pa text := (select v::text from t_p where k='p_admin');
  pf1 text := (select v::text from t_p where k='p_fin1');
  pf2 text := (select v::text from t_p where k='p_fin2');
  a1 text := (select v::text from t_p where k='t_a1');
  a2 text := (select v::text from t_p where k='t_a2');
  d text := p_fase;
begin
  -- ===== LEITURA =====
  -- admin do Pensar (2FA opcional): vê os 3 perfis e 3 papéis da escola; nada de outra escola
  perform pg_temp.rec(d, 'L1 admin Pensar: perfis do Pensar', pg_temp.run_r(pa::uuid,'aal1','select count(*)::text from public.profiles where school_id='''||pen||''''), '3');
  perform pg_temp.rec(d, 'L2 admin Pensar: papéis de membros do Pensar', pg_temp.run_r(pa::uuid,'aal1','select count(*)::text from public.user_roles r where r.user_id in (select user_id from public.profiles where school_id='''||pen||''')'), '3');
  perform pg_temp.rec(d, 'L3 admin Pensar: perfis de OUTRA escola', pg_temp.run_r(pa::uuid,'aal1','select count(*)::text from public.profiles where school_id is distinct from '''||pen||''''), '0');
  perform pg_temp.rec(d, 'L4 admin Pensar: papéis de usuários de outra escola', pg_temp.run_r(pa::uuid,'aal1','select count(*)::text from public.user_roles where user_id not in (select user_id from public.profiles where school_id='''||pen||''')'), '0');
  perform pg_temp.rec(d, 'L5 admin Pensar: convites de outra escola', pg_temp.run_r(pa::uuid,'aal1','select count(*)::text from public.invitations where school_id is distinct from '''||pen||''''), '0');
  perform pg_temp.rec(d, 'L6 admin Pensar: perfil do master', pg_temp.run_r(pa::uuid,'aal1','select count(*)::text from public.profiles where is_master_admin'), '0');
  -- admin da Colegio Teste: se vê + o outro admin; nunca o master (que tem school_id da Teste)
  perform pg_temp.rec(d, 'L7 admin Teste: perfis da Teste (ele + o outro admin)', pg_temp.run_r(a1::uuid,'aal1','select count(*)::text from public.profiles where school_id='''||tst||''''), '2');
  perform pg_temp.rec(d, 'L8 admin Teste: vê o outro admin', pg_temp.run_r(a1::uuid,'aal1','select count(*)::text from public.profiles where user_id='''||a2||''''), '1');
  perform pg_temp.rec(d, 'L9 admin Teste: perfil do master', pg_temp.run_r(a1::uuid,'aal1','select count(*)::text from public.profiles where user_id='''||mst||''''), '0');
  perform pg_temp.rec(d, 'L10 admin Teste: papel do master', pg_temp.run_r(a1::uuid,'aal1','select count(*)::text from public.user_roles where user_id='''||mst||''''), '0');
  perform pg_temp.rec(d, 'L11 admin Teste: perfis do Pensar', pg_temp.run_r(a1::uuid,'aal1','select count(*)::text from public.profiles where school_id='''||pen||''''), '0');
  perform pg_temp.rec(d, 'L12 admin Teste: convites (só da Teste)', pg_temp.run_r(a1::uuid,'aal1','select count(*)::text from public.invitations where school_id is distinct from '''||tst||''''), '0');
  -- financeiro: só a si mesmo
  perform pg_temp.rec(d, 'L13 financeiro Pensar: perfis', pg_temp.run_r(pf1::uuid,'aal1','select count(*)::text from public.profiles'), '1');
  perform pg_temp.rec(d, 'L14 financeiro Pensar: papéis', pg_temp.run_r(pf1::uuid,'aal1','select count(*)::text from public.user_roles'), '1');
  perform pg_temp.rec(d, 'L15 financeiro Pensar: convites de outra escola', pg_temp.run_r(pf1::uuid,'aal1','select count(*)::text from public.invitations where school_id is distinct from '''||pen||''''), '0');
  -- master: vê tudo (inalterado)
  perform pg_temp.rec(d, 'L16 master: perfis', pg_temp.run_r(mst::uuid,'aal2','select count(*)::text from public.profiles'), (select count(*)::text from public.profiles));
  perform pg_temp.rec(d, 'L17 master: papéis', pg_temp.run_r(mst::uuid,'aal2','select count(*)::text from public.user_roles'), (select count(*)::text from public.user_roles));
  perform pg_temp.rec(d, 'L18 master: convites', pg_temp.run_r(mst::uuid,'aal2','select count(*)::text from public.invitations'), (select count(*)::text from public.invitations));

  -- ===== ESCRITAS =====
  -- não promover a master nem editar/remover o master
  perform pg_temp.rec(d, 'E1 admin Teste: rebaixa o papel do master', pg_temp.run_w(a1::uuid,'aal1','update public.user_roles set role=''financial'' where user_id='''||mst||''''), 'BLOQ');
  perform pg_temp.rec(d, 'E2 admin Teste: remove o papel do master', pg_temp.run_w(a1::uuid,'aal1','delete from public.user_roles where user_id='''||mst||''''), 'BLOQ');
  perform pg_temp.rec(d, 'E3 admin Teste: altera is_master_admin do próprio perfil', pg_temp.run_w(a1::uuid,'aal1','update public.profiles set is_master_admin=true where user_id='''||a1||''''), 'BLOQ');
  perform pg_temp.rec(d, 'E4 admin Teste: altera is_master_admin do perfil do colega', pg_temp.run_w(a1::uuid,'aal1','update public.profiles set is_master_admin=true where user_id='''||a2||''''), 'BLOQ');
  perform pg_temp.rec(d, 'E5 admin Teste: edita o perfil do master', pg_temp.run_w(a1::uuid,'aal1','update public.profiles set full_name=''x'' where user_id='''||mst||''''), 'BLOQ');
  perform pg_temp.rec(d, 'E6 admin Teste: remove o perfil do master', pg_temp.run_w(a1::uuid,'aal1','delete from public.profiles where user_id='''||mst||''''), 'BLOQ');
  -- outra escola: não alterar nem remover
  perform pg_temp.rec(d, 'E7 admin Pensar: rebaixa admin da Teste', pg_temp.run_w(pa::uuid,'aal1','update public.user_roles set role=''financial'' where user_id='''||a1||''''), 'BLOQ');
  perform pg_temp.rec(d, 'E8 admin Pensar: remove papel de usuário da Teste', pg_temp.run_w(pa::uuid,'aal1','delete from public.user_roles where user_id='''||a1||''''), 'BLOQ');
  perform pg_temp.rec(d, 'E9 admin Pensar: edita perfil da Teste', pg_temp.run_w(pa::uuid,'aal1','update public.profiles set full_name=''x'' where school_id='''||tst||''''), 'BLOQ');
  perform pg_temp.rec(d, 'E10 admin Pensar: remove perfil da Teste', pg_temp.run_w(pa::uuid,'aal1','delete from public.profiles where school_id='''||tst||''''), 'BLOQ');
  perform pg_temp.rec(d, 'E11 admin Pensar: altera convite da Teste (bloqueado: a policy de UPDATE consulta auth.users)', pg_temp.run_w(pa::uuid,'aal1','update public.invitations set status=''expired'' where school_id='''||tst||''''), 'ERR:42501');
  perform pg_temp.rec(d, 'E12 admin Pensar: remove convite da Teste', pg_temp.run_w(pa::uuid,'aal1','delete from public.invitations where school_id='''||tst||''''), 'BLOQ');
  perform pg_temp.rec(d, 'E13 admin Pensar: cria convite na Teste', pg_temp.run_w(pa::uuid,'aal1','insert into public.invitations (email, role, school_id, status) values (''z@z.com'',''admin'','''||tst||''',''pending'')'), 'ERR:42501');
  perform pg_temp.rec(d, 'E14 admin Pensar: altera o próprio school_id', pg_temp.run_w(pa::uuid,'aal1','update public.profiles set school_id='''||tst||''' where user_id='''||pa||''''), 'BLOQ');
  -- último admin
  perform pg_temp.rec(d, 'E15 único admin do Pensar: rebaixa a si mesmo', pg_temp.run_w(pa::uuid,'aal1','update public.user_roles set role=''financial'' where user_id='''||pa||''''), 'BLOQ');
  perform pg_temp.rec(d, 'E16 único admin do Pensar: remove o próprio papel', pg_temp.run_w(pa::uuid,'aal1','delete from public.user_roles where user_id='''||pa||''''), 'BLOQ');
  -- financeiro não escreve em papéis
  perform pg_temp.rec(d, 'E17 financeiro: altera o próprio papel para admin', pg_temp.run_w(pf1::uuid,'aal1','update public.user_roles set role=''admin'' where user_id='''||pf1||''''), 'BLOQ');
  perform pg_temp.rec(d, 'E18 financeiro: rebaixa o colega', pg_temp.run_w(pf1::uuid,'aal1','update public.user_roles set role=''teacher'' where user_id='''||pf2||''''), 'BLOQ');
  perform pg_temp.rec(d, 'E19 financeiro: remove o admin', pg_temp.run_w(pf1::uuid,'aal1','delete from public.user_roles where user_id='''||pa||''''), 'BLOQ');
  -- permitido (o poder normal do admin): rebaixar um colega que NÃO é o último admin
  perform pg_temp.rec(d, 'E20 admin Teste: rebaixa o colega admin (permitido)', pg_temp.run_w(a1::uuid,'aal1','update public.user_roles set role=''financial'' where user_id='''||a2||''''), case when d = 'antes' then '0' else '1' end);
end $f$;

select pg_temp.matrix('antes');

-- @@MIGRATION@@

select pg_temp.matrix('depois');

-- ===== Cenários que exigem ajuste (como postgres, desfeito no ROLLBACK) =====
-- Escola exigindo 2FA: admin em aal1 sem fator nem carência só vê a si mesmo; em aal2 vê tudo.
-- sem usuário simulado (o trigger de require_2fa só deixa o contexto sem JWT mexer)
select set_config('request.jwt.claims', '', true);
update public.schools set require_2fa = true where id = (select v from t_p where k='pensar');
delete from public.mfa_grace where user_id = (select v from t_p where k='p_admin');
select pg_temp.rec('depois', 'F1 admin Pensar, escola exige 2FA, aal1 sem 2FA: perfis',
  pg_temp.run_r((select v from t_p where k='p_admin'),'aal1','select count(*)::text from public.profiles'), '1');
select pg_temp.rec('depois', 'F2 admin Pensar, escola exige 2FA, aal1 sem 2FA: papéis',
  pg_temp.run_r((select v from t_p where k='p_admin'),'aal1','select count(*)::text from public.user_roles'), '1');
select pg_temp.rec('depois', 'F3 admin Pensar, escola exige 2FA, aal2: perfis (controle)',
  pg_temp.run_r((select v from t_p where k='p_admin'),'aal2','select count(*)::text from public.profiles'), '3');

-- Owner protegido de outro admin: promove um financeiro a admin e tenta rebaixar/remover o owner.
select set_config('request.jwt.claims', '', true);
update public.schools set require_2fa = false where id = (select v from t_p where k='pensar');
update public.user_roles set role = 'admin' where user_id = (select v from t_p where k='p_fin1');
select pg_temp.rec('depois', 'E21 2º admin do Pensar rebaixa o OWNER',
  pg_temp.run_w((select v from t_p where k='p_fin1'),'aal1','update public.user_roles set role=''financial'' where user_id='''||(select v from t_p where k='p_admin')||''''), 'BLOQ');
select pg_temp.rec('depois', 'E22 2º admin do Pensar remove o papel do OWNER',
  pg_temp.run_w((select v from t_p where k='p_fin1'),'aal1','delete from public.user_roles where user_id='''||(select v from t_p where k='p_admin')||''''), 'BLOQ');

-- Função auxiliar: privilégios.
select pg_temp.rec('depois', 'P1 is_school_member: authenticated executa',
  has_function_privilege('authenticated','public.is_school_member(uuid)','execute')::text, 'true');
select pg_temp.rec('depois', 'P2 is_school_member: anon NÃO executa',
  has_function_privilege('anon','public.is_school_member(uuid)','execute')::text, 'false');
select pg_temp.rec('depois', 'P3 is_school_member: public NÃO executa',
  (not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.oid = 'public.is_school_member(uuid)'::regprocedure and a.grantee = 0))::text, 'true');
select pg_temp.rec('depois', 'P4 is_school_member: STABLE, SECURITY DEFINER, search_path fixo, retorna boolean',
  (select (provolatile = 's' and prosecdef and proconfig::text like '%search_path%' and prorettype = 'boolean'::regtype)::text
     from pg_proc where oid = 'public.is_school_member(uuid)'::regprocedure), 'true');

select n, fase, cenario, got, esperado, ok from t_res order by fase desc, n;

rollback;
