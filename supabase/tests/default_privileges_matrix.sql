-- Matriz das permissões padrão de funções novas (migration 20261128110000). Tudo em BEGIN ... ROLLBACK.
-- Para rodar antes de aplicar: gerar arquivo trocando a linha marcadora DP pelo conteúdo da migration e a
-- linha marcadora DPREV pelo conteúdo de docs/db/reversao_default_privileges_funcoes.sql. Com a migration aplicada, tirar as marcadoras.
begin;
create temp table t_res (n serial, fase text, cenario text, got text, esperado text, ok boolean);
create function pg_temp.rec(p_fase text, p_cenario text, p_got text, p_esperado text) returns void language sql as $f$
  insert into t_res (fase, cenario, got, esperado, ok) values (p_fase, p_cenario, p_got, p_esperado, p_got = p_esperado)
$f$;
create temp table t_base as
  select p.oid, p.proname, has_function_privilege('anon', p.oid, 'execute') anon_exec, has_function_privilege('authenticated', p.oid, 'execute') auth_exec
    from pg_proc p where p.pronamespace = 'public'::regnamespace;

-- @@DP@@

create function public._probe_default_priv() returns int language sql as $f$ select 1 $f$;
select pg_temp.rec('depois', 'D1 função nova: anon NÃO executa', has_function_privilege('anon', 'public._probe_default_priv()', 'execute')::text, 'false');
select pg_temp.rec('depois', 'D2 função nova: public NÃO executa', (not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = 'public._probe_default_priv()'::regprocedure and a.grantee = 0))::text, 'true');
select pg_temp.rec('depois', 'D3 função nova: authenticated executa', has_function_privilege('authenticated', 'public._probe_default_priv()', 'execute')::text, 'true');
select pg_temp.rec('depois', 'D4 função nova: service_role executa', has_function_privilege('service_role', 'public._probe_default_priv()', 'execute')::text, 'true');
select pg_temp.rec('depois', 'D5 as 3 funções de RLS continuam executáveis por anon',
  (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('get_current_user_role','get_user_school_id','is_master_admin') and has_function_privilege('anon', p.oid, 'execute')), '3');
select pg_temp.rec('depois', 'D6 funções já existentes: nenhuma mudou de permissão',
  (select count(*)::text from t_base b where has_function_privilege('anon', b.oid, 'execute') is distinct from b.anon_exec or has_function_privilege('authenticated', b.oid, 'execute') is distinct from b.auth_exec), '0');
drop function public._probe_default_priv();

-- @@DPREV@@
create function public._probe_default_priv2() returns int language sql as $f$ select 1 $f$;
select pg_temp.rec('reversao', 'V1 após a reversão: função nova volta a ser executável por anon', has_function_privilege('anon', 'public._probe_default_priv2()', 'execute')::text, 'true');
select pg_temp.rec('reversao', 'V2 após a reversão: public volta a executar', (exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = 'public._probe_default_priv2()'::regprocedure and a.grantee = 0))::text, 'true');
drop function public._probe_default_priv2();

select n, fase, cenario, got, esperado, ok from t_res order by case fase when 'depois' then 1 else 2 end, n;
rollback;
