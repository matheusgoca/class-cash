-- Fase 2 da Sprint S1 (docs/PLANO_SPRINTS_NOV2026.md, seção 4): base de logs
-- de alteração. Append-only — nenhuma policy de UPDATE/DELETE é criada
-- abaixo, e RLS nega por padrão qualquer operação sem policy, então a tabela
-- fica imutável mesmo para quem tem acesso de SELECT.

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  -- NULL quando a tabela afetada não tem conceito de escola própria no
  -- registro (ex: user_roles de um owner, antes de resolvido via profiles) —
  -- nesses casos a linha só aparece para o master admin.
  school_id uuid references public.schools(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_role text,
  -- true quando quem fez a ação é master admin atuando em uma escola que
  -- não é a própria (ver audit_trigger_fn).
  is_master_action boolean not null default false,
  table_name text not null,
  record_id uuid,
  action text not null check (action in ('insert', 'update', 'delete')),
  changed_fields text[],
  old_data jsonb,
  new_data jsonb,
  -- 'manual' (padrão): ação direta de um usuário na tela.
  -- 'generated': lançamento mensal de mensalidade/despesa recorrente.
  -- 'import': linha criada pela importação de planilha.
  source text not null default 'manual' check (source in ('manual', 'generated', 'import')),
  created_at timestamptz not null default now()
);

create index audit_logs_school_created_idx on public.audit_logs (school_id, created_at desc);
create index audit_logs_table_record_idx on public.audit_logs (table_name, record_id);

alter table public.audit_logs enable row level security;

-- Owner/admin da própria escola veem só seus logs; master admin vê tudo
-- (a tela de histórico filtra por escola — essa policy só controla acesso).
create policy audit_logs_select on public.audit_logs
  for select
  using (
    (school_id = public.get_user_school_id() and public.get_current_user_role() = any (array['owner', 'admin']))
    or public.is_master_admin()
  );

comment on table public.audit_logs is
  'Log append-only de insert/update/delete nas tabelas financeiras e de gestão. Populado só pela trigger audit_trigger_fn (SECURITY DEFINER) — nunca por INSERT direto do client.';
