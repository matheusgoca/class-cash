# S3 — Preferências de notificação (tela + dados, sem envio)

**Data:** 2026-11-18 · **Status:** aprovado em brainstorming (seções 1 e 2) e revisado pelo usuário (2ª rodada de ajustes)
**Origem:** `docs/PROMPT_S2_CLAUDE_CODE.md` (Fase 4, nunca executada) e `docs/PLANO_SPRINTS_NOV2026.md` §3 e §5. Primeiro passo da S3.
**Mockups:** `docs/mockups/Notificacoes.dc.html` (central + botão Preferências) e `docs/mockups/Config-Notificacoes-Seguranca.dc.html` (card "Notificações"). Referência visual: usar tokens do tema e componentes de `src/components/ui/`, nunca os hex.

## Objetivo

Cada usuário de escola (owner, admin, financeiro) escolhe, por evento, se quer aviso no sistema e/ou por e-mail, com qual antecedência, e se quer um resumo diário por e-mail. As escolhas são **salvas de verdade**, mas **nada é gerado nem enviado** nesta entrega: o gerador de notificações é S3 (passos seguintes) e o envio de e-mail é S4.

## Fora do escopo

- Geração de notificações (pg_cron), tabela `notifications`, sino no header, card "Precisa da sua atenção" — passos seguintes da S3.
- Envio de e-mail e do resumo diário — S4.
- Lista, filtros e "Marcar todas como lidas" na central — entram quando houver notificações.
- Registro em `audit_logs` (dispensado pelo PROMPT_S2, Fase 4, item 3).

## Decisões (não reabrir)

| # | Decisão |
|---|---|
| D1 | Abordagem de dados: uma linha por usuário × escola × evento + uma linha de configurações por usuário × escola (não JSONB, não tabela larga). |
| D2 | `offset_days` (não `lead_days`). A **direção** (antes/depois) é fixa por evento e definida em `notification_event_defaults()`, comentada. `0` = no dia. |
| D3 | **E-mail nasce desligado** (todos os eventos e o resumo diário) e a tela mostra exatamente isso, inclusive no primeiro acesso — nada pré-marcado. O usuário liga o que quiser e **salva** (`notification_settings.confirmed_at`). **O gerador da S4 só envia e-mail se `confirmed_at is not null` e o canal estiver ligado.** |
| D4 | `school_id` vem de `get_user_school_id()` dentro dos RPCs, nunca do cliente. O item Notificações fica oculto quando o master está visualizando uma escola diferente da sua (as preferências seriam gravadas na escola de casa, não na visualizada). |
| D5 | Policy RESTRICTIVE `mfa_gate` nas duas tabelas e `assert_mfa_gate()` nos RPCs (convenção do `CLAUDE.md`). Confirmado em 2026-11-18, por `BEGIN…ROLLBACK` com RLS real, que a gate só barra usuário de escola quando `require_2fa = true` (6/6 casos). **O master é sempre exigido** — conferido na definição de `mfa_gate_ok()` em produção em 2026-11-18 (`-- master: sempre exigido`) e no plano da Fase 3 ("Master admin também é exigido, sempre"); o front reforça ("Contas master precisam manter o 2FA ativo"). Logo, master só lê estas tabelas em sessão aal2 (ou dentro da carência). Tornar o 2FA do master opcional seria mudança da Fase 3, fora desta spec. |
| D6 | `UNIQUE (user_id, school_id)` em `notification_settings`; `UNIQUE (user_id, school_id, event)` em `notification_preferences`; `ensure_notification_preferences()` usa `ON CONFLICT DO NOTHING`; `digest_time` é `time`. |
| D7 | Evento **Rematrícula** só para owner/admin (o financeiro não o vê na tela, não ganha linha e o save o rejeita). |
| D8 | Navegação segue o mockup: grupo **Conta** na barra lateral com **Notificações** e **Segurança da conta** (movida do rodapé). Preferências abre pelo botão da central. |
| D10 | FKs com `ON DELETE CASCADE` para `schools(id)` e `auth.users(id)` nas duas tabelas (decisão do usuário; mesmo padrão de `mfa_grace`). Exceção deliberada à regra genérica "sem FK" de `.claude/rules/database/SCHEMA.md`, que é do toolkit Kotlin e não do schema deste projeto. |
| D9 | Professor não acessa nenhum dos cinco assuntos (mensalidades, despesas, contratos, renegociação) → não vê o item Notificações nem as rotas. Continua vendo o grupo Conta só com Segurança da conta. |

## Eventos

Padrões do mockup; direção fixa por evento. Opções de antecedência são as que o seletor oferece (o RPC rejeita valores fora da lista).

| `event` | Rótulo | Descrição | Direção | Sistema | E-mail (antes de confirmar) | Padrão | Opções | Quem vê |
|---|---|---|---|---|---|---|---|---|
| `tuition_due` | Mensalidade a vencer | Lembrete antes do vencimento | antes | ✓ | ✗ | 3 | 1, 3, 5, 7 | owner, admin, financeiro |
| `tuition_overdue` ★ | Mensalidade em atraso | Quando passa do vencimento | depois | ✓ | ✗ | 5 | 1, 3, 5, 10, 15 | owner, admin, financeiro |
| `renegotiation_installment` ★ | Parcela de renegociação | Parcelas dos acordos ativos | antes | ✓ | ✗ | 1 | 0, 1, 2, 3 | owner, admin, financeiro |
| `expense_due` | Despesa a pagar | Despesas e recorrências | antes | ✓ | ✗ | 2 | 0, 1, 2, 3, 5, 7 | owner, admin, financeiro |
| `reenrollment` ★ | Rematrícula | Contratos perto do fim | antes | ✓ | ✗ | 45 | 30, 45, 60, 90 | owner, admin |

Rótulo do seletor: direção "antes" → `0` = "No dia", `n` = "n dia(s) antes"; direção "depois" → "Após n dia(s)".

Resumo diário: nasce **desligado**, horário padrão `07:00`, opções de hora em hora das `06:00` às `20:00`.

★ = **e-mail recomendado**. O mockup mostra e-mail ligado nesses três eventos; aqui isso vira só um selo "Recomendado" ao lado da chave de e-mail, mais o botão opcional "Ativar e-mails recomendados" (liga essas três chaves no rascunho, sem salvar). Nada vem pré-marcado — D3. A lista de recomendados vem de `notification_event_defaults()` (coluna `email_recommended`).

## Dados

### `notification_preferences`

| coluna | tipo | regra |
|---|---|---|
| `id` | uuid PK | `uuid_generate_v4()` |
| `school_id` | uuid not null | FK `schools`, cascade (D10) |
| `user_id` | uuid not null | FK `auth.users`, cascade (D10) |
| `event` | text not null | CHECK nos 5 valores |
| `in_app` | boolean not null | |
| `email` | boolean not null | |
| `offset_days` | integer not null | CHECK `between 0 and 120` (lista fina validada no RPC) |
| `created_at`, `updated_at` | timestamptz | trigger `update_updated_at` existente |

`UNIQUE (user_id, school_id, event)`; índice em `(school_id, event)` para o gerador da S3.

### `notification_settings`

| coluna | tipo | regra |
|---|---|---|
| `id` | uuid PK | |
| `school_id`, `user_id` | uuid not null, FKs (D10) | `UNIQUE (user_id, school_id)` |
| `digest_enabled` | boolean not null default false | |
| `digest_time` | time not null default `'07:00'` | CHECK minutos = 0, entre 06:00 e 20:00 |
| `timezone` | text not null default `'America/Sao_Paulo'` | IANA, gravado a partir do navegador no save (regra TIMEZONE.md: preferência de horário local + fuso separado) |
| `confirmed_at` | timestamptz null | preenchido no primeiro save (D3) |
| `created_at`, `updated_at` | timestamptz | |

FKs (D10), nas duas tabelas: `school_id references public.schools(id) on delete cascade`, `user_id references auth.users(id) on delete cascade`.

### Funções

- **`notification_event_defaults()`** — `immutable`, retorna `(event, direction, in_app, email, email_recommended, offset_days, allowed_offsets int[], admin_only boolean)`. **Única fonte** dos padrões e das opções; comentário explicando a direção de cada evento e `0 = no dia`. O gerador da S3 a usa para quem nunca abriu a tela (só canal "sistema"; e-mail nunca, por D3).
- **`ensure_notification_preferences()`** — `security definer`, `perform assert_mfa_gate()`, `school_id := get_user_school_id()` (erro se nulo). Insere, com `ON CONFLICT DO NOTHING`, uma linha por evento visível ao usuário (sem `reenrollment` se não for owner/admin, via `mfa_is_admin_or_owner`) e a linha de `notification_settings`. Retorna as preferências + settings do usuário nessa escola, **filtradas pelos eventos visíveis ao papel atual** — se o usuário foi rebaixado de admin para financeiro, a linha antiga de `reenrollment` fica no banco mas não volta para a tela (e o gerador também a ignora; ver notas da S4).
- **`save_notification_preferences(p_prefs jsonb, p_digest_enabled boolean, p_digest_time time, p_timezone text)`** — `security definer`, gate, `school_id` como acima, numa transação: valida cada item (evento conhecido, visível ao papel, `offset_days` em `allowed_offsets`, fuso válido em `pg_timezone_names`), faz upsert das linhas e atualiza settings com `confirmed_at = coalesce(confirmed_at, now())`. Erros com `errcode` mapeáveis em `friendlyError.ts`.
- Permissões: `revoke all ... from public, anon`; `grant execute ... to authenticated` só nos dois RPCs.

### RLS

Nas duas tabelas:
- SELECT: `user_id = auth.uid() and school_id = get_user_school_id()`, **ou** `is_master_admin()`.
- INSERT/UPDATE/DELETE: nenhuma policy direta — escrita só pelos RPCs.
- RESTRICTIVE `mfa_gate` (D5).

## Front

### Arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/notificationEvents.ts` (+ `.test.ts`) | Catálogo puro: rótulo, descrição, direção, opções, `adminOnly`; `formatOffset(event, n)`; `visibleEvents(isAdminOrOwner)`; `isDirty(saved, draft)`; `applyRecommendedEmails(draft, recommended)`; `canSave(saved, draft, confirmedAt)`. **Sem padrões** (vêm do banco). |
| `src/lib/notificationPreferences.ts` | Chamadas aos RPCs (`ensure`, `save`), tipagem do retorno. |
| `src/pages/Notifications.tsx` | Central (`/notificacoes`): cabeçalho do mockup + botão Preferências + estado vazio. |
| `src/pages/NotificationPreferences.tsx` | Tela de preferências (`/notificacoes/preferencias`). |
| `src/components/notifications/PreferencesMatrix.tsx` | Matriz evento × canal × antecedência (tabela no desktop, cartões empilhados no celular). |
| `src/components/notifications/DigestSettings.tsx` | Chave do resumo + horário. |
| `src/App.tsx` | 2 rotas, `ProtectedRoute requireSchool allowedRoles={['admin','financial']}`. |
| `src/components/layout/AppSidebar.tsx` | Grupo **Conta**: Notificações (condicional, D4/D9) + Segurança da conta (movida do rodapé). Rodapé fica só com Sair. |
| `src/lib/friendlyError.ts` | Mensagens dos erros dos RPCs. |

### Central (`/notificacoes`)

Cabeçalho "Notificações" / "Lembretes de cobrança, renegociação, despesas e rematrícula", botão **Preferências** (ghost, como no mockup). Corpo: estado vazio desenhado — "Nenhuma notificação ainda. Os avisos começam a aparecer aqui nas próximas versões." + link "Ajustar preferências".

### Tela de preferências

- Voltar para a central; título "Preferências de notificação"; subtítulo do mockup "Escolha o que avisar, onde e com quanta antecedência. Vale para o seu usuário."
- Ao abrir: `ensure_notification_preferences()` → skeleton até responder.
- A tela mostra **sempre** o que está gravado, inclusive no primeiro acesso: e-mail e resumo desligados (D3).
- **Primeiro acesso (`confirmed_at` nulo):** aviso "Os e-mails estão desligados. Ative os que quiser e salve.", selo "Recomendado" na chave de e-mail dos eventos ★ e botão opcional "Ativar e-mails recomendados" (só altera o rascunho).
- Matriz: colunas Evento / No sistema / E-mail / Antecedência; `Switch` com `aria-label` por evento e canal; `Select` de antecedência com os rótulos de `formatOffset`. Rematrícula só para owner/admin.
- Resumo: "Receber um resumo diário por e-mail" + "Horário do resumo" (desabilitado com a chave desligada).
- Rodapé: "Os avisos serão ativados nas próximas versões. Suas escolhas já ficam salvas." + botão **Salvar preferências** (habilitado quando há mudança e **sempre no primeiro acesso**, para o usuário poder confirmar mesmo sem mudar nada).
- Salvar → `save_notification_preferences(...)` com `Intl.DateTimeFormat().resolvedOptions().timeZone` → toast "Preferências salvas" → estado da tela sincronizado com o retorno.
- Erros: `getFriendlyErrorMessage`; o rascunho não é perdido em caso de erro.
- Sair com alterações não salvas: sem bloqueio nesta entrega (YAGNI).

### Barra lateral

- Grupo **Conta** abaixo dos grupos existentes: **Notificações** (`Bell`) e **Segurança da conta** (`KeyRound`).
- Notificações visível se `role ∈ {admin, financial}` **e** `!(isMasterAdmin && viewingSchoolId && viewingSchoolId !== homeSchoolId)`.
- Segurança da conta continua visível para todos (inclusive professor e master sem escola).

## Testes

- **Vitest** — `notificationEvents.test.ts`: `formatOffset` nas duas direções e no 0; `visibleEvents` com e sem admin; `isDirty`; `applyRecommendedEmails`; `canSave` (primeiro acesso sempre `true`).
- **SQL** — `supabase/tests/notification_prefs_matrix.sql`, `BEGIN…ROLLBACK`, RLS real (`SET LOCAL ROLE authenticated` + `request.jwt.claims`):
  1. `ensure` cria 5 linhas para owner/admin e 4 para financeiro (sem `reenrollment`); e-mail falso em todas; `confirmed_at` nulo.
  2. `ensure` duas vezes não duplica nem altera linhas.
  3. `save` grava, preenche `confirmed_at`; segundo `save` não muda `confirmed_at`.
  4. `save` rejeita: `offset_days` fora da lista; `reenrollment` vindo do financeiro; fuso inválido; horário fora da faixa.
  5. Usuário A não lê linhas do usuário B; usuário de outra escola não lê; **master em aal2 lê**; **master em aal1 sem carência não lê** (D5).
  6. INSERT/UPDATE direto na tabela falha (sem policy de escrita).
  7. Gate: escola com `require_2fa=true` + admin aal1 sem carência → `ensure` falha com `MFA_REQUIRED`; financeiro passa.
  8. Usuário rebaixado: admin roda `ensure` (5 linhas) → papel trocado para `financial` dentro da transação → novo `ensure` retorna 4 eventos (sem `reenrollment`), não cria linha nova, e `save` com `reenrollment` é rejeitado.
  9. FKs: apagar (dentro do `ROLLBACK`) um usuário de teste remove as linhas dele nas duas tabelas.
- **Manual (navegador, produção, Colegio Teste)**: primeiro acesso tudo desligado com selos e aviso → "Ativar e-mails recomendados" liga as três → salvar → recarregar mostra o gravado; financeiro não vê Rematrícula; professor não vê Notificações; master visualizando Colégio Estrela não vê o item.

## Ordem de entrega

1. Migration (tabelas, funções, RLS, gate) → `--dry-run` → autorização do usuário → `db push` → `gen types`.
2. Front. Ordem de rollout indiferente: o front novo só chama RPCs que a migration cria, e o front antigo não toca nas tabelas novas — **mas** a migration precisa estar aplicada antes do deploy do front, senão a tela de preferências mostra erro.

## Notas para a S4 (registrar no plano)

- Enviar e-mail **somente** se `notification_settings.confirmed_at is not null` **e** (`notification_preferences.email` ou `digest_enabled`) — D3.
- Horário do resumo: compor `digest_time` com `timezone` no momento do disparo (nunca guardar um UTC fixo).
- `timezone` é **sobrescrito pelo fuso do navegador a cada save** — o último dispositivo que salvou define o fuso do resumo. Aceitável para escolas no Brasil; se surgir usuário em viagem/outro fuso, tornar o fuso um campo explícito.
- O gerador (S3 e S4) junta as preferências com o **papel e o vínculo atuais** do usuário (`profiles.school_id`, `user_roles`, `schools.owner_user_id`), não só com as linhas de preferência: linha de `reenrollment` de quem virou financeiro, ou de quem saiu da escola, é ignorada. As linhas não são apagadas no rebaixamento.
