-- supabase/migrations/20261119130100_email_outbox.sql
-- S4a: fila de e-mails por evento. Uma linha por usuário × escola × evento × dia.
-- SEM FK para notifications: o aviso de atraso é substituído todo dia e o histórico
-- de envio não pode sumir junto. Escrita só pelos RPCs (service_role); sem policies de escrita.

create table if not exists public.email_outbox (
  id                  uuid primary key default gen_random_uuid(),
  school_id           uuid not null references public.schools(id) on delete cascade,
  user_id             uuid not null references auth.users(id)     on delete cascade,
  event               text not null
                      check (event in ('tuition_due','tuition_overdue','renegotiation_installment','expense_due','reenrollment')),
  reference_date      date not null,
  status              text not null check (status in ('sending','sent','failed')),
  attempts            integer not null default 0,
  last_error          text,
  provider_message_id text,
  sent_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint email_outbox_user_school_event_day_key unique (user_id, school_id, event, reference_date)
);
create index if not exists idx_email_outbox_status_updated on public.email_outbox (status, updated_at);

drop trigger if exists update_email_outbox_updated_at on public.email_outbox;
create trigger update_email_outbox_updated_at
  before update on public.email_outbox
  for each row execute function public.set_updated_at();

alter table public.email_outbox enable row level security;

drop policy if exists email_outbox_select on public.email_outbox;
create policy email_outbox_select on public.email_outbox
  for select to authenticated
  using ((user_id = auth.uid() and school_id = public.get_user_school_id()) or public.is_master_admin());

drop policy if exists mfa_gate on public.email_outbox;
create policy mfa_gate on public.email_outbox as restrictive for all to authenticated
  using ((select public.mfa_gate_ok())) with check ((select public.mfa_gate_ok()));
