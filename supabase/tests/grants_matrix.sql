-- Grants de anon/authenticated no schema public (endurecimento de 2026-11-23).
-- Tudo dentro de BEGIN ... ROLLBACK: nada persiste. NUNCA remova o "rollback;" do final.
--
-- Como rodar:
--   Migration já aplicada:  npx supabase@2.117.0 db query --linked -f supabase/tests/grants_matrix.sql
--   Migration NÃO aplicada: gerar um arquivo que troca a linha marcadora MIGRATION (abaixo, sozinha
--     na linha) pelo conteúdo de supabase/migrations/20261123130000_revoke_truncate_anon_authenticated.sql.
-- Saída: uma linha por verificação; "ok" deve ser true em TODAS.

begin;

-- @@MIGRATION@@

create temp table t_res (n serial, cenario text, got text, esperado text);

insert into t_res (cenario, got, esperado)
select 'nenhuma tabela do public com TRUNCATE para anon', count(*)::text, '0'
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee = 'anon' and privilege_type = 'TRUNCATE'
union all
select 'nenhuma tabela do public com TRUNCATE para authenticated', count(*)::text, '0'
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee = 'authenticated' and privilege_type = 'TRUNCATE'
union all
-- o PostgREST depende destes; o RLS limita as linhas
select 'authenticated mantém SELECT/INSERT/UPDATE/DELETE onde tinha',
       (count(*) filter (where privilege_type = 'SELECT') > 0
        and count(*) filter (where privilege_type in ('INSERT', 'UPDATE', 'DELETE')) > 0)::text, 'true'
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee = 'authenticated';

-- tabela nova criada por migration (dono postgres) não herda TRUNCATE
create table public._probe_grants (id int);
insert into t_res (cenario, got, esperado)
select 'tabela nova: sem TRUNCATE para anon',          has_table_privilege('anon', 'public._probe_grants', 'TRUNCATE')::text, 'false'
union all
select 'tabela nova: sem TRUNCATE para authenticated', has_table_privilege('authenticated', 'public._probe_grants', 'TRUNCATE')::text, 'false'
union all
select 'tabela nova: SELECT para authenticated',       has_table_privilege('authenticated', 'public._probe_grants', 'SELECT')::text, 'true';

select n, cenario, got, esperado, got = esperado as ok from t_res order by n;

rollback;
