# S3 — Gerador de notificações, sino, central e card "Precisa da sua atenção"

**Data:** 2026-11-18 · **Status:** aprovado em brainstorming (seções 1 e 2), validado contra os mockups
**Origem:** `docs/PLANO_SPRINTS_NOV2026.md` §3 (incluindo "Regras herdadas da tela de preferências") e linha S3 da tabela de sprints.
**Depende de:** `docs/superpowers/specs/2026-11-18-preferencias-notificacao-design.md` (tabelas `notification_preferences`/`notification_settings`, função `notification_event_defaults()`), já em produção.
**Mockups:** `docs/mockups/Main.dc.html` (sino + popover, card "Precisa da sua atenção hoje") e `docs/mockups/Notificacoes.dc.html` (central). Referência visual: tokens do tema e componentes de `src/components/ui/`, nunca os hex.

## Objetivo

Todo dia, cada usuário de escola (owner, admin, financeiro) recebe no sistema um aviso **agregado** por evento ("12 mensalidades vencidas há mais de 5 dias"), conforme as suas preferências. Os avisos aparecem no sino do cabeçalho, na central de notificações e no card "Precisa da sua atenção hoje" do Dashboard. **Nada é enviado por e-mail** (S4).

## Entrega em duas etapas (dois PRs)

1. **Etapa 1 — dados e gerador:** tabela `notifications`, função `generate_daily_notifications()`, job `pg_cron`, RPCs de leitura/marcação, matriz SQL. Nenhuma mudança de UI.
2. **Etapa 2 — interface:** formatador de texto, sino, central preenchida, card no Dashboard, filtro `?status=` em Mensalidades.

A etapa 1 pode ir a produção sozinha (os avisos começam a se acumular; ninguém os vê até a etapa 2).

## Fora do escopo

- E-mail e resumo diário (S4). Itens do mockup "Resumo diário enviado por e-mail" e "Despesa recorrente criada" ficam fora.
- Telas de renegociação e de ciclo de rematrícula (não existem; rematrícula é S4).
- Notificações em tempo real (o gerador roda uma vez por dia).
- Retenção/limpeza de avisos antigos.

## Decisões (não reabrir)

| # | Decisão |
|---|---|
| G1 | Card "Precisa da sua atenção hoje" mostra **as notificações geradas hoje** (fonte única com o sino). É o retrato da geração; os botões levam às telas com números atuais. |
| G2 | **Uma spec, duas etapas** (dados+gerador; interface), cada uma com PR próprio. |
| G3 | **Mensalidade em atraso** = lembrete **diário acumulado**: todo dia, enquanto houver `overdue` vencida há mais de N dias, um aviso com o total atualizado. Os outros quatro eventos olham um **dia exato** (vence/termina em hoje + N) e por isso não repetem. |
| G4 | Gerador = **função SQL** agendada no `pg_cron` (não Edge Function, não geração sob demanda). |
| G5 | **Uma linha por usuário × escola × evento × dia** (`reference_date`); UNIQUE torna o job idempotente; reexecução atualiza números e **preserva `read_at`**. |
| G6 | A tabela guarda **dados estruturados**; as frases em português são montadas no front por função pura (`src/lib/notificationText.ts`). |
| G7 | Destinatários = papel e vínculo **atuais** (owner/admin/financeiro; rematrícula só owner/admin), canal "no sistema" ligado na preferência, ou padrão de `notification_event_defaults()` para quem não tem linha. Antecedência = a do usuário (ou o padrão). |
| G8 | "Hoje" de cada usuário no fuso de `notification_settings.timezone`; `America/Sao_Paulo` sem linha. |
| G9 | Job às **08:00 UTC (05:00 em Brasília)**: depois de `promote-overdue-tuitions` (03:00 UTC) e antes do horário de resumo mais cedo (06:00, S4). **Desvio do mockup**, que mostra 08:00 como horário ilustrativo. |
| G10 | Sino no **cabeçalho global** (`Layout.tsx`), não dentro da página do Dashboard como no mockup — disponível em todas as telas. Visibilidade = mesma regra do item Notificações da barra lateral (`showNotificationsItem`). |
| G11 | Botões de ação: rótulos do mockup quando a tela existe; "Ver parcelas" e "Ver contratos" no lugar de "Abrir renegociações"/"Abrir rematrícula" (telas inexistentes). **Desvio do mockup**, a reverter quando as telas existirem. |
| G12 | Mesmo padrão de segurança da tela de preferências: RLS só leitura do próprio usuário na própria escola (+ master lê), RESTRICTIVE `mfa_gate`, escrita só por RPC/função `SECURITY DEFINER`, FKs `on delete cascade` para `schools` e `auth.users`, `gen_random_uuid()`, `set_updated_at()` se houver `updated_at`. |

## Etapa 1 — dados e gerador

### Tabela `notifications`

| coluna | tipo | regra |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `school_id` | uuid not null | FK `schools(id)` cascade |
| `user_id` | uuid not null | FK `auth.users(id)` cascade |
| `event` | text not null | CHECK nos 5 eventos |
| `reference_date` | date not null | o "hoje" do usuário na geração |
| `offset_days` | integer not null | antecedência usada |
| `item_count` | integer not null | CHECK `> 0` |
| `total_amount` | numeric null | soma dos valores (mensalidades: `getTuitionValue` equivalente em SQL = `coalesce(final_amount, amount)`; despesas: `amount`); nulo para rematrícula |
| `details` | jsonb not null default `'{}'` | por evento, ver abaixo |
| `read_at` | timestamptz null | |
| `created_at` | timestamptz not null default now() | |
| `updated_at` | timestamptz not null default now() | trigger `set_updated_at()` |

`UNIQUE (user_id, school_id, event, reference_date)`; índice `(user_id, school_id, created_at desc)` para listagem; índice parcial `(user_id, school_id) where read_at is null` para o contador.

### Regras por evento (por escola, para cada destinatário com seu N)

| Evento | Linhas consideradas | `details` |
|---|---|---|
| `tuition_due` | `tuitions.status = 'pending'`, `renegotiation_id is null`, `due_date = hoje + N` | `{ "class_count": int }` |
| `tuition_overdue` | `tuitions.status = 'overdue'`, `due_date < hoje - N` (acumulado) | `{ "class_count": int }` |
| `renegotiation_installment` | `tuitions.status = 'pending'`, `renegotiation_id is not null`, `due_date = hoje + N` | `{}` |
| `expense_due` | `expenses.status in ('pending','overdue')` (exclui `paid` e `cancelled`; confirmado em produção), `due_date = hoje + N` | `{ "description": text }` só quando `item_count = 1` |
| `reenrollment` | `contracts.status = 'active'` (confirmar valores), `end_date = hoje + N` | `{ "renewed_count": int }` = quantos desses contratos já têm um contrato **não cancelado** com `renewed_from_id` apontando para eles |

Turmas de uma mensalidade: via `contracts.class_id` (`tuitions.contract_id`); mensalidade sem contrato não conta turma. Contagem zero → nenhuma linha. Toda consulta filtra por `school_id` explicitamente.

### Função `generate_daily_notifications(p_now timestamptz default now())`

- `SECURITY DEFINER`, `set search_path = public`. Sem gate de 2FA (roda pelo cron, sem usuário — mesmo motivo de `promote_overdue_tuitions`). Revogada de `public, anon, authenticated`.
- `p_now` existe para os testes fixarem o "agora".
- Para cada destinatário (G7) e evento visível ao papel, calcula `hoje` no fuso do usuário (G8), aplica a regra, e faz `insert ... on conflict (user_id, school_id, event, reference_date) do update set offset_days, item_count, total_amount, details` (sem tocar `read_at`). Se a contagem do dia caiu para zero numa reexecução, **apaga** a linha não lida daquele dia (lida fica).
- Retorna o número de linhas inseridas/atualizadas (para o log do cron).
- Job: `select cron.schedule('generate-daily-notifications', '0 8 * * *', $$ select public.generate_daily_notifications(); $$);` (idempotente: `unschedule` se existir antes).

### RPCs para o front

- `list_notifications(p_offset integer default 0, p_limit integer default 20, p_category text default null, p_unread_only boolean default false) → jsonb` — `{ items: [{ id, event, reference_date, offset_days, item_count, total_amount, details, read_at, created_at }], filtered_total, total, unread }` do usuário na escola de `get_user_school_id()`. `total` e `unread` ignoram os filtros; `filtered_total` respeita categoria e `p_unread_only`. `p_category ∈ {cobranca, renegociacao, despesas, rematricula}` (cobranca = `tuition_due` + `tuition_overdue`). `p_limit` entre 1 e 100. Ordenação `reference_date desc`, ordem do evento (`sort_order` de `notification_event_defaults()`), `id`. **Paginação por offset**, não por cursor: todas as linhas de uma geração têm o mesmo `created_at` (mesma transação), então um cursor por tempo pularia itens. Erros: `MFA_REQUIRED`/`NOT_ALLOWED` (42501), `NO_SCHOOL` (P0001), `INVALID_CATEGORY`/`INVALID_LIMIT` (22023).
- `mark_notifications_read(p_ids uuid[] default null) → integer` — `null` = todas do usuário na escola; só as do próprio usuário; devolve quantas marcou.
- Ambas com `perform public.assert_mfa_gate();` primeiro; `school_id` sempre de `get_user_school_id()`.

### RLS

SELECT: `(user_id = auth.uid() and school_id = get_user_school_id()) or is_master_admin()`; sem INSERT/UPDATE/DELETE; RESTRICTIVE `mfa_gate`.

### Testes — `supabase/tests/notifications_matrix.sql` (`BEGIN…ROLLBACK`, RLS real)

Dados de teste criados dentro da transação numa escola de teste (mensalidades, despesas, contratos com datas relativas a um `p_now` fixo):
1. Cada um dos 5 eventos gera 1 linha com `item_count`, `total_amount` e `details` corretos.
2. `tuition_overdue` acumulado: vencidas há N+1 e N+10 dias contam; há exatamente N dias não conta.
3. Preferência `in_app = false` → nada; sem linha de preferência → usa o padrão.
4. Antecedência do usuário diferente do padrão é respeitada.
5. Financeiro não recebe `reenrollment`; professor não recebe nada; usuário rebaixado admin→financeiro deixa de receber `reenrollment`.
6. Idempotência: rodar duas vezes não duplica; `read_at` preservado; contagem zero numa reexecução apaga a não lida.
7. Fuso: usuário com `timezone` diferente usa o seu "hoje".
8. Escola A não gera avisos com dados da escola B.
9. RPCs: `list_notifications` só devolve as do usuário; filtro por categoria; `mark_notifications_read` só marca as próprias; gate de 2FA bloqueia admin aal1 sem carência quando a escola exige.
10. Escrita direta na tabela falha.

## Etapa 2 — interface

> **Entregue em 2026-11-19** (branch `feature/s3-notificacoes-interface`; plano em `docs/superpowers/plans/2026-11-19-notificacoes-etapa2-interface.md`). QA visual pendente.

### `src/lib/notificationText.ts` (puro, Vitest)

`describeNotification(n) → { title, subtitle, category, categoryLabel, actionLabel, actionPath }`:

| Evento | Título | Subtítulo | Categoria | Ação |
|---|---|---|---|---|
| `tuition_due` | "8 mensalidades vencem em 3 dias" / "1 mensalidade vence amanhã" | "Bom momento para enviar o lembrete aos responsáveis." | Cobrança | Ver cobranças → `/mensalidades?status=pending` |
| `tuition_overdue` | "12 mensalidades vencidas há mais de 5 dias" | "R$ 6.840,00 em atraso, em 3 turmas." | Cobrança | Ver cobranças → `/mensalidades?status=overdue` |
| `renegotiation_installment` | "3 parcelas de renegociação vencem amanhã" | "Acordos ativos com parcelas em aberto." | Renegociação | Ver parcelas → `/mensalidades?status=pending` |
| `expense_due` | "Despesa a pagar: Aluguel" (1) / "4 despesas vencem em 2 dias" | "Vence em 2 dias · R$ 4.200,00" | Despesas | Ver despesa(s) → `/despesas` |
| `reenrollment` | "18 contratos terminam em 45 dias" | "6 já rematriculados · 12 pendentes" | Rematrícula | Ver contratos → `/contratos` |

Singular/plural, "hoje" (0) e "amanhã" (1) tratados; valores com o formatador de moeda do projeto. Também: `groupByDay(items, now)` → Hoje / Ontem / Esta semana / Anteriores, e `formatRelativeTime(created_at, now)` → "hoje 05:00" / "ontem" / "seg".

### `src/lib/notifications.ts`

Cliente dos RPCs (`listNotifications`, `markNotificationsRead`), sem `school_id` do cliente.

### Sino (`src/components/notifications/NotificationBell.tsx`, montado em `Layout.tsx` antes de `DebugReportButton`)

- Visível só quando `showNotificationsItem(...)` é verdadeiro.
- Botão com `aria-label="Notificações, N não lidas"` e selo com N (oculto quando 0; "9+" acima de 9).
- Popover: "Notificações" + "Marcar todas como lidas"; até **4** avisos não lidos mais recentes (`list_notifications(0, 4, null, true)`) (título + "subtítulo curto · hoje 05:00"); "Ver todas as notificações" → `/notificacoes`. Sem não lidos: "Tudo em dia."
- Busca ao montar e ao voltar o foco da janela; falha → só o ícone, sem selo, sem quebrar o cabeçalho.
- Clicar num aviso: marca como lido e navega para `actionPath`.

### Central (`src/pages/Notifications.tsx`, substitui o estado vazio)

- Cabeçalho existente + "Marcar todas como lidas".
- Abas: **Todas · total**, **Não lidas · unread**, Cobrança, Renegociação, Despesas, Rematrícula.
- Lista agrupada por dia; cada item: título, etiqueta de categoria, subtítulo, horário, botão de ação (marca como lido e navega). Não lido com destaque visual (não só cor: ponto + peso da fonte).
- Rodapé "Mostrando X de Y notificações" (Y = `filtered_total`) + "Carregar mais" (offset, 20 por página; deduplicar por `id`, porque uma geração no meio da paginação desloca o offset).
- Estado vazio existente mantido quando não há nenhuma; vazio por filtro: "Nenhuma notificação nesta categoria."

### Card (`src/components/dashboard/AttentionCard.tsx`, em `Index.tsx` logo depois do bloco de saldo, antes dos indicadores menores)

- Título "Precisa da sua atenção hoje" + etiqueta "N itens".
- Itens = avisos com `reference_date = hoje` (lidos ou não); primeiro botão `default`, demais `outline`.
- "Hoje" do card = o `reference_date` mais recente devolvido pelo RPC (o "hoje" do servidor está no fuso salvo do usuário, que pode diferir do navegador).
- Rodapé discreto: "Gerado hoje às 05:00" (do `created_at`, no fuso do navegador).
- Sem itens: "Nada pendente para hoje."
- Mesma regra de visibilidade do sino.

### Mensalidades: filtro por URL

`src/pages/Tuitions.tsx` passa a ler `?status=` (`pending` / `overdue` / `paid`) como valor inicial do filtro de status, do mesmo jeito que já lê `?search=`.

### Testes (etapa 2)

Vitest: `describeNotification` (5 eventos × singular/plural/0/1), `groupByDay`, `formatRelativeTime`. QA no navegador numa escola de teste após rodar `generate_daily_notifications()` manualmente (com autorização): sino com contador, popover, marcar como lido, central com abas e paginação, card no Dashboard, botões levando às telas filtradas.

## Pendências levantadas na revisão final da etapa 1 (decidir antes da etapa 2)

- ~~**Acúmulo do lembrete de atraso**~~ — **resolvido** pela migration `20261118160000_notifications_supersede_overdue.sql`: o aviso de atraso de hoje substitui os de dias anteriores ainda não lidos (lidos ficam). Matriz casos 12a–12d.
- **Execução que falha perde o dia:** o gerador roda numa transação só; se falhar, os eventos de dia exato daquele dia não são recuperados no dia seguinte, e o `cron.job_run_details` não mostra a contagem. Hoje não há monitoramento.
- ~~**`renewed_count` conta renovações canceladas**~~ — **resolvido** pela migration `20261119120000_notifications_renewed_count_exclude_cancelled.sql` (aplicada em 2026-11-19): renovação `cancelled` não conta. Matriz caso 1e.

## Ordem de entrega

1. Etapa 1: diagnóstico (valores reais de `expenses.status` e `contracts.status`, extensão `pg_cron` no schema certo) → migration + matriz → `--dry-run` → autorização → `db push` → `gen types` → PR.
2. Etapa 2: front → QA → PR. Requer a etapa 1 em produção.

## Notas para a S4

- O e-mail reaproveita as linhas de `notifications` do dia (mesmos números) e os mesmos textos de `notificationText.ts` — portar o formatador para a Edge Function ou mover os textos para um módulo compartilhado.
- Regra de e-mail herdada: só com `confirmed_at is not null` e o canal ligado.
