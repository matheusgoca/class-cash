// Bolsista integral, desconto 100% (S6b, bloco H).
// A mensalidade de um contrato com final_amount = 0 nasce RESOLVIDA no servidor (trigger tuitions_apply_scholarship,
// migration 20261126110000): status 'paid', payment_method 'bolsa', final_amount 0, paid_date = due_date.
// Como é 'paid' ela sai sozinha da inadimplência, dos avisos e das ações de baixa; o que o front precisa é
// identificá-la para (1) não contá-la como "paga" nem nas taxas e (2) mostrar o selo "Bolsa 100%" e o contador de bolsistas.

/** Forma de pagamento que marca a mensalidade de bolsa 100%; o estorno também a bloqueia (bloco D). */
export const SCHOLARSHIP_METHOD = 'bolsa';
export const SCHOLARSHIP_LABEL = 'Bolsa 100%';

export function isScholarshipTuition(t: { payment_method?: string | null }): boolean {
  return (t.payment_method ?? '').trim().toLowerCase() === SCHOLARSHIP_METHOD;
}
