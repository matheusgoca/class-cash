-- supabase/migrations/20261119140000_renewal_decisions.sql
-- S4c: decisão da família por contrato em fim de ciclo. Spec: docs/superpowers/specs/2026-11-19-s4c-rematricula-design.md (R3, R4, R9).
-- "Sem resposta" = ausência de linha; "Renovado" é derivado (contrato sucessor) e nunca gravado.
-- Escrita só pelo RPC set_renewal_decision; sem policies de escrita.

create table if not exists public.renewal_decisions (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id)   on delete cascade,
  contract_id uuid not null references public.contracts(id) on delete cascade,
  status      text not null check (status in ('contacted', 'will_renew', 'will_not_renew')),
  reason      text check (reason in ('moved_city', 'price', 'changed_school', 'other')),
  note        text check (note is null or char_length(note) <= 500),
  decided_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint renewal_decisions_contract_key unique (contract_id),
  -- Motivo obrigatório se, e só se, a família não vai renovar.
  constraint renewal_decisions_reason_iff_declined check ((status = 'will_not_renew') = (reason is not null))
);
create index if not exists idx_renewal_decisions_school on public.renewal_decisions (school_id);

drop trigger if exists update_renewal_decisions_updated_at on public.renewal_decisions;
create trigger update_renewal_decisions_updated_at
  before update on public.renewal_decisions
  for each row execute function public.set_updated_at();

alter table public.renewal_decisions enable row level security;

drop policy if exists renewal_decisions_select on public.renewal_decisions;
create policy renewal_decisions_select on public.renewal_decisions
  for select to authenticated
  using ((school_id = public.get_user_school_id() and coalesce(public.get_current_user_role() in ('admin', 'financial'), false))
         or coalesce(public.is_master_admin(), false));

drop policy if exists mfa_gate on public.renewal_decisions;
create policy mfa_gate on public.renewal_decisions as restrictive for all to authenticated
  using ((select public.mfa_gate_ok())) with check ((select public.mfa_gate_ok()));

drop trigger if exists audit_trigger on public.renewal_decisions;
create trigger audit_trigger after insert or update or delete on public.renewal_decisions
  for each row execute function public.audit_trigger_fn();
