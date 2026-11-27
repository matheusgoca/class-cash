-- Permissões padrão de funções novas no schema public (criadas pelo role postgres): sem EXECUTE para public e anon;
-- authenticated e service_role continuam recebendo EXECUTE. Não altera funções já existentes.
-- Quem precisar de uma função chamável por anon concede explicitamente na migration que a cria.
-- Reversão: docs/db/reversao_default_privileges_funcoes.sql
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
