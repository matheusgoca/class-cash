-- ================================================================
-- Renegociação de mensalidades atômica (RPC), substituindo os 3
-- passos sequenciais feitos direto do client (inserir renegociação →
-- cancelar mensalidades atrasadas → inserir novas parcelas), que
-- podiam ficar pela metade se o 3º passo falhasse depois do 2º ter
-- sucesso — a dívida do aluno sumia sem cobrança nenhuma no lugar.
--
-- Também corrige: reconfirma que as mensalidades ainda estão
-- pending/overdue (FOR UPDATE) antes de cancelar — se a família pagou
-- em outra aba enquanto o modal estava aberto, a chamada agora falha
-- em vez de sobrescrever o pagamento; e só atribui as parcelas novas a
-- um contract_id quando todas as mensalidades atrasadas pertencem ao
-- MESMO contrato, em vez de sempre usar a primeira arbitrariamente.
-- ================================================================

CREATE FUNCTION public.renegotiate_tuitions(
  p_student_id uuid,
  p_school_id uuid,
  p_tuition_ids uuid[],
  p_new_installment_amount numeric,
  p_installments integer,
  p_first_due_date date,
  p_notes text,
  p_created_by uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowed boolean;
  v_renegotiation_id uuid;
  v_original_amount numeric;
  v_contract_id uuid;
  v_distinct_contracts integer;
  v_locked_count integer;
  i integer;
BEGIN
  SELECT
    p_school_id = public.get_user_school_id()
    AND public.get_current_user_role() IN ('admin', 'financial')
  INTO v_allowed;

  IF NOT COALESCE(v_allowed, false) THEN
    RAISE EXCEPTION 'Sem permissão para renegociar mensalidades desta escola';
  END IF;

  IF p_tuition_ids IS NULL OR array_length(p_tuition_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Nenhuma mensalidade selecionada';
  END IF;

  -- Trava e revalida as mensalidades — a lista do client pode estar
  -- desatualizada se um pagamento chegou enquanto o modal estava aberto.
  SELECT count(*), sum(COALESCE(final_amount, amount))
  INTO v_locked_count, v_original_amount
  FROM public.tuitions
  WHERE id = ANY(p_tuition_ids)
    AND student_id = p_student_id
    AND school_id = p_school_id
    AND status IN ('pending', 'overdue')
  FOR UPDATE;

  IF v_locked_count IS NULL OR v_locked_count <> array_length(p_tuition_ids, 1) THEN
    RAISE EXCEPTION 'Uma ou mais mensalidades já não estão mais pendentes/atrasadas — atualize a tela e tente novamente';
  END IF;

  SELECT count(DISTINCT contract_id) INTO v_distinct_contracts
  FROM public.tuitions WHERE id = ANY(p_tuition_ids);

  IF v_distinct_contracts = 1 THEN
    SELECT contract_id INTO v_contract_id FROM public.tuitions WHERE id = p_tuition_ids[1];
  ELSE
    v_contract_id := NULL;
  END IF;

  INSERT INTO public.renegotiations (
    student_id, school_id, original_amount, new_installment_amount,
    installments, total_renegotiated, first_due_date, notes, created_by
  ) VALUES (
    p_student_id, p_school_id, v_original_amount, p_new_installment_amount,
    p_installments, p_new_installment_amount * p_installments, p_first_due_date, p_notes, p_created_by
  )
  RETURNING id INTO v_renegotiation_id;

  UPDATE public.tuitions
  SET status = 'cancelled', renegotiation_id = v_renegotiation_id
  WHERE id = ANY(p_tuition_ids);

  FOR i IN 0..(p_installments - 1) LOOP
    INSERT INTO public.tuitions (
      student_id, school_id, contract_id, amount, final_amount, due_date,
      status, description, renegotiation_id, category, discount_applied, penalty_amount
    ) VALUES (
      p_student_id, p_school_id, v_contract_id, p_new_installment_amount, p_new_installment_amount,
      (p_first_due_date + (i::text || ' months')::interval)::date,
      'pending',
      'Parcela renegociada ' || (i + 1) || '/' || p_installments,
      v_renegotiation_id, 'tuition', 0, 0
    );
  END LOOP;

  RETURN v_renegotiation_id;
END;
$$;
