-- Estorno de baixa e trava de baixa dupla (S6b, bloco D; ensaio geral de 25/11/2026).
--
-- Antes: a tela não oferecia como desfazer uma baixa errada, e o banco aceitava "pagar" de novo uma mensalidade já paga
-- (sobrescrevia paid_date e valor). Agora:
--  1. Trigger tuitions_guard_payment (BEFORE UPDATE):
--       - paga -> paga com paid_date, final_amount, payment_method ou amount diferentes: ALREADY_PAID (22023);
--       - paga -> pending/overdue: USE_REVERSAL (22023), a não ser pelo RPC reverse_tuition_payment.
--     Escape para correção administrativa por script: set_config('app.allow_paid_edit', 'on', true) na mesma transação.
--     Não bloqueia paga -> cancelada nem nenhuma mudança que não envolva a baixa.
--  2. RPC reverse_tuition_payment(p_school_id, p_tuition_id): volta a mensalidade paga para pending e limpa paid_date,
--     final_amount e payment_method. Só admin e financeiro da escola (ou master). Nega mensalidade não paga, cancelada ou de bolsa
--     (payment_method = 'bolsa', bloco H). A auditoria (trigger genérica) guarda o old_data.
-- Nada de dados é alterado pela migration. discount_applied e penalty_amount são preservados no estorno.

create or replace function public.tuitions_guard_payment()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'paid' and new.status = 'paid'
     and (new.paid_date is distinct from old.paid_date
          or new.final_amount is distinct from old.final_amount
          or new.payment_method is distinct from old.payment_method
          or new.amount is distinct from old.amount)
     and coalesce(current_setting('app.allow_paid_edit', true), '') <> 'on' then
    raise exception 'ALREADY_PAID' using errcode = '22023',
      detail = 'Esta mensalidade já está paga. Estorne a baixa antes de registrar outra.';
  end if;

  if old.status = 'paid' and new.status in ('pending', 'overdue')
     and coalesce(current_setting('app.tuition_reversal', true), '') <> 'on' then
    raise exception 'USE_REVERSAL' using errcode = '22023',
      detail = 'Para reabrir uma mensalidade paga use o estorno de baixa.';
  end if;

  return new;
end;
$$;

drop trigger if exists tuitions_guard_payment on public.tuitions;
create trigger tuitions_guard_payment
  before update on public.tuitions
  for each row execute function public.tuitions_guard_payment();

create or replace function public.reverse_tuition_payment(p_school_id uuid, p_tuition_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tuitions%rowtype;
  v_allowed boolean;
begin
  perform public.assert_mfa_gate();

  select
    (p_school_id = public.get_user_school_id() and public.get_current_user_role() in ('admin', 'financial'))
    or public.is_master_admin()
  into v_allowed;
  if not coalesce(v_allowed, false) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  -- Trava a linha: dois estornos simultâneos da mesma mensalidade se serializam aqui.
  select * into t from public.tuitions where id = p_tuition_id and school_id = p_school_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = '22023';
  end if;
  if t.status <> 'paid' then
    raise exception 'NOT_PAID' using errcode = '22023';
  end if;
  if t.payment_method = 'bolsa' then
    raise exception 'SCHOLARSHIP_LOCKED' using errcode = '22023';
  end if;

  perform set_config('app.tuition_reversal', 'on', true);
  update public.tuitions
     set status = 'pending', paid_date = null, final_amount = null, payment_method = null
   where id = t.id and school_id = p_school_id;
  perform set_config('app.tuition_reversal', '', true);

  return jsonb_build_object(
    'id', t.id,
    'previous_paid_date', t.paid_date,
    'previous_final_amount', t.final_amount,
    'previous_payment_method', t.payment_method
  );
end;
$$;

revoke all on function public.reverse_tuition_payment(uuid, uuid) from public, anon;
grant execute on function public.reverse_tuition_payment(uuid, uuid) to authenticated;

comment on function public.reverse_tuition_payment(uuid, uuid) is
  'Estorna a baixa de uma mensalidade paga: volta a pending e limpa paid_date, final_amount e payment_method. Admin e financeiro da escola (ou master). Nega não paga, cancelada e bolsa.';
