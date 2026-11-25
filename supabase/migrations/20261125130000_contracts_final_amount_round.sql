-- supabase/migrations/20261125130000_contracts_final_amount_round.sql
-- Item I (opção A, regra R6): contracts.final_amount passa a ter 2 casas na origem. Spec:
-- docs/superpowers/specs/2026-11-25-item-i-contrato-fonte-unica-design.md
--
-- Hoje a coluna gerada é monthly_amount * (1 - discount/100) SEM round (ex.: 333,33 com 10% = 299,997), enquanto
-- tuitions.amount é numeric(10,2) (300,00). Aqui ela vira round(..., 2), no Postgres 17 (SET EXPRESSION).
--
-- GARANTIA "NENHUMA LINHA MUDA", atômica: o bloco abaixo (a) guarda contagem, soma e um hash linha a linha de
-- id:round(final_amount,2); (b) ABORTA se algum contrato tiver fração de centavo (arredondar mudaria um valor);
-- (c) troca a expressão; (d) recalcula e ABORTA se contagem, soma ou hash diferirem. Como é uma transação só,
-- qualquer aborto desfaz tudo e a expressão antiga continua valendo.
--
-- A coluna é STORED: o Postgres reescreve a tabela (ACCESS EXCLUSIVE por instantes; 327 linhas, 160 kB em 25/11).
-- Nada depende da coluna (sem índice, constraint, policy, view nem trigger além do audit_trigger_fn genérico).

do $$
declare
  v_n    bigint;
  v_sum  numeric;
  v_hash text;
  v_frac bigint;
  v_n2    bigint;
  v_sum2  numeric;
  v_hash2 text;
begin
  select count(*),
         coalesce(sum(final_amount), 0),
         md5(coalesce(string_agg(id::text || ':' || round(final_amount, 2)::text, ',' order by id), '')),
         count(*) filter (where final_amount <> round(final_amount, 2))
    into v_n, v_sum, v_hash, v_frac
    from public.contracts;

  if v_frac > 0 then
    raise exception 'ABORTADO: % contrato(s) com fração de centavo em final_amount; arredondar mudaria valores. Revise antes de aplicar.', v_frac
      using errcode = 'P0001';
  end if;

  alter table public.contracts
    alter column final_amount set expression as
      (round(monthly_amount * (1::numeric - coalesce(discount, 0::numeric) / 100::numeric), 2));

  select count(*),
         coalesce(sum(final_amount), 0),
         md5(coalesce(string_agg(id::text || ':' || final_amount::text, ',' order by id), ''))
    into v_n2, v_sum2, v_hash2
    from public.contracts;

  if v_n2 <> v_n or v_sum2 <> v_sum or v_hash2 <> v_hash then
    raise exception 'ABORTADO: o arredondamento alterou dados (contagem % -> %, soma % -> %, hash igual: %). Nada foi aplicado.',
      v_n, v_n2, v_sum, v_sum2, (v_hash2 = v_hash)
      using errcode = 'P0001';
  end if;

  raise notice 'final_amount arredondado: % contratos, soma % (idênticos antes e depois)', v_n2, v_sum2;
end $$;
