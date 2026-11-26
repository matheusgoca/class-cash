-- Bolsista integral (desconto 100%) (S6b, bloco H; ensaio geral de 25/11/2026).
--
-- Regra: uma mensalidade de contrato cujo final_amount é 0 (desconto 100%, valor de tabela preservado em monthly_amount)
-- nasce RESOLVIDA: status 'paid', payment_method 'bolsa', final_amount 0 e paid_date = due_date (inclusive em mês futuro).
-- Sem status novo ('isenta'): como a mensalidade nasce paga, ela sai sozinha da inadimplência, dos avisos (o gerador só lê
-- pending/overdue), da lista de abertas e das ações de baixa. O estorno já bloqueia payment_method = 'bolsa' (bloco D).
--
-- A regra vive em UM trigger BEFORE INSERT, então vale para todos os caminhos que criam mensalidade: gerador
-- (insert_generated_tuitions), matrícula, renovação em lote (renew_contracts), importação de contratos (import_contract + geração)
-- e lançamento manual. Só atua quando amount = 0 e o contrato (da mesma escola) tem final_amount = 0.
-- Não altera dados existentes: o backfill é desnecessário (dry-run em 26/11: 0 contratos com 100% e 0 mensalidades de R$ 0 nas 3 escolas).

create or replace function public.tuitions_apply_scholarship()
returns trigger
language plpgsql
as $$
begin
  if new.contract_id is not null
     and new.status in ('pending', 'overdue')
     and new.amount = 0
     and exists (select 1 from public.contracts c
                  where c.id = new.contract_id and c.school_id = new.school_id and c.final_amount = 0) then
    new.status := 'paid';
    new.payment_method := 'bolsa';
    new.final_amount := 0;
    new.paid_date := new.due_date;
  end if;
  return new;
end;
$$;

drop trigger if exists tuitions_apply_scholarship on public.tuitions;
create trigger tuitions_apply_scholarship
  before insert on public.tuitions
  for each row execute function public.tuitions_apply_scholarship();

comment on function public.tuitions_apply_scholarship() is
  'Mensalidade de contrato com final_amount = 0 (bolsa 100%) nasce paid, payment_method bolsa, final_amount 0, paid_date = due_date.';
