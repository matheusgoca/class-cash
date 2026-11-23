-- Endurecimento: anon e authenticated deixam de ter TRUNCATE nas tabelas do schema public.
--
-- Por quê: é o padrão de grants do Supabase (todas as tabelas nascem com TRUNCATE para
-- anon/authenticated). Hoje não é explorável — esses papéis só chegam ao banco pelo
-- PostgREST, que não expõe TRUNCATE —, mas o RLS não cobre TRUNCATE, então o grant é
-- uma porta aberta caso algum dia exista outro caminho (ex.: uma função SECURITY INVOKER
-- que execute SQL dinâmico).
--
-- Diagnóstico em produção (2026-11-23, leitura):
--   * 26 tabelas do public com TRUNCATE para anon e para authenticated.
--   * Nenhuma função do public usa TRUNCATE; as 35 SECURITY DEFINER rodam como postgres
--     (dono das tabelas), não dependem de grant de anon/authenticated.
--   * Único trigger de TRUNCATE no banco: cron.job (fora do public).
--   * PostgREST não tem operação que gere TRUNCATE.
--
-- Escopo: só TRUNCATE. Os demais grants (SELECT/INSERT/UPDATE/DELETE/...) continuam,
-- porque o PostgREST depende deles e o RLS é quem limita as linhas.

revoke truncate on all tables in schema public from anon, authenticated;

-- Tabelas futuras criadas pelas migrations (dono: postgres) não recebem mais TRUNCATE.
-- As criadas por supabase_admin (raras, fora das nossas migrations) mantêm o padrão do
-- Supabase: postgres não pode alterar os default privileges de supabase_admin.
alter default privileges for role postgres in schema public
  revoke truncate on tables from anon, authenticated;
