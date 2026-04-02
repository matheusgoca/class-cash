-- ============================================================
-- TABELA schools — preparada para multi-tenant (E2)
-- Se a tabela NÃO existe ainda: execute o bloco CREATE abaixo.
-- Se já existe com a coluna "segment" (TEXT): pule para MIGRATION.
-- ============================================================

-- ── Criação (primeira vez) ───────────────────────────────────
create table if not exists public.schools (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  segments      text[] default '{}',   -- ex: '{infantil,fundamental,medio}'
  logo_url      text,
  owner_user_id uuid references auth.users(id) on delete cascade,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index if not exists schools_owner_idx on public.schools(owner_user_id);

alter table public.schools enable row level security;

create policy "Dono pode ver sua escola"
  on public.schools for select
  using (owner_user_id = auth.uid());

create policy "Dono pode criar escola"
  on public.schools for insert
  with check (owner_user_id = auth.uid());

create policy "Dono pode atualizar escola"
  on public.schools for update
  using (owner_user_id = auth.uid());

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger schools_updated_at
  before update on public.schools
  for each row execute procedure public.set_updated_at();


-- ============================================================
-- MIGRATION — rode este bloco se a tabela JÁ EXISTE
-- com a coluna "segment" (TEXT) da versão anterior.
-- ============================================================
alter table public.schools
  add column if not exists segments text[] default '{}';

update public.schools
  set segments = array[segment]
  where segment is not null
    and (segments is null or segments = '{}');

alter table public.schools drop column if exists segment;


-- ============================================================
-- ADMIN MASTER — garante que seu usuário tenha role admin.
-- Substitua o e-mail se necessário e execute após a migration.
-- ============================================================
insert into public.user_roles (user_id, role)
select id, 'admin'
from auth.users
where email = 'matheusgoca@gmail.com'
  and not exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.users.id
      and ur.role = 'admin'
  );
