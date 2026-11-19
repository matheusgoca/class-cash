# S4c — Rematrícula, Etapa 1 (banco) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar no banco o acompanhamento da decisão da família (`renewal_decisions` + `set_renewal_decision`), a renovação em lote atômica (`renew_contracts`) e a atualização do aviso de rematrícula, tudo validado por matrizes SQL. Sem mudança de tela.

**Architecture:** Duas tabelas/RPCs novos no padrão dos RPCs existentes (`SECURITY DEFINER`, `assert_mfa_gate()`, permissão igual às policies de `contracts`, auditoria `generated` para o lote). O cliente (Etapa 2) calcula as mensalidades com a função pura; o servidor só valida e grava, em uma transação. O gerador de avisos ganha `declined_count` e deixa de avisar quando não há pendentes.

**Tech Stack:** Postgres/Supabase (migrations + matrizes em `BEGIN … ROLLBACK`), `npx supabase@2.117.0`.

**Spec:** `docs/superpowers/specs/2026-11-19-s4c-rematricula-design.md` (decisões R1–R9). Esta é a **Etapa 1**; o plano da Etapa 2 (interface) será escrito depois que esta estiver em produção e os tipos regenerados.

## Diagnóstico do schema real (feito em 2026-11-19, produção)

- `contracts`: colunas `id, student_id, class_id, monthly_amount, discount, start_date, end_date, status (default 'active', SEM CHECK), school_id, due_day (default 10), final_amount (GERADA: monthly_amount*(1-coalesce(discount,0)/100)), period (CHECK meio_periodo|integral), renewed_from_id (FK contracts), created_at, updated_at`. RLS: SELECT `school_id = get_user_school_id() or is_master_admin()`; INSERT/UPDATE/DELETE exigem `get_current_user_role() in ('admin','financial')` na escola, ou master; `master_admin_bypass_contracts`; RESTRICTIVE `mfa_gate`. Trigger só `audit_trigger`.
- `tuitions`: `id, student_id, contract_id, description, amount, due_date, paid_date, payment_method, status (default 'pending', SEM CHECK), category (default 'mensalidade'), discount_applied, penalty_amount, final_amount, school_id, renegotiation_id, …`; sem CHECK nem UNIQUE.
- `service_charges`: `school_id, service_id, student_id, description, amount (CHECK > 0), due_date, status (CHECK pending|paid|overdue|cancelled), …`. `school_services`: `price` (CHECK > 0), `type` (CHECK avulso|mensal|anual_parcelado), `active`, UNIQUE `(school_id, name)`.
- `get_current_user_role()` = `select role::text from user_roles where user_id = auth.uid() limit 1` (SECURITY DEFINER). Helpers existentes: `get_user_school_id()`, `assert_mfa_gate()`, `mfa_is_admin_or_owner(p_user, p_school)`, `is_master_admin()`, `public.set_updated_at()`.
- Auditoria: `audit_trigger_fn()` exige só as colunas `id` e `school_id` na linha; `audit_logs.table_name` é texto livre; liga-se com `create trigger audit_trigger after insert or update or delete on public.X for each row execute function public.audit_trigger_fn()`. A source vem de `current_setting('app.audit_source', true)` (default `manual`).
- **`enrollments` NÃO é tocada por esta entrega.** Só `import_enrollment` (importação) a escreve; a renovação individual de hoje também não mexe nela. Hoje as 325 matrículas ativas batem com as 527 linhas importadas. Promover alunos de turma no lote não atualiza `enrollments`: é o mesmo comportamento da renovação individual. **Ruling do plano:** manter assim e registrar no STATUS (a contagem por turma do Dashboard vem de `enrollments`).

## Rulings do plano (desvios deliberados da spec)

- **`renew_contracts` recebe `p_school_id`** (a spec dizia "escola do servidor"). Segue o padrão de `insert_generated_tuitions`: `p_school_id = get_user_school_id() and role in ('admin','financial')` **ou** `is_master_admin()`. Sem isso o master não renovaria numa escola que está visualizando. `set_renewal_decision` deduz a escola do próprio contrato e aplica a mesma regra. Custo se errado: nenhum funcional; é só a assinatura do RPC (ajustar a spec na Task 4).
- A decisão do serviço de taxa: precisa ser `type = 'avulso'`, `active` e da escola (como a tela atual lista).

## Global Constraints

- Textos de erro e docs em português; códigos de erro em maiúsculas (`NOT_ALLOWED`, `INVALID_CONTRACT`, …).
- `gen_random_uuid()` (nunca `uuid_generate_v4()`) e `public.set_updated_at()` (nunca `update_updated_at_column()`).
- Toda consulta filtra `school_id` explicitamente, mesmo em `SECURITY DEFINER`.
- RPCs: `SECURITY DEFINER`, `set search_path = public`, `perform public.assert_mfa_gate();` primeiro; `revoke all … from public, anon`; `grant execute … to authenticated`.
- O RPC de lote marca `select set_config('app.audit_source', 'generated'::text, true)` **antes** dos inserts, dentro da mesma transação (CLAUDE.md).
- As matrizes rodam em `BEGIN … ROLLBACK` contra produção: **nunca remover o `rollback;`**; não rodar perto das 08:00 UTC (o gerador roda lá); o relógio é simulado por datas fixas.
- **Toda escrita em produção** (`db push`) só com autorização explícita do usuário, com `--dry-run` antes. Comandos: `npx supabase@2.117.0 …`; a saída de `db query --linked` é JSON precedido de linhas de log.
- Commits em português, terminando com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Nunca commitar os arquivos soltos já existentes no working tree (`RUBRICA_AVALIACAO.md`, `docs/RESUMO_SPRINT_S1_CLAUDE_PROJECT.md`, `docs/backups/`, `docs/designs/`).
- `npx vitest run` e `npm run build` devem seguir verdes (esta etapa não muda código TypeScript, exceto o texto do aviso, que é da Etapa 2).

---

### Task 1: Tabela `renewal_decisions`, RPC `set_renewal_decision` e a matriz (parte 1)

**Files:**
- Create: `supabase/migrations/20261119140000_renewal_decisions.sql`
- Create: `supabase/migrations/20261119140100_set_renewal_decision.sql`
- Create: `supabase/tests/renewal_matrix.sql`

**Interfaces:**
- Produces:
  - `public.renewal_decisions (id, school_id, contract_id UNIQUE, status, reason, note, decided_by, created_at, updated_at)`
  - `public.set_renewal_decision(p_contract_id uuid, p_status text, p_reason text default null, p_note text default null) returns void` — `p_status ∈ {contacted, will_renew, will_not_renew, none}`; erros `NOT_ALLOWED` (42501), `INVALID_STATUS`, `INVALID_CONTRACT`, `REASON_REQUIRED` (22023).

- [ ] **Step 1: Branch de trabalho**

A spec e este plano estão na branch `docs/spec-s4c-rematricula` (ainda não enviada ao GitHub). A branch de trabalho parte dela:

```bash
git checkout docs/spec-s4c-rematricula && git checkout -b feature/s4c-etapa1-banco
```

- [ ] **Step 2: Migration da tabela**

```sql
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
  using (school_id = public.get_user_school_id() or public.is_master_admin());

drop policy if exists mfa_gate on public.renewal_decisions;
create policy mfa_gate on public.renewal_decisions as restrictive for all to authenticated
  using ((select public.mfa_gate_ok())) with check ((select public.mfa_gate_ok()));

drop trigger if exists audit_trigger on public.renewal_decisions;
create trigger audit_trigger after insert or update or delete on public.renewal_decisions
  for each row execute function public.audit_trigger_fn();
```

- [ ] **Step 3: Migration do RPC `set_renewal_decision`**

```sql
-- supabase/migrations/20261119140100_set_renewal_decision.sql
-- S4c: registra/atualiza/apaga a decisão da família sobre um contrato (spec R3, R4, R6).

create or replace function public.set_renewal_decision(
  p_contract_id uuid,
  p_status      text,
  p_reason      text default null,
  p_note        text default null
) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_school uuid;
  v_status text;
  v_reason text;
begin
  perform public.assert_mfa_gate();

  -- Papel primeiro (não depende do contrato): professor nunca chega a consultar nada.
  if not (public.get_current_user_role() in ('admin', 'financial') or public.is_master_admin()) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  if p_status is null or p_status not in ('contacted', 'will_renew', 'will_not_renew', 'none') then
    raise exception 'INVALID_STATUS' using errcode = '22023';
  end if;

  select c.school_id, c.status into v_school, v_status
    from public.contracts c where c.id = p_contract_id;

  -- Contrato inexistente ou de outra escola respondem igual (sem revelar existência).
  if v_school is null or not (v_school = public.get_user_school_id() or public.is_master_admin()) then
    raise exception 'INVALID_CONTRACT' using errcode = '22023';
  end if;
  if v_status <> 'active' then
    raise exception 'INVALID_CONTRACT' using errcode = '22023';
  end if;
  -- Já renovado (sucessor não cancelado): não há mais o que decidir.
  if exists (select 1 from public.contracts r
              where r.renewed_from_id = p_contract_id and r.school_id = v_school and r.status <> 'cancelled') then
    raise exception 'INVALID_CONTRACT' using errcode = '22023';
  end if;

  if p_status = 'none' then
    delete from public.renewal_decisions where contract_id = p_contract_id and school_id = v_school;
    return;
  end if;

  if p_status = 'will_not_renew' then
    if p_reason is null or p_reason not in ('moved_city', 'price', 'changed_school', 'other') then
      raise exception 'REASON_REQUIRED' using errcode = '22023';
    end if;
    v_reason := p_reason;
  else
    v_reason := null;   -- motivo só existe para "não vai renovar"; qualquer outro é ignorado
  end if;

  insert into public.renewal_decisions (school_id, contract_id, status, reason, note, decided_by)
  values (v_school, p_contract_id, p_status, v_reason, nullif(btrim(p_note), ''), auth.uid())
  on conflict (contract_id) do update
    set status     = excluded.status,
        reason     = excluded.reason,
        note       = excluded.note,
        decided_by = excluded.decided_by;
end $$;

revoke all on function public.set_renewal_decision(uuid, text, text, text) from public, anon;
grant execute on function public.set_renewal_decision(uuid, text, text, text) to authenticated;
```

- [ ] **Step 4: Escrever a matriz (parte 1: decisões)**

A matriz usa os dois usuários de teste de sempre (admin e financeiro), movidos para uma escola criada dentro da transação. O marcador `-- @@MIGRATION@@` é trocado pelas migrations na hora de rodar (Step 6). **A parte 2 (renovação, Task 2) será acrescentada antes do `end $$;`.**

```sql
-- supabase/tests/renewal_matrix.sql
-- Matriz da rematrícula (S4c, etapa 1). Spec: docs/superpowers/specs/2026-11-19-s4c-rematricula-design.md
-- Tudo dentro de BEGIN ... ROLLBACK: nada persiste.
-- ATENÇÃO: roda contra PRODUÇÃO, cria duas escolas de teste, move dois usuários de teste para a escola X,
-- muda papéis e liga/desliga require_2fa dentro da transação — NUNCA remova o "rollback;" do final.
-- Não rodar perto das 08:00 UTC.
--
-- Como rodar (migrations ainda NÃO aplicadas): gerar um arquivo que troca a linha marcadora MIGRATION
-- (sozinha na linha) pelo conteúdo, em ordem, de 20261119140000_renewal_decisions.sql,
-- 20261119140100_set_renewal_decision.sql e (depois da Task 2) 20261119140200_renew_contracts.sql.
-- Migrations já aplicadas: npx supabase@2.117.0 db query --linked -f supabase/tests/renewal_matrix.sql
-- Saída: uma linha por verificação; "ok" deve ser true em TODAS.

begin;

-- @@MIGRATION@@

create temp table t_res (n serial, cenario text, got text, esperado text, ok boolean);

create function pg_temp.run_as(p_uid uuid, p_aal text, p_sql text)
returns text language plpgsql as $f$
declare v text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'aal', p_aal, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    execute p_sql into v;
  exception when others then
    v := 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v;
end $f$;

create function pg_temp.rec(p_cenario text, p_got text, p_esperado text) returns void language sql as $f$
  insert into t_res (cenario, got, esperado, ok)
  values (p_cenario, p_got, p_esperado,
          coalesce(p_got = p_esperado or (p_esperado like 'ERR:%' and p_got like p_esperado || '%'), false))
$f$;

-- chama set_renewal_decision como o usuário e devolve '1' (ok) ou o erro
create function pg_temp.decide(p_uid uuid, p_contract uuid, p_status text, p_reason text default null, p_note text default null)
returns text language sql as $f$
  select pg_temp.run_as(p_uid, 'aal1',
    format('select count(*)::text from (select public.set_renewal_decision(%L, %L, %L, %L)) x',
           p_contract, p_status, p_reason, p_note))
$f$;

do $$
declare
  u_master uuid := '52d00ab5-567f-4537-b33a-22c2bd44e14d'; -- master + owner + admin, Colegio Teste
  u_admin  uuid := 'e0185312-eea9-4273-a9a8-ad9d575d4781'; -- admin (movido para a escola X)
  u_fin    uuid := 'b7ba4eb2-c7a2-4129-83a8-de8e7175c446'; -- financeiro (movido para a escola X)
  s_x uuid; s_y uuid; cl1 uuid; cl2 uuid; cly uuid; st uuid; sty uuid;
  k1 uuid; k2 uuid; k3 uuid; k4 uuid; k5 uuid; k6 uuid; kdead uuid; ky uuid;
  svc uuid; svc_m uuid; svc_off uuid; svcy uuid;
  v text; r jsonb; item jsonb;
begin
  perform set_config('request.jwt.claims', '', true);

  -- Escolas de teste isoladas.
  insert into public.schools (name, owner_user_id) values ('Escola Teste Rematrícula X', u_master) returning id into s_x;
  insert into public.schools (name, owner_user_id) values ('Escola Teste Rematrícula Y', u_master) returning id into s_y;
  update public.profiles set school_id = s_x where user_id in (u_admin, u_fin);
  delete from auth.mfa_factors where user_id in (u_admin, u_fin);
  delete from public.mfa_grace  where user_id in (u_admin, u_fin);

  insert into public.classes (name, school_id) values ('Turma 1', s_x) returning id into cl1;
  insert into public.classes (name, school_id) values ('Turma 2', s_x) returning id into cl2;
  insert into public.classes (name, school_id) values ('Turma Y', s_y) returning id into cly;
  insert into public.students (full_name, birth_date, school_id) values ('Aluno Teste', date '2015-01-01', s_x) returning id into st;
  insert into public.students (full_name, birth_date, school_id) values ('Aluno Y', date '2015-01-01', s_y) returning id into sty;

  -- Contratos de origem (todos terminam em 2031-02-28; o sucessor começa em 2031-03-01).
  insert into public.contracts (student_id, class_id, school_id, start_date, end_date, status, monthly_amount, discount, due_day, period)
    values (st, cl1, s_x, date '2030-03-01', date '2031-02-28', 'active', 100, 10, 5, 'integral') returning id into k1;
  insert into public.contracts (student_id, class_id, school_id, start_date, end_date, status, monthly_amount, discount, due_day, period)
    values (st, cl1, s_x, date '2030-03-01', date '2031-02-28', 'active', 200, 0, 10, 'meio_periodo') returning id into k2;
  insert into public.contracts (student_id, class_id, school_id, start_date, end_date, status, monthly_amount, discount, due_day, period)
    values (st, cl1, s_x, date '2030-03-01', date '2031-02-28', 'active', 300, 0, 10, 'meio_periodo') returning id into k3;
  insert into public.contracts (student_id, class_id, school_id, start_date, end_date, status, monthly_amount, discount, due_day, period)
    values (st, cl1, s_x, date '2030-03-01', date '2031-02-28', 'active', 400, 0, 10, 'meio_periodo') returning id into k4;
  insert into public.contracts (student_id, class_id, school_id, start_date, end_date, status, monthly_amount, discount, due_day, period)
    values (st, cl1, s_x, date '2030-03-01', date '2031-02-28', 'active', 500, 0, 10, 'meio_periodo') returning id into k5;
  insert into public.contracts (student_id, class_id, school_id, start_date, end_date, status, monthly_amount, discount, due_day, period)
    values (st, cl1, s_x, date '2030-03-01', date '2031-02-28', 'active', 600, 0, 10, 'meio_periodo') returning id into k6;
  insert into public.contracts (student_id, class_id, school_id, start_date, end_date, status, monthly_amount, discount, due_day, period)
    values (st, cl1, s_x, date '2030-03-01', date '2031-02-28', 'cancelled', 100, 0, 10, 'meio_periodo') returning id into kdead;
  insert into public.contracts (student_id, class_id, school_id, start_date, end_date, status, monthly_amount, discount, due_day, period)
    values (sty, cly, s_y, date '2030-03-01', date '2031-02-28', 'active', 100, 0, 10, 'meio_periodo') returning id into ky;

  insert into public.school_services (school_id, name, price, type, active) values (s_x, 'Taxa de rematrícula', 150, 'avulso', true) returning id into svc;
  insert into public.school_services (school_id, name, price, type, active) values (s_x, 'Mensalidade extra', 80, 'mensal', true) returning id into svc_m;
  insert into public.school_services (school_id, name, price, type, active) values (s_x, 'Taxa antiga', 90, 'avulso', false) returning id into svc_off;
  insert into public.school_services (school_id, name, price, type, active) values (s_y, 'Taxa Y', 70, 'avulso', true) returning id into svcy;

  -- 1. set_renewal_decision ---------------------------------------------------------------
  perform pg_temp.rec('1a admin marca "contatado"', pg_temp.decide(u_admin, k1, 'contacted'), '1');
  perform pg_temp.rec('1b linha gravada com autor e sem motivo',
    (select (status = 'contacted' and reason is null and decided_by = u_admin and school_id = s_x)::text
       from public.renewal_decisions where contract_id = k1), 'true');
  perform pg_temp.rec('1c auditoria da decisão (source manual)',
    (select string_agg(distinct source, ',') from public.audit_logs
      where table_name = 'renewal_decisions' and school_id = s_x), 'manual');
  perform pg_temp.rec('1d financeiro marca "vai renovar" (R6)', pg_temp.decide(u_fin, k2, 'will_renew'), '1');
  perform pg_temp.rec('1e "não vai renovar" sem motivo falha', pg_temp.decide(u_admin, k3, 'will_not_renew'), 'ERR:22023:REASON_REQUIRED');
  perform pg_temp.rec('1f "não vai renovar" com motivo inválido falha', pg_temp.decide(u_admin, k3, 'will_not_renew', 'xyz'), 'ERR:22023:REASON_REQUIRED');
  perform pg_temp.rec('1g "não vai renovar" com motivo e observação', pg_temp.decide(u_admin, k3, 'will_not_renew', 'price', '  Achou caro  '), '1');
  perform pg_temp.rec('1h motivo e observação (aparada) gravados',
    (select (reason = 'price' and note = 'Achou caro')::text from public.renewal_decisions where contract_id = k3), 'true');
  perform pg_temp.rec('1i motivo enviado com outro estado é ignorado', pg_temp.decide(u_admin, k1, 'will_renew', 'price'), '1');
  perform pg_temp.rec('1j ...e a linha fica sem motivo',
    (select (status = 'will_renew' and reason is null)::text from public.renewal_decisions where contract_id = k1), 'true');
  perform pg_temp.rec('1k mudar de "não vai" para outro estado limpa o motivo', pg_temp.decide(u_admin, k3, 'contacted'), '1');
  perform pg_temp.rec('1l ...motivo some',
    (select (status = 'contacted' and reason is null)::text from public.renewal_decisions where contract_id = k3), 'true');
  perform pg_temp.rec('1m "none" apaga a decisão', pg_temp.decide(u_admin, k3, 'none'), '1');
  perform pg_temp.rec('1n ...linha apagada', (select count(*)::text from public.renewal_decisions where contract_id = k3), '0');
  perform pg_temp.rec('1o um registro por contrato (upsert, não duplica)',
    (select count(*)::text from public.renewal_decisions where contract_id = k1), '1');
  perform pg_temp.rec('1p status inválido', pg_temp.decide(u_admin, k1, 'xyz'), 'ERR:22023:INVALID_STATUS');
  perform pg_temp.rec('1q contrato de outra escola', pg_temp.decide(u_admin, ky, 'contacted'), 'ERR:22023:INVALID_CONTRACT');
  perform pg_temp.rec('1r contrato inexistente', pg_temp.decide(u_admin, gen_random_uuid(), 'contacted'), 'ERR:22023:INVALID_CONTRACT');
  perform pg_temp.rec('1s contrato cancelado', pg_temp.decide(u_admin, kdead, 'contacted'), 'ERR:22023:INVALID_CONTRACT');

  -- Leitura e escrita direta
  perform pg_temp.rec('1t admin lê só as decisões da própria escola', pg_temp.run_as(u_admin, 'aal1',
    'select count(*)::text from public.renewal_decisions'),
    (select count(*)::text from public.renewal_decisions where school_id = s_x));
  perform pg_temp.rec('1u INSERT direto falha', pg_temp.run_as(u_admin, 'aal1', format(
    $q$with x as (insert into public.renewal_decisions (school_id, contract_id, status) values (%L, %L, 'contacted') returning 1) select count(*)::text from x$q$, s_x, k4)), 'ERR:42501');
  perform pg_temp.rec('1v UPDATE direto não afeta', pg_temp.run_as(u_admin, 'aal1',
    'with x as (update public.renewal_decisions set status = ''will_renew'' returning 1) select count(*)::text from x'), '0');
  perform pg_temp.rec('1w anon não executa o RPC',
    has_function_privilege('anon', 'public.set_renewal_decision(uuid,text,text,text)', 'execute')::text, 'false');

  -- Papel: professor é negado
  update public.user_roles set role = 'teacher' where user_id = u_fin;
  perform pg_temp.rec('1x professor é negado', pg_temp.decide(u_fin, k4, 'contacted'), 'ERR:42501:NOT_ALLOWED');
  update public.user_roles set role = 'financial' where user_id = u_fin;

  -- Gate de 2FA
  perform set_config('request.jwt.claims', '', true);
  update public.schools set require_2fa = true where id = s_x;
  delete from public.mfa_grace where user_id in (u_admin, u_fin);
  perform pg_temp.rec('1y admin aal1 sem carência bloqueado', pg_temp.decide(u_admin, k4, 'contacted'), 'ERR:42501:MFA_REQUIRED');
  perform set_config('request.jwt.claims', '', true);
  update public.schools set require_2fa = false where id = s_x;

  -- @@PART2@@
end $$;

select n, cenario, got, esperado, ok from t_res order by n;

rollback;
```

- [ ] **Step 5: Rodar a matriz e ver falhar (migrations ainda não aplicadas, marcador não trocado)**

Run: `npx supabase@2.117.0 db query --linked -f supabase/tests/renewal_matrix.sql 2>&1 | tail -6`
Expected: erro `relation "public.renewal_decisions" does not exist` (vermelho esperado). A transação é descartada; nada persiste.

- [ ] **Step 6: Rodar a matriz com as migrations embutidas (BEGIN…ROLLBACK, com autorização do usuário)**

```bash
B="C:/Users/mathe/AppData/Local/Temp/claude/f869db936a1e168f/34e3216f-f7ee-454a-9c3b-6fc894e0f1a5/scratchpad"
python - <<EOF
mig = ''.join(open('supabase/migrations/' + f, encoding='utf-8').read() + '\n' for f in [
    '20261119140000_renewal_decisions.sql', '20261119140100_set_renewal_decision.sql'])
t = open('supabase/tests/renewal_matrix.sql', encoding='utf-8').read()
assert t.count('-- @@MIGRATION@@') == 1 and t.rstrip().endswith('rollback;')
open(r'$B/renewal_matrix_with_migration.sql', 'w', encoding='utf-8').write(t.replace('-- @@MIGRATION@@', mig))
EOF
timeout 110 npx supabase@2.117.0 db query --linked -f "$B/renewal_matrix_with_migration.sql" 2>&1 | python -c "
import sys,json
t=sys.stdin.read()
try:
    r=json.loads(t[t.index('{'):]); rows=r.get('rows')
    if rows is None: print(json.dumps(r)[:900])
    else: print(len(rows),'casos; falhas:',[(x['cenario'],x['got'],x['esperado']) for x in rows if not x['ok']])
except Exception as e: print('ERR',e,t[:900])"
```
Expected: todos os casos `ok` (`falhas: []`). Se um caso falhar, corrija a **migration** (ou o caso, se o caso estiver errado) e rode de novo. Pré-requisito: autorização do usuário para a matriz e fora das 08:00 UTC. Depois confirme que nada persistiu: `select to_regclass('public.renewal_decisions')` deve ser nulo.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261119140000_renewal_decisions.sql supabase/migrations/20261119140100_set_renewal_decision.sql supabase/tests/renewal_matrix.sql
git commit -m "Decisão da família na rematrícula: tabela renewal_decisions e RPC set_renewal_decision, com matriz SQL (ainda não aplicadas)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: RPC `renew_contracts` e a matriz (parte 2)

**Files:**
- Create: `supabase/migrations/20261119140200_renew_contracts.sql`
- Modify: `supabase/tests/renewal_matrix.sql` (substituir a linha `-- @@PART2@@` pelo bloco abaixo; ajustar o comentário do cabeçalho se necessário)

**Interfaces:**
- Consumes: tabela e RPC da Task 1 (caso 2x usa `set_renewal_decision`).
- Produces: `public.renew_contracts(p_school_id uuid, p_items jsonb, p_fee_service_id uuid default null) returns jsonb` → `{ "renewed": int, "tuitions": int, "skipped": [ { "source_contract_id": uuid, "reason": "ALREADY_RENEWED" } ] }`. Erros (todos `22023`, exceto o de papel `42501`): `NOT_ALLOWED`, `INVALID_ITEMS` (lote vazio ou > 100), `INVALID_ITEM` (com `detail` citando o contrato), `INVALID_SERVICE`.
- Formato de cada item de `p_items`:
  `{ "source_contract_id", "class_id" (nulo permitido), "monthly_amount", "start_date", "end_date", "tuitions": [ { "due_date", "status" ("pending"|"overdue"), "description" } ] }` (o `amount` por mensalidade é opcional e só é conferido, com tolerância de R$ 0,01, contra o `final_amount` calculado no servidor; o servidor grava sempre o valor dele).

- [ ] **Step 1: Migration do RPC**

```sql
-- supabase/migrations/20261119140200_renew_contracts.sql
-- S4c: renovação em lote, atômica (spec R8). O cliente calcula as mensalidades com a função pura da Etapa 2;
-- o servidor valida tudo e grava contratos, mensalidades e taxa de rematrícula numa transação só.
-- Qualquer item inválido aborta o lote inteiro. Origem que já tem sucessor é PULADA e listada.

create or replace function public.renew_contracts(
  p_school_id      uuid,
  p_items          jsonb,
  p_fee_service_id uuid default null
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  it         record;
  src        record;
  fee        record;
  t          record;
  v_new_id   uuid;
  v_final    numeric;
  v_n        integer;
  v_cnt      integer;
  v_distinct integer;
  v_renewed  integer := 0;
  v_tuitions integer := 0;
  v_skipped  jsonb   := '[]'::jsonb;
begin
  perform public.assert_mfa_gate();

  if not ((p_school_id = public.get_user_school_id() and public.get_current_user_role() in ('admin', 'financial'))
          or public.is_master_admin()) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'INVALID_ITEMS' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(p_items);
  if v_n < 1 or v_n > 100 then
    raise exception 'INVALID_ITEMS' using errcode = '22023', detail = 'O lote precisa ter de 1 a 100 contratos.';
  end if;

  if p_fee_service_id is not null then
    select s.id, s.name, s.price into fee
      from public.school_services s
     where s.id = p_fee_service_id and s.school_id = p_school_id and s.type = 'avulso' and s.active;
    if not found then
      raise exception 'INVALID_SERVICE' using errcode = '22023';
    end if;
  end if;

  -- Marca a origem na auditoria; local à transação desta chamada (nunca vaza no pool).
  perform set_config('app.audit_source', 'generated'::text, true);

  for it in
    select * from jsonb_to_recordset(p_items) as x(
      source_contract_id uuid, class_id uuid, monthly_amount numeric,
      start_date date, end_date date, tuitions jsonb)
  loop
    if it.source_contract_id is null or it.monthly_amount is null or it.start_date is null
       or it.end_date is null or it.tuitions is null or jsonb_typeof(it.tuitions) <> 'array' then
      raise exception 'INVALID_ITEM' using errcode = '22023', detail = 'Item incompleto no lote.';
    end if;

    -- Trava a origem: duas renovações simultâneas do mesmo contrato se serializam aqui.
    select c.* into src from public.contracts c
     where c.id = it.source_contract_id and c.school_id = p_school_id for update;
    if not found then
      raise exception 'INVALID_ITEM' using errcode = '22023',
        detail = format('Contrato %s não encontrado nesta escola.', it.source_contract_id);
    end if;

    -- Já tem sucessor (não cancelado, inclusive um criado antes neste mesmo lote): pula e informa.
    if exists (select 1 from public.contracts r
                where r.renewed_from_id = src.id and r.school_id = p_school_id and r.status <> 'cancelled') then
      v_skipped := v_skipped || jsonb_build_object('source_contract_id', src.id, 'reason', 'ALREADY_RENEWED');
      continue;
    end if;

    if src.status <> 'active' then
      raise exception 'INVALID_ITEM' using errcode = '22023',
        detail = format('Contrato %s não está ativo.', src.id);
    end if;
    if it.monthly_amount <= 0 then
      raise exception 'INVALID_ITEM' using errcode = '22023',
        detail = format('Contrato %s: valor mensal inválido.', src.id);
    end if;
    if it.class_id is not null
       and not exists (select 1 from public.classes cl where cl.id = it.class_id and cl.school_id = p_school_id) then
      raise exception 'INVALID_ITEM' using errcode = '22023',
        detail = format('Contrato %s: turma de destino não pertence à escola.', src.id);
    end if;
    if it.start_date <> src.end_date + 1 then
      raise exception 'INVALID_ITEM' using errcode = '22023',
        detail = format('Contrato %s: o novo contrato deve começar no dia seguinte ao fim do atual.', src.id);
    end if;
    if it.end_date < it.start_date or it.end_date > (it.start_date + interval '24 months')::date then
      raise exception 'INVALID_ITEM' using errcode = '22023',
        detail = format('Contrato %s: período do novo contrato inválido (máximo 24 meses).', src.id);
    end if;
    if jsonb_array_length(it.tuitions) < 1 then
      raise exception 'INVALID_ITEM' using errcode = '22023',
        detail = format('Contrato %s: nenhuma mensalidade informada.', src.id);
    end if;

    insert into public.contracts
      (student_id, class_id, school_id, period, start_date, end_date, monthly_amount, discount, due_day, status, renewed_from_id)
    values
      (src.student_id, it.class_id, p_school_id, src.period, it.start_date, it.end_date,
       it.monthly_amount, src.discount, src.due_day, 'active', src.id)
    returning id, final_amount into v_new_id, v_final;

    -- Mensalidades: o servidor manda no valor (final_amount do contrato novo); o cliente só é conferido.
    for t in
      select * from jsonb_to_recordset(it.tuitions) as r(due_date date, amount numeric, status text, description text)
    loop
      if t.due_date is null or t.due_date < it.start_date or t.due_date > it.end_date then
        raise exception 'INVALID_ITEM' using errcode = '22023',
          detail = format('Contrato %s: mensalidade fora do período do contrato.', src.id);
      end if;
      if t.status is null or t.status not in ('pending', 'overdue') then
        raise exception 'INVALID_ITEM' using errcode = '22023',
          detail = format('Contrato %s: status de mensalidade inválido.', src.id);
      end if;
      if t.description is null or btrim(t.description) = '' then
        raise exception 'INVALID_ITEM' using errcode = '22023',
          detail = format('Contrato %s: mensalidade sem descrição.', src.id);
      end if;
      if t.amount is not null and abs(t.amount - v_final) > 0.01 then
        raise exception 'INVALID_ITEM' using errcode = '22023',
          detail = format('Contrato %s: valor da mensalidade não confere com o do contrato.', src.id);
      end if;
    end loop;

    select count(distinct (r.due_date)) into v_distinct
      from jsonb_to_recordset(it.tuitions) as r(due_date date);
    if v_distinct <> jsonb_array_length(it.tuitions) then
      raise exception 'INVALID_ITEM' using errcode = '22023',
        detail = format('Contrato %s: mensalidades com a mesma data de vencimento.', src.id);
    end if;

    insert into public.tuitions (contract_id, student_id, school_id, amount, final_amount, due_date, status, description)
    select v_new_id, src.student_id, p_school_id, v_final, null, r.due_date, r.status, r.description
      from jsonb_to_recordset(it.tuitions) as r(due_date date, status text, description text);
    get diagnostics v_cnt = row_count;
    v_tuitions := v_tuitions + v_cnt;

    if fee.id is not null then
      insert into public.service_charges (school_id, student_id, service_id, description, amount, due_date, status)
      values (p_school_id, src.student_id, fee.id, fee.name, fee.price, it.start_date, 'pending');
    end if;

    v_renewed := v_renewed + 1;
  end loop;

  return jsonb_build_object('renewed', v_renewed, 'tuitions', v_tuitions, 'skipped', v_skipped);
end $$;

revoke all on function public.renew_contracts(uuid, jsonb, uuid) from public, anon;
grant execute on function public.renew_contracts(uuid, jsonb, uuid) to authenticated;
```

- [ ] **Step 2: Acrescentar a parte 2 à matriz**

Substituir a linha `  -- @@PART2@@` de `supabase/tests/renewal_matrix.sql` por este bloco. Antes dele, **acrescentar duas funções auxiliares** logo depois de `pg_temp.decide(...)` (fora do `do $$`):

```sql
-- 12 mensalidades mensais a partir de p_start, vencendo em p_due_day, todas com o valor p_amount
create function pg_temp.rows12(p_start date, p_due_day int, p_amount numeric) returns jsonb language sql as $f$
  select jsonb_agg(jsonb_build_object(
           'due_date', (date_trunc('month', p_start) + make_interval(months => g) + make_interval(days => p_due_day - 1))::date,
           'amount', p_amount, 'status', 'pending', 'description', 'Mensalidade ' || (g + 1)))
    from generate_series(0, 11) g
$f$;

-- um item de lote; o contrato novo vai de p_start a p_end (padrão: 2031-03-01 a 2032-02-29)
create function pg_temp.item(p_src uuid, p_class uuid, p_monthly numeric, p_amount numeric, p_due int default 5,
                             p_start date default date '2031-03-01', p_end date default date '2032-02-29')
returns jsonb language sql as $f$
  select jsonb_build_object('source_contract_id', p_src, 'class_id', p_class, 'monthly_amount', p_monthly,
                            'start_date', p_start, 'end_date', p_end, 'tuitions', pg_temp.rows12(p_start, p_due, p_amount))
$f$;

-- chama renew_contracts como o usuário e devolve o jsonb em texto ou o erro
create function pg_temp.renew(p_uid uuid, p_school uuid, p_items jsonb, p_fee uuid default null)
returns text language sql as $f$
  select pg_temp.run_as(p_uid, 'aal1',
    format('select public.renew_contracts(%L, %L::jsonb, %L)::text', p_school, p_items::text, p_fee))
$f$;
```

O bloco que substitui `-- @@PART2@@`:

```sql
  -- 2. renew_contracts --------------------------------------------------------------------
  -- 2a. lote válido: k1 reajustada (100 → 110 com desconto 10% = 99,00) e promovida de turma, k2 igual; com taxa
  r := (pg_temp.renew(u_admin, s_x, jsonb_build_array(pg_temp.item(k1, cl2, 110, 99), pg_temp.item(k2, cl1, 200, 200, 10)), svc))::jsonb;
  perform pg_temp.rec('2a lote renova 2 contratos e cria 24 mensalidades, sem pulados',
    (r->>'renewed') || '|' || (r->>'tuitions') || '|' || jsonb_array_length(r->'skipped'), '2|24|0');
  perform pg_temp.rec('2b contrato novo de k1: valores, turma, período e herança',
    (select (monthly_amount = 110 and discount = 10 and due_day = 5 and period = 'integral' and class_id = cl2
             and start_date = date '2031-03-01' and end_date = date '2032-02-29' and status = 'active' and school_id = s_x
             and student_id = st)::text
       from public.contracts where renewed_from_id = k1), 'true');
  perform pg_temp.rec('2c 12 mensalidades do novo k1 a R$ 99,00, final_amount nulo, na escola certa',
    (select count(*)::text from public.tuitions t join public.contracts c on c.id = t.contract_id
      where c.renewed_from_id = k1 and t.amount = 99 and t.final_amount is null and t.school_id = s_x
        and t.student_id = st and t.status = 'pending'), '12');
  perform pg_temp.rec('2d 2 cobranças de taxa de R$ 150 pendentes no início do contrato novo',
    (select count(*)::text from public.service_charges
      where school_id = s_x and service_id = svc and amount = 150 and status = 'pending' and due_date = date '2031-03-01'), '2');
  perform pg_temp.rec('2e auditoria do lote marcada como generated',
    (select string_agg(distinct source, ',') from public.audit_logs
      where table_name = 'tuitions' and school_id = s_x
        and (new_data->>'contract_id')::uuid in (select id from public.contracts where renewed_from_id in (k1, k2))), 'generated');

  -- 2f/2g. já renovado: pulado; lote misto
  r := (pg_temp.renew(u_admin, s_x, jsonb_build_array(pg_temp.item(k1, cl2, 110, 99)), null))::jsonb;
  perform pg_temp.rec('2f origem já renovada é pulada e listada',
    (r->>'renewed') || '|' || (r->'skipped'->0->>'reason'), '0|ALREADY_RENEWED');
  perform pg_temp.rec('2g ...e não criou contrato novo', (select count(*)::text from public.contracts where renewed_from_id = k1), '1');
  r := (pg_temp.renew(u_admin, s_x, jsonb_build_array(pg_temp.item(k1, cl2, 110, 99), pg_temp.item(k3, cl1, 300, 300, 10)), null))::jsonb;
  perform pg_temp.rec('2h lote misto: 1 renovado, 1 pulado',
    (r->>'renewed') || '|' || jsonb_array_length(r->'skipped'), '1|1');
  perform pg_temp.rec('2i duplicata no mesmo lote: a segunda é pulada',
    (((pg_temp.renew(u_admin, s_x, jsonb_build_array(pg_temp.item(k4, cl1, 400, 400, 10), pg_temp.item(k4, cl1, 400, 400, 10)), null))::jsonb)->>'renewed')
    || '|' || (select count(*)::text from public.contracts where renewed_from_id = k4), '1|1');

  -- 2j. atomicidade: um item inválido aborta o lote inteiro (k5 válido não pode ser renovado)
  perform pg_temp.rec('2j item inválido aborta o lote inteiro',
    pg_temp.renew(u_admin, s_x, jsonb_build_array(pg_temp.item(k5, cl1, 500, 500, 10), pg_temp.item(k6, cl1, 600, 999, 10)), null),
    'ERR:22023:INVALID_ITEM');
  perform pg_temp.rec('2k ...e k5 NÃO foi renovada (nada gravado)',
    (select count(*)::text from public.contracts where renewed_from_id in (k5, k6)), '0');
  perform pg_temp.rec('2l ...nem mensalidades órfãs',
    (select count(*)::text from public.tuitions where school_id = s_x and contract_id in (select id from public.contracts where renewed_from_id in (k5, k6))), '0');

  -- 2m. validações de item
  perform pg_temp.rec('2m início diferente de fim + 1', pg_temp.renew(u_admin, s_x,
    jsonb_build_array(pg_temp.item(k5, cl1, 500, 500, 10, date '2031-03-02', date '2032-03-01')), null), 'ERR:22023:INVALID_ITEM');
  perform pg_temp.rec('2n duração acima de 24 meses', pg_temp.renew(u_admin, s_x,
    jsonb_build_array(pg_temp.item(k5, cl1, 500, 500, 10, date '2031-03-01', date '2033-03-02')), null), 'ERR:22023:INVALID_ITEM');
  perform pg_temp.rec('2o mensalidade fora do período', pg_temp.renew(u_admin, s_x,
    jsonb_build_array(jsonb_set(pg_temp.item(k5, cl1, 500, 500, 10), '{tuitions,0,due_date}', '"2033-01-01"')), null), 'ERR:22023:INVALID_ITEM');
  perform pg_temp.rec('2p valor da mensalidade não confere', pg_temp.renew(u_admin, s_x,
    jsonb_build_array(pg_temp.item(k5, cl1, 500, 499)), null), 'ERR:22023:INVALID_ITEM');
  perform pg_temp.rec('2q vencimentos repetidos', pg_temp.renew(u_admin, s_x,
    jsonb_build_array(jsonb_set(pg_temp.item(k5, cl1, 500, 500, 10), '{tuitions,1,due_date}', (pg_temp.item(k5, cl1, 500, 500, 10)->'tuitions'->0->'due_date'))), null), 'ERR:22023:INVALID_ITEM');
  perform pg_temp.rec('2r valor mensal zero', pg_temp.renew(u_admin, s_x,
    jsonb_build_array(pg_temp.item(k5, cl1, 0, 0)), null), 'ERR:22023:INVALID_ITEM');
  perform pg_temp.rec('2s sem mensalidades', pg_temp.renew(u_admin, s_x,
    jsonb_build_array(jsonb_set(pg_temp.item(k5, cl1, 500, 500), '{tuitions}', '[]')), null), 'ERR:22023:INVALID_ITEM');
  perform pg_temp.rec('2t status de mensalidade inválido', pg_temp.renew(u_admin, s_x,
    jsonb_build_array(jsonb_set(pg_temp.item(k5, cl1, 500, 500, 10), '{tuitions,0,status}', '"paid"')), null), 'ERR:22023:INVALID_ITEM');
  perform pg_temp.rec('2u origem de outra escola', pg_temp.renew(u_admin, s_x,
    jsonb_build_array(pg_temp.item(ky, cl1, 100, 100, 10)), null), 'ERR:22023:INVALID_ITEM');
  perform pg_temp.rec('2v turma de destino de outra escola', pg_temp.renew(u_admin, s_x,
    jsonb_build_array(pg_temp.item(k5, cly, 500, 500, 10)), null), 'ERR:22023:INVALID_ITEM');
  perform pg_temp.rec('2w origem cancelada', pg_temp.renew(u_admin, s_x,
    jsonb_build_array(pg_temp.item(kdead, cl1, 100, 100, 10)), null), 'ERR:22023:INVALID_ITEM');
  perform pg_temp.rec('2x lote vazio', pg_temp.renew(u_admin, s_x, '[]'::jsonb, null), 'ERR:22023:INVALID_ITEMS');
  perform pg_temp.rec('2y lote com 101 itens', pg_temp.renew(u_admin, s_x,
    (select jsonb_agg(pg_temp.item(k5, cl1, 500, 500, 10)) from generate_series(1, 101)), null), 'ERR:22023:INVALID_ITEMS');
  perform pg_temp.rec('2z serviço de outra escola', pg_temp.renew(u_admin, s_x,
    jsonb_build_array(pg_temp.item(k5, cl1, 500, 500, 10)), svcy), 'ERR:22023:INVALID_SERVICE');
  perform pg_temp.rec('2za serviço mensal (não avulso)', pg_temp.renew(u_admin, s_x,
    jsonb_build_array(pg_temp.item(k5, cl1, 500, 500, 10)), svc_m), 'ERR:22023:INVALID_SERVICE');
  perform pg_temp.rec('2zb serviço inativo', pg_temp.renew(u_admin, s_x,
    jsonb_build_array(pg_temp.item(k5, cl1, 500, 500, 10)), svc_off), 'ERR:22023:INVALID_SERVICE');

  -- 2zc. permissões
  perform pg_temp.rec('2zc escola Y por quem é da escola X', pg_temp.renew(u_admin, s_y,
    jsonb_build_array(pg_temp.item(ky, cly, 100, 100, 10)), null), 'ERR:42501:NOT_ALLOWED');
  update public.user_roles set role = 'teacher' where user_id = u_fin;
  perform pg_temp.rec('2zd professor é negado', pg_temp.renew(u_fin, s_x,
    jsonb_build_array(pg_temp.item(k5, cl1, 500, 500, 10)), null), 'ERR:42501:NOT_ALLOWED');
  update public.user_roles set role = 'financial' where user_id = u_fin;
  perform pg_temp.rec('2ze financeiro renova (R6)',
    (((pg_temp.renew(u_fin, s_x, jsonb_build_array(pg_temp.item(k5, cl1, 500, 500, 10)), null))::jsonb)->>'renewed'), '1');
  perform pg_temp.rec('2zf anon não executa o RPC',
    has_function_privilege('anon', 'public.renew_contracts(uuid,jsonb,uuid)', 'execute')::text, 'false');

  -- 2zg. renovação cancelada libera nova renovação; decisão em contrato já renovado é bloqueada
  update public.contracts set status = 'cancelled' where renewed_from_id = k1;
  r := (pg_temp.renew(u_admin, s_x, jsonb_build_array(pg_temp.item(k1, cl2, 110, 99)), null))::jsonb;
  perform pg_temp.rec('2zg sucessor cancelado não conta: k1 pode ser renovada de novo', (r->>'renewed'), '1');
  perform pg_temp.rec('2zh decisão em contrato já renovado é bloqueada', pg_temp.decide(u_admin, k2, 'contacted'), 'ERR:22023:INVALID_CONTRACT');

  -- 2zi. gate de 2FA
  perform set_config('request.jwt.claims', '', true);
  update public.schools set require_2fa = true where id = s_x;
  delete from public.mfa_grace where user_id in (u_admin, u_fin);
  perform pg_temp.rec('2zi admin aal1 sem carência bloqueado', pg_temp.renew(u_admin, s_x,
    jsonb_build_array(pg_temp.item(k6, cl1, 600, 600, 10)), null), 'ERR:42501:MFA_REQUIRED');
  perform set_config('request.jwt.claims', '', true);
  update public.schools set require_2fa = false where id = s_x;

  -- 2zj. isolamento: nada foi criado na escola Y
  perform pg_temp.rec('2zj escola Y intacta',
    (select count(*)::text from public.contracts where school_id = s_y and renewed_from_id is not null), '0');
```

**Atenção ao caso `2zi`:** `mfa_grace`/`require_2fa` seguem o mesmo padrão da matriz `notifications_matrix.sql` (admin aal1 sem carência é bloqueado quando a escola exige 2FA). Se o caso `1y` da Task 1 passar, este também passa.

- [ ] **Step 3: Rodar a matriz e ver falhar (RPC ainda não existe)**

Run (com as migrations da Task 1 embutidas, sem a `140200`): o mesmo comando do Task 1 Step 6, mas **incluindo** a Task 2 no marcador após criar o arquivo da migration. Para o vermelho: rodar com só as duas migrations da Task 1 embutidas.
Expected: erro `function public.renew_contracts(...) does not exist` (ou casos `2*` com `ERR:42883`), vermelho esperado.

- [ ] **Step 4: Rodar com as três migrations embutidas (BEGIN…ROLLBACK, com autorização)**

```bash
B="C:/Users/mathe/AppData/Local/Temp/claude/f869db936a1e168f/34e3216f-f7ee-454a-9c3b-6fc894e0f1a5/scratchpad"
python - <<EOF
mig = ''.join(open('supabase/migrations/' + f, encoding='utf-8').read() + '\n' for f in [
    '20261119140000_renewal_decisions.sql', '20261119140100_set_renewal_decision.sql', '20261119140200_renew_contracts.sql'])
t = open('supabase/tests/renewal_matrix.sql', encoding='utf-8').read()
assert t.count('-- @@MIGRATION@@') == 1 and t.rstrip().endswith('rollback;')
open(r'$B/renewal_matrix_with_migration.sql', 'w', encoding='utf-8').write(t.replace('-- @@MIGRATION@@', mig))
EOF
timeout 110 npx supabase@2.117.0 db query --linked -f "$B/renewal_matrix_with_migration.sql" 2>&1 | python -c "
import sys,json
t=sys.stdin.read()
try:
    r=json.loads(t[t.index('{'):]); rows=r.get('rows')
    if rows is None: print(json.dumps(r)[:900])
    else: print(len(rows),'casos; falhas:',[(x['cenario'],x['got'],x['esperado']) for x in rows if not x['ok']])
except Exception as e: print('ERR',e,t[:900])"
```
Expected: todos `ok`. Corrija a migration (ou o caso, se estiver errado) e rode de novo até zerar. Confirme depois: `select to_regclass('public.renewal_decisions')` nulo (nada persistiu).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261119140200_renew_contracts.sql supabase/tests/renewal_matrix.sql
git commit -m "RPC renew_contracts (renovação em lote atômica) e matriz SQL da rematrícula (ainda não aplicados)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Aviso de rematrícula com `declined_count` e sem aviso quando não há pendentes

**Files:**
- Create: `supabase/migrations/20261119140300_notifications_reenrollment_declined.sql` (gerada por script a partir da migration anterior do gerador)
- Modify: `supabase/tests/notifications_matrix.sql` (3 edições + um bloco novo)

**Interfaces:**
- Consumes: `public.renewal_decisions` (Task 1).
- Produces: `details` do evento `reenrollment` passa a ser `{ "renewed_count": n, "declined_count": m }`; o aviso só é gerado se `item_count − renewed_count − declined_count > 0`.

- [ ] **Step 1: Gerar a migration a partir da última versão do gerador**

A cópia mais recente da função é a de `20261119120000_notifications_renewed_count_exclude_cancelled.sql`. O script abaixo copia o `create or replace function` inteiro e aplica **duas** substituições exatas (cada uma tem de bater exatamente uma vez):

```bash
python - <<'EOF'
src = open('supabase/migrations/20261119120000_notifications_renewed_count_exclude_cancelled.sql', encoding='utf-8').read()
body = src[src.index('create or replace function public.generate_daily_notifications'):]

old1 = """      select count(*)::integer, null::numeric,
             jsonb_build_object('renewed_count', count(*) filter (where exists (
               select 1 from public.contracts r2
                where r2.renewed_from_id = c.id and r2.school_id = c.school_id
                  and r2.status <> 'cancelled')))   -- MUDANÇA: renovação cancelada não conta
        from public.contracts c"""
new1 = """      select count(*)::integer, null::numeric,
             jsonb_build_object(
               'renewed_count', count(*) filter (where exists (
                 select 1 from public.contracts r2
                  where r2.renewed_from_id = c.id and r2.school_id = c.school_id
                    and r2.status <> 'cancelled')),
               -- MUDANÇA (S4c): "não vai renovar" (sem sucessor) sai dos pendentes
               'declined_count', count(*) filter (where not exists (
                   select 1 from public.contracts r2
                    where r2.renewed_from_id = c.id and r2.school_id = c.school_id
                      and r2.status <> 'cancelled')
                 and exists (
                   select 1 from public.renewal_decisions d
                    where d.contract_id = c.id and d.school_id = c.school_id
                      and d.status = 'will_not_renew')))
        from public.contracts c"""
old2 = "   where x.item_count > 0;"
new2 = """   where x.item_count > 0
     -- MUDANÇA (S4c): rematrícula só avisa quando ainda há pendentes
     and not (x.event = 'reenrollment'
              and x.item_count - (x.details->>'renewed_count')::integer - (x.details->>'declined_count')::integer <= 0);"""
assert body.count(old1) == 1 and body.count(old2) == 1, (body.count(old1), body.count(old2))
body = body.replace(old1, new1).replace(old2, new2)

header = """-- S4c: o aviso de rematrícula passa a descontar quem "não vai renovar" e só é gerado se ainda houver pendentes.
-- Spec: docs/superpowers/specs/2026-11-19-s4c-rematricula-design.md (seção "Aviso de rematrícula").
-- details do evento reenrollment: { renewed_count, declined_count }. Pendentes = item_count - renewed_count - declined_count.
-- Únicas mudanças na função: os dois trechos marcados "MUDANÇA (S4c)". O resto é a definição de
-- 20261119120000_notifications_renewed_count_exclude_cancelled.sql, sem alterações.
-- Permissões: CREATE OR REPLACE preserva os GRANT/REVOKE existentes.
-- Requer public.renewal_decisions (20261119140000).

"""
open('supabase/migrations/20261119140300_notifications_reenrollment_declined.sql', 'w', encoding='utf-8').write(header + body)
print('ok')
EOF
diff <(sed -n '/^create or replace function/,$p' supabase/migrations/20261119120000_notifications_renewed_count_exclude_cancelled.sql) <(sed -n '/^create or replace function/,$p' supabase/migrations/20261119140300_notifications_reenrollment_declined.sql)
```
Expected: o diff mostra **só** as duas mudanças (o bloco do `reenrollment` e a cláusula `where` final). Qualquer outra diferença é um erro do script.

- [ ] **Step 2: Editar `supabase/tests/notifications_matrix.sql`** (edições exatas)

1. **Declaração** (linha ~58): acrescentar `k5` à lista de variáveis. Trocar `k3 uuid; cat uuid; rn uuid;` por `k3 uuid; k5 uuid; cat uuid; rn uuid;` (aparece uma vez).
2. **Caso 1e:** trocar `'2|-|{"renewed_count": 1}'` por `'2|-|{"renewed_count": 1, "declined_count": 0}'` (aparece uma vez; o `jsonb` ordena as chaves por tamanho, então `renewed_count` vem antes de `declined_count`).
3. **Bloco novo** antes de `-- 11. Job agendado`:

```sql
  -- 13. S4c: "não vai renovar" sai dos pendentes; sem pendentes não há aviso de rematrícula
  insert into public.contracts (student_id, class_id, school_id, start_date, end_date, status, monthly_amount)
    values (st, cl1, s_x, date '2031-01-01', d + 45, 'active', 100) returning id into k5;   -- terceiro contrato do conjunto (d+45)
  insert into public.renewal_decisions (school_id, contract_id, status, reason) values (s_x, k1, 'will_not_renew', 'price');
  perform public.generate_daily_notifications(c_now);
  perform pg_temp.rec('13a pendentes > 0: aviso com declined_count (3 contratos, 1 renovado, 1 recusou, 1 pendente)',
    pg_temp.notif(u_admin, 'reenrollment'), '3|-|{"renewed_count": 1, "declined_count": 1}');
  insert into public.renewal_decisions (school_id, contract_id, status, reason) values (s_x, k5, 'will_not_renew', 'other');
  perform public.generate_daily_notifications(c_now);
  perform pg_temp.rec('13b sem pendentes: o aviso não nasce (e o não lido do dia é apagado)',
    pg_temp.notif(u_admin, 'reenrollment'), 'none');
  -- decisão "não vai renovar" em contrato que JÁ foi renovado conta como renovado, não como recusa
  insert into public.renewal_decisions (school_id, contract_id, status, reason) values (s_x, k2, 'will_not_renew', 'price');
  update public.renewal_decisions set status = 'contacted', reason = null where contract_id = k5;
  perform public.generate_daily_notifications(c_now);
  perform pg_temp.rec('13c decisão em contrato já renovado conta como renovado (k2 tem sucessor k3)',
    pg_temp.notif(u_admin, 'reenrollment'), '3|-|{"renewed_count": 1, "declined_count": 1}');
```
(No `13c`, `k1` continua recusado e sem sucessor → `declined_count` 1; `k2` tem sucessor `k3` → conta como renovado; `k5` voltou a "contatado" → pendente.)

- [ ] **Step 3: Rodar a matriz de notificações e ver falhar (função ainda antiga em produção)**

Run: `npx supabase@2.117.0 db query --linked -f supabase/tests/notifications_matrix.sql` — a tabela `renewal_decisions` ainda não existe em produção: espera-se o erro `relation "public.renewal_decisions" does not exist` (vermelho esperado; nada persiste).

- [ ] **Step 4: Rodar com as migrations embutidas (BEGIN…ROLLBACK, com autorização)**

O marcador `-- @@MIGRATION@@` de `notifications_matrix.sql` recebe, em ordem, a tabela (`…140000`) e o gerador novo (`…140300`):

```bash
B="C:/Users/mathe/AppData/Local/Temp/claude/f869db936a1e168f/34e3216f-f7ee-454a-9c3b-6fc894e0f1a5/scratchpad"
python - <<EOF
mig = ''.join(open('supabase/migrations/' + f, encoding='utf-8').read() + '\n' for f in [
    '20261119140000_renewal_decisions.sql', '20261119140300_notifications_reenrollment_declined.sql'])
t = open('supabase/tests/notifications_matrix.sql', encoding='utf-8').read()
assert t.count('-- @@MIGRATION@@') == 1 and t.rstrip().endswith('rollback;')
open(r'$B/notifications_matrix_with_migration.sql', 'w', encoding='utf-8').write(t.replace('-- @@MIGRATION@@', mig))
EOF
timeout 110 npx supabase@2.117.0 db query --linked -f "$B/notifications_matrix_with_migration.sql" 2>&1 | python -c "
import sys,json
t=sys.stdin.read()
try:
    r=json.loads(t[t.index('{'):]); rows=r.get('rows')
    if rows is None: print(json.dumps(r)[:900])
    else: print(len(rows),'casos; falhas:',[(x['cenario'],x['got'],x['esperado']) for x in rows if not x['ok']])
except Exception as e: print('ERR',e,t[:900])"
```
Expected: todos `ok` (42 casos anteriores + 3 novos = 45). Nada persiste. **Não rodar perto das 08:00 UTC.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261119140300_notifications_reenrollment_declined.sql supabase/tests/notifications_matrix.sql
git commit -m "Aviso de rematrícula desconta quem não vai renovar e só avisa com pendentes (ainda não aplicado)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Documentação e alinhamento da spec

**Files:**
- Modify: `docs/superpowers/specs/2026-11-19-s4c-rematricula-design.md`
- Modify: `CHANGELOG.md`, `QA_CHECKLIST.md`, `docs/STATUS.md`

- [ ] **Step 1: Alinhar a spec às decisões do plano**

Em `docs/superpowers/specs/2026-11-19-s4c-rematricula-design.md`:
- Na seção do RPC `renew_contracts`, trocar a assinatura por `renew_contracts(p_school_id uuid, p_items jsonb, p_fee_service_id uuid default null) → jsonb`, e a frase de permissão por: "Permitido se `p_school_id = get_user_school_id()` e o papel for admin ou financeiro, ou se for master admin (padrão de `insert_generated_tuitions`, para o master poder renovar numa escola que está visualizando)."
- Na seção do `set_renewal_decision`, dizer que a escola é a **do contrato** (e que a permissão é papel admin/financeiro, ou master).
- Acrescentar na seção "Riscos e avisos": "**`enrollments` não é atualizada:** só a importação a escreve; promover alunos de turma no lote não a altera (mesmo comportamento da renovação individual). A contagem por turma do Dashboard usa `enrollments`."
- No item `INVALID_ITEM`, mencionar que o servidor grava sempre o valor da mensalidade que ele calcula (`final_amount` do contrato novo) e só **confere** o valor enviado pelo cliente, com tolerância de R$ 0,01.

- [ ] **Step 2: CHANGELOG, QA e STATUS**

`CHANGELOG.md`: nova seção no topo "Sprint S4c — Rematrícula, etapa 1 (banco) (2026-11-19)", dizendo **o estado real** (código pronto, não aplicado, até a Task 5): tabela `renewal_decisions`, RPCs `set_renewal_decision` e `renew_contracts`, gerador com `declined_count`, as duas matrizes (número real de casos e quando rodaram).

`QA_CHECKLIST.md`: seção "Roteiro de QA — S4c, rematrícula (etapa 1: banco)" com itens abertos: matrizes `renewal_matrix.sql` e `notifications_matrix.sql` `ok` contra o schema aplicado; grants (`anon` sem execute); aviso de rematrícula não nasce quando tudo está resolvido.

`docs/STATUS.md`: linha "S4c, etapa 1 (banco)" na tabela e o item "Etapa 2 (interface)" como próximo passo; registrar o achado sobre `enrollments`.

- [ ] **Step 3: Verificação**

Run: `npx vitest run 2>&1 | grep -E "Test Files|Tests |FAIL"` e `npm run build 2>&1 | grep -E "built in|error"` → verdes (nada de TypeScript mudou).

- [ ] **Step 4: Commit (push e PR só com o aval do usuário)**

```bash
git add docs/superpowers/specs/2026-11-19-s4c-rematricula-design.md CHANGELOG.md QA_CHECKLIST.md docs/STATUS.md
git commit -m "S4c etapa 1: CHANGELOG, roteiro de QA, STATUS e spec alinhada às decisões do plano" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Aplicar em produção (cada passo com autorização)

Esta tarefa **grava em produção**. Peça autorização por passo e mostre o `--dry-run` antes do `db push`. O PR da Etapa 1 deve estar mergeado ou aprovado pelo usuário.

**Files:**
- Modify (regenerar): `src/integrations/supabase/types.ts`

- [ ] **Step 1: Dry-run**

Run: `npx supabase@2.117.0 db push --linked --dry-run 2>&1 | tail -10`
Expected: lista **as quatro** migrations (`…140000`, `…140100`, `…140200`, `…140300`) e nenhuma outra.

- [ ] **Step 2: Aplicar (após autorização)**

Run: `npx supabase@2.117.0 db push --linked`
Verificar: `select to_regclass('public.renewal_decisions') is not null as tabela, (select count(*) from pg_proc where proname in ('set_renewal_decision','renew_contracts')) as rpcs, (select count(*) from public.renewal_decisions) as linhas, has_function_privilege('anon','public.renew_contracts(uuid,jsonb,uuid)','execute') as anon_exec, has_function_privilege('authenticated','public.renew_contracts(uuid,jsonb,uuid)','execute') as auth_exec` → `tabela: true`, `rpcs: 2`, `linhas: 0`, `anon_exec: false`, `auth_exec: true`.

- [ ] **Step 3: Matrizes contra o schema aplicado (BEGIN…ROLLBACK, com autorização)**

Run: `npx supabase@2.117.0 db query --linked -f supabase/tests/renewal_matrix.sql` e `… -f supabase/tests/notifications_matrix.sql`; todos os casos `ok`. Depois: `select count(*) from public.renewal_decisions` = 0 e nenhuma escola `Escola Teste Rematrícula%` restante. Registre as contagens no CHANGELOG.

- [ ] **Step 4: Regenerar os tipos e atualizar a documentação**

Run: `npx supabase@2.117.0 gen types typescript --linked > <arquivo temporário>`; confirme com diff que só **entram** `renewal_decisions` e os dois RPCs (nenhuma linha removida) e aplique em `src/integrations/supabase/types.ts` preservando o fim de linha original (o arquivo usa CRLF). Atualize CHANGELOG, QA e STATUS com o estado aplicado e o resultado das matrizes. `npx vitest run` e `npm run build` verdes.
Commit: `git add src/integrations/supabase/types.ts CHANGELOG.md QA_CHECKLIST.md docs/STATUS.md && git commit -m "S4c etapa 1 aplicada em produção: types.ts e docs atualizados" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`.

---

## Self-review

**Cobertura da spec (Etapa 1):**
- Tabela `renewal_decisions` com todas as colunas, CHECKs (motivo obrigatório sse "não vai"), RLS, `mfa_gate`, trigger de auditoria: Task 1.
- `set_renewal_decision` (papéis, escola do contrato, ativo, sem sucessor, `none` apaga, motivo): Task 1; casos 1a–1y.
- `renew_contracts` (validações, lote ≤ 100, atômico, pulados, taxa, auditoria `generated`, trava da origem): Task 2; casos 2a–2zj.
- Aviso de rematrícula (`declined_count`, só com pendentes): Task 3.
- Matrizes das duas áreas, docs, aplicação em produção e tipos: Tasks 1–5. A Etapa 2 (UI, `renewal.ts`, página, texto do aviso) fica para o plano seguinte, como a spec manda.
- Os desvios da spec estão declarados no plano (`p_school_id`, `enrollments` intocada) e alinhados na Task 4.

**Placeholders:** nenhum "TBD". O corpo do PR no fim da Task 4 é escrito no momento, a partir do CHANGELOG.

**Consistência de nomes e tipos:** `set_renewal_decision(p_contract_id, p_status, p_reason, p_note)` e `renew_contracts(p_school_id, p_items, p_fee_service_id)` têm as mesmas assinaturas nas migrations, nas matrizes (`pg_temp.decide`, `pg_temp.renew`), nos `revoke/grant` e na verificação de produção. Os códigos de erro (`NOT_ALLOWED`, `INVALID_STATUS`, `INVALID_CONTRACT`, `REASON_REQUIRED`, `INVALID_ITEMS`, `INVALID_ITEM`, `INVALID_SERVICE`) são os mesmos nos RPCs e nos casos. O formato do item de `p_items` bate com `pg_temp.item`/`rows12` e com o `jsonb_to_recordset` do RPC. As migrations `…140000` a `…140300` aparecem na mesma ordem em todo o plano.

**Riscos conhecidos:** (1) as matrizes não puderam ser executadas ao escrever o plano (só serão rodadas na execução); o caso `2q` (vencimentos repetidos) e o `2i` (duplicata no mesmo lote) são os mais sutis. (2) O ordenamento de chaves de `jsonb::text` (`renewed_count` antes de `declined_count`) foi deduzido da regra "por tamanho, depois bytes"; se a matriz mostrar a ordem inversa, ajustar a **expectativa**, não a função. (3) O caso `1c` assume que, antes de qualquer `renew_contracts`, a `audit_logs.source` da decisão é `manual`; por isso a parte 1 da matriz roda antes da parte 2 (o `set_config('app.audit_source')` do lote persiste até o fim da transação).
