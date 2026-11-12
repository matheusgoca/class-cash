-- Item H da auditoria financeira (docs/PLANO_SPRINTS_NOV2026.md, seção 1):
-- mensalidades "pending" cujo due_date já passou continuam "pending" no
-- banco até alguém editar o registro manualmente. Qualquer relatório ou
-- futura notificação que filtre por status='overdue' direto no banco perde
-- essas parcelas — hoje só o front-end (isTuitionOverdue) reclassifica na
-- tela. Este job promove o status no banco todo dia, então status='overdue'
-- passa a ser confiável como fonte de verdade; isTuitionOverdue continua
-- como segurança no front (cobre o intervalo entre execuções do job e
-- qualquer falha do cron).

create extension if not exists pg_cron;

create or replace function public.promote_overdue_tuitions()
returns void
language sql
security definer
set search_path = public
as $$
  update public.tuitions
  set status = 'overdue'
  where status = 'pending'
    and due_date < current_date;
$$;

comment on function public.promote_overdue_tuitions() is
  'Promove tuitions.status de pending para overdue quando due_date já passou. Rodado diariamente via pg_cron (ver cron.job "promote-overdue-tuitions").';

-- 03:00 UTC = 00:00 em Brasília (UTC-3, sem DST hoje) — baixa atividade,
-- fora da janela 1h-3h problemática para fusos que ainda observam DST.
-- unschedule antes de schedule: idempotente se a migration for reaplicada.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'promote-overdue-tuitions') then
    perform cron.unschedule('promote-overdue-tuitions');
  end if;
end $$;

select cron.schedule(
  'promote-overdue-tuitions',
  '0 3 * * *',
  $$ select public.promote_overdue_tuitions(); $$
);
