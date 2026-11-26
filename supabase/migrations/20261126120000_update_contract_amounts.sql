-- Propagar a edição de valor do contrato para as mensalidades (S6b, bloco B; ensaio geral de 25/11/2026).
--
-- Antes: editar monthly_amount ou discount de um contrato recalculava final_amount (coluna gerada), mas as mensalidades já
-- geradas ficavam com o valor antigo, em silêncio. Editar contrato é CORREÇÃO DE CADASTRO (reajuste é pela renovação).
-- Agora o RPC update_contract_amounts altera valor e/ou desconto e propaga, de forma atômica, para as mensalidades ABERTAS.
--
-- Elegíveis (mudam): mensalidades do contrato, da escola, com status pending ou overdue (status separado no banco; uma pending
-- já vencida que o job ainda não promoveu conta como vencida), NÃO renegociadas e cujo valor (amount) ainda é igual ao
-- final_amount ANTIGO do contrato (ajuste manual é preservado). Não se restringe a vencimento futuro.
-- Nunca tocadas: pagas de verdade, canceladas, renegociadas, ajustadas manualmente.
-- Bolsa 100% (bloco H, trigger tuitions_apply_scholarship): desconto ENTRANDO em 100% => as elegíveis viram bolsa
-- (paid / 'bolsa' / final 0 / paid_date = due_date); SAINDO de 100% => as mensalidades de bolsa do contrato reabrem com o novo valor
-- (pending se a vencer, overdue se já vencida). Mensalidade realmente paga nunca é reaberta.
-- p_dry_run = true devolve as contagens sem gravar nada (alimenta o aviso "X a vencer, Y vencidas, Z não alteradas").
-- Só admin e financeiro da escola (ou master), assert_mfa_gate primeiro, auditoria pela trigger genérica (old_data).
-- Teto de monthly_amount: o mesmo do lote de renovação (R$ 30.000); MANTER IGUAL a MAX_MONTHLY_AMOUNT em src/lib/renewal.ts.

create or replace function public.update_contract_amounts(
  p_school_id uuid,
  p_contract_id uuid,
  p_monthly_amount numeric default null,
  p_discount numeric default null,
  p_dry_run boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_max_monthly constant numeric := 30000;
  c public.contracts%rowtype;
  v_allowed boolean;
  v_m numeric; v_d numeric; v_old numeric; v_new numeric;
  n_up int := 0; n_ov int := 0; n_re_up int := 0; n_re_ov int := 0;
  n_adj int; n_reneg int; n_paid int; n_canc int;
  n_to_bolsa int := 0;
begin
  perform public.assert_mfa_gate();

  select
    (p_school_id = public.get_user_school_id() and public.get_current_user_role() in ('admin', 'financial'))
    or public.is_master_admin()
  into v_allowed;
  if not coalesce(v_allowed, false) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  -- Trava o contrato: duas edições simultâneas do mesmo contrato se serializam aqui.
  select * into c from public.contracts where id = p_contract_id and school_id = p_school_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = '22023';
  end if;

  v_m := coalesce(p_monthly_amount, c.monthly_amount);
  v_d := coalesce(p_discount, c.discount);
  if v_m is null or v_m <= 0 or v_m > c_max_monthly then
    raise exception 'INVALID_AMOUNT' using errcode = '22023';
  end if;
  if v_d is null or v_d < 0 or v_d > 100 then
    raise exception 'INVALID_DISCOUNT' using errcode = '22023';
  end if;

  v_old := c.final_amount;
  v_new := round(v_m * (1::numeric - v_d / 100::numeric), 2);

  -- Contagens do que NÃO muda (para o aviso), sempre calculadas sobre o estado atual
  select count(*) filter (where t.status in ('pending', 'overdue') and t.renegotiation_id is null and t.amount <> v_old),
         count(*) filter (where t.status in ('pending', 'overdue') and t.renegotiation_id is not null),
         count(*) filter (where t.status = 'paid' and coalesce(t.payment_method, '') <> 'bolsa'),
         count(*) filter (where t.status = 'cancelled')
    into n_adj, n_reneg, n_paid, n_canc
    from public.tuitions t where t.contract_id = c.id and t.school_id = p_school_id;

  if v_new <> v_old then
    if v_old > 0 then
      -- elegíveis: abertas, não renegociadas, com valor ainda igual ao final_amount antigo
      select count(*) filter (where t.due_date >= current_date), count(*) filter (where t.due_date < current_date)
        into n_up, n_ov
        from public.tuitions t
       where t.contract_id = c.id and t.school_id = p_school_id
         and t.status in ('pending', 'overdue') and t.renegotiation_id is null and t.amount = v_old;
      if v_new = 0 then n_to_bolsa := n_up + n_ov; end if;
    else
      -- saindo de 100%: as de bolsa reabrem com o novo valor
      select count(*) filter (where t.due_date >= current_date), count(*) filter (where t.due_date < current_date)
        into n_re_up, n_re_ov
        from public.tuitions t
       where t.contract_id = c.id and t.school_id = p_school_id and t.status = 'paid' and t.payment_method = 'bolsa';
    end if;
  end if;

  if not p_dry_run and (v_m <> c.monthly_amount or v_d <> c.discount) then
    update public.contracts set monthly_amount = v_m, discount = v_d where id = c.id and school_id = p_school_id;

    if v_new <> v_old then
      if v_old > 0 and v_new = 0 then
        update public.tuitions
           set amount = 0, status = 'paid', payment_method = 'bolsa', final_amount = 0, paid_date = due_date
         where contract_id = c.id and school_id = p_school_id
           and status in ('pending', 'overdue') and renegotiation_id is null and amount = v_old;
      elsif v_old > 0 then
        update public.tuitions set amount = v_new
         where contract_id = c.id and school_id = p_school_id
           and status in ('pending', 'overdue') and renegotiation_id is null and amount = v_old;
      else
        perform set_config('app.tuition_reversal', 'on', true);
        update public.tuitions
           set amount = v_new, status = case when due_date < current_date then 'overdue' else 'pending' end,
               paid_date = null, final_amount = null, payment_method = null
         where contract_id = c.id and school_id = p_school_id and status = 'paid' and payment_method = 'bolsa';
        perform set_config('app.tuition_reversal', '', true);
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'old_final', v_old,
    'new_final', v_new,
    'changed', (v_m <> c.monthly_amount or v_d <> c.discount),
    'upcoming', n_up,
    'overdue', n_ov,
    'to_scholarship', n_to_bolsa,
    'reopened_upcoming', n_re_up,
    'reopened_overdue', n_re_ov,
    'updated', n_up + n_ov + n_re_up + n_re_ov,
    'unchanged', jsonb_build_object('adjusted', n_adj, 'renegotiated', n_reneg, 'paid', n_paid, 'cancelled', n_canc)
  );
end;
$$;

revoke all on function public.update_contract_amounts(uuid, uuid, numeric, numeric, boolean) from public, anon;
grant execute on function public.update_contract_amounts(uuid, uuid, numeric, numeric, boolean) to authenticated;

comment on function public.update_contract_amounts(uuid, uuid, numeric, numeric, boolean) is
  'Edita monthly_amount/discount do contrato e propaga para as mensalidades abertas (pending/overdue, não renegociadas, valor igual ao final_amount antigo). Bolsa 100% entra/sai. p_dry_run só conta.';
