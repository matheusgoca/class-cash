-- ================================================================
-- Novo tipo de serviço: 'anual_parcelado' — cobre apostila/material/
-- anuidade: valor anual fechado dividido em N parcelas mensais fixas,
-- diferente de 'avulso' (cobrança única) e 'mensal' (recorrente
-- indefinido). `price` continua sendo o valor de CADA parcela (mesmo
-- significado de sempre); `installments` é só a quantidade de vezes.
--
-- default_installments no catálogo é o mesmo padrão que já existe pra
-- `price`: um valor sugerido que é copiado pra student_services na
-- assinatura, mas pode ser sobrescrito por aluno.
-- ================================================================

ALTER TABLE public.school_services
  DROP CONSTRAINT school_services_type_check;

ALTER TABLE public.school_services
  ADD CONSTRAINT school_services_type_check
  CHECK (type IN ('avulso', 'mensal', 'anual_parcelado'));

ALTER TABLE public.school_services
  ADD COLUMN default_installments integer CHECK (default_installments IS NULL OR default_installments > 0);

ALTER TABLE public.student_services
  ADD COLUMN installments integer CHECK (installments IS NULL OR installments > 0);
