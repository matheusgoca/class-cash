-- ================================================================
-- Rastreio de rematrícula: liga um contrato renovado ao contrato
-- anterior, pra dar pra saber quem já rematriculou sem precisar
-- adivinhar por datas.
-- ================================================================

ALTER TABLE public.contracts
  ADD COLUMN renewed_from_id uuid REFERENCES public.contracts(id);

CREATE INDEX ON public.contracts (renewed_from_id);
