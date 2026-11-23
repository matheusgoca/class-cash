# S3 — Preferências de notificação: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada usuário de escola (owner, admin, financeiro) escolhe e salva, por evento, aviso no sistema/e-mail e antecedência, mais um resumo diário — sem gerar nem enviar nada ainda.

**Architecture:** Duas tabelas novas (`notification_preferences`, `notification_settings`) escritas só por dois RPCs `SECURITY DEFINER` (`ensure_…`, `save_…`), com os padrões e as opções numa única função SQL (`notification_event_defaults()`). O front lê o payload dos RPCs (inclusive opções e direção de cada evento) e só guarda rótulos em português; lógica de tela em funções puras testadas com Vitest. Navegação ganha o grupo **Conta** (Notificações + Segurança da conta).

**Tech Stack:** Postgres/Supabase (RLS, plpgsql), React + TypeScript, shadcn/ui (`Switch`, `Select`, `Badge`, `Card`, `Skeleton`, `Button`), Vitest, Supabase CLI via `npx supabase@2.117.0`.

**Spec:** `docs/superpowers/specs/2026-11-18-preferencias-notificacao-design.md` (decisões D1–D10). Mockups: `docs/mockups/Notificacoes.dc.html`, `docs/mockups/Config-Notificacoes-Seguranca.dc.html`.

## Global Constraints

- Eventos (texto exato no banco): `tuition_due`, `tuition_overdue`, `renegotiation_installment`, `expense_due`, `reenrollment`.
- Coluna `offset_days` (nunca `lead_days`); `0` = no dia; direção fixa por evento em `notification_event_defaults()`.
- **E-mail nasce desligado** em todos os eventos e no resumo; a tela mostra o que está gravado, inclusive no 1º acesso (D3).
- `school_id` vem de `get_user_school_id()` dentro dos RPCs; nunca aceitar `school_id` do cliente (D4).
- Policy RESTRICTIVE `mfa_gate` nas duas tabelas + `perform public.assert_mfa_gate();` como 1ª instrução dos RPCs (D5, convenção do `CLAUDE.md`).
- `UNIQUE (user_id, school_id, event)` e `UNIQUE (user_id, school_id)`; `ON CONFLICT DO NOTHING` no ensure; `digest_time` é `time` (D6).
- `reenrollment` só para owner/admin (D7). FKs `on delete cascade` para `public.schools(id)` e `auth.users(id)` (D10).
- Textos ao usuário em português; erros via `getFriendlyErrorMessage` (`src/lib/friendlyError.ts`). Tokens do tema e componentes de `src/components/ui/`, nunca hex dos mockups.
- Fuso: horário do resumo como hora local + IANA separado (regra `.claude/rules/core/TIMEZONE.md`).
- Escrita em produção (`db push`, `functions deploy`, DML) **só com autorização explícita do usuário**, mostrando `--dry-run` antes. `BEGIN…ROLLBACK` não precisa de autorização.
- Um commit por task, mensagem em português explicando o porquê. **Sem push** até o usuário pedir.
- Branch de trabalho: `feature/s3-preferencias-notificacao` a partir do `main` local.
- Comando do CLI nesta máquina: `npx supabase@2.117.0 …` (não há `supabase` global).

## Desvio deliberado da spec (registrar no CHANGELOG)

A spec põe as **opções de antecedência** no catálogo do front. O plano faz o payload dos RPCs devolver `direction`, `allowed_offsets` e `email_recommended` por evento, e o front só guarda rótulo e descrição. Motivo: as opções já precisam existir no SQL para validar o save; repeti-las no front criaria duas fontes que podem divergir. Consequência para a assinatura: `formatOffset(direction, n)` em vez de `formatOffset(event, n)`, e `applyRecommendedEmails(draft)` lê `emailRecommended` de cada linha em vez de receber a lista à parte.

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20261118120000_notification_preferences.sql` | Tabelas, índices, triggers, RLS, `mfa_gate`, 4 funções, permissões |
| `supabase/tests/notification_prefs_matrix.sql` | Matriz `BEGIN…ROLLBACK` (casos 1–9 da spec) |
| `src/integrations/supabase/types.ts` | Regenerado após a migration |
| `src/lib/notificationEvents.ts` (+ `.test.ts`) | Tipos, rótulos, `formatOffset`, `visibleEvents`, `isDirty`, `applyRecommendedEmails`, `canSave`, `DIGEST_HOURS` |
| `src/lib/accountMenu.ts` (+ `.test.ts`) | `showNotificationsItem`, `isMasterViewingOtherSchool` |
| `src/lib/notificationPreferences.ts` (+ `.test.ts`) | `parsePreferencesPayload` (puro), `ensurePreferences`, `savePreferences` |
| `src/lib/friendlyError.ts` (+ `friendlyNotificationError.test.ts`) | Mensagens dos erros dos RPCs e de `MFA_REQUIRED` |
| `src/components/notifications/PreferencesMatrix.tsx` | Matriz evento × canal × antecedência (tabela ≥ md, cartões < md) |
| `src/components/notifications/DigestSettings.tsx` | Chave do resumo + horário |
| `src/pages/Notifications.tsx` | Central `/notificacoes` (cabeçalho + Preferências + estado vazio) |
| `src/pages/NotificationPreferences.tsx` | Tela `/notificacoes/preferencias` |
| `src/App.tsx` | 2 rotas |
| `src/components/layout/AppSidebar.tsx` | Grupo **Conta**; rodapé fica só com Sair |
| `CHANGELOG.md`, `QA_CHECKLIST.md`, `docs/PLANO_SPRINTS_NOV2026.md` | Fechamento + notas da S4 |

---

### Task 1: Diagnóstico em produção (somente leitura)

**Files:** nenhum (resultado colado no chat/PR antes da Task 2).

**Interfaces:**
- Produces: confirmação dos nomes usados na Task 2 — `update_updated_at_column()`, `uuid_generate_v4()`, `get_user_school_id()`, `is_master_admin()`, `mfa_is_admin_or_owner(uuid, uuid)`, `mfa_gate_ok()`, `assert_mfa_gate()`; e que `notification_preferences`/`notification_settings` ainda não existem.

- [ ] **Step 1: Criar o branch**

```bash
git checkout main && git checkout -b feature/s3-preferencias-notificacao
```

- [ ] **Step 2: Rodar o diagnóstico**

```bash
npx supabase@2.117.0 db query --linked "
select 'fn' as kind, p.proname as name, pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('update_updated_at_column','get_user_school_id','is_master_admin',
                     'mfa_is_admin_or_owner','mfa_gate_ok','assert_mfa_gate')
union all
select 'ext', extname, extversion from pg_extension where extname in ('uuid-ossp','pgcrypto')
union all
select 'table', table_name, '' from information_schema.tables
 where table_schema = 'public' and table_name in ('notification_preferences','notification_settings')
union all
select 'fk_pattern', conname, pg_get_constraintdef(oid) from pg_constraint
 where conrelid = 'public.mfa_grace'::regclass and contype = 'f'
order by 1, 2;"
```

Expected: 6 linhas `fn` (as 6 funções), `ext` com `uuid-ossp`, **nenhuma** linha `table`, e 1 `fk_pattern` em `mfa_grace` referenciando `auth.users(id) ON DELETE CASCADE`.
Se `update_updated_at_column` ou `uuid-ossp` não aparecerem: **parar** e reportar ao usuário (a Task 2 depende deles).

- [ ] **Step 3: Colar o resultado no chat.** Sem commit.

---

### Task 2: Migration + matriz SQL (TDD em `BEGIN…ROLLBACK`)

**Files:**
- Create: `supabase/tests/notification_prefs_matrix.sql`
- Create: `supabase/migrations/20261118120000_notification_preferences.sql`
- Modify (após push autorizado): `src/integrations/supabase/types.ts`

**Interfaces:**
- Consumes: funções confirmadas na Task 1.
- Produces:
  - RPC `ensure_notification_preferences() → jsonb`
  - RPC `save_notification_preferences(p_prefs jsonb, p_digest_enabled boolean, p_digest_time time, p_timezone text) → jsonb`
  - Payload (ambos):
    ```json
    { "preferences": [ { "event": "tuition_due", "direction": "before", "in_app": true, "email": false,
                         "offset_days": 3, "allowed_offsets": [1,3,5,7], "email_recommended": false } ],
      "settings": { "digest_enabled": false, "digest_time": "07:00", "timezone": "America/Sao_Paulo",
                    "confirmed_at": null } }
    ```
    `preferences` vem na ordem fixa da função de padrões e só com os eventos visíveis ao papel atual.
  - Erros (`raise exception '<CÓDIGO>'`): `NO_SCHOOL` (P0001), `NOT_ALLOWED` (42501), `EVENT_NOT_ALLOWED` (42501), `INVALID_EVENT` (22023), `INVALID_OFFSET` (22023), `INVALID_TIMEZONE` (22023), `INVALID_DIGEST_TIME` (22023), `INVALID_PREFERENCES` (22023); e `MFA_REQUIRED` (42501) vindo de `assert_mfa_gate()`.

- [ ] **Step 1: Escrever a matriz (falha antes da migration)**

`supabase/tests/notification_prefs_matrix.sql`:

```sql
-- Matriz das preferências de notificação (S3). Spec: docs/superpowers/specs/2026-11-18-preferencias-notificacao-design.md
-- Tudo dentro de BEGIN ... ROLLBACK: nada persiste.
--
-- Como rodar:
--   Migration já aplicada:  npx supabase@2.117.0 db query --linked -f supabase/tests/notification_prefs_matrix.sql
--   Migration NÃO aplicada: gerar um arquivo que troca a linha "-- @@MIGRATION@@" pelo conteúdo de
--     supabase/migrations/20261118120000_notification_preferences.sql e rodar esse arquivo.
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
  values (p_cenario, p_got, p_esperado, coalesce(p_got = p_esperado or (p_esperado like 'ERR:%' and p_got like p_esperado || '%'), false))
$f$;

do $$
declare
  u_master  uuid := '<uuid do master>'; -- master + owner + admin, Escola C
  u_admin_t uuid := '<uuid do admin da Escola C>'; -- admin, Escola C
  u_fin_t   uuid := '<uuid do financeiro da Escola C>'; -- financeiro, Escola C
  u_owner_p uuid := '<uuid do owner da Escola B>'; -- owner + admin, Escola B
  s_teste   uuid := '<uuid da Escola C>';
  s_b  uuid := '<uuid da Escola B>';

  q_ensure     text := 'select jsonb_array_length(public.ensure_notification_preferences()->''preferences'')::text';
  q_count_mine text := 'select count(*)::text from public.notification_preferences where user_id = auth.uid()';
  q_email_on   text := 'select count(*)::text from public.notification_preferences where user_id = auth.uid() and email';
  q_confirmed  text := 'select (confirmed_at is not null)::text from public.notification_settings where user_id = auth.uid()';
  q_has_reenr  text := $q$select (public.ensure_notification_preferences()->'preferences' @> '[{"event":"reenrollment"}]')::text$q$;
  q_save_ok    text := $q$select (public.save_notification_preferences(
       '[{"event":"tuition_overdue","in_app":true,"email":true,"offset_days":10}]'::jsonb,
       true, '08:00'::time, 'America/Sao_Paulo')->'settings'->>'digest_time')$q$;
  q_save_bad_offset text := $q$select public.save_notification_preferences(
       '[{"event":"tuition_due","in_app":true,"email":false,"offset_days":4}]'::jsonb,
       false, '07:00'::time, 'America/Sao_Paulo')::text$q$;
  q_save_reenr text := $q$select public.save_notification_preferences(
       '[{"event":"reenrollment","in_app":true,"email":true,"offset_days":45}]'::jsonb,
       false, '07:00'::time, 'America/Sao_Paulo')::text$q$;
  q_save_bad_tz text := $q$select public.save_notification_preferences('[]'::jsonb, false, '07:00'::time, 'Marte/Olympus')::text$q$;
  q_save_bad_hr text := $q$select public.save_notification_preferences('[]'::jsonb, true, '21:00'::time, 'America/Sao_Paulo')::text$q$;
  q_direct_ins  text := format($q$with x as (insert into public.notification_preferences (school_id, user_id, event, in_app, email, offset_days)
       values (%L, auth.uid(), 'tuition_due', true, true, 3) returning 1) select count(*)::text from x$q$, s_teste);
  q_direct_upd  text := 'with x as (update public.notification_preferences set email = true where user_id = auth.uid() returning 1) select count(*)::text from x';
  q_read_admin_t text := format('select count(*)::text from public.notification_preferences where user_id = %L', '<uuid do admin da Escola C>');
  v_before text;
  v_n int;
begin
  -- estado controlado: sem fatores, sem carência, sem exigência; nenhuma preferência prévia
  perform set_config('request.jwt.claims', '', true);
  delete from auth.mfa_factors where user_id in (u_master, u_admin_t, u_fin_t, u_owner_p);
  delete from public.mfa_grace  where user_id in (u_master, u_admin_t, u_fin_t, u_owner_p);
  update public.schools set require_2fa = false where id in (s_teste, s_b);
  delete from public.notification_preferences where user_id in (u_master, u_admin_t, u_fin_t, u_owner_p);
  delete from public.notification_settings    where user_id in (u_master, u_admin_t, u_fin_t, u_owner_p);

  -- 1. ensure: 5 para admin/owner, 4 para financeiro; e-mail desligado; confirmed_at nulo
  perform pg_temp.rec('1a ensure admin → 5 eventos',        pg_temp.run_as(u_admin_t, 'aal1', q_ensure), '5');
  perform pg_temp.rec('1b ensure owner Escola B → 5 eventos',  pg_temp.run_as(u_owner_p, 'aal1', q_ensure), '5');
  perform pg_temp.rec('1c ensure financeiro → 4 eventos',    pg_temp.run_as(u_fin_t,   'aal1', q_ensure), '4');
  perform pg_temp.rec('1d financeiro sem linha reenrollment', pg_temp.run_as(u_fin_t,  'aal1', q_count_mine), '4');
  perform pg_temp.rec('1e e-mail desligado em tudo (admin)', pg_temp.run_as(u_admin_t, 'aal1', q_email_on), '0');
  perform pg_temp.rec('1f confirmed_at nulo após ensure',    pg_temp.run_as(u_admin_t, 'aal1', q_confirmed), 'false');

  -- 2. ensure idempotente
  v_before := (select string_agg(id::text || updated_at::text, ',' order by event) from public.notification_preferences where user_id = u_admin_t);
  perform pg_temp.run_as(u_admin_t, 'aal1', q_ensure);
  perform pg_temp.rec('2a ensure 2x não duplica',            pg_temp.run_as(u_admin_t, 'aal1', q_count_mine), '5');
  perform pg_temp.rec('2b ensure 2x não altera linhas',
    ((select string_agg(id::text || updated_at::text, ',' order by event) from public.notification_preferences where user_id = u_admin_t) = v_before)::text, 'true');

  -- 3. save grava e confirma; 2º save não muda confirmed_at
  perform pg_temp.rec('3a save devolve horário salvo',       pg_temp.run_as(u_admin_t, 'aal1', q_save_ok), '08:00');
  perform pg_temp.rec('3b save preenche confirmed_at',       pg_temp.run_as(u_admin_t, 'aal1', q_confirmed), 'true');
  perform pg_temp.rec('3c e-mail ligado só no evento salvo', pg_temp.run_as(u_admin_t, 'aal1', q_email_on), '1');
  v_before := (select confirmed_at::text from public.notification_settings where user_id = u_admin_t);
  perform pg_temp.run_as(u_admin_t, 'aal1', q_save_ok);
  perform pg_temp.rec('3d 2º save mantém confirmed_at',
    ((select confirmed_at::text from public.notification_settings where user_id = u_admin_t) = v_before)::text, 'true');

  -- 4. save rejeita entradas inválidas
  perform pg_temp.rec('4a offset fora da lista',             pg_temp.run_as(u_admin_t, 'aal1', q_save_bad_offset), 'ERR:22023:INVALID_OFFSET');
  perform pg_temp.rec('4b reenrollment pelo financeiro',     pg_temp.run_as(u_fin_t,   'aal1', q_save_reenr),      'ERR:42501:EVENT_NOT_ALLOWED');
  perform pg_temp.rec('4c fuso inválido',                    pg_temp.run_as(u_admin_t, 'aal1', q_save_bad_tz),     'ERR:22023:INVALID_TIMEZONE');
  perform pg_temp.rec('4d horário fora da faixa',            pg_temp.run_as(u_admin_t, 'aal1', q_save_bad_hr),     'ERR:22023:INVALID_DIGEST_TIME');

  -- 5. RLS de leitura
  perform pg_temp.rec('5a financeiro não lê linhas do admin', pg_temp.run_as(u_fin_t,   'aal1', q_read_admin_t), '0');
  perform pg_temp.rec('5b owner de outra escola não lê',      pg_temp.run_as(u_owner_p, 'aal1', q_read_admin_t), '0');
  perform pg_temp.rec('5c master aal2 lê',                    pg_temp.run_as(u_master,  'aal2', q_read_admin_t), '5');
  perform pg_temp.rec('5d master aal1 sem carência não lê',   pg_temp.run_as(u_master,  'aal1', q_read_admin_t), '0');

  -- 6. escrita direta bloqueada (sem policy de escrita)
  perform pg_temp.rec('6a INSERT direto falha',               pg_temp.run_as(u_admin_t, 'aal1', q_direct_ins), 'ERR:42501');
  perform pg_temp.rec('6b UPDATE direto não afeta linhas',    pg_temp.run_as(u_admin_t, 'aal1', q_direct_upd), '0');

  -- 7. gate: escola exige 2FA
  perform set_config('request.jwt.claims', '', true);
  update public.schools set require_2fa = true where id = s_teste;
  delete from public.mfa_grace where user_id in (u_admin_t, u_fin_t);
  perform pg_temp.rec('7a admin aal1 sem carência bloqueado', pg_temp.run_as(u_admin_t, 'aal1', q_ensure), 'ERR:42501:MFA_REQUIRED');
  perform pg_temp.rec('7b financeiro passa',                  pg_temp.run_as(u_fin_t,   'aal1', q_ensure), '4');
  perform set_config('request.jwt.claims', '', true);
  update public.schools set require_2fa = false where id = s_teste;

  -- 8. rebaixado de admin para financeiro
  perform set_config('request.jwt.claims', '', true);
  update public.user_roles set role = 'financial' where user_id = u_admin_t;
  perform pg_temp.rec('8a rebaixado: ensure devolve 4',       pg_temp.run_as(u_admin_t, 'aal1', q_ensure), '4');
  perform pg_temp.rec('8b rebaixado: sem reenrollment',       pg_temp.run_as(u_admin_t, 'aal1', q_has_reenr), 'false');
  perform pg_temp.rec('8c rebaixado: linha antiga mantida, nenhuma nova',
    (select count(*)::text from public.notification_preferences where user_id = u_admin_t), '5');
  perform pg_temp.rec('8d rebaixado: save de reenrollment rejeitado', pg_temp.run_as(u_admin_t, 'aal1', q_save_reenr), 'ERR:42501:EVENT_NOT_ALLOWED');

  -- 9. FK cascade: apagar o usuário remove as linhas dele
  perform set_config('request.jwt.claims', '', true);
  delete from auth.users where id = u_fin_t;
  perform pg_temp.rec('9a cascade em notification_preferences',
    (select count(*)::text from public.notification_preferences where user_id = u_fin_t), '0');
  perform pg_temp.rec('9b cascade em notification_settings',
    (select count(*)::text from public.notification_settings where user_id = u_fin_t), '0');
end $$;

select n, cenario, got, esperado, ok from t_res order by n;

rollback;
```

Notas para quem executa: (a) `9` apaga um usuário de teste **dentro** da transação — o `ROLLBACK` devolve; se o `delete from auth.users` falhar por outra FK (ex.: `profiles` sem cascade), trocar o caso 9 para apagar a **escola** de teste numa cópia controlada não é aceitável — em vez disso, registrar o erro e usar `delete from public.schools where id = s_b` só se `schools` não tiver dependentes sem cascade; se nenhum dos dois for possível, marcar o caso 9 como "não executável" e reportar ao usuário. (b) Se `user_roles` tiver CHECK/trigger que impeça o `update` do caso 8, reportar antes de contornar.

- [ ] **Step 2: Rodar a matriz sem a migration → deve falhar**

```bash
npx supabase@2.117.0 db query --linked -f supabase/tests/notification_prefs_matrix.sql
```

Expected: erro `relation "public.notification_preferences" does not exist` (a matriz referencia tabelas que ainda não existem). Nada persiste (`BEGIN` abortado).

- [ ] **Step 3: Escrever a migration**

`supabase/migrations/20261118120000_notification_preferences.sql`:

```sql
-- S3: preferências de notificação (tela + dados; nada é gerado nem enviado ainda).
-- Spec: docs/superpowers/specs/2026-11-18-preferencias-notificacao-design.md (D1–D10).
-- Escrita só pelos RPCs ensure/save; sem policies de INSERT/UPDATE/DELETE.

-- 1. Tabelas -------------------------------------------------------------------
create table if not exists public.notification_preferences (
  id          uuid primary key default uuid_generate_v4(),
  school_id   uuid not null references public.schools(id) on delete cascade,
  user_id     uuid not null references auth.users(id)     on delete cascade,
  event       text not null
              check (event in ('tuition_due','tuition_overdue','renegotiation_installment','expense_due','reenrollment')),
  in_app      boolean not null,
  email       boolean not null,
  offset_days integer not null check (offset_days between 0 and 120), -- lista fina validada no save
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint notification_preferences_user_school_event_key unique (user_id, school_id, event)
);
create index if not exists idx_notification_preferences_school_event
  on public.notification_preferences (school_id, event);

create table if not exists public.notification_settings (
  id             uuid primary key default uuid_generate_v4(),
  school_id      uuid not null references public.schools(id) on delete cascade,
  user_id        uuid not null references auth.users(id)     on delete cascade,
  digest_enabled boolean not null default false,
  digest_time    time not null default '07:00',
  timezone       text not null default 'America/Sao_Paulo',  -- IANA; sobrescrito pelo navegador a cada save
  confirmed_at   timestamptz,                                -- 1º save; a S4 só envia e-mail se não nulo (D3)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint notification_settings_user_school_key unique (user_id, school_id),
  constraint notification_settings_digest_time_check
    check (digest_time between time '06:00' and time '20:00'
           and extract(minute from digest_time) = 0 and extract(second from digest_time) = 0)
);

drop trigger if exists update_notification_preferences_updated_at on public.notification_preferences;
create trigger update_notification_preferences_updated_at
  before update on public.notification_preferences
  for each row execute function public.update_updated_at_column();

drop trigger if exists update_notification_settings_updated_at on public.notification_settings;
create trigger update_notification_settings_updated_at
  before update on public.notification_settings
  for each row execute function public.update_updated_at_column();

-- 2. RLS -----------------------------------------------------------------------
alter table public.notification_preferences enable row level security;
alter table public.notification_settings    enable row level security;

drop policy if exists notification_preferences_select on public.notification_preferences;
create policy notification_preferences_select on public.notification_preferences
  for select to authenticated
  using ((user_id = auth.uid() and school_id = public.get_user_school_id()) or public.is_master_admin());

drop policy if exists notification_settings_select on public.notification_settings;
create policy notification_settings_select on public.notification_settings
  for select to authenticated
  using ((user_id = auth.uid() and school_id = public.get_user_school_id()) or public.is_master_admin());

-- Gate de 2FA (convenção do CLAUDE.md): RESTRICTIVE, combinada com AND.
drop policy if exists mfa_gate on public.notification_preferences;
create policy mfa_gate on public.notification_preferences as restrictive for all to authenticated
  using ((select public.mfa_gate_ok())) with check ((select public.mfa_gate_ok()));
drop policy if exists mfa_gate on public.notification_settings;
create policy mfa_gate on public.notification_settings as restrictive for all to authenticated
  using ((select public.mfa_gate_ok())) with check ((select public.mfa_gate_ok()));

-- 3. Padrões: ÚNICA fonte de padrões, opções, direção e recomendados ------------
-- direction:
--   'before' = N dias ANTES da data de referência (vencimento da mensalidade,
--              parcela da renegociação, vencimento da despesa, fim do contrato);
--   'after'  = N dias DEPOIS do vencimento (mensalidade em atraso).
--   offset_days = 0 significa "no próprio dia".
-- email = false em todos: e-mail só liga quando o usuário salva a tela (D3).
-- email_recommended: selo "Recomendado" na tela (o mockup mostrava e-mail ligado).
-- O gerador da S3 usa esta função para quem nunca abriu a tela (só canal sistema).
create or replace function public.notification_event_defaults()
returns table (event text, direction text, in_app boolean, email boolean, email_recommended boolean,
               offset_days integer, allowed_offsets integer[], admin_only boolean, sort_order integer)
language sql immutable
set search_path = public
as $$
  values
    ('tuition_due',               'before', true, false, false,  3, array[1,3,5,7],      false, 1),
    ('tuition_overdue',           'after',  true, false, true,   5, array[1,3,5,10,15],  false, 2),
    ('renegotiation_installment', 'before', true, false, true,   1, array[0,1,2,3],      false, 3),
    ('expense_due',               'before', true, false, false,  2, array[0,1,2,3,5,7],  false, 4),
    ('reenrollment',              'before', true, false, true,  45, array[30,45,60,90],  true,  5)
$$;

-- 4. Quem pode ter preferências: owner/admin ou financeiro da escola ------------
create or replace function public.notification_actor(out o_uid uuid, out o_school uuid, out o_admin boolean)
language plpgsql stable security definer
set search_path = public
as $$
begin
  o_uid := auth.uid();
  if o_uid is null then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  o_school := public.get_user_school_id();
  if o_school is null then
    raise exception 'NO_SCHOOL' using errcode = 'P0001';
  end if;
  o_admin := public.mfa_is_admin_or_owner(o_uid, o_school);
  if not o_admin and not exists (
       select 1 from public.user_roles r where r.user_id = o_uid and r.role = 'financial') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';   -- professor e sem papel
  end if;
end $$;

-- 5. Payload devolvido pelos dois RPCs -----------------------------------------
-- Só eventos visíveis ao papel ATUAL: linha antiga de reenrollment de quem foi
-- rebaixado a financeiro fica no banco, mas não volta para a tela.
create or replace function public.notification_preferences_payload(p_uid uuid, p_school uuid, p_admin boolean)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'preferences', coalesce((
      select jsonb_agg(jsonb_build_object(
               'event', d.event, 'direction', d.direction,
               'in_app', p.in_app, 'email', p.email, 'offset_days', p.offset_days,
               'allowed_offsets', to_jsonb(d.allowed_offsets), 'email_recommended', d.email_recommended)
             order by d.sort_order)
        from public.notification_event_defaults() d
        join public.notification_preferences p
          on p.event = d.event and p.user_id = p_uid and p.school_id = p_school
       where p_admin or not d.admin_only), '[]'::jsonb),
    'settings', (
      select jsonb_build_object(
               'digest_enabled', s.digest_enabled,
               'digest_time', to_char(s.digest_time, 'HH24:MI'),
               'timezone', s.timezone,
               'confirmed_at', s.confirmed_at)
        from public.notification_settings s
       where s.user_id = p_uid and s.school_id = p_school));
$$;

-- 6. RPC: cria o que falta e devolve o estado -----------------------------------
create or replace function public.ensure_notification_preferences()
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  a record;
begin
  perform public.assert_mfa_gate();
  select * into a from public.notification_actor();

  insert into public.notification_preferences (school_id, user_id, event, in_app, email, offset_days)
  select a.o_school, a.o_uid, d.event, d.in_app, d.email, d.offset_days
    from public.notification_event_defaults() d
   where a.o_admin or not d.admin_only
  on conflict (user_id, school_id, event) do nothing;

  insert into public.notification_settings (school_id, user_id)
  values (a.o_school, a.o_uid)
  on conflict (user_id, school_id) do nothing;

  return public.notification_preferences_payload(a.o_uid, a.o_school, a.o_admin);
end $$;

-- 7. RPC: grava tudo numa transação e confirma ----------------------------------
create or replace function public.save_notification_preferences(
  p_prefs jsonb, p_digest_enabled boolean, p_digest_time time, p_timezone text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  a      record;
  v_item jsonb;
  v_def  record;
  v_off  integer;
begin
  perform public.assert_mfa_gate();
  select * into a from public.notification_actor();

  if p_prefs is null or jsonb_typeof(p_prefs) <> 'array' then
    raise exception 'INVALID_PREFERENCES' using errcode = '22023';
  end if;
  if p_timezone is null or not exists (select 1 from pg_timezone_names t where t.name = p_timezone) then
    raise exception 'INVALID_TIMEZONE' using errcode = '22023';
  end if;
  if p_digest_time is null or p_digest_time < time '06:00' or p_digest_time > time '20:00'
     or extract(minute from p_digest_time) <> 0 or extract(second from p_digest_time) <> 0 then
    raise exception 'INVALID_DIGEST_TIME' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_prefs) loop
    select * into v_def from public.notification_event_defaults() d where d.event = v_item->>'event';
    if not found then
      raise exception 'INVALID_EVENT' using errcode = '22023';
    end if;
    if v_def.admin_only and not a.o_admin then
      raise exception 'EVENT_NOT_ALLOWED' using errcode = '42501';
    end if;
    if jsonb_typeof(v_item->'offset_days') <> 'number' then
      raise exception 'INVALID_OFFSET' using errcode = '22023';
    end if;
    v_off := (v_item->>'offset_days')::integer;
    if not (v_off = any (v_def.allowed_offsets)) then
      raise exception 'INVALID_OFFSET' using errcode = '22023';
    end if;

    insert into public.notification_preferences (school_id, user_id, event, in_app, email, offset_days)
    values (a.o_school, a.o_uid, v_def.event,
            coalesce((v_item->>'in_app')::boolean, false),
            coalesce((v_item->>'email')::boolean, false),
            v_off)
    on conflict (user_id, school_id, event) do update
      set in_app = excluded.in_app, email = excluded.email, offset_days = excluded.offset_days;
  end loop;

  insert into public.notification_settings (school_id, user_id, digest_enabled, digest_time, timezone, confirmed_at)
  values (a.o_school, a.o_uid, coalesce(p_digest_enabled, false), p_digest_time, p_timezone, now())
  on conflict (user_id, school_id) do update
    set digest_enabled = excluded.digest_enabled,
        digest_time    = excluded.digest_time,
        timezone       = excluded.timezone,  -- o navegador de quem salvou define o fuso (nota S4)
        confirmed_at   = coalesce(public.notification_settings.confirmed_at, now());

  return public.notification_preferences_payload(a.o_uid, a.o_school, a.o_admin);
end $$;

-- 8. Permissões ----------------------------------------------------------------
-- Funções novas em public nascem executáveis por anon/authenticated no Supabase.
revoke all on function public.notification_event_defaults()                      from public, anon, authenticated;
revoke all on function public.notification_actor()                               from public, anon, authenticated;
revoke all on function public.notification_preferences_payload(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.ensure_notification_preferences()                  from public, anon;
revoke all on function public.save_notification_preferences(jsonb, boolean, time, text) from public, anon;
grant execute on function public.ensure_notification_preferences()                  to authenticated;
grant execute on function public.save_notification_preferences(jsonb, boolean, time, text) to authenticated;
```

- [ ] **Step 4: Rodar a matriz com a migration embutida → deve passar**

```bash
SCRATCH=$(mktemp -d)   # arquivo temporário fora do repo; contém a migration embutida
python3 -I - "$SCRATCH/notif_matrix_with_migration.sql" <<'EOF'
import sys
m = open('supabase/migrations/20261118120000_notification_preferences.sql').read()
t = open('supabase/tests/notification_prefs_matrix.sql').read()
open(sys.argv[1], 'w').write(t.replace('-- @@MIGRATION@@', m))
EOF
npx supabase@2.117.0 db query --linked -f "$SCRATCH/notif_matrix_with_migration.sql"
```

Expected: 30 linhas, todas com `ok = true`. Se alguma falhar, corrigir a migration (nunca o esperado do teste sem discutir com o usuário) e repetir. Conferir depois que nada persistiu:

```bash
npx supabase@2.117.0 db query --linked "select count(*) from information_schema.tables where table_schema='public' and table_name like 'notification_%'"
```

Expected: `0`.

- [ ] **Step 5: Commit (migration ainda NÃO aplicada)**

```bash
git add supabase/migrations/20261118120000_notification_preferences.sql supabase/tests/notification_prefs_matrix.sql
git commit -m "Migration das preferências de notificação (S3) + matriz BEGIN/ROLLBACK, ainda não aplicada" -m "Duas tabelas escritas só por RPC, padrões numa única função SQL, gate de 2FA e e-mail desligado até o usuário salvar (D3). Matriz: 30 verificações ok contra produção em BEGIN...ROLLBACK."
```

- [ ] **Step 6: Dry-run e autorização**

```bash
npx supabase@2.117.0 db push --linked --dry-run
```

Expected: exatamente `20261118120000_notification_preferences.sql`. Mostrar ao usuário e **pedir autorização explícita** para o push real. Sem autorização, parar aqui e seguir para as Tasks 3–5 (puras), voltando ao Step 7 depois.

- [ ] **Step 7: Aplicar, revalidar e regenerar tipos (após autorização)**

```bash
npx supabase@2.117.0 db push --linked
npx supabase@2.117.0 db query --linked -f supabase/tests/notification_prefs_matrix.sql
npx supabase@2.117.0 gen types typescript --linked > src/integrations/supabase/types.ts
git diff --stat src/integrations/supabase/types.ts
```

Expected: push aplica 1 migration; matriz (agora sem embutir) com 30 `ok = true`; `types.ts` ganha `notification_preferences`, `notification_settings`, `ensure_notification_preferences`, `save_notification_preferences` e mais nada inesperado (se aparecer diff em outras tabelas, é drift: reportar ao usuário antes de commitar).

- [ ] **Step 8: Commit**

```bash
git add src/integrations/supabase/types.ts
git commit -m "Regenera types.ts após aplicar a migration das preferências de notificação"
```

---

### Task 3: Catálogo e regras da tela (puro, TDD)

**Files:**
- Create: `src/lib/notificationEvents.ts`
- Test: `src/lib/notificationEvents.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type NotificationEvent = 'tuition_due' | 'tuition_overdue' | 'renegotiation_installment' | 'expense_due' | 'reenrollment';
  export type OffsetDirection = 'before' | 'after';
  export interface EventPreference { event: NotificationEvent; direction: OffsetDirection; inApp: boolean; email: boolean;
    offsetDays: number; options: number[]; emailRecommended: boolean; }
  export interface DigestPreference { enabled: boolean; time: string /* 'HH:MM' */; }
  export interface PreferencesState { preferences: EventPreference[]; digest: DigestPreference; }
  export const EVENT_LABELS: Record<NotificationEvent, { label: string; description: string }>;
  export const DIGEST_HOURS: string[]; // '06:00' … '20:00'
  export function formatOffset(direction: OffsetDirection, n: number): string;
  export function isDirty(saved: PreferencesState, draft: PreferencesState): boolean;
  export function applyRecommendedEmails(draft: PreferencesState): PreferencesState;
  export function canSave(saved: PreferencesState, draft: PreferencesState, confirmedAt: string | null): boolean;
  ```
  (`visibleEvents` da spec deixa de ser necessário no front: o payload já vem filtrado pelo papel — ver "Desvio deliberado".)

- [ ] **Step 1: Teste falhando**

`src/lib/notificationEvents.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  DIGEST_HOURS, EVENT_LABELS, applyRecommendedEmails, canSave, formatOffset, isDirty,
  type PreferencesState,
} from './notificationEvents';

const base = (): PreferencesState => ({
  preferences: [
    { event: 'tuition_due', direction: 'before', inApp: true, email: false, offsetDays: 3, options: [1, 3, 5, 7], emailRecommended: false },
    { event: 'tuition_overdue', direction: 'after', inApp: true, email: false, offsetDays: 5, options: [1, 3, 5, 10, 15], emailRecommended: true },
    { event: 'renegotiation_installment', direction: 'before', inApp: true, email: false, offsetDays: 1, options: [0, 1, 2, 3], emailRecommended: true },
  ],
  digest: { enabled: false, time: '07:00' },
});

describe('formatOffset', () => {
  it('antes: 0 é "No dia", 1 no singular, n no plural', () => {
    expect(formatOffset('before', 0)).toBe('No dia');
    expect(formatOffset('before', 1)).toBe('1 dia antes');
    expect(formatOffset('before', 45)).toBe('45 dias antes');
  });
  it('depois: "Após n dia(s)"', () => {
    expect(formatOffset('after', 1)).toBe('Após 1 dia');
    expect(formatOffset('after', 5)).toBe('Após 5 dias');
  });
});

describe('EVENT_LABELS e DIGEST_HOURS', () => {
  it('rótulos do mockup', () => {
    expect(EVENT_LABELS.tuition_due).toEqual({ label: 'Mensalidade a vencer', description: 'Lembrete antes do vencimento' });
    expect(EVENT_LABELS.reenrollment.label).toBe('Rematrícula');
  });
  it('horas cheias das 06:00 às 20:00', () => {
    expect(DIGEST_HOURS[0]).toBe('06:00');
    expect(DIGEST_HOURS[DIGEST_HOURS.length - 1]).toBe('20:00');
    expect(DIGEST_HOURS).toHaveLength(15);
  });
});

describe('isDirty', () => {
  it('igual → false; mudou canal, antecedência ou resumo → true', () => {
    expect(isDirty(base(), base())).toBe(false);
    const a = base(); a.preferences[0].email = true;
    expect(isDirty(base(), a)).toBe(true);
    const b = base(); b.preferences[1].offsetDays = 10;
    expect(isDirty(base(), b)).toBe(true);
    const c = base(); c.digest.time = '08:00';
    expect(isDirty(base(), c)).toBe(true);
  });
});

describe('applyRecommendedEmails', () => {
  it('liga e-mail só nos recomendados, sem mutar o original', () => {
    const draft = base();
    const out = applyRecommendedEmails(draft);
    expect(out.preferences.map((p) => p.email)).toEqual([false, true, true]);
    expect(draft.preferences.map((p) => p.email)).toEqual([false, false, false]);
    expect(out.digest).toEqual(draft.digest);
  });
});

describe('canSave', () => {
  it('primeiro acesso (confirmedAt nulo): sempre pode salvar', () => {
    expect(canSave(base(), base(), null)).toBe(true);
  });
  it('depois de confirmado: só com mudança', () => {
    expect(canSave(base(), base(), '2026-11-18T10:00:00Z')).toBe(false);
    const d = base(); d.digest.enabled = true;
    expect(canSave(base(), d, '2026-11-18T10:00:00Z')).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar → FAIL**

Run: `npx vitest run src/lib/notificationEvents.test.ts`
Expected: FAIL — `Failed to resolve import "./notificationEvents"`.

- [ ] **Step 3: Implementação**

`src/lib/notificationEvents.ts`:

```ts
// Catálogo da tela de preferências de notificação (S3). Padrões, opções de
// antecedência, direção e "recomendado" vêm do banco (notification_event_defaults()
// via RPC); aqui ficam só rótulos em português e regras puras da tela.

export type NotificationEvent =
  | 'tuition_due'
  | 'tuition_overdue'
  | 'renegotiation_installment'
  | 'expense_due'
  | 'reenrollment';

export type OffsetDirection = 'before' | 'after';

export interface EventPreference {
  event: NotificationEvent;
  direction: OffsetDirection;
  inApp: boolean;
  email: boolean;
  offsetDays: number;
  options: number[];
  emailRecommended: boolean;
}

export interface DigestPreference {
  enabled: boolean;
  time: string; // 'HH:MM', hora local; o fuso vai à parte no save
}

export interface PreferencesState {
  preferences: EventPreference[];
  digest: DigestPreference;
}

export const EVENT_LABELS: Record<NotificationEvent, { label: string; description: string }> = {
  tuition_due: { label: 'Mensalidade a vencer', description: 'Lembrete antes do vencimento' },
  tuition_overdue: { label: 'Mensalidade em atraso', description: 'Quando passa do vencimento' },
  renegotiation_installment: { label: 'Parcela de renegociação', description: 'Parcelas dos acordos ativos' },
  expense_due: { label: 'Despesa a pagar', description: 'Despesas e recorrências' },
  reenrollment: { label: 'Rematrícula', description: 'Contratos perto do fim' },
};

export const DIGEST_HOURS: string[] = Array.from({ length: 15 }, (_, i) => `${String(6 + i).padStart(2, '0')}:00`);

export function formatOffset(direction: OffsetDirection, n: number): string {
  const dias = n === 1 ? 'dia' : 'dias';
  if (direction === 'after') return `Após ${n} ${dias}`;
  if (n === 0) return 'No dia';
  return `${n} ${dias} antes`;
}

const key = (s: PreferencesState) =>
  JSON.stringify({
    p: s.preferences.map((p) => [p.event, p.inApp, p.email, p.offsetDays]),
    d: [s.digest.enabled, s.digest.time],
  });

export function isDirty(saved: PreferencesState, draft: PreferencesState): boolean {
  return key(saved) !== key(draft);
}

export function applyRecommendedEmails(draft: PreferencesState): PreferencesState {
  return {
    ...draft,
    preferences: draft.preferences.map((p) => (p.emailRecommended ? { ...p, email: true } : { ...p })),
  };
}

// No 1º acesso o usuário pode salvar sem mudar nada: é assim que confirma a tela (D3).
export function canSave(saved: PreferencesState, draft: PreferencesState, confirmedAt: string | null): boolean {
  return confirmedAt === null || isDirty(saved, draft);
}
```

- [ ] **Step 4: Rodar → PASS**

Run: `npx vitest run src/lib/notificationEvents.test.ts`
Expected: PASS (8 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/notificationEvents.ts src/lib/notificationEvents.test.ts
git commit -m "Catálogo e regras puras da tela de preferências de notificação (S3)"
```

---

### Task 4: Cliente dos RPCs + mensagens de erro (TDD)

**Files:**
- Create: `src/lib/notificationPreferences.ts`, `src/lib/notificationPreferences.test.ts`
- Modify: `src/lib/friendlyError.ts` (dentro de `getFriendlyErrorMessage`, antes do bloco `23514`)
- Test: `src/lib/friendlyNotificationError.test.ts`

**Interfaces:**
- Consumes: tipos da Task 3; RPCs e payload da Task 2.
- Produces:
  ```ts
  export interface LoadedPreferences { state: PreferencesState; confirmedAt: string | null; }
  export function parsePreferencesPayload(raw: unknown): LoadedPreferences; // lança Error('Resposta inesperada do servidor.')
  export async function ensurePreferences(): Promise<LoadedPreferences>;
  export async function savePreferences(draft: PreferencesState, timezone: string): Promise<LoadedPreferences>;
  ```

- [ ] **Step 1: Testes falhando**

`src/lib/notificationPreferences.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: vi.fn() } }));

import { parsePreferencesPayload } from './notificationPreferences';

const raw = {
  preferences: [
    { event: 'tuition_due', direction: 'before', in_app: true, email: false, offset_days: 3, allowed_offsets: [1, 3, 5, 7], email_recommended: false },
    { event: 'tuition_overdue', direction: 'after', in_app: true, email: true, offset_days: 10, allowed_offsets: [1, 3, 5, 10, 15], email_recommended: true },
  ],
  settings: { digest_enabled: true, digest_time: '08:00', timezone: 'America/Sao_Paulo', confirmed_at: '2026-11-18T10:00:00+00:00' },
};

describe('parsePreferencesPayload', () => {
  it('converte snake_case do RPC para o estado da tela', () => {
    const out = parsePreferencesPayload(raw);
    expect(out.confirmedAt).toBe('2026-11-18T10:00:00+00:00');
    expect(out.state.digest).toEqual({ enabled: true, time: '08:00' });
    expect(out.state.preferences[1]).toEqual({
      event: 'tuition_overdue', direction: 'after', inApp: true, email: true,
      offsetDays: 10, options: [1, 3, 5, 10, 15], emailRecommended: true,
    });
  });
  it('confirmed_at ausente vira null', () => {
    const out = parsePreferencesPayload({ ...raw, settings: { ...raw.settings, confirmed_at: null } });
    expect(out.confirmedAt).toBeNull();
  });
  it('payload sem preferences ou settings lança erro amigável', () => {
    expect(() => parsePreferencesPayload(null)).toThrow('Resposta inesperada do servidor.');
    expect(() => parsePreferencesPayload({ preferences: [] })).toThrow('Resposta inesperada do servidor.');
  });
});
```

`src/lib/friendlyNotificationError.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getFriendlyErrorMessage } from './friendlyError';

describe('getFriendlyErrorMessage — preferências de notificação', () => {
  it.each([
    ['MFA_REQUIRED', 'Esta conta precisa da verificação em duas etapas (2FA) para continuar.'],
    ['NO_SCHOOL', 'Sua conta ainda não está vinculada a uma escola.'],
    ['NOT_ALLOWED', 'Seu perfil não tem acesso às preferências de notificação.'],
    ['EVENT_NOT_ALLOWED', 'Seu perfil não pode configurar um dos avisos escolhidos.'],
    ['INVALID_OFFSET', 'Uma das antecedências escolhidas não é permitida.'],
    ['INVALID_TIMEZONE', 'Não foi possível identificar o fuso horário do seu navegador.'],
    ['INVALID_DIGEST_TIME', 'Escolha um horário de resumo entre 06:00 e 20:00.'],
  ])('%s', (code, expected) => {
    expect(getFriendlyErrorMessage({ code: 'P0001', message: code })).toBe(expected);
  });
});
```

- [ ] **Step 2: Rodar → FAIL**

Run: `npx vitest run src/lib/notificationPreferences.test.ts src/lib/friendlyNotificationError.test.ts`
Expected: FAIL — import de `./notificationPreferences` não resolve; e as 7 mensagens voltam o texto cru.

- [ ] **Step 3: Implementação**

`src/lib/notificationPreferences.ts`:

```ts
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import type { EventPreference, NotificationEvent, OffsetDirection, PreferencesState } from './notificationEvents';

export interface LoadedPreferences {
  state: PreferencesState;
  confirmedAt: string | null;
}

interface RawPreference {
  event: NotificationEvent;
  direction: OffsetDirection;
  in_app: boolean;
  email: boolean;
  offset_days: number;
  allowed_offsets: number[];
  email_recommended: boolean;
}

interface RawPayload {
  preferences: RawPreference[];
  settings: { digest_enabled: boolean; digest_time: string; timezone: string; confirmed_at: string | null };
}

const UNEXPECTED = 'Resposta inesperada do servidor.';

export function parsePreferencesPayload(raw: unknown): LoadedPreferences {
  const p = raw as RawPayload | null;
  if (!p || !Array.isArray(p.preferences) || !p.settings) throw new Error(UNEXPECTED);
  const preferences: EventPreference[] = p.preferences.map((r) => ({
    event: r.event,
    direction: r.direction,
    inApp: r.in_app,
    email: r.email,
    offsetDays: r.offset_days,
    options: r.allowed_offsets,
    emailRecommended: r.email_recommended,
  }));
  return {
    state: { preferences, digest: { enabled: p.settings.digest_enabled, time: p.settings.digest_time } },
    confirmedAt: p.settings.confirmed_at ?? null,
  };
}

// school_id nunca vai do cliente: o RPC usa get_user_school_id() (D4).
export async function ensurePreferences(): Promise<LoadedPreferences> {
  const { data, error } = await supabase.rpc('ensure_notification_preferences');
  if (error) throw error;
  return parsePreferencesPayload(data);
}

export async function savePreferences(draft: PreferencesState, timezone: string): Promise<LoadedPreferences> {
  // Tipado como Json: um array inferido como object[] não é aceito pelo tipo gerado
  // (mesmo erro de tsc que já existe em generateTuitions.ts).
  const p_prefs: Json = draft.preferences.map((p) => ({
    event: p.event,
    in_app: p.inApp,
    email: p.email,
    offset_days: p.offsetDays,
  }));
  const { data, error } = await supabase.rpc('save_notification_preferences', {
    p_prefs,
    p_digest_enabled: draft.digest.enabled,
    p_digest_time: draft.digest.time,
    p_timezone: timezone,
  });
  if (error) throw error;
  return parsePreferencesPayload(data);
}
```

Em `src/lib/friendlyError.ts`, dentro de `getFriendlyErrorMessage`, **imediatamente antes** do comentário `// Postgres check_violation`:

```ts
  // RPCs das preferências de notificação (S3) e gate de 2FA (Fase 3)
  const rpcMessages: Record<string, string> = {
    MFA_REQUIRED: 'Esta conta precisa da verificação em duas etapas (2FA) para continuar.',
    NO_SCHOOL: 'Sua conta ainda não está vinculada a uma escola.',
    NOT_ALLOWED: 'Seu perfil não tem acesso às preferências de notificação.',
    EVENT_NOT_ALLOWED: 'Seu perfil não pode configurar um dos avisos escolhidos.',
    INVALID_OFFSET: 'Uma das antecedências escolhidas não é permitida.',
    INVALID_TIMEZONE: 'Não foi possível identificar o fuso horário do seu navegador.',
    INVALID_DIGEST_TIME: 'Escolha um horário de resumo entre 06:00 e 20:00.',
    INVALID_EVENT: 'Um dos avisos enviados não existe. Recarregue a página e tente de novo.',
    INVALID_PREFERENCES: 'Não foi possível ler as preferências enviadas. Recarregue a página e tente de novo.',
  };
  if (rpcMessages[message.trim()]) {
    return rpcMessages[message.trim()];
  }

```

- [ ] **Step 4: Rodar → PASS** (e a suíte inteira, para garantir que nada de `friendlyError` regrediu)

Run: `npx vitest run`
Expected: todos os testes passam (90 anteriores + os novos).

- [ ] **Step 5: Typecheck do cliente**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -E "notificationPreferences|friendlyError" || echo "sem erros novos"`
Expected: `sem erros novos` (depende do `types.ts` regenerado na Task 2, Step 7; se a migration ainda não foi autorizada, o `rpc(...)` não tipa — anotar e voltar a este step depois do Step 7).

- [ ] **Step 6: Commit**

```bash
git add src/lib/notificationPreferences.ts src/lib/notificationPreferences.test.ts src/lib/friendlyError.ts src/lib/friendlyNotificationError.test.ts
git commit -m "Cliente dos RPCs de preferências e mensagens amigáveis dos erros (S3)"
```

---

### Task 5: Grupo "Conta" na barra lateral (TDD da regra + integração)

**Files:**
- Create: `src/lib/accountMenu.ts`, `src/lib/accountMenu.test.ts`
- Modify: `src/components/layout/AppSidebar.tsx` (imports de ícones; bloco do rodapé por volta das linhas 266–290)

**Interfaces:**
- Consumes: `AppRole` de `@/hooks/use-role`.
- Produces:
  ```ts
  export interface AccountMenuInput { role: AppRole | null; isMasterAdmin: boolean; viewingSchoolId: string | null; homeSchoolId: string | null; }
  export function isMasterViewingOtherSchool(i: AccountMenuInput): boolean;
  export function showNotificationsItem(i: AccountMenuInput): boolean;
  ```

- [ ] **Step 1: Teste falhando**

`src/lib/accountMenu.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isMasterViewingOtherSchool, showNotificationsItem, type AccountMenuInput } from './accountMenu';

const u = (o: Partial<AccountMenuInput>): AccountMenuInput => ({
  role: 'admin', isMasterAdmin: false, viewingSchoolId: null, homeSchoolId: 'casa', ...o,
});

describe('showNotificationsItem', () => {
  it('admin e financeiro veem; professor e sem papel não (D9)', () => {
    expect(showNotificationsItem(u({ role: 'admin' }))).toBe(true);
    expect(showNotificationsItem(u({ role: 'financial' }))).toBe(true);
    expect(showNotificationsItem(u({ role: 'teacher' }))).toBe(false);
    expect(showNotificationsItem(u({ role: null }))).toBe(false);
  });
  it('master sem escola visualizada não vê', () => {
    expect(showNotificationsItem(u({ isMasterAdmin: true, viewingSchoolId: null }))).toBe(false);
  });
  it('master na própria escola vê; em outra escola não (D4)', () => {
    expect(showNotificationsItem(u({ isMasterAdmin: true, viewingSchoolId: 'casa' }))).toBe(true);
    expect(showNotificationsItem(u({ isMasterAdmin: true, viewingSchoolId: 'outra' }))).toBe(false);
  });
});

describe('isMasterViewingOtherSchool', () => {
  it('só é true para master com escola visualizada diferente da de casa', () => {
    expect(isMasterViewingOtherSchool(u({ isMasterAdmin: true, viewingSchoolId: 'outra' }))).toBe(true);
    expect(isMasterViewingOtherSchool(u({ isMasterAdmin: true, viewingSchoolId: 'casa' }))).toBe(false);
    expect(isMasterViewingOtherSchool(u({ isMasterAdmin: false, viewingSchoolId: 'outra' }))).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar → FAIL**

Run: `npx vitest run src/lib/accountMenu.test.ts`
Expected: FAIL — import não resolve.

- [ ] **Step 3: Implementação da regra**

`src/lib/accountMenu.ts`:

```ts
import type { AppRole } from '@/hooks/use-role';

export interface AccountMenuInput {
  role: AppRole | null;
  isMasterAdmin: boolean;
  viewingSchoolId: string | null;
  homeSchoolId: string | null; // profiles.school_id: onde os RPCs gravam (get_user_school_id)
}

// O master visualizando outra escola gravaria preferências na escola de casa,
// não na que está na tela — por isso o item some (D4).
export function isMasterViewingOtherSchool(i: AccountMenuInput): boolean {
  return i.isMasterAdmin && !!i.viewingSchoolId && i.viewingSchoolId !== i.homeSchoolId;
}

export function showNotificationsItem(i: AccountMenuInput): boolean {
  if (i.isMasterAdmin && !i.viewingSchoolId) return false;
  if (isMasterViewingOtherSchool(i)) return false;
  return i.role === 'admin' || i.role === 'financial';
}
```

- [ ] **Step 4: Rodar → PASS**

Run: `npx vitest run src/lib/accountMenu.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Integrar na barra lateral**

Em `src/components/layout/AppSidebar.tsx`:

1. Adicionar `Bell` e `UserCircle` aos imports de `lucide-react` e importar a regra:
```ts
import { showNotificationsItem } from "@/lib/accountMenu";
```
2. Depois da linha `const masterWithoutSchool = isMasterAdmin && !viewingSchoolId;`, acrescentar:
```ts
  const showNotifications = showNotificationsItem({
    role,
    isMasterAdmin,
    viewingSchoolId,
    homeSchoolId: profile?.school_id ?? null,
  });
  const accountItems = [
    ...(showNotifications ? [{ title: "Notificações", url: "/notificacoes", icon: Bell }] : []),
    { title: "Segurança da conta", url: "/seguranca", icon: KeyRound },
  ];
  const isActivePrefix = (path: string) => currentPath === path || currentPath.startsWith(`${path}/`);
```
3. Trocar o estado inicial dos grupos abertos para incluir "Conta":
```ts
  const [openGroups, setOpenGroups] = useState<string[]>(["Gestão", "Financeiro", "Configurações", "Conta"]);
```
4. Logo **depois** do `{visibleItems.map(...)}` (ainda dentro do primeiro `<SidebarMenu>`), renderizar o grupo **Conta** — fora de `visibleItems` de propósito, para continuar visível ao master sem escola e ao professor:
```tsx
          <SidebarMenuItem key="Conta">
            <Collapsible open={openGroups.includes("Conta")} onOpenChange={() => toggleGroup("Conta")}>
              <CollapsibleTrigger asChild>
                <SidebarMenuButton className="w-full justify-between">
                  <div className="flex items-center gap-2">
                    <UserCircle className="h-4 w-4" />
                    {!collapsed && <span>Conta</span>}
                  </div>
                  {!collapsed && (
                    <ChevronDown className={`h-4 w-4 transition-transform ${openGroups.includes("Conta") ? "rotate-180" : ""}`} />
                  )}
                </SidebarMenuButton>
              </CollapsibleTrigger>
              {!collapsed && (
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {accountItems.map((subItem) => (
                      <SidebarMenuSubItem key={subItem.title}>
                        <SidebarMenuSubButton asChild>
                          <NavLink
                            to={subItem.url}
                            className={`flex items-center gap-2 ${getNavCls(isActivePrefix(subItem.url))}`}
                          >
                            <subItem.icon className="h-4 w-4" />
                            <span>{subItem.title}</span>
                          </NavLink>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              )}
            </Collapsible>
          </SidebarMenuItem>
```
5. No rodapé, **remover** o `<SidebarMenuItem>` do `NavLink to="/seguranca"` (o que tem `KeyRound` e "Segurança da conta"), mantendo só o de "Sair".

- [ ] **Step 6: Verificar**

Run: `npx vitest run && npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep AppSidebar || echo "AppSidebar ok"`
Expected: testes verdes; `AppSidebar ok`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/accountMenu.ts src/lib/accountMenu.test.ts src/components/layout/AppSidebar.tsx
git commit -m "Grupo Conta na barra lateral: Notificações e Segurança da conta (S3)" -m "Notificações some para professor e para o master visualizando outra escola, porque as preferências são gravadas na escola de casa."
```

---

### Task 6: Central `/notificacoes` + rotas

**Files:**
- Create: `src/pages/Notifications.tsx`
- Modify: `src/App.tsx` (import ao lado de `import Security from "./pages/Security";`; rotas logo depois da rota `/seguranca`)

**Interfaces:**
- Consumes: nada novo (a rota de preferências aponta para o componente da Task 7; até lá, criar `src/pages/NotificationPreferences.tsx` mínimo neste task para o build passar — a Task 7 o substitui).
- Produces: rotas `/notificacoes` e `/notificacoes/preferencias`.

- [ ] **Step 1: Página da central**

`src/pages/Notifications.tsx`:

```tsx
import { Link } from 'react-router-dom';
import { Bell, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/** Central de notificações. Por enquanto só o estado vazio: o gerador entra nos próximos passos da S3. */
const Notifications = () => (
  <div className="space-y-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Notificações</h1>
        <p className="text-muted-foreground">Lembretes de cobrança, renegociação, despesas e rematrícula</p>
      </div>
      <Button variant="outline" asChild>
        <Link to="/notificacoes/preferencias">
          <SlidersHorizontal className="mr-2 h-4 w-4" />
          Preferências
        </Link>
      </Button>
    </div>

    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Bell className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        </div>
        <p className="font-medium">Nenhuma notificação ainda.</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Os avisos começam a aparecer aqui nas próximas versões.
        </p>
        <Button variant="link" asChild>
          <Link to="/notificacoes/preferencias">Ajustar preferências</Link>
        </Button>
      </CardContent>
    </Card>
  </div>
);

export default Notifications;
```

- [ ] **Step 2: Página de preferências provisória** (substituída na Task 7)

`src/pages/NotificationPreferences.tsx`:

```tsx
const NotificationPreferences = () => <div />;
export default NotificationPreferences;
```

- [ ] **Step 3: Rotas**

Em `src/App.tsx`, junto dos imports de páginas:
```ts
import Notifications from "./pages/Notifications";
import NotificationPreferences from "./pages/NotificationPreferences";
```
E logo depois do `<Route path="/seguranca" … />`:
```tsx
                <Route
                  path="/notificacoes"
                  element={
                    <ProtectedRoute requireSchool allowedRoles={['admin', 'financial']}>
                      <Layout>
                        <Notifications />
                      </Layout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/notificacoes/preferencias"
                  element={
                    <ProtectedRoute requireSchool allowedRoles={['admin', 'financial']}>
                      <Layout>
                        <NotificationPreferences />
                      </Layout>
                    </ProtectedRoute>
                  }
                />
```

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -E "App.tsx|Notifications" || echo ok; npm run build 2>&1 | tail -3`
Expected: `ok`; build conclui (`built in …`).

- [ ] **Step 5: Commit**

```bash
git add src/pages/Notifications.tsx src/pages/NotificationPreferences.tsx src/App.tsx
git commit -m "Central de notificações (/notificacoes) com estado vazio e rotas (S3)"
```

---

### Task 7: Tela de preferências

**Files:**
- Create: `src/components/notifications/PreferencesMatrix.tsx`, `src/components/notifications/DigestSettings.tsx`
- Replace: `src/pages/NotificationPreferences.tsx`

**Interfaces:**
- Consumes: `EVENT_LABELS`, `DIGEST_HOURS`, `formatOffset`, `applyRecommendedEmails`, `canSave`, tipos (Task 3); `ensurePreferences`, `savePreferences`, `LoadedPreferences` (Task 4); `isMasterViewingOtherSchool` (Task 5); `getFriendlyErrorMessage`.
- Produces: componentes `PreferencesMatrix({ preferences, onChange, disabled })` e `DigestSettings({ digest, onChange, disabled })`.

- [ ] **Step 1: Matriz**

`src/components/notifications/PreferencesMatrix.tsx`:

```tsx
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { EVENT_LABELS, formatOffset, type EventPreference } from '@/lib/notificationEvents';

interface Props {
  preferences: EventPreference[];
  onChange: (next: EventPreference[]) => void;
  disabled?: boolean;
}

export function PreferencesMatrix({ preferences, onChange, disabled }: Props) {
  const update = (i: number, patch: Partial<EventPreference>) =>
    onChange(preferences.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  return (
    <div className="divide-y rounded-md border">
      <div className="hidden grid-cols-[1fr_96px_120px_180px] gap-4 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:grid">
        <span>Evento</span>
        <span>No sistema</span>
        <span>E-mail</span>
        <span>Antecedência</span>
      </div>
      {preferences.map((p, i) => {
        const { label, description } = EVENT_LABELS[p.event];
        return (
          <div key={p.event} className="grid gap-3 px-4 py-4 md:grid-cols-[1fr_96px_120px_180px] md:items-center md:gap-4">
            <div>
              <p className="text-sm font-medium">{label}</p>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id={`${p.event}-in-app`}
                checked={p.inApp}
                onCheckedChange={(v) => update(i, { inApp: v })}
                disabled={disabled}
                aria-label={`${label} no sistema`}
              />
              <Label htmlFor={`${p.event}-in-app`} className="text-sm font-normal md:hidden">No sistema</Label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Switch
                id={`${p.event}-email`}
                checked={p.email}
                onCheckedChange={(v) => update(i, { email: v })}
                disabled={disabled}
                aria-label={`${label} por e-mail`}
              />
              <Label htmlFor={`${p.event}-email`} className="text-sm font-normal md:hidden">E-mail</Label>
              {p.emailRecommended && <Badge variant="secondary">Recomendado</Badge>}
            </div>
            <Select
              value={String(p.offsetDays)}
              onValueChange={(v) => update(i, { offsetDays: Number(v) })}
              disabled={disabled}
            >
              <SelectTrigger aria-label={`Antecedência: ${label}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {p.options.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {formatOffset(p.direction, n)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Resumo diário**

`src/components/notifications/DigestSettings.tsx`:

```tsx
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { DIGEST_HOURS, type DigestPreference } from '@/lib/notificationEvents';

interface Props {
  digest: DigestPreference;
  onChange: (next: DigestPreference) => void;
  disabled?: boolean;
}

export function DigestSettings({ digest, onChange, disabled }: Props) {
  return (
    <div className="flex flex-col gap-4 rounded-md border p-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex items-center gap-3">
        <Switch
          id="digest-enabled"
          checked={digest.enabled}
          onCheckedChange={(v) => onChange({ ...digest, enabled: v })}
          disabled={disabled}
        />
        <Label htmlFor="digest-enabled" className="text-sm font-medium">
          Receber um resumo diário por e-mail
        </Label>
      </div>
      <div className="w-full sm:w-40">
        <Label htmlFor="digest-time" className="mb-1 block text-sm">Horário do resumo</Label>
        <Select
          value={digest.time}
          onValueChange={(v) => onChange({ ...digest, time: v })}
          disabled={disabled || !digest.enabled}
        >
          <SelectTrigger id="digest-time">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DIGEST_HOURS.map((h) => (
              <SelectItem key={h} value={h}>{h}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Página**

Substituir `src/pages/NotificationPreferences.tsx` por:

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Info } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DigestSettings } from '@/components/notifications/DigestSettings';
import { PreferencesMatrix } from '@/components/notifications/PreferencesMatrix';
import { useAuth } from '@/contexts/AuthContext';
import { useMasterAdmin } from '@/contexts/MasterAdminContext';
import { useToast } from '@/hooks/use-toast';
import { useRole } from '@/hooks/use-role';
import { isMasterViewingOtherSchool } from '@/lib/accountMenu';
import { getFriendlyErrorMessage } from '@/lib/friendlyError';
import { applyRecommendedEmails, canSave, type PreferencesState } from '@/lib/notificationEvents';
import { ensurePreferences, savePreferences } from '@/lib/notificationPreferences';

const NotificationPreferences = () => {
  const { toast } = useToast();
  const { profile } = useAuth();
  const { isMasterAdmin, viewingSchoolId } = useMasterAdmin();
  const { role } = useRole();

  const [saved, setSaved] = useState<PreferencesState | null>(null);
  const [draft, setDraft] = useState<PreferencesState | null>(null);
  const [confirmedAt, setConfirmedAt] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // D4: o RPC grava na escola de casa; visualizando outra escola, não carrega nada.
  const otherSchool = isMasterViewingOtherSchool({
    role, isMasterAdmin, viewingSchoolId, homeSchoolId: profile?.school_id ?? null,
  });

  useEffect(() => {
    if (otherSchool) return;
    let cancelled = false;
    ensurePreferences()
      .then((loaded) => {
        if (cancelled) return;
        setSaved(loaded.state);
        setDraft(loaded.state);
        setConfirmedAt(loaded.confirmedAt);
      })
      .catch((err) => {
        if (cancelled) return;
        setSaved(null);
        setDraft(null);
        setLoadError(getFriendlyErrorMessage(err, 'Não foi possível carregar suas preferências.'));
      });
    return () => {
      cancelled = true;
    };
  }, [otherSchool]);

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const loaded = await savePreferences(draft, timezone);
      setSaved(loaded.state);
      setDraft(loaded.state);
      setConfirmedAt(loaded.confirmedAt);
      toast({ title: 'Preferências salvas' });
    } catch (err) {
      // o rascunho fica como está: o usuário não perde o que marcou
      toast({
        title: 'Erro',
        description: getFriendlyErrorMessage(err, 'Não foi possível salvar suas preferências.'),
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const header = (
    <div className="space-y-2">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link to="/notificacoes">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Notificações
        </Link>
      </Button>
      <h1 className="text-3xl font-bold tracking-tight">Preferências de notificação</h1>
      <p className="text-muted-foreground">Escolha o que avisar, onde e com quanta antecedência. Vale para o seu usuário.</p>
    </div>
  );

  if (otherSchool) {
    return (
      <div className="space-y-6">
        {header}
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Você está visualizando outra escola. Suas preferências de notificação valem para a sua própria escola: volte ao painel master e acesse-a para ajustá-las.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-6">
        {header}
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!saved || !draft) {
    return (
      <div className="space-y-6">
        {header}
        <Card className="max-w-4xl">
          <CardContent className="space-y-3 pt-6">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  const firstAccess = confirmedAt === null;
  const hasRecommended = draft.preferences.some((p) => p.emailRecommended && !p.email);

  return (
    <div className="space-y-6">
      {header}
      <Card className="max-w-4xl">
        <CardHeader>
          <CardTitle>Notificações</CardTitle>
          <CardDescription>Avisos no sistema e por e-mail.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {firstAccess && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span>Os e-mails estão desligados. Ative os que quiser e salve.</span>
                {hasRecommended && (
                  <Button size="sm" variant="outline" onClick={() => setDraft(applyRecommendedEmails(draft))} disabled={saving}>
                    Ativar e-mails recomendados
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}

          <PreferencesMatrix
            preferences={draft.preferences}
            onChange={(preferences) => setDraft({ ...draft, preferences })}
            disabled={saving}
          />
          <DigestSettings digest={draft.digest} onChange={(digest) => setDraft({ ...draft, digest })} disabled={saving} />

          <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Os avisos serão ativados nas próximas versões. Suas escolhas já ficam salvas.
            </p>
            <Button onClick={handleSave} disabled={saving || !canSave(saved, draft, confirmedAt)}>
              {saving ? 'Salvando...' : 'Salvar preferências'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default NotificationPreferences;
```

- [ ] **Step 4: Verificar**

Run: `npx vitest run && npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -E "notifications/|NotificationPreferences" || echo ok; npx eslint src/pages/Notifications.tsx src/pages/NotificationPreferences.tsx src/components/notifications src/lib/notificationEvents.ts src/lib/notificationPreferences.ts src/lib/accountMenu.ts; npm run build 2>&1 | tail -3`
Expected: testes verdes; `ok`; ESLint sem erros nos arquivos novos; build conclui.

- [ ] **Step 5: Commit**

```bash
git add src/components/notifications src/pages/NotificationPreferences.tsx
git commit -m "Tela de preferências de notificação conforme o mockup (S3)" -m "Mostra sempre o que está gravado; no primeiro acesso, e-mails desligados com selo Recomendado e atalho para ativá-los, e Salvar habilitado para confirmar (D3)."
```

---

### Task 8: QA no navegador, documentação e fechamento

**Files:**
- Modify: `QA_CHECKLIST.md` (nova seção no topo), `CHANGELOG.md` (nova seção no topo), `docs/PLANO_SPRINTS_NOV2026.md` (§3, notas da S4)

**Interfaces:** nenhuma nova.

- [ ] **Step 1: Suíte completa**

Run: `npx vitest run && npm run build 2>&1 | tail -2`
Expected: todos verdes; build ok.

- [ ] **Step 2: QA manual local** (`npm run dev`, logado pelo usuário — nunca digitar a senha dele)

Roteiro, anotando o observado em cada item:
1. Master na Escola C (via "Acessar escola"): grupo **Conta** com Notificações + Segurança da conta; rodapé só com Sair.
2. `/notificacoes`: cabeçalho, botão Preferências, estado vazio.
3. Preferências, 1º acesso: e-mails desligados, selo "Recomendado" em atraso, renegociação e rematrícula, aviso "Os e-mails estão desligados…", Salvar habilitado.
4. "Ativar e-mails recomendados" liga as três chaves; Salvar → toast "Preferências salvas"; recarregar mostra o gravado; aviso de 1º acesso some.
5. Mudar antecedência e horário do resumo (horário desabilitado com a chave desligada); salvar; recarregar.
6. Master acessando Escola A: item Notificações some; abrir `/notificacoes/preferencias` direto mostra o aviso de "outra escola" e não carrega nada.
7. Largura 375 px: matriz vira cartões empilhados, sem rolagem horizontal.
8. (Se o usuário logar com as contas de teste) financeiro não vê Rematrícula; professor não vê Notificações.

Conferir no banco depois do item 4:

```bash
npx supabase@2.117.0 db query --linked "select p.event, p.in_app, p.email, p.offset_days, s.digest_enabled, to_char(s.digest_time,'HH24:MI') as hora, s.timezone, s.confirmed_at is not null as confirmado from public.notification_preferences p join public.notification_settings s using (user_id, school_id) join public.profiles pr on pr.user_id = p.user_id where pr.is_master_admin order by p.event"
```

Expected: 5 linhas, e-mail `true` só nos três recomendados (ou conforme o que foi salvo), `confirmado = true`, `timezone = America/Sao_Paulo`.

- [ ] **Step 3: `QA_CHECKLIST.md`** — inserir no topo (logo após `# QA Testing Checklist`):

```markdown
## Roteiro de QA manual — S3, preferências de notificação (2026-11-18)

Matriz SQL: `supabase/tests/notification_prefs_matrix.sql` (30 verificações em `BEGIN ... ROLLBACK`).

- [ ] Grupo **Conta** na barra lateral (Notificações + Segurança da conta); rodapé só com Sair
- [ ] `/notificacoes`: cabeçalho, botão Preferências, estado vazio
- [ ] 1º acesso: e-mails desligados, selo "Recomendado" em 3 eventos, aviso, Salvar habilitado
- [ ] "Ativar e-mails recomendados" → salvar → recarregar mostra o gravado; aviso some
- [ ] Antecedência e horário do resumo salvos e recarregados; horário desabilitado com o resumo desligado
- [ ] Master visualizando outra escola: item some; URL direta mostra aviso e não carrega
- [ ] 375 px: matriz em cartões, sem rolagem horizontal
- [ ] Financeiro não vê Rematrícula
- [ ] Professor não vê Notificações (vê Segurança da conta)
```

- [ ] **Step 4: `CHANGELOG.md`** — inserir no topo (logo após `# Application Sync Changelog`):

```markdown
## Sprint S3 — Preferências de notificação (2026-11-18)

Spec: `docs/superpowers/specs/2026-11-18-preferencias-notificacao-design.md`. Plano: `docs/superpowers/plans/2026-11-18-preferencias-notificacao.md`.

- Tabelas `notification_preferences` (usuário × escola × evento) e `notification_settings` (resumo diário, fuso, `confirmed_at`), escritas só pelos RPCs `ensure_notification_preferences()` e `save_notification_preferences(...)`; padrões, opções e direção numa única função (`notification_event_defaults()`). Migration `20261118120000_notification_preferences.sql`.
- E-mail nasce desligado e só vale depois do 1º save (`confirmed_at`); Rematrícula só para owner/admin; gate de 2FA (`mfa_gate` + `assert_mfa_gate()`); FKs com cascade para `schools` e `auth.users`.
- Front: central `/notificacoes` (estado vazio) e `/notificacoes/preferencias` conforme o mockup; grupo **Conta** na barra lateral com Notificações e Segurança da conta.
- **Desvio da spec:** opções de antecedência, direção e "recomendado" vêm do payload do RPC em vez de um catálogo no front (evita duas fontes).
- Nada é gerado nem enviado ainda (gerador: próximos passos da S3; e-mail: S4).
```

- [ ] **Step 5: `docs/PLANO_SPRINTS_NOV2026.md`** — ao final da seção `## 3. Notificações`, acrescentar:

```markdown

**Regras herdadas da tela de preferências (S3, 2026-11-18) que o gerador e o envio precisam respeitar:**
- E-mail (eventos e resumo) **só** se `notification_settings.confirmed_at is not null` e o canal estiver ligado. Quem nunca salvou recebe só aviso no sistema, com os padrões de `notification_event_defaults()`.
- O gerador junta as preferências com o **papel e o vínculo atuais** (`profiles.school_id`, `user_roles`, `schools.owner_user_id`): linha de `reenrollment` de quem virou financeiro, ou de quem saiu da escola, é ignorada (as linhas não são apagadas).
- Horário do resumo = `digest_time` composto com `timezone` no momento do disparo; nunca guardar UTC fixo. O `timezone` é sobrescrito pelo navegador a cada save (último dispositivo vence).
```

- [ ] **Step 6: Commit**

```bash
git add QA_CHECKLIST.md CHANGELOG.md docs/PLANO_SPRINTS_NOV2026.md
git commit -m "Fecha a tela de preferências de notificação (S3): QA, CHANGELOG e regras para o gerador e a S4"
```

- [ ] **Step 7: Entregar ao usuário** — resumo do que foi feito, resultado da matriz e do QA (o que foi visto funcionando e o que não foi verificado), e perguntar se pode dar push e abrir o PR. **Não** dar push sem o pedido.

---

## Self-Review

- **Cobertura da spec:** D1 (T2 tabelas) · D2 (`offset_days`, direção comentada em `notification_event_defaults`) · D3 (e-mail `false` nos padrões, `confirmed_at` no save, tela sem pré-marcar, selo + botão, Salvar no 1º acesso — T2/T3/T7) · D4 (`get_user_school_id()` nos RPCs; `showNotificationsItem` + guarda na página — T2/T5/T7) · D5 (`mfa_gate` + `assert_mfa_gate`; casos 5c/5d/7a/7b) · D6 (UNIQUEs, `on conflict do nothing`, `time`) · D7 (`admin_only`, payload filtrado, `EVENT_NOT_ALLOWED`; casos 1c/1d/4b/8) · D8 (grupo Conta, Segurança movida — T5) · D9 (professor: `NOT_ALLOWED` no RPC, item oculto, rotas sem `teacher`) · D10 (FKs cascade; caso 9). Testes SQL 1–9 → Task 2 Step 1. Notas da S4 → Task 8 Step 5. Mobile → `PreferencesMatrix` (grid em `md`). Erros → Task 4.
- **Placeholders:** nenhum "TBD"; o único texto condicional é o caso 9 (se uma FK de terceiros impedir o `delete`), com instrução explícita de parar e reportar.
- **Consistência de tipos:** `EventPreference`/`PreferencesState`/`DigestPreference` (T3) usados em T4 e T7; `LoadedPreferences` (T4) em T7; `AccountMenuInput`/`isMasterViewingOtherSchool`/`showNotificationsItem` (T5) em T5 e T7; nomes dos RPCs e chaves do payload idênticos em T2 e T4 (`in_app`, `offset_days`, `allowed_offsets`, `email_recommended`, `digest_time`, `confirmed_at`).
- **Riscos declarados:** caso 9 depende de as outras FKs de `auth.users` terem cascade; `useRole()` devolve `null` enquanto carrega (o item Notificações pisca ausente por um instante — aceitável); payload ordena por `sort_order` da função de padrões.
