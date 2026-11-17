# Fase 3 (S2) — Segurança da conta + `require_2fa` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a Fase 3 da Sprint S2: troca de senha em 3 passos, 2FA TOTP (ativar/desativar/login), política `require_2fa` por escola **com enforcement no front e no banco (RLS)**, e recuperação de acesso via Edge Function.

**Architecture:** Uma função pura `resolveMfaGate()` (TDD, Vitest) decide o estado no front (`ok | challenge | enroll_grace | enroll_blocked`); um espelho em SQL (`public.mfa_gate_ok()`) decide no banco. O banco aplica o gate com **uma policy RESTRICTIVE por tabela** (AND com as policies existentes, sem reescrever nenhuma das ~95 policies). Carência por usuário numa tabela própria `mfa_grace`, escrita só por RPC. Recuperação por Edge Function `reset-user-mfa` (service role), no padrão de `remove-user`.

**Tech Stack:** React + TypeScript, Supabase Auth MFA (`auth.mfa.*`), Postgres RLS, Deno Edge Functions, Vitest.

**Spec:** `docs/PROMPT_S2_CLAUDE_CODE.md` (Fase 3, itens 1-5) + decisões do usuário em 17/11/2026 (abaixo).

## Decisões já tomadas (não reabrir)

- Carência: **7 dias**, por usuário, iniciada na 1ª vez que ele esbarra numa escola com `require_2fa=true` sem fator verificado.
- Enforcement: **front + RLS** juntos.
- Edge Function de recuperação: **nesta fase**.
- Quem liga `require_2fa` precisa ter 2FA verificado e sessão `aal2` (evita trancar a escola, inclusive o próprio admin).
- 1 fator TOTP ativo por usuário (front confere `listFactors()` antes de oferecer "Ativar").

## Decisões adicionais (usuário, 17/11/2026)

- **Quem é exigido: owner + admin** (quando a escola liga `require_2fa`). Financeiro e professor não são bloqueados.
- **Master admin também é exigido, sempre** — independe de toggle de escola (ele não pertence a uma). Mesma carência de 7 dias por usuário, mesmo gate de RLS. Hoje o master não tem nenhum 2FA (zero código de MFA no repo).
- **Risco de trancar o próprio master:** o master é a conta do dono do produto. Mitigações no plano: (a) ordem de rollout obrigatória em "Ordem de rollout"; (b) recuperação do master **não** passa pela Edge Function (ele não consegue autenticar em aal2 sem o aparelho) — o caminho é remover o fator direto no painel Supabase (Authentication → Users → MFA) ou via SQL `delete from auth.mfa_factors where user_id = '<uid>'`; documentar isso no `CLAUDE.md` (Task 9).

## Ordem de rollout (obrigatória)

1. Migration A (schema + funções; ainda não bloqueia nada, nenhuma tabela usa o gate).
2. Deploy do front (Tasks 7-8) — é ele que chama `start_mfa_grace()` e dá a carência ao master/admins.
3. **Master ativa o próprio 2FA** (e confirma que o login pede o código).
4. Migration B e C (policies + RPCs) — a partir daqui o gate vale de verdade.
5. Edge Function (Task 6) pode ser deployada a qualquer momento antes de ligar o toggle em escola real.

Pular o passo 2 antes do 4 trancaria o master (sem linha em `mfa_grace` = bloqueado).

## Global Constraints

- Timestamps sempre `TIMESTAMPTZ`; datas exibidas no fuso do browser (regra TIMEZONE.md).
- Mensagens ao usuário em português, erros via `getFriendlyErrorMessage` (`src/lib/friendlyError.ts`).
- **Nunca** logar segredo TOTP, `qr_code`, nem código de 6 dígitos (nem em `console.log`, nem em `debugReport`).
- Toda query nova filtra por `school_id` explicitamente (CLAUDE.md).
- Drift de schema: **confirmar em produção** (`pg_policies`, `information_schema`) antes de escrever cada migration. Migrations entram por `supabase db push` (CLI já linkado, ver memória `feedback_supabase_cli_direto`): `--dry-run` primeiro, mostrar ao usuário, **pedir autorização por tipo de ação** antes do push real. Validação com `BEGIN ... ROLLBACK` não precisa de autorização de escrita.
- Funções PL/pgSQL grandes: não colar no SQL Editor do Studio (corrompe `$$`); usar `supabase db push`.
- TDD: teste falhando primeiro, em toda lógica pura.

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/passwordRules.ts` (+test) | Checklist de requisitos de senha (puro) |
| `src/lib/mfaGate.ts` (+test) | `resolveMfaGate()` puro — única fonte do estado de 2FA no front |
| `src/contexts/MfaGateContext.tsx` | **(mudou na execução: Provider, não hook por rota)** Junta AAL, `listFactors`, escola, role, RPC de carência → `resolveMfaGate`; exporta `MfaGateProvider` e `useMfaGate()` |
| `src/components/security/MfaChallenge.tsx` | Tela "digite o código" (login e retomada de sessão) |
| `src/components/security/MfaEnrollFlow.tsx` | Ativação em 3 passos (reutilizado na forçada e em Configurações) |
| `src/components/security/MfaGate.tsx` | Envolve rotas: decide challenge / enroll forçado / banner de carência |
| `src/components/settings/SecuritySection.tsx` | Aba "Segurança": senha, 2FA, toggle `require_2fa` |
| `src/components/settings/PasswordChangeFlow.tsx` | Troca de senha em 3 passos |
| `src/components/settings/MfaRecoveryButton.tsx` | Admin remove o fator de um membro (chama a Edge Function) |
| `supabase/migrations/20261117120000_mfa_schema_and_gate_fn.sql` | `require_2fa`, `mfa_grace`, `start_mfa_grace()`, `mfa_gate_ok()`, trigger do toggle |
| `supabase/migrations/20261117130000_mfa_restrictive_policies.sql` | Policies RESTRICTIVE por tabela |
| `supabase/migrations/20261117131000_mfa_gate_in_definer_rpcs.sql` | `assert_mfa_gate()` nas RPCs `SECURITY DEFINER` |
| `supabase/functions/reset-user-mfa/index.ts` | Remove fatores de outro usuário (service role) |
| `supabase/tests/mfa_gate_matrix.sql` | Roteiro `BEGIN…ROLLBACK` com a matriz de cenários |

---

### Task 1: Regras de senha (puro, TDD)

**Files:**
- Create: `src/lib/passwordRules.ts`
- Test: `src/lib/passwordRules.test.ts`

**Interfaces:**
- Produces: `evaluatePassword(pw: string): { rules: { id: 'length'|'number'|'symbol'; label: string; ok: boolean; required: boolean }[]; valid: boolean }` — `valid` = todas as `required` ok (length ≥ 10 e número; símbolo é só recomendado).

- [ ] **Step 1: Teste falhando**

```ts
import { describe, it, expect } from "vitest";
import { evaluatePassword } from "./passwordRules";

describe("evaluatePassword", () => {
  it("exige 10+ caracteres e um número", () => {
    expect(evaluatePassword("abcdefghi1").valid).toBe(true);
    expect(evaluatePassword("abcdefghi").valid).toBe(false);   // 9 chars, sem número
    expect(evaluatePassword("abcdefghij").valid).toBe(false);  // sem número
    expect(evaluatePassword("a1").valid).toBe(false);          // curta
  });

  it("símbolo é recomendado, não obrigatório", () => {
    const r = evaluatePassword("abcdefghi1");
    const symbol = r.rules.find((x) => x.id === "symbol")!;
    expect(symbol.required).toBe(false);
    expect(symbol.ok).toBe(false);
    expect(r.valid).toBe(true);
  });

  it("detecta símbolo", () => {
    expect(evaluatePassword("abcdefghi1!").rules.find((x) => x.id === "symbol")!.ok).toBe(true);
  });
});
```

- [ ] **Step 2:** `npx vitest run src/lib/passwordRules.test.ts` → FAIL ("evaluatePassword" não existe).

- [ ] **Step 3: Implementação mínima**

```ts
export interface PasswordRule { id: "length" | "number" | "symbol"; label: string; ok: boolean; required: boolean }

export function evaluatePassword(pw: string): { rules: PasswordRule[]; valid: boolean } {
  const rules: PasswordRule[] = [
    { id: "length", label: "Pelo menos 10 caracteres", ok: pw.length >= 10, required: true },
    { id: "number", label: "Pelo menos um número", ok: /\d/.test(pw), required: true },
    { id: "symbol", label: "Um símbolo (recomendado)", ok: /[^A-Za-z0-9]/.test(pw), required: false },
  ];
  return { rules, valid: rules.filter((r) => r.required).every((r) => r.ok) };
}
```

- [ ] **Step 4:** rodar o teste → PASS.
- [ ] **Step 5: Commit** — `git add src/lib/passwordRules.* && git commit -m "Regras de senha em função pura (S2, Fase 3)"`

---

### Task 2: `resolveMfaGate` (puro, TDD)

**Files:**
- Create: `src/lib/mfaGate.ts`
- Test: `src/lib/mfaGate.test.ts`

**Interfaces:**
- Produces:
```ts
export type MfaGateState = "ok" | "challenge" | "enroll_grace" | "enroll_blocked";
export interface MfaGateInput {
  currentLevel: "aal1" | "aal2" | null;
  hasVerifiedFactor: boolean;
  schoolRequires2fa: boolean;
  isAdminOrOwner: boolean;
  isMasterAdmin: boolean;      // master é sempre exigido
  graceUntil: Date | null;
  now: Date;
}
export function resolveMfaGate(i: MfaGateInput): MfaGateState;
export function graceDaysLeft(graceUntil: Date, now: Date): number; // arredonda pra cima, mín. 0
```

- [ ] **Step 1: Testes falhando**

```ts
import { describe, it, expect } from "vitest";
import { resolveMfaGate, graceDaysLeft } from "./mfaGate";

const now = new Date("2026-11-20T12:00:00Z");
const base = {
  currentLevel: "aal1" as const, hasVerifiedFactor: false, schoolRequires2fa: false,
  isAdminOrOwner: true, isMasterAdmin: false, graceUntil: null, now,
};

describe("resolveMfaGate", () => {
  it("sem exigência e sem fator → ok", () => {
    expect(resolveMfaGate(base)).toBe("ok");
  });
  it("tem fator verificado mas sessão aal1 → challenge (qualquer escola)", () => {
    expect(resolveMfaGate({ ...base, hasVerifiedFactor: true })).toBe("challenge");
  });
  it("sessão aal2 → ok", () => {
    expect(resolveMfaGate({ ...base, hasVerifiedFactor: true, currentLevel: "aal2", schoolRequires2fa: true })).toBe("ok");
  });
  it("escola exige, admin sem fator, dentro da carência → enroll_grace", () => {
    expect(resolveMfaGate({ ...base, schoolRequires2fa: true, graceUntil: new Date("2026-11-25T00:00:00Z") })).toBe("enroll_grace");
  });
  it("escola exige, admin sem fator, carência vencida → enroll_blocked", () => {
    expect(resolveMfaGate({ ...base, schoolRequires2fa: true, graceUntil: new Date("2026-11-19T00:00:00Z") })).toBe("enroll_blocked");
  });
  it("escola exige, sem carência registrada → enroll_blocked (seguro por padrão)", () => {
    expect(resolveMfaGate({ ...base, schoolRequires2fa: true })).toBe("enroll_blocked");
  });
  it("escola exige mas usuário é financeiro/professor → ok", () => {
    expect(resolveMfaGate({ ...base, schoolRequires2fa: true, isAdminOrOwner: false })).toBe("ok");
  });
  it("master admin é exigido mesmo sem toggle de escola nenhum", () => {
    const m = { ...base, isMasterAdmin: true, isAdminOrOwner: false, schoolRequires2fa: false };
    expect(resolveMfaGate({ ...m, graceUntil: new Date("2026-11-25T00:00:00Z") })).toBe("enroll_grace");
    expect(resolveMfaGate({ ...m, graceUntil: null })).toBe("enroll_blocked");
    expect(resolveMfaGate({ ...m, hasVerifiedFactor: true })).toBe("challenge");
    expect(resolveMfaGate({ ...m, hasVerifiedFactor: true, currentLevel: "aal2" })).toBe("ok");
  });
});

describe("graceDaysLeft", () => {
  it("arredonda para cima e nunca é negativo", () => {
    expect(graceDaysLeft(new Date("2026-11-22T00:00:00Z"), now)).toBe(2);
    expect(graceDaysLeft(new Date("2026-11-10T00:00:00Z"), now)).toBe(0);
  });
});
```

- [ ] **Step 2:** `npx vitest run src/lib/mfaGate.test.ts` → FAIL.
- [ ] **Step 3: Implementação**

```ts
export type MfaGateState = "ok" | "challenge" | "enroll_grace" | "enroll_blocked";

export interface MfaGateInput {
  currentLevel: "aal1" | "aal2" | null;
  hasVerifiedFactor: boolean;
  schoolRequires2fa: boolean;
  isAdminOrOwner: boolean;
  graceUntil: Date | null;
  now: Date;
}

// Espelho em TS de public.mfa_gate_ok() (SQL). Diferença intencional: o front
// também pede o código para quem tem fator mesmo em escola que não exige
// (2FA voluntário); o banco só bloqueia quando a escola exige.
export function resolveMfaGate(i: MfaGateInput): MfaGateState {
  if (i.currentLevel === "aal2") return "ok";
  if (i.hasVerifiedFactor) return "challenge";
  const required = i.isMasterAdmin || (i.schoolRequires2fa && i.isAdminOrOwner);
  if (!required) return "ok";
  if (i.graceUntil && i.graceUntil.getTime() > i.now.getTime()) return "enroll_grace";
  return "enroll_blocked";
}

export function graceDaysLeft(graceUntil: Date, now: Date): number {
  const ms = graceUntil.getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}
```

- [ ] **Step 4:** rodar → PASS.
- [ ] **Step 5: Commit** — `git commit -m "resolveMfaGate: estado de 2FA como função pura (S2, Fase 3)"`

---

### Task 3: Migration A — schema + `mfa_gate_ok()` + carência + guarda do toggle

**Files:**
- Create: `supabase/migrations/20261117120000_mfa_schema_and_gate_fn.sql`
- Create: `supabase/tests/mfa_gate_matrix.sql`

**Interfaces:**
- Produces (SQL): `schools.require_2fa boolean not null default false`; tabela `public.mfa_grace(user_id, started_at, grace_until)`; `public.start_mfa_grace() returns timestamptz`; `public.mfa_gate_ok() returns boolean`; `public.assert_mfa_gate() returns void`; trigger `schools_require_2fa_guard`.

- [ ] **Step 1: Diagnóstico em produção (colar resultado antes de escrever a migration)**

```bash
supabase db query --linked "select column_name,data_type from information_schema.columns where table_schema='public' and table_name in ('schools','profiles','user_roles') order by 1,2;"
supabase db query --linked "select count(*) from auth.mfa_factors;"
supabase db query --linked "select polname, polcmd, polpermissive from pg_policy where polrelid='public.profiles'::regclass;"
```
Confirmar: `user_roles` tem `user_id` + `role` (unique por user_id); `auth.mfa_factors` legível pelo owner da função. (Se o CLI não tiver `db query`, usar o SQL Editor só para estes SELECTs.)

- [ ] **Step 2: Escrever a migration**

```sql
-- Fase 3 (S2): exigir 2FA por escola. Enforcement no banco via mfa_gate_ok().

alter table public.schools
  add column if not exists require_2fa boolean not null default false;

-- Carência por usuário. Tabela própria (e não coluna em profiles) porque
-- profiles é auto-editável pelo usuário; aqui só a RPC escreve.
create table if not exists public.mfa_grace (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  started_at  timestamptz not null default now(),
  grace_until timestamptz not null
);
alter table public.mfa_grace enable row level security;
drop policy if exists mfa_grace_select_own on public.mfa_grace;
create policy mfa_grace_select_own on public.mfa_grace
  for select to authenticated using (user_id = auth.uid());
-- sem policies de insert/update/delete: só funções SECURITY DEFINER escrevem.

-- "Esse usuário é owner ou admin da escola dele?"
create or replace function public.mfa_is_admin_or_owner(p_user uuid, p_school uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.schools s where s.id = p_school and s.owner_user_id = p_user)
      or exists (select 1 from public.user_roles r where r.user_id = p_user and r.role = 'admin');
$$;

create or replace function public.mfa_gate_ok()
returns boolean language plpgsql stable security definer set search_path = public, auth as $$
declare
  v_uid uuid := auth.uid();
  v_school uuid;
  v_master boolean;
  v_req boolean;
begin
  if v_uid is null then return true; end if;                       -- service role/anon: demais policies decidem
  if coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2' then return true; end if;

  select p.school_id, coalesce(p.is_master_admin, false) into v_school, v_master
    from public.profiles p where p.user_id = v_uid;

  if not v_master then
    if v_school is null then return true; end if;                   -- sem escola ainda (onboarding)
    select s.require_2fa into v_req from public.schools s where s.id = v_school;
    if not coalesce(v_req, false) then return true; end if;
    if not public.mfa_is_admin_or_owner(v_uid, v_school) then return true; end if;
  end if;                                                           -- master: sempre exigido

  -- usuário exigido, sessão aal1:
  if exists (select 1 from auth.mfa_factors f where f.user_id = v_uid and f.status = 'verified') then
    return false;                                                   -- tem fator → precisa do desafio (aal2)
  end if;
  return exists (select 1 from public.mfa_grace g where g.user_id = v_uid and g.grace_until > now());
end $$;

create or replace function public.assert_mfa_gate()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.mfa_gate_ok() then
    raise exception 'MFA_REQUIRED' using errcode = '42501',
      hint = 'Esta escola exige verificação em duas etapas (2FA).';
  end if;
end $$;

-- Inicia a carência (idempotente). Só cria se a escola exige, o usuário é
-- exigido e não tem fator verificado.
create or replace function public.start_mfa_grace()
returns timestamptz language plpgsql security definer set search_path = public, auth as $$
declare
  v_uid uuid := auth.uid();
  v_school uuid;
  v_master boolean;
  v_until timestamptz;
begin
  if v_uid is null then raise exception 'não autenticado' using errcode = '28000'; end if;
  select p.school_id, coalesce(p.is_master_admin, false) into v_school, v_master
    from public.profiles p where p.user_id = v_uid;

  if exists (select 1 from auth.mfa_factors f where f.user_id = v_uid and f.status = 'verified') then
    return null;                                                    -- já tem fator: não precisa de carência
  end if;
  if not v_master and (
       v_school is null
    or not coalesce((select s.require_2fa from public.schools s where s.id = v_school), false)
    or not public.mfa_is_admin_or_owner(v_uid, v_school)
  ) then return null; end if;

  insert into public.mfa_grace (user_id, grace_until)
  values (v_uid, now() + interval '7 days')
  on conflict (user_id) do nothing;

  select g.grace_until into v_until from public.mfa_grace g where g.user_id = v_uid;
  return v_until;
end $$;
revoke all on function public.start_mfa_grace() from public;
grant execute on function public.start_mfa_grace() to authenticated;

-- Guarda do toggle: ligar exige aal2 (e fator verificado) de quem liga, e
-- zera carências antigas da escola (religar = recomeçar o relógio).
create or replace function public.schools_require_2fa_guard()
returns trigger language plpgsql security definer set search_path = public, auth as $$
declare v_uid uuid := auth.uid();
begin
  if new.require_2fa is not distinct from old.require_2fa then return new; end if;
  if v_uid is not null then   -- service role passa
    if not exists (select 1 from public.profiles p where p.user_id = v_uid and p.is_master_admin) then
      if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
        raise exception 'Ative e verifique o seu 2FA antes de alterar esta política.' using errcode = '42501';
      end if;
    end if;
  end if;
  if new.require_2fa then
    delete from public.mfa_grace g using public.profiles p
     where g.user_id = p.user_id and p.school_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists schools_require_2fa_guard on public.schools;
create trigger schools_require_2fa_guard before update on public.schools
  for each row execute function public.schools_require_2fa_guard();
```

- [ ] **Step 3: Escrever `supabase/tests/mfa_gate_matrix.sql`** — roteiro `BEGIN … ROLLBACK`. Estrutura (um bloco por cenário, simulando `request.jwt.claims` e `SET LOCAL ROLE authenticated`, mesma técnica validada na Fase 0 do `audit_logs`):

```sql
begin;
  -- setup: escola de teste, admin, mfa_factor verified fake, etc. (inserts dentro da transação)
  -- cenário N:
  select set_config('request.jwt.claims', '{"sub":"<uid>","aal":"aal1","role":"authenticated"}', true);
  set local role authenticated;
  select 'C1 escola não exige, aal1' as cenario, public.mfa_gate_ok() as esperado_true;
  reset role;
rollback;
```
Cenários mínimos (todos devem ser exercitados): C1 escola não exige/aal1 → true; C2 exige+admin+sem fator+sem carência → **false**; C3 exige+admin+sem fator+carência futura → true; C4 carência vencida → false; C5 exige+admin+fator verificado+aal1 → false; C6 mesmo com aal2 → true; C7 exige+financeiro → true; C8 master sem fator e sem carência → **false**, com carência futura → true, com fator+aal1 → false, aal2 → true (master é sempre exigido, `school_id` nulo não o isenta); C8b usuário sem escola e não-master (onboarding) → true; C9 owner sem linha em user_roles → tratado como admin; C10 `update schools set require_2fa=true` com aal1 → erro; com aal2 → ok e apaga `mfa_grace` da escola.

- [ ] **Step 4: Validar** — `supabase db push --dry-run` e rodar `supabase/tests/mfa_gate_matrix.sql` (dentro do `BEGIN…ROLLBACK`; para a migration, aplicar também dentro de `BEGIN…ROLLBACK` antes). Colar o resultado de cada cenário. **Esperado:** todos conforme a lista acima.
- [ ] **Step 5:** mostrar `--dry-run` ao usuário e **pedir autorização** do `supabase db push` real (ação de escrita em produção). Após aplicar: `supabase gen types typescript --linked > src/integrations/supabase/types.ts`.
- [ ] **Step 6: Commit** — `git add supabase/migrations/20261117120000_* supabase/tests src/integrations/supabase/types.ts && git commit -m "Migration: require_2fa, carência por usuário e mfa_gate_ok()"`

---

### Task 4: Migration B — policies RESTRICTIVE nas tabelas sensíveis

**Files:**
- Create: `supabase/migrations/20261117130000_mfa_restrictive_policies.sql`
- Modify: `supabase/tests/mfa_gate_matrix.sql` (adicionar leitura em tabelas)

**Tabelas gateadas:** `students, teachers, classes, class_teachers, contracts, enrollments, tuitions, expenses, expense_categories, recurring_expenses, service_charges, school_services, student_services, renegotiations, audit_logs`.
**Deliberadamente fora:** `profiles`, `schools`, `user_roles`, `invitations` (a própria tela de ativação do 2FA precisa lê-las); `debug_reports`. Documentar no comentário da migration.

- [ ] **Step 1: Diagnóstico** — confirmar que cada tabela existe e tem RLS ligado, e se `teachers_directory` (view) é `security_invoker`:

```sql
select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r' order by 1;
select relname, reloptions from pg_class where relname='teachers_directory';
```
Se a view **não** for `security_invoker`, ela vaza `teachers` sem passar pelo gate → anotar e tratar (`alter view ... set (security_invoker = true)` ou gate dentro da view).

- [ ] **Step 2: Migration**

```sql
-- Gate de 2FA: policy RESTRICTIVE = AND com as permissivas existentes.
-- Fora do gate de propósito: profiles, schools, user_roles, invitations
-- (a tela de ativação do 2FA depende delas) e debug_reports.
do $$
declare t text;
begin
  foreach t in array array[
    'students','teachers','classes','class_teachers','contracts','enrollments',
    'tuitions','expenses','expense_categories','recurring_expenses','service_charges',
    'school_services','student_services','renegotiations','audit_logs'
  ] loop
    execute format('drop policy if exists mfa_gate on public.%I', t);
    execute format(
      'create policy mfa_gate on public.%I as restrictive for all to authenticated
         using (public.mfa_gate_ok()) with check (public.mfa_gate_ok())', t);
  end loop;
end $$;
```

- [ ] **Step 3: Estender a matriz** — para 3 tabelas representativas (`students`, `tuitions`, `audit_logs`): C2 (bloqueado) → `select count(*)` retorna **0 linhas** (RLS filtra, não erra) e `insert` falha com `42501`; C5 idem; C3/C6 → vê os dados normalmente; usuário de **outra escola** e **financeiro** continuam como antes (regressão: nenhuma mudança de comportamento para quem não é exigido).
- [ ] **Step 4:** validar com `BEGIN…ROLLBACK`, `--dry-run`, mostrar ao usuário, pedir autorização do push.
- [ ] **Step 5: Commit** — `git commit -m "Migration: policies RESTRICTIVE do gate de 2FA"`

---

### Task 5: Migration C — gate nas RPCs `SECURITY DEFINER`

RPCs `SECURITY DEFINER` rodam como dono e **ignoram RLS** — sem esta task, `import_*` / `insert_generated_*` / `renegotiate_tuitions` / `save_class_with_teachers` seriam uma porta lateral ao gate.

**Files:**
- Create: `supabase/migrations/20261117131000_mfa_gate_in_definer_rpcs.sql`

- [ ] **Step 1: Inventário em produção** (não assumir a lista do `types.ts`):

```sql
select p.proname, p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.prosecdef order by 1;
```
- [ ] **Step 2:** para cada RPC que **lê ou escreve dados de escola** (esperado: `import_teacher, import_student, import_enrollment, import_contract, insert_generated_expenses, insert_generated_tuitions, renegotiate_tuitions, save_class_with_teachers, get_active_teachers_salary_sum`, mais o que o inventário mostrar), obter a definição atual (`select pg_get_functiondef('public.<nome>'::regproc)`) e reaplicar com `create or replace` **idêntica**, adicionando como primeira instrução do corpo: `perform public.assert_mfa_gate();`. Manter o `set_config('app.audit_source', …)` onde existe. Não alterar mais nada nas funções.
- [ ] **Step 3: Teste** — no `mfa_gate_matrix.sql`, C2 chamando `import_student(...)` e `insert_generated_tuitions(...)` deve falhar com `MFA_REQUIRED`; C6 passa.
- [ ] **Step 4:** como são funções grandes, aplicar via `supabase db push` (nunca SQL Editor). `--dry-run`, mostrar, autorização.
- [ ] **Step 5: Commit** — `git commit -m "Migration: assert_mfa_gate() nas RPCs SECURITY DEFINER"`

---

### Task 6: Edge Function `reset-user-mfa`

**Files:**
- Create: `supabase/functions/reset-user-mfa/index.ts`
- Modify: `supabase/config.toml` (adicionar `[functions.reset-user-mfa] verify_jwt = false`, igual às demais — a função valida o Bearer internamente)

**Regras de autorização (todas):** caller autenticado; **não** pode resetar a si mesmo (exceto master admin); caller é master admin **ou** owner/admin da mesma escola do alvo; se a escola do caller exige 2FA, o JWT do caller precisa ser `aal2` (senão senha roubada = reset de terceiros); toda execução grava linha em `audit_logs` (`table_name='mfa_factors'`, `action='RESET'`, `source='manual'`).

- [ ] **Step 1: Implementação** (mesmo `buildCorsHeaders` de `remove-user`):

```ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://class-cash-tan.vercel.app",
  "http://localhost:8080",
  "http://localhost:8081",
];
function buildCorsHeaders(req: Request) {
  const origin = req.headers.get("origin");
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}

function jwtAal(token: string): string {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.aal ?? "aal1";
  } catch { return "aal1"; }
}

serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const fail = (error: string, status: number) => Response.json({ error }, { status, headers: cors });

  try {
    const { user_id } = await req.json();
    if (!user_id) return fail("user_id é obrigatório", 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail("Não autorizado", 401);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller }, error: authError } = await admin.auth.getUser(token);
    if (authError || !caller) return fail("Não autorizado", 401);

    const { data: callerProfile } = await admin.from("profiles")
      .select("school_id, is_master_admin").eq("user_id", caller.id).single();
    const isMaster = !!callerProfile?.is_master_admin;

    if (caller.id === user_id && !isMaster) {
      return fail("Peça a outro administrador (ou ao suporte) para redefinir o seu 2FA.", 403);
    }

    const { data: target } = await admin.from("profiles")
      .select("school_id").eq("user_id", user_id).single();
    if (!target?.school_id) return fail("Usuário não encontrado.", 404);
    const schoolId = target.school_id;

    if (!isMaster) {
      const { data: school } = await admin.from("schools")
        .select("owner_user_id, require_2fa").eq("id", schoolId).single();
      const { data: role } = await admin.from("user_roles")
        .select("role").eq("user_id", caller.id).eq("role", "admin").maybeSingle();
      const sameSchool = callerProfile?.school_id === schoolId;
      const isOwner = school?.owner_user_id === caller.id;
      if (!sameSchool || (!isOwner && !role)) return fail("Apenas admins da escola podem redefinir o 2FA de um membro.", 403);
      if (school?.require_2fa && jwtAal(token) !== "aal2") {
        return fail("Confirme o seu 2FA para executar esta ação.", 403);
      }
    }

    const { data: factors, error: listError } = await admin.auth.admin.mfa.listFactors({ userId: user_id });
    if (listError) throw listError;
    for (const f of factors?.factors ?? []) {
      const { error } = await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId: user_id });
      if (error) throw error;
    }
    await admin.from("mfa_grace").delete().eq("user_id", user_id); // recomeça a carência no próximo login

    await admin.from("audit_logs").insert({
      table_name: "mfa_factors", action: "RESET", record_id: user_id, school_id: schoolId,
      actor_user_id: caller.id, actor_role: isMaster ? "master" : "admin",
      is_master_action: isMaster, source: "manual",
      new_data: { removed_factors: (factors?.factors ?? []).length },
    });

    return Response.json({ success: true, removed: (factors?.factors ?? []).length }, { headers: cors });
  } catch (err: any) {
    console.error("reset-user-mfa error:", err?.message);   // nunca logar o corpo/tokens
    return fail(err.message ?? "Erro interno", 500);
  }
});
```
- [ ] **Step 2:** confirmar a assinatura `admin.auth.admin.mfa.*` na versão do supabase-js usada pelas outras functions (se `deleteFactor` exigir `{ id, userId }` ou outra forma, ajustar). Confirmar também que `audit_logs.action` aceita `'RESET'` (checar CHECK constraint; se só aceita INSERT/UPDATE/DELETE, usar `'UPDATE'` com `changed_fields = {'mfa_reset'}`).
- [ ] **Step 3: Teste manual** (sem framework de teste de Edge Function no repo): `supabase functions serve reset-user-mfa` + `curl` com 4 casos → sem token (401), a si mesmo (403), admin de outra escola (403), admin da mesma escola (200 e fator some em `auth.mfa_factors`). Colar as respostas.
- [ ] **Step 4:** pedir autorização e `supabase functions deploy reset-user-mfa`.
- [ ] **Step 5: Commit** — `git commit -m "Edge Function reset-user-mfa: recuperação de 2FA por admin/master"`

---

### Task 7: Hook `useMfaGate` + componentes de desafio/ativação + `MfaGate`

**Files:**
- Create: `src/hooks/useMfaGate.ts`, `src/components/security/MfaChallenge.tsx`, `src/components/security/MfaEnrollFlow.tsx`, `src/components/security/MfaGate.tsx`
- Modify: `src/components/ProtectedRoute.tsx` (envolver o retorno final e o ramo do master em `<MfaGate>`)
- Modify: `src/contexts/SchoolContext.tsx` (expor `require_2fa` no `school`, se o `select` for explícito)

**Interfaces:**
- Consumes: `resolveMfaGate`, `graceDaysLeft` (Task 2); `supabase.rpc('start_mfa_grace')` (Task 3).
- Produces: `useMfaGate(): { state: MfaGateState | 'loading'; graceUntil: Date | null; refresh: () => Promise<void> }`.

- [ ] **Step 1: `useMfaGate`** — na ordem: (1) `supabase.auth.mfa.getAuthenticatorAssuranceLevel()` → `currentLevel`; (2) `supabase.auth.mfa.listFactors()` → `hasVerifiedFactor = data.totp.length > 0` (a lista `totp` só traz fatores **verificados**); (3) se `school.require_2fa && isAdminOrOwner && !hasVerifiedFactor` → `await supabase.rpc('start_mfa_grace')` (**antes** de liberar as páginas — é isso que impede a corrida com as queries) e usar o retorno como `graceUntil`; (4) `resolveMfaGate({... now: new Date()})`. `state = 'loading'` até terminar. `refresh()` refaz tudo (chamado após verificar/desativar).
- [ ] **Step 2: `MfaChallenge`** — campo `InputOTP` (já existe `src/components/ui/input-otp.tsx`) de 6 dígitos; `const { data: factors } = await supabase.auth.mfa.listFactors()`, `const factorId = factors.totp[0].id`; `const { data: ch } = await supabase.auth.mfa.challenge({ factorId })`; `await supabase.auth.mfa.verifyChallenge`/`verify({ factorId, challengeId: ch.id, code })`; sucesso → `refresh()`. Erro → "Código incorreto ou expirado. Confira o horário do celular e tente de novo." Botão "Sair" (`signOut`). Nunca logar `code`.
- [ ] **Step 3: `MfaEnrollFlow` (3 passos)** — props `{ onDone: () => void; forced?: boolean }`. Passo 1: instruir a instalar um app autenticador. Passo 2: `supabase.auth.mfa.enroll({ factorType: 'totp' })` → mostrar `<img src={data.totp.qr_code} alt="QR code para o app autenticador" />` e `data.totp.secret` (chave manual) — **só em estado local, nunca em log**. Passo 3: `challenge` + `verify` com o código de 6 dígitos; sucesso → `onDone()`. Antes do passo 2: `listFactors()`; se já houver fator verificado, **não** oferece ativar (1 fator por usuário); se houver fator **não verificado** abandonado (`data.all` com `status !== 'verified'`), `unenroll` dele antes de criar outro.
- [ ] **Step 4: `MfaGate`** — `loading` → spinner; `challenge` → `<MfaChallenge/>`; `enroll_blocked` → tela cheia "Sua escola exige verificação em duas etapas" + `<MfaEnrollFlow forced/>` + botão Sair; `enroll_grace` → `children` + faixa fixa no topo: "Sua escola exige 2FA. Ative até {data} ({n} dias)" com link para `/configuracoes` (aba Segurança) — usar `graceDaysLeft`; `ok` → `children`.
- [ ] **Step 5: Integrar no `ProtectedRoute`** — envolver `children` (nos dois `return <>{children}</>` finais, inclusive o do master com `viewingSchoolId`) em `<MfaGate>`. **Não** envolver `/auth` nem `/onboarding` sem escola. Master é exigido: passar `isMasterAdmin` (de `useMasterAdmin()`) para `resolveMfaGate`; sem escola, o `useMfaGate` chama `start_mfa_grace()` mesmo com `school` nulo. A tela `enroll_blocked` do master tem o mesmo botão "Sair".
- [ ] **Step 6: Verificação** — `npx tsc --noEmit` e `npm run lint` sem erros novos; `npm test` verde.
- [ ] **Step 7: Commit** — `git commit -m "Gate de 2FA no front: desafio, ativação em 3 passos e carência"`

---

### Task 8: Página pessoal `/seguranca` + toggle em Configurações (senha, 2FA, toggle, recuperação)

> **Mudança de desenho (descoberta na Task 7):** senha e 2FA são pessoais e valem para TODOS os papéis (inclusive master, financeiro e professor), mas `/configuracoes` é só de admin. Criar a rota `/seguranca` (`ProtectedRoute` sem `requireSchool`, dentro do `Layout`, com link no menu) com `PasswordChangeFlow` + card de 2FA. O banner de carência (`MfaGate`) já aponta para `/seguranca`. Em Configurações fica só o toggle `require_2fa` (admin).

**Files:**
- Create: `src/components/settings/SecuritySection.tsx`, `src/components/settings/PasswordChangeFlow.tsx`, `src/components/settings/MfaRecoveryButton.tsx`
- Modify: `src/pages/Settings.tsx` (nova `TabsTrigger value="seguranca"` + `TabsContent`)
- Modify: `src/pages/Team.tsx` (botão "Redefinir 2FA" por membro, só para quem pode)

- [ ] **Step 1: `PasswordChangeFlow` (3 passos)** — (1) senha atual: `supabase.auth.signInWithPassword({ email: user.email, password })` — erro "Senha atual incorreta." (a sessão continua a mesma conta; não navegar); (2) nova senha com checklist ao vivo via `evaluatePassword` (botão desabilitado até `valid`; ícone + texto, não só cor), campo de confirmação; (3) `supabase.auth.updateUser({ password })` → `supabase.auth.signOut({ scope: 'others' })` → toast "Senha alterada. As outras sessões foram encerradas." Erros via `getFriendlyErrorMessage`. Se o usuário tem 2FA e a sessão está `aal1`, o `updateUser` falha: tratar mostrando "Confirme o seu 2FA primeiro" (o `MfaGate` já impede esse estado na prática).
- [ ] **Step 2: Card "Verificação em duas etapas"** em `SecuritySection` — sem fator: botão "Ativar" abre `MfaEnrollFlow`; com fator: badge "Ativo" + "Desativar" que pede o código atual (`challenge`+`verify`) e só então `supabase.auth.mfa.unenroll({ factorId })`. Se a escola exige e o usuário é exigido: botão Desativar **oculto** com texto "Sua escola exige 2FA".
- [ ] **Step 3: Toggle `require_2fa`** (só owner/admin) — `Switch` "Exigir 2FA de owner e admin". Ao ligar: se o usuário atual não tem fator/`aal2`, mostrar explicação + `MfaEnrollFlow` primeiro (espelha o trigger do banco). Texto de apoio obrigatório: "Quem ainda não ativou terá 7 dias a partir do próximo acesso." Atualizar via `supabase.from('schools').update({ require_2fa }).eq('id', school.id)`; erro do trigger (`42501`) → mensagem amigável. Adicionar o mapeamento em `friendlyError.ts`.
- [ ] **Step 4: `MfaRecoveryButton`** — em `Team.tsx`, por membro (não em si mesmo): `supabase.functions.invoke('reset-user-mfa', { body: { user_id } })` com `AlertDialog` de confirmação ("O membro precisará ativar o 2FA de novo no próximo acesso"); toasts de sucesso/erro.
- [ ] **Step 5: Verificação manual** com `npm run dev` (via skill `run`/`browser-qa`): senha em 3 passos encerrando outras sessões; ativar → sair → logar pedindo código; desativar pedindo código; toggle bloqueado sem 2FA; membro com toggle ligado entra em carência e vê a faixa. Anexar prints/descrição do que foi observado — **não declarar pronto sem ter visto funcionar**.
- [ ] **Step 6: Commit** — `git commit -m "Aba Segurança: troca de senha, 2FA, exigência por escola e recuperação"`

---

### Task 9: Fechamento — documentação, QA e memória

**Files:**
- Modify: `CHANGELOG.md`, `QA_CHECKLIST.md`, `CLAUDE.md`
- Create: `claude/` resumo da sprint no formato de `docs/RESUMO_SPRINT_S1_CLAUDE_PROJECT.md` (item "Ao terminar" do PROMPT_S2)

- [ ] **Step 1: `CLAUDE.md`** — registrar a convenção: *"Gate de 2FA no banco = policy RESTRICTIVE `mfa_gate` por tabela + `assert_mfa_gate()` nas RPCs `SECURITY DEFINER`. Tabela/RPC nova com dados de escola precisa entrar nas duas listas."* e a exceção deliberada (`profiles`, `schools`, `user_roles`, `invitations`).
- [ ] **Step 2: `QA_CHECKLIST.md`** — roteiro dos itens (6) senha em etapas e (7) 2FA ativar/desativar/login do PROMPT_S2 + cenários C1-C10 da matriz SQL + "financeiro de escola que exige 2FA continua entrando sem 2FA".
- [ ] **Step 3: `CHANGELOG.md`** — Fase 3 completa; migrations a rodar **em ordem** (A, B, C) e a function a deployar.
- [ ] **Step 4:** atualizar a memória `sprint_s2_status.md` (Fase 3 → implementada/validada; pendências reais).
- [ ] **Step 5:** rodar `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`; só então atualizar o PR #1 (`git push`).

---

## Self-Review

- **Cobertura:** item 1 (senha) → T1+T8; item 2 (TOTP) → T7+T8; item 3 (login aal2) → T7 (`MfaChallenge` via `MfaGate`); item 4 (`require_2fa`: carência, quem liga, front, RLS, recuperação) → T2/T3/T4/T5/T6/T7/T8; item 5 (master exigido sempre) → T2 (`isMasterAdmin`), T3 (`mfa_gate_ok`/`start_mfa_grace`), T7 step 5, "Ordem de rollout". Decisões do usuário (7 dias, tudo completo, função já) → T3, T4+T5, T6.
- **Tipos consistentes:** `resolveMfaGate`/`MfaGateInput`/`graceDaysLeft` (T2) usados em T7; `start_mfa_grace()` (T3) usada em T7; `assert_mfa_gate()` (T3) usada em T5; `evaluatePassword` (T1) usada em T8; `reset-user-mfa` `{ user_id }` (T6) usada em T8.
- **Riscos abertos (declarados, não escondidos):** `teachers_directory` pode vazar o gate se a view não for `security_invoker` (T4 step 1); assinatura exata de `admin.auth.admin.mfa.*` e CHECK de `audit_logs.action` a confirmar (T6 step 2); `auth.mfa_factors` precisa ser legível pela função `SECURITY DEFINER` (T3 step 1).
