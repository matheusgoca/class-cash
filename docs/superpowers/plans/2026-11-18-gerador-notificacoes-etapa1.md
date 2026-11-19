# S3 — Gerador de notificações, Etapa 1 (dados + gerador): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tabela `notifications`, função diária `generate_daily_notifications()` agendada no `pg_cron`, RPCs `list_notifications` e `mark_notifications_read`, com matriz SQL — sem nenhuma mudança de UI.

**Architecture:** Uma migration cria a tabela (RLS só leitura do próprio usuário + `mfa_gate`), a função geradora `SECURITY DEFINER` (agrega por usuário × escola × evento × dia, idempotente via UNIQUE, preservando `read_at`), o job às 08:00 UTC e dois RPCs para o front. Testes em `BEGIN…ROLLBACK` com uma escola de teste criada dentro da transação, para que as contagens sejam exatas.

**Tech Stack:** Postgres/Supabase (plpgsql, RLS, `pg_cron` em `pg_catalog`), Supabase CLI via `npx supabase@2.117.0`.

**Spec:** `docs/superpowers/specs/2026-11-18-gerador-notificacoes-design.md` (G1–G12; seção "Etapa 1").

## Global Constraints

- Eventos: `tuition_due`, `tuition_overdue`, `renegotiation_installment`, `expense_due`, `reenrollment`.
- Uma linha por `(user_id, school_id, event, reference_date)`; reexecução atualiza números e **preserva `read_at`**; contagem zero (ou destinatário que deixou de receber o evento) apaga só a linha **não lida** do dia (G5).
- Destinatários: papel e vínculo **atuais** — owner/admin (`mfa_is_admin_or_owner`) ou `user_roles.role = 'financial'`; `reenrollment` só owner/admin; `in_app` da preferência ou o padrão de `notification_event_defaults()`; antecedência da preferência ou o padrão (G7).
- "Hoje" no fuso de `notification_settings.timezone`, `America/Sao_Paulo` sem linha (G8).
- Job `generate-daily-notifications` às `0 8 * * *` (08:00 UTC = 05:00 Brasília) (G9).
- Segurança (G12): RLS SELECT `(user_id = auth.uid() and school_id = get_user_school_id()) or is_master_admin()`; sem policies de escrita; RESTRICTIVE `mfa_gate`; RPCs com `perform public.assert_mfa_gate();` primeiro e `school_id` de `get_user_school_id()`; FKs `on delete cascade`; `gen_random_uuid()`; trigger `public.set_updated_at()`.
- Escrita em produção (`db push`, DML) **só com autorização explícita do usuário**, mostrando o `--dry-run` antes. `BEGIN…ROLLBACK` não precisa.
- CLI: `npx supabase@2.117.0 …`. Saída do `db query` é JSON depois de algumas linhas de log.
- Commits em português explicando o porquê; **sem push** até o usuário pedir. Branch: `feature/s3-gerador-notificacoes` (já criado; a spec está nele).

## Diagnóstico já feito (2026-11-18, produção, leitura)

- `expenses.status` ∈ {pending, paid, overdue, cancelled} (CHECK). `contracts.status` em uso: active, cancelled. `tuitions.status` em uso: pending, overdue, paid, cancelled.
- `pg_cron` instalado em `pg_catalog`; job existente `promote-overdue-tuitions` às `0 3 * * *` (usa `current_date`, em UTC).
- Colunas obrigatórias sem default: `schools(name)`; `classes(name)`; `students(full_name, birth_date)`; `contracts(student_id)`; `tuitions(student_id, description, amount, due_date)`; `expenses(school_id, category_id, description, amount, due_date)`; `expense_categories(school_id, name)` (UNIQUE `(school_id, name)`); `renegotiations(student_id, school_id, original_amount, new_installment_amount, installments, total_renegotiated, first_due_date)`.
- `schools` tem trigger `ensure_owner_is_admin_trigger` (AFTER INSERT, sem WHEN): insere `user_roles(owner_user_id, 'admin')` — por isso a escola de teste usa `owner_user_id` = master (que já é admin).
- Parcelas de renegociação são `tuitions` com `renegotiation_id`.

## Decisões de plano (refinam a spec)

- **`expense_due` considera `status in ('pending','overdue')`** (exclui `paid` e `cancelled`). A spec dizia "`<> 'paid'` — confirmar"; o diagnóstico mostrou `cancelled`.
- **Paginação por `p_offset`, não cursor por `created_at`.** Todas as linhas de uma execução têm o mesmo `created_at` (mesma transação), então um cursor por tempo pularia itens. Avisos chegam uma vez por dia, então offset é estável. `list_notifications(p_offset, p_limit, p_category, p_unread_only)`.
- Ordenação da lista: `reference_date desc`, ordem do evento em `notification_event_defaults().sort_order`, `id`.

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20261118150000_notifications_generator.sql` | Tabela, índices, trigger, RLS, `mfa_gate`, gerador, job, 2 RPCs, permissões |
| `supabase/tests/notifications_matrix.sql` | Matriz `BEGIN…ROLLBACK` |
| `src/integrations/supabase/types.ts` | Regenerado após o push |
| `CHANGELOG.md`, `QA_CHECKLIST.md` | Registro da etapa 1 |

---

### Task 1: Matriz SQL + migration (TDD em `BEGIN…ROLLBACK`)

**Files:**
- Create: `supabase/tests/notifications_matrix.sql`
- Create: `supabase/migrations/20261118150000_notifications_generator.sql`

**Interfaces:**
- Produces:
  - `public.generate_daily_notifications(p_now timestamptz default now()) → integer` (linhas inseridas/atualizadas)
  - RPC `public.list_notifications(p_offset integer default 0, p_limit integer default 20, p_category text default null, p_unread_only boolean default false) → jsonb`:
    ```json
    { "items": [ { "id": "…", "event": "tuition_overdue", "reference_date": "2031-03-10", "offset_days": 5,
                   "item_count": 2, "total_amount": 120.00, "details": { "class_count": 1 },
                   "read_at": null, "created_at": "…" } ],
      "filtered_total": 2, "total": 5, "unread": 5 }
    ```
    `p_category ∈ {cobranca, renegociacao, despesas, rematricula}`; `total`/`unread` ignoram filtros; `filtered_total` respeita categoria e `p_unread_only`.
  - RPC `public.mark_notifications_read(p_ids uuid[] default null) → integer`
  - Erros: `MFA_REQUIRED` (42501, do gate), `NOT_ALLOWED` (42501), `NO_SCHOOL` (P0001), `INVALID_CATEGORY` (22023), `INVALID_LIMIT` (22023).
  - `details` por evento: `tuition_due`/`tuition_overdue` → `{"class_count": n}`; `renegotiation_installment` → `{}`; `expense_due` → `{"description": "…"}` só com 1 item, senão `{}`; `reenrollment` → `{"renewed_count": n}`; `total_amount` nulo em `reenrollment`.

- [ ] **Step 1: Escrever a matriz (falha antes da migration)**

`supabase/tests/notifications_matrix.sql`:

```sql
-- Matriz do gerador de notificações (S3, etapa 1).
-- Spec: docs/superpowers/specs/2026-11-18-gerador-notificacoes-design.md
-- Tudo dentro de BEGIN ... ROLLBACK: nada persiste.
-- ATENÇÃO: roda contra PRODUÇÃO, cria uma escola de teste, move dois usuários de teste para ela,
-- muda papéis e roda o gerador para TODAS as escolas dentro da transação — NUNCA remova o "rollback;" do final.
--
-- Como rodar:
--   Migration já aplicada:  npx supabase@2.117.0 db query --linked -f supabase/tests/notifications_matrix.sql
--   Migration NÃO aplicada: gerar um arquivo que troca a linha marcadora MIGRATION (abaixo, sozinha na linha)
--     pelo conteúdo de supabase/migrations/20261118150000_notifications_generator.sql e rodar esse arquivo.
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

-- linha de um aviso do usuário/evento como texto comparável
create function pg_temp.notif(p_uid uuid, p_event text) returns text language sql as $f$
  select coalesce((
    select item_count::text || '|' || coalesce(total_amount::numeric(12,2)::text, '-') || '|' || details::text
      from public.notifications where user_id = p_uid and event = p_event
     order by reference_date desc limit 1), 'none')
$f$;

do $$
declare
  u_master uuid := '52d00ab5-567f-4537-b33a-22c2bd44e14d'; -- master + owner + admin, Colegio Teste
  u_admin  uuid := 'e0185312-eea9-4273-a9a8-ad9d575d4781'; -- admin, Colegio Teste (movido para a escola X)
  u_fin    uuid := 'b7ba4eb2-c7a2-4129-83a8-de8e7175c446'; -- financeiro, Colegio Teste (movido para a escola X)
  c_now    timestamptz := '2031-03-10 08:00:00+00';       -- 05:00 em São Paulo → "hoje" = 2031-03-10
  d        date := date '2031-03-10';
  s_x uuid; cl1 uuid; cl2 uuid; st uuid; k1 uuid; k2 uuid; k3 uuid; cat uuid; rn uuid;
  v text; v_id uuid;
begin
  perform set_config('request.jwt.claims', '', true);

  -- Escola de teste isolada: contagens exatas, sem dados reais misturados.
  insert into public.schools (name, owner_user_id) values ('Escola Teste Notificações', u_master) returning id into s_x;
  update public.profiles set school_id = s_x where user_id in (u_admin, u_fin);
  delete from auth.mfa_factors where user_id in (u_admin, u_fin);
  delete from public.mfa_grace  where user_id in (u_admin, u_fin);
  delete from public.notification_preferences where user_id in (u_admin, u_fin);
  delete from public.notification_settings    where user_id in (u_admin, u_fin);
  delete from public.notifications            where user_id in (u_admin, u_fin);

  insert into public.classes (name, school_id) values ('Turma A', s_x) returning id into cl1;
  insert into public.classes (name, school_id) values ('Turma B', s_x) returning id into cl2;
  insert into public.students (full_name, birth_date, school_id) values ('Aluno Teste', date '2015-01-01', s_x) returning id into st;
  insert into public.contracts (student_id, class_id, school_id, start_date, end_date, status, monthly_amount)
    values (st, cl1, s_x, date '2031-01-01', d + 45, 'active', 100) returning id into k1;
  insert into public.contracts (student_id, class_id, school_id, start_date, end_date, status, monthly_amount)
    values (st, cl2, s_x, date '2031-01-01', d + 45, 'active', 200) returning id into k2;
  insert into public.contracts (student_id, class_id, school_id, start_date, end_date, status, monthly_amount, renewed_from_id)
    values (st, cl2, s_x, d + 46, d + 400, 'active', 200, k2) returning id into k3;   -- renova k2

  -- tuition_due (N=3): 2 itens, R$ 300, 2 turmas. Pago e cancelado não contam.
  insert into public.tuitions (student_id, contract_id, school_id, description, amount, due_date, status) values
    (st, k1, s_x, 'Mensalidade', 100, d + 3, 'pending'),
    (st, k2, s_x, 'Mensalidade', 200, d + 3, 'pending'),
    (st, k1, s_x, 'Mensalidade', 999, d + 3, 'paid'),
    (st, k1, s_x, 'Mensalidade', 999, d + 3, 'cancelled'),
    (st, k1, s_x, 'Mensalidade',  10, d + 5, 'pending');   -- só para quem usa N=5 (caso 4)
  -- tuition_overdue (N=5, acumulado): d-6 (R$ 50) e d-20 (final_amount R$ 70) contam; d-5 não (exatamente N).
  insert into public.tuitions (student_id, contract_id, school_id, description, amount, final_amount, due_date, status) values
    (st, k1, s_x, 'Mensalidade',  50, null, d - 6,  'overdue'),
    (st, k1, s_x, 'Mensalidade',  60,   70, d - 20, 'overdue'),
    (st, k1, s_x, 'Mensalidade', 999, null, d - 5,  'overdue');
  -- renegotiation_installment (N=1): 1 parcela de R$ 80.
  insert into public.renegotiations (student_id, school_id, original_amount, new_installment_amount, installments, total_renegotiated, first_due_date)
    values (st, s_x, 160, 80, 2, 160, d + 1) returning id into rn;
  insert into public.tuitions (student_id, school_id, description, amount, due_date, status, renegotiation_id) values
    (st, s_x, 'Parcela 1/2', 80, d + 1, 'pending', rn);
  -- expense_due (N=2): 1 despesa "Aluguel" R$ 4200; paga não conta.
  insert into public.expense_categories (school_id, name) values (s_x, 'Infraestrutura') returning id into cat;
  insert into public.expenses (school_id, category_id, description, amount, due_date, status) values
    (s_x, cat, 'Aluguel', 4200, d + 2, 'pending'),
    (s_x, cat, 'Luz', 300, d + 2, 'paid');

  -- caso 3/4: financeiro desliga despesas no sistema e usa N=5 em mensalidade a vencer
  insert into public.notification_preferences (school_id, user_id, event, in_app, email, offset_days) values
    (s_x, u_fin, 'expense_due', false, false, 2),
    (s_x, u_fin, 'tuition_due', true, false, 5);

  perform public.generate_daily_notifications(c_now);

  -- 1. Cada evento para o admin (padrões)
  perform pg_temp.rec('1a admin tuition_due',     pg_temp.notif(u_admin, 'tuition_due'),     '2|300.00|{"class_count": 2}');
  perform pg_temp.rec('1b admin tuition_overdue', pg_temp.notif(u_admin, 'tuition_overdue'), '2|120.00|{"class_count": 1}');
  perform pg_temp.rec('1c admin renegotiation',   pg_temp.notif(u_admin, 'renegotiation_installment'), '1|80.00|{}');
  perform pg_temp.rec('1d admin expense_due',     pg_temp.notif(u_admin, 'expense_due'),     '1|4200.00|{"description": "Aluguel"}');
  perform pg_temp.rec('1e admin reenrollment',    pg_temp.notif(u_admin, 'reenrollment'),    '2|-|{"renewed_count": 1}');
  perform pg_temp.rec('1f reference_date = hoje SP',
    (select string_agg(distinct reference_date::text, ',') from public.notifications where user_id = u_admin), '2031-03-10');
  perform pg_temp.rec('1g offset_days do padrão gravado',
    (select offset_days::text from public.notifications where user_id = u_admin and event = 'reenrollment'), '45');

  -- 2. Atraso: exatamente N dias não conta (o R$ 999 de d-5 ficou de fora)
  perform pg_temp.rec('2a d-5 fora do acumulado', (pg_temp.notif(u_admin, 'tuition_overdue') not like '%999%')::text, 'true');

  -- 3/4/5. Preferências e papéis
  perform pg_temp.rec('3a financeiro com despesa desligada', pg_temp.notif(u_fin, 'expense_due'), 'none');
  perform pg_temp.rec('4a financeiro com N=5',               pg_temp.notif(u_fin, 'tuition_due'), '1|10.00|{"class_count": 1}');
  perform pg_temp.rec('5a financeiro sem rematrícula',       pg_temp.notif(u_fin, 'reenrollment'), 'none');
  perform pg_temp.rec('5b financeiro recebe atraso',         pg_temp.notif(u_fin, 'tuition_overdue'), '2|120.00|{"class_count": 1}');
  perform pg_temp.rec('5c master não recebe da escola X',
    (select count(*)::text from public.notifications where user_id = u_master and school_id = s_x), '0');

  -- 8. Isolamento: nenhuma linha dos dois usuários fora da escola X
  perform pg_temp.rec('8a linhas só da escola X',
    (select count(*)::text from public.notifications where user_id in (u_admin, u_fin) and school_id <> s_x), '0');

  -- 9. RPCs (como usuário, RLS real)
  perform pg_temp.rec('9a list admin: total',  pg_temp.run_as(u_admin, 'aal1', 'select (public.list_notifications()->>''total'')'), '5');
  perform pg_temp.rec('9b list admin: unread', pg_temp.run_as(u_admin, 'aal1', 'select (public.list_notifications()->>''unread'')'), '5');
  perform pg_temp.rec('9c list cobranca',      pg_temp.run_as(u_admin, 'aal1',
    'select (public.list_notifications(0, 20, ''cobranca'')->>''filtered_total'')'), '2');
  perform pg_temp.rec('9d list categoria inválida', pg_temp.run_as(u_admin, 'aal1',
    'select public.list_notifications(0, 20, ''xyz'')::text'), 'ERR:22023:INVALID_CATEGORY');
  perform pg_temp.rec('9e list limite inválido', pg_temp.run_as(u_admin, 'aal1',
    'select public.list_notifications(0, 0)::text'), 'ERR:22023:INVALID_LIMIT');
  perform pg_temp.rec('9f paginação: 2 itens com limit 2', pg_temp.run_as(u_admin, 'aal1',
    'select jsonb_array_length(public.list_notifications(0, 2)->''items'')::text'), '2');
  v_id := (select id from public.notifications where user_id = u_admin and event = 'tuition_due');
  perform pg_temp.rec('9g financeiro não marca aviso do admin', pg_temp.run_as(u_fin, 'aal1',
    format('select public.mark_notifications_read(array[%L]::uuid[])::text', v_id)), '0');
  perform pg_temp.rec('9h admin marca o próprio', pg_temp.run_as(u_admin, 'aal1',
    format('select public.mark_notifications_read(array[%L]::uuid[])::text', v_id)), '1');
  perform pg_temp.rec('9i unread caiu para 4', pg_temp.run_as(u_admin, 'aal1', 'select (public.list_notifications()->>''unread'')'), '4');
  perform pg_temp.rec('9j financeiro só vê os próprios', pg_temp.run_as(u_fin, 'aal1',
    format('select count(*)::text from public.notifications where user_id = %L', u_admin)), '0');

  -- 10. Escrita direta bloqueada
  perform pg_temp.rec('10a INSERT direto falha', pg_temp.run_as(u_admin, 'aal1', format(
    $q$with x as (insert into public.notifications (school_id, user_id, event, reference_date, offset_days, item_count)
       values (%L, auth.uid(), 'tuition_due', current_date, 3, 1) returning 1) select count(*)::text from x$q$, s_x)), 'ERR:42501');
  perform pg_temp.rec('10b UPDATE direto não afeta', pg_temp.run_as(u_admin, 'aal1',
    'with x as (update public.notifications set read_at = now() where user_id = auth.uid() returning 1) select count(*)::text from x'), '0');

  -- 9. Gate de 2FA nos RPCs
  perform set_config('request.jwt.claims', '', true);
  update public.schools set require_2fa = true where id = s_x;
  delete from public.mfa_grace where user_id in (u_admin, u_fin);
  perform pg_temp.rec('9k admin aal1 sem carência bloqueado', pg_temp.run_as(u_admin, 'aal1',
    'select public.list_notifications()::text'), 'ERR:42501:MFA_REQUIRED');
  perform pg_temp.rec('9l financeiro passa', pg_temp.run_as(u_fin, 'aal1',
    'select (public.list_notifications()->>''total'')'), '3');
  perform set_config('request.jwt.claims', '', true);
  update public.schools set require_2fa = false where id = s_x;

  -- 6. Idempotência
  perform public.generate_daily_notifications(c_now);
  perform pg_temp.rec('6a reexecução não duplica',
    (select count(*)::text from public.notifications where user_id = u_admin), '5');
  perform pg_temp.rec('6b read_at preservado',
    (select (read_at is not null)::text from public.notifications where id = v_id), 'true');
  update public.tuitions set status = 'paid' where school_id = s_x and due_date = d + 3;   -- zera tuition_due (o lido)
  update public.expenses set status = 'paid' where school_id = s_x;                       -- zera expense_due (não lido)
  perform public.generate_daily_notifications(c_now);
  perform pg_temp.rec('6c zerado e lido: mantém',
    (select count(*)::text from public.notifications where id = v_id), '1');
  perform pg_temp.rec('6d zerado e não lido: apaga', pg_temp.notif(u_admin, 'expense_due'), 'none');

  -- 5. Papel atual: admin rebaixado a financeiro perde a rematrícula não lida; professor não recebe nada
  update public.user_roles set role = 'financial' where user_id = u_admin;
  update public.user_roles set role = 'teacher'   where user_id = u_fin;
  perform public.generate_daily_notifications(c_now);
  perform pg_temp.rec('5d rebaixado sem rematrícula', pg_temp.notif(u_admin, 'reenrollment'), 'none');
  perform pg_temp.rec('5e professor sem avisos novos (não lidos apagados)',
    (select count(*)::text from public.notifications where user_id = u_fin and read_at is null), '0');
  update public.user_roles set role = 'admin'     where user_id = u_admin;
  update public.user_roles set role = 'financial' where user_id = u_fin;

  -- 7. Fuso: financeiro em Honolulu (UTC-10) → "hoje" = 2031-03-09
  delete from public.notifications where user_id = u_fin;
  insert into public.notification_settings (school_id, user_id, timezone) values (s_x, u_fin, 'Pacific/Honolulu');
  perform public.generate_daily_notifications(c_now);
  perform pg_temp.rec('7a reference_date no fuso do usuário',
    (select string_agg(distinct reference_date::text, ',') from public.notifications where user_id = u_fin), '2031-03-09');
  perform pg_temp.rec('7b atraso calculado no "hoje" dele', pg_temp.notif(u_fin, 'tuition_overdue'), '1|70.00|{"class_count": 1}');

  -- 11. Job agendado
  perform pg_temp.rec('11a job às 08:00 UTC',
    (select schedule from cron.job where jobname = 'generate-daily-notifications'), '0 8 * * *');
end $$;

select n, cenario, got, esperado, ok from t_res order by n;

rollback;
```

Notas para quem executa: (a) se algum `insert` de dados de teste falhar por coluna obrigatória ou CHECK não listados no diagnóstico, ajustar **só os dados de teste** (não as expectativas) e registrar no relatório; (b) se uma expectativa parecer errada, **não alterar** — parar e reportar NEEDS_CONTEXT com a linha, got e esperado; (c) a expectativa 7b assume que, no "hoje" 2031-03-09 com N=5, só a mensalidade de d-20 está vencida há mais de 5 dias (d-6 = 2031-03-04 não é `< 2031-03-04`).

- [ ] **Step 2: Rodar sem a migration → deve falhar**

Run: `npx supabase@2.117.0 db query --linked -f supabase/tests/notifications_matrix.sql`
Expected: erro `function public.generate_daily_notifications(timestamp with time zone) does not exist` ou `relation "public.notifications" does not exist`. Nada persiste.

- [ ] **Step 3: Escrever a migration**

`supabase/migrations/20261118150000_notifications_generator.sql`:

```sql
-- S3, etapa 1: notificações no sistema geradas diariamente (sem e-mail; S4).
-- Spec: docs/superpowers/specs/2026-11-18-gerador-notificacoes-design.md (G1–G12).
-- Escrita só pelo gerador (cron) e por mark_notifications_read; sem policies de escrita.

-- 1. Tabela --------------------------------------------------------------------
create table if not exists public.notifications (
  id             uuid primary key default gen_random_uuid(),
  school_id      uuid not null references public.schools(id) on delete cascade,
  user_id        uuid not null references auth.users(id)     on delete cascade,
  event          text not null
                 check (event in ('tuition_due','tuition_overdue','renegotiation_installment','expense_due','reenrollment')),
  reference_date date not null,                -- o "hoje" do usuário no momento da geração
  offset_days    integer not null,
  item_count     integer not null check (item_count > 0),
  total_amount   numeric,                      -- nulo em reenrollment
  details        jsonb not null default '{}'::jsonb,
  read_at        timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint notifications_user_school_event_day_key unique (user_id, school_id, event, reference_date)
);
create index if not exists idx_notifications_user_school_created
  on public.notifications (user_id, school_id, created_at desc);
create index if not exists idx_notifications_unread
  on public.notifications (user_id, school_id) where read_at is null;

drop trigger if exists update_notifications_updated_at on public.notifications;
create trigger update_notifications_updated_at
  before update on public.notifications
  for each row execute function public.set_updated_at();

-- 2. RLS -----------------------------------------------------------------------
alter table public.notifications enable row level security;

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated
  using ((user_id = auth.uid() and school_id = public.get_user_school_id()) or public.is_master_admin());

drop policy if exists mfa_gate on public.notifications;
create policy mfa_gate on public.notifications as restrictive for all to authenticated
  using ((select public.mfa_gate_ok())) with check ((select public.mfa_gate_ok()));

-- 3. Gerador -------------------------------------------------------------------
-- Roda pelo cron (sem usuário), por isso sem assert_mfa_gate (mesmo motivo de
-- promote_overdue_tuitions). p_now existe para os testes fixarem o "agora".
-- Regras por evento (N = antecedência do usuário, "hoje" no fuso dele):
--   tuition_due               pending, sem renegociação, due_date = hoje + N
--   tuition_overdue           overdue, due_date < hoje - N   (acumulado: repete todo dia)
--   renegotiation_installment pending, com renegociação, due_date = hoje + N
--   expense_due               pending/overdue, due_date = hoje + N
--   reenrollment              contrato active, end_date = hoje + N
create or replace function public.generate_daily_notifications(p_now timestamptz default now())
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  drop table if exists pg_temp._notif_recipients;
  drop table if exists pg_temp._notif_daily;

  -- Destinatários: papel e vínculo ATUAIS (owner/admin ou financeiro).
  create temp table _notif_recipients on commit drop as
  select p.user_id,
         p.school_id,
         public.mfa_is_admin_or_owner(p.user_id, p.school_id) as is_admin,
         (p_now at time zone coalesce(s.timezone, 'America/Sao_Paulo'))::date as today
    from public.profiles p
    left join public.notification_settings s on s.user_id = p.user_id and s.school_id = p.school_id
   where p.school_id is not null
     and (public.mfa_is_admin_or_owner(p.user_id, p.school_id)
          or exists (select 1 from public.user_roles r where r.user_id = p.user_id and r.role = 'financial'));

  create temp table _notif_daily on commit drop as
  with targets as (
    select r.user_id, r.school_id, r.today, d.event,
           coalesce(np.offset_days, d.offset_days) as n
      from _notif_recipients r
      cross join public.notification_event_defaults() d
      left join public.notification_preferences np
        on np.user_id = r.user_id and np.school_id = r.school_id and np.event = d.event
     where coalesce(np.in_app, d.in_app)
       and (r.is_admin or not d.admin_only)
  )
  select t.user_id, t.school_id, t.event, t.today, t.n, x.item_count, x.total_amount, x.details
    from targets t
    cross join lateral (
      select count(*)::integer as item_count,
             sum(coalesce(tu.final_amount, tu.amount)) as total_amount,
             jsonb_build_object('class_count', count(distinct c.class_id)) as details
        from public.tuitions tu
        left join public.contracts c on c.id = tu.contract_id and c.school_id = tu.school_id
       where t.event = 'tuition_due' and tu.school_id = t.school_id
         and tu.status = 'pending' and tu.renegotiation_id is null and tu.due_date = t.today + t.n
      union all
      select count(*)::integer,
             sum(coalesce(tu.final_amount, tu.amount)),
             jsonb_build_object('class_count', count(distinct c.class_id))
        from public.tuitions tu
        left join public.contracts c on c.id = tu.contract_id and c.school_id = tu.school_id
       where t.event = 'tuition_overdue' and tu.school_id = t.school_id
         and tu.status = 'overdue' and tu.due_date < t.today - t.n
      union all
      select count(*)::integer, sum(coalesce(tu.final_amount, tu.amount)), '{}'::jsonb
        from public.tuitions tu
       where t.event = 'renegotiation_installment' and tu.school_id = t.school_id
         and tu.status = 'pending' and tu.renegotiation_id is not null and tu.due_date = t.today + t.n
      union all
      select count(*)::integer, sum(e.amount),
             case when count(*) = 1 then jsonb_build_object('description', min(e.description)) else '{}'::jsonb end
        from public.expenses e
       where t.event = 'expense_due' and e.school_id = t.school_id
         and e.status in ('pending', 'overdue') and e.due_date = t.today + t.n
      union all
      select count(*)::integer, null::numeric,
             jsonb_build_object('renewed_count', count(*) filter (where exists (
               select 1 from public.contracts r2
                where r2.renewed_from_id = c.id and r2.school_id = c.school_id)))
        from public.contracts c
       where t.event = 'reenrollment' and c.school_id = t.school_id
         and c.status = 'active' and c.end_date = t.today + t.n
    ) x
   where x.item_count > 0;

  insert into public.notifications (school_id, user_id, event, reference_date, offset_days, item_count, total_amount, details)
  select school_id, user_id, event, today, n, item_count, total_amount, details
    from _notif_daily
  on conflict (user_id, school_id, event, reference_date) do update
    set offset_days  = excluded.offset_days,
        item_count   = excluded.item_count,
        total_amount = excluded.total_amount,
        details      = excluded.details;          -- read_at preservado
  get diagnostics v_rows = row_count;

  -- Aviso NÃO LIDO de hoje que deixou de valer (zerou, preferência desligada, papel mudou): apaga.
  delete from public.notifications n
   using _notif_recipients r
   where n.user_id = r.user_id and n.school_id = r.school_id and n.reference_date = r.today
     and n.read_at is null
     and not exists (select 1 from _notif_daily dd
                      where dd.user_id = n.user_id and dd.school_id = n.school_id and dd.event = n.event);

  -- Quem deixou de ser destinatário (ex.: virou professor): apaga os não lidos de hoje (hoje em São Paulo).
  delete from public.notifications n
   where n.read_at is null
     and n.reference_date = (p_now at time zone 'America/Sao_Paulo')::date
     and not exists (select 1 from _notif_recipients r where r.user_id = n.user_id and r.school_id = n.school_id);

  return v_rows;
end $$;

-- 4. RPCs para o front ---------------------------------------------------------
create or replace function public.list_notifications(
  p_offset integer default 0, p_limit integer default 20,
  p_category text default null, p_unread_only boolean default false)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_school uuid;
  v_events text[];
begin
  perform public.assert_mfa_gate();
  if v_uid is null then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  v_school := public.get_user_school_id();
  if v_school is null then
    raise exception 'NO_SCHOOL' using errcode = 'P0001';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 or p_offset is null or p_offset < 0 then
    raise exception 'INVALID_LIMIT' using errcode = '22023';
  end if;
  if p_category is null then
    v_events := null;
  elsif p_category = 'cobranca' then
    v_events := array['tuition_due', 'tuition_overdue'];
  elsif p_category = 'renegociacao' then
    v_events := array['renegotiation_installment'];
  elsif p_category = 'despesas' then
    v_events := array['expense_due'];
  elsif p_category = 'rematricula' then
    v_events := array['reenrollment'];
  else
    raise exception 'INVALID_CATEGORY' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', q.id, 'event', q.event, 'reference_date', q.reference_date,
               'offset_days', q.offset_days, 'item_count', q.item_count,
               'total_amount', q.total_amount, 'details', q.details,
               'read_at', q.read_at, 'created_at', q.created_at)
             order by q.reference_date desc, q.sort_order, q.id)
        from (
          select n.*, d.sort_order
            from public.notifications n
            join public.notification_event_defaults() d on d.event = n.event
           where n.user_id = v_uid and n.school_id = v_school
             and (v_events is null or n.event = any (v_events))
             and (not coalesce(p_unread_only, false) or n.read_at is null)
           order by n.reference_date desc, d.sort_order, n.id
           offset p_offset limit p_limit) q), '[]'::jsonb),
    'filtered_total', (select count(*) from public.notifications n
                        where n.user_id = v_uid and n.school_id = v_school
                          and (v_events is null or n.event = any (v_events))
                          and (not coalesce(p_unread_only, false) or n.read_at is null)),
    'total',  (select count(*) from public.notifications n where n.user_id = v_uid and n.school_id = v_school),
    'unread', (select count(*) from public.notifications n
                where n.user_id = v_uid and n.school_id = v_school and n.read_at is null));
end $$;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_school uuid;
  v_count  integer;
begin
  perform public.assert_mfa_gate();
  if v_uid is null then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  v_school := public.get_user_school_id();
  if v_school is null then
    raise exception 'NO_SCHOOL' using errcode = 'P0001';
  end if;
  update public.notifications
     set read_at = now()
   where user_id = v_uid and school_id = v_school and read_at is null
     and (p_ids is null or id = any (p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- 5. Permissões ----------------------------------------------------------------
revoke all on function public.generate_daily_notifications(timestamptz)          from public, anon, authenticated;
revoke all on function public.list_notifications(integer, integer, text, boolean) from public, anon;
revoke all on function public.mark_notifications_read(uuid[])                     from public, anon;
grant execute on function public.list_notifications(integer, integer, text, boolean) to authenticated;
grant execute on function public.mark_notifications_read(uuid[])                     to authenticated;

-- 6. Job diário: 08:00 UTC = 05:00 em Brasília (depois de promote-overdue-tuitions às 03:00 UTC,
--    antes do resumo mais cedo da S4, 06:00).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'generate-daily-notifications') then
    perform cron.unschedule('generate-daily-notifications');
  end if;
  perform cron.schedule('generate-daily-notifications', '0 8 * * *',
                        'select public.generate_daily_notifications();');
end $$;
```

- [ ] **Step 4: Rodar com a migration embutida → deve passar**

```bash
T=$(mktemp -d)
python3 -I - "$T/m.sql" <<'EOF'
import sys
m = open('supabase/migrations/20261118150000_notifications_generator.sql').read()
t = open('supabase/tests/notifications_matrix.sql').read()
assert t.count('\n-- @@MIGRATION@@\n') == 1
open(sys.argv[1], 'w').write(t.replace('\n-- @@MIGRATION@@\n', '\n' + m + '\n', 1))
EOF
npx supabase@2.117.0 db query --linked -f "$T/m.sql"
```

Expected: todas as linhas com `ok = true`. Se alguma falhar, corrigir a **migration** e repetir (nunca a expectativa sem reportar). Depois, conferir que nada persistiu:

```bash
npx supabase@2.117.0 db query --linked "select (select count(*) from information_schema.tables where table_schema='public' and table_name='notifications') as tabela, (select count(*) from cron.job where jobname='generate-daily-notifications') as job, (select count(*) from public.schools where name='Escola Teste Notificações') as escola"
```

Expected: `0 | 0 | 0`.

- [ ] **Step 5: Commit (migration ainda NÃO aplicada)**

```bash
git add supabase/migrations/20261118150000_notifications_generator.sql supabase/tests/notifications_matrix.sql
git commit -m "Gerador diário de notificações (S3, etapa 1) + matriz BEGIN/ROLLBACK, ainda não aplicado" -m "Uma linha por usuário, escola, evento e dia, idempotente e preservando o lido; destinatários pelo papel atual e pelas preferências; job às 05:00 de Brasília."
```

---

### Task 2: Aplicar em produção, tipos, documentação

**Files:**
- Modify: `src/integrations/supabase/types.ts` (regenerado), `CHANGELOG.md`, `QA_CHECKLIST.md`

**Interfaces:**
- Consumes: migration e matriz da Task 1.

- [ ] **Step 1: Dry-run e autorização**

Run: `npx supabase@2.117.0 db push --linked --dry-run`
Expected: exatamente `20261118150000_notifications_generator.sql`. Mostrar ao usuário e **pedir autorização explícita**. Sem autorização, parar.

- [ ] **Step 2: Aplicar e revalidar (após autorização)**

```bash
npx supabase@2.117.0 db push --linked
npx supabase@2.117.0 db query --linked -f supabase/tests/notifications_matrix.sql
npx supabase@2.117.0 db query --linked "select jobname, schedule, active from cron.job order by jobname"
npx supabase@2.117.0 db query --linked "select count(*) from public.notifications"
```

Expected: 1 migration aplicada; matriz toda `ok = true`; dois jobs (`generate-daily-notifications` `0 8 * * *` ativo, `promote-overdue-tuitions`); `0` notificações (a primeira geração real é às 08:00 UTC seguinte).

- [ ] **Step 3: Tipos**

```bash
npx supabase@2.117.0 gen types typescript --linked > src/integrations/supabase/types.ts
git diff --stat src/integrations/supabase/types.ts
```

Expected: só adições (`notifications`, `generate_daily_notifications`, `list_notifications`, `mark_notifications_read`). Diferenças em outras tabelas = drift: reportar antes de commitar.

- [ ] **Step 4: Documentação**

`CHANGELOG.md`, logo depois de `# Application Sync Changelog`:

```markdown
## Sprint S3 — Gerador de notificações, etapa 1 (2026-11-18)

Spec: `docs/superpowers/specs/2026-11-18-gerador-notificacoes-design.md`. Plano: `docs/superpowers/plans/2026-11-18-gerador-notificacoes-etapa1.md`.

- Tabela `notifications` (uma linha por usuário × escola × evento × dia, dados estruturados; textos montados no front na etapa 2) e função `generate_daily_notifications()`, agendada no `pg_cron` às 08:00 UTC (05:00 em Brasília). Migration `20261118150000_notifications_generator.sql`.
- Destinatários pelo papel e vínculo atuais e pelas preferências (ou padrões); "hoje" no fuso do usuário; atraso como lembrete diário acumulado; reexecução idempotente preservando o lido.
- RPCs `list_notifications` (paginação por offset — todas as linhas de uma geração têm o mesmo `created_at`) e `mark_notifications_read`; gate de 2FA e `school_id` de `get_user_school_id()`.
- Matriz `supabase/tests/notifications_matrix.sql` em `BEGIN ... ROLLBACK`, com uma escola de teste criada dentro da transação.
- Ainda sem interface (etapa 2): os avisos começam a se acumular a partir da primeira execução do job.
```

`QA_CHECKLIST.md`, logo depois de `# QA Testing Checklist`:

```markdown
## Roteiro de QA — S3, gerador de notificações, etapa 1 (2026-11-18)

- [ ] Matriz `supabase/tests/notifications_matrix.sql` toda `ok = true` contra o schema aplicado
- [ ] `cron.job` com `generate-daily-notifications` (`0 8 * * *`, ativo)
- [ ] Na manhã seguinte ao deploy: `cron.job_run_details` com a execução `succeeded` e linhas em `notifications` para owner/admin/financeiro das escolas com dados
```

- [ ] **Step 5: Commit**

```bash
git add src/integrations/supabase/types.ts CHANGELOG.md QA_CHECKLIST.md
git commit -m "Aplica o gerador de notificações (S3, etapa 1): tipos, CHANGELOG e roteiro de QA"
```

- [ ] **Step 6: Entregar ao usuário** — resultado da matriz antes e depois do push, jobs ativos, e pedir autorização para push do branch e PR.

---

## Self-Review

- **Cobertura da spec (Etapa 1):** tabela e colunas (T1 migration §1) · UNIQUE/índices (§1) · regras por evento (§3, comentário + lateral) · G3 acumulado (caso 2a) · G5 idempotência, preserva lido, apaga não lido zerado (6a–6d) · G7 destinatários/papel atual/preferências/padrões (1a–1g, 3a, 4a, 5a–5e) · G8 fuso (7a, 7b) · G9 job (11a, §6) · G12 RLS/gate/escrita bloqueada (9j, 9k, 10a, 10b) · RPCs (9a–9i, 9l) · isolamento de escola (8a) · contagem zero sem linha (`where x.item_count > 0`).
- **Placeholders:** nenhum; as condicionais são instruções explícitas de parar e reportar.
- **Consistência:** nomes de funções, parâmetros e chaves do JSON idênticos entre migration, matriz e "Interfaces"; `details` por evento igual à spec; categoria `cobranca` = `tuition_due` + `tuition_overdue` como na spec.
- **Riscos declarados:** o gerador processa todas as escolas — dentro do `ROLLBACK` da matriz isso inclui dados reais (nada persiste); o segundo `delete` (quem deixou de ser destinatário) usa o "hoje" de São Paulo, aceitável enquanto todas as escolas estão no Brasil; `profiles` sem `school_id` mas dono de escola (fallback de `get_user_school_id`) não é destinatário — mesmo comportamento da tela de preferências.
