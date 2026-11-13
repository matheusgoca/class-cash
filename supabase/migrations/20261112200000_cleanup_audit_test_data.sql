-- Limpeza de dados de teste gerados durante a validação manual da Fase 2
-- (audit_logs) nesta sprint — não é mudança de schema. Remove as despesas
-- de teste criadas em "Colégio Estrela" (description começa com
-- '[TESTE audit_logs'), e desativa a despesa recorrente que as gerou para
-- não continuar lançando novos meses.

update public.recurring_expenses
set end_date = current_date
where description like '[TESTE audit_logs%';

delete from public.expenses
where description like '[TESTE audit_logs%';
