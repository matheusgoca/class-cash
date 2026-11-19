# S4a — E-mail por evento (transporte + envio às 08:00 locais)

**Data:** 2026-11-19 · **Status:** desenho aprovado em brainstorming (seções 1 a 3)
**Origem:** `docs/PLANO_SPRINTS_NOV2026.md` (linha S4 e seção 3, "Regras herdadas") e "Notas para a S4" em `docs/superpowers/specs/2026-11-18-gerador-notificacoes-design.md`.
**Depende de:** S3 inteira em produção (tabelas `notifications`, `notification_preferences`, `notification_settings`; função `notification_event_defaults()`).

## Objetivo

Quem ligou o canal **e-mail** de um evento nas preferências recebe, **às 08:00 no seu fuso**, um e-mail com o mesmo aviso (mesmos números) que o sino mostra. A S4a entrega o transporte de e-mail e o envio por evento. **Lança "apagado"**: o código e a infraestrutura vão a produção com o envio desligado; ligar é configuração, não deploy.

## Divisão da S4

| | Entrega | Depende de |
|---|---|---|
| **S4a (esta spec)** | Provedor (Resend), fila `email_outbox`, Edge Function, job horário, e-mail por evento | S3 |
| S4b | Resumo diário por e-mail (`digest_time` + `timezone`) | S4a |
| S4c | Ciclo de rematrícula (ciclo letivo, tela, ação de renovar) | independente |

## Fora do escopo

- Resumo diário (S4b) — se o usuário tiver evento **e** resumo ligados, a S4b decide se deduplica; a S4a não presume nada.
- Link de descadastro com token: desligar é feito na tela de preferências, linkada no rodapé.
- E-mail para endereço não confirmado; reenvio manual pela interface; painel de envios para o usuário.
- Imagens/logo no e-mail (não há hospedagem de assets).

## Decisões (não reabrir)

| # | Decisão |
|---|---|
| E1 | Provedor: **Resend**, chamado por HTTP de uma Edge Function (Deno). |
| E2 | Sem domínio nem conta ainda: remetente e chave são **secrets**, não código. Lançar apagado; ligar quando o domínio estiver verificado. |
| E3 | Envio às **08:00 no fuso do usuário** (`notification_settings.timezone`, padrão `America/Sao_Paulo`). O gerador continua às 05:00 Brasília e só cria as linhas. |
| E4 | Disparo por **`pg_cron` horário → `pg_net` → Edge Function** (abordagem A). Agendamento versionado em migration, como `generate-daily-notifications`. |
| E5 | Uma **fila `email_outbox`**, uma linha por usuário × escola × evento × dia, **sem FK para `notifications`** (o aviso de atraso é substituído todo dia; o histórico de envio não pode sumir com ele). |
| E6 | Só se envia o aviso **do próprio dia** (`reference_date` = "hoje" do usuário). Aviso de ontem nunca vira e-mail. |
| E7 | Regra D3 (preferências): e-mail só com `notification_settings.confirmed_at is not null` **e** `notification_preferences.email = true` para o evento. Sem linha de preferência = sem e-mail. |
| E8 | O texto do e-mail e o da tela vêm do **mesmo módulo** (`describeNotification`), movido para `supabase/functions/_shared/`. |
| E9 | Interruptor global `EMAIL_SENDING_ENABLED` (secret). Desligado: a função responde "desligado" e **não registra nada na fila**. |
| E10 | `Idempotency-Key` = id da linha da fila em cada envio ao Resend: reenvio após queda não duplica. |

## Dados

### Tabela `email_outbox`

| coluna | tipo | regra |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `school_id` | uuid not null | FK `schools(id)` on delete cascade |
| `user_id` | uuid not null | FK `auth.users(id)` on delete cascade |
| `event` | text not null | CHECK nos 5 eventos |
| `reference_date` | date not null | o "hoje" do usuário no envio |
| `status` | text not null | CHECK `sending` / `sent` / `failed` |
| `attempts` | integer not null default 0 | incrementa a cada reivindicação |
| `last_error` | text null | truncado a 500 caracteres |
| `provider_message_id` | text null | id devolvido pelo Resend |
| `sent_at` | timestamptz null | |
| `created_at`, `updated_at` | timestamptz not null default now() | trigger `set_updated_at()` |

`UNIQUE (user_id, school_id, event, reference_date)`; índice `(status, updated_at)` para o reclaim.

**RLS (G12 da S3):** SELECT só de `user_id = auth.uid() and school_id = get_user_school_id()` ou `is_master_admin()`; sem INSERT/UPDATE/DELETE para `authenticated`; RESTRICTIVE `mfa_gate`; toda escrita pelos RPCs abaixo.

### RPC `claim_notification_emails(p_now timestamptz default now(), p_limit integer default 40, p_only_emails text[] default null) → jsonb`

`SECURITY DEFINER`, `set search_path = public`, revogada de `public, anon, authenticated`, concedida só ao `service_role`. Sem gate de 2FA (não há usuário; mesmo motivo do gerador).

Reivindica, numa transação, até `p_limit` avisos elegíveis e devolve um array de itens `{ outbox_id, to_email, school_name, event, reference_date, offset_days, item_count, total_amount, details }`.

**Elegível** (tudo calculado por linha de `notifications`, filtrando `school_id` explicitamente):
1. `notifications.reference_date` = `(p_now at time zone tz)::date` do usuário e a hora local ≥ 8 (E3, E6).
2. `notification_settings.confirmed_at is not null` e `notification_preferences.email` verdadeiro para o evento (E7).
3. O usuário ainda é destinatário: papel e vínculo **atuais**, como no gerador (owner/admin ou financeiro; `reenrollment` só owner/admin).
4. `auth.users.email` presente e `email_confirmed_at is not null`.
5. `p_only_emails` nulo, ou o e-mail está na lista (rollout controlado).
6. Sem linha na fila, **ou** linha `failed` com `attempts < 3`, **ou** `sending` com `updated_at` há mais de 30 minutos e `attempts < 3`.

Insere/atualiza a fila para `sending` com `attempts = attempts + 1`, com `insert … on conflict do update … where` (só reivindica linha `failed` com tentativas sobrando ou `sending` parada há mais de 30 min, comparando com `now()`), de modo que duas execuções simultâneas nunca pegam o mesmo aviso. Ordena por `created_at` do aviso.

### RPC `mark_email_result(p_outbox_id uuid, p_status text, p_provider_id text default null, p_error text default null) → void`

Mesmas permissões. `p_status` ∈ {`sent`, `failed`}; erro de valor → `INVALID_STATUS` (22023). `sent` preenche `sent_at` e `provider_message_id`; `failed` grava `last_error`.

### Job

`select cron.schedule('send-notification-emails', '0 * * * *', ...)` com `unschedule` antes se existir. O comando faz `net.http_post` para a função com `Authorization: Bearer <chave de serviço lida de vault.decrypted_secrets, segredo de nome service_role_key, em tempo de execução>`. A chave nunca aparece em migration ou no repositório.

## Edge Function `send-notification-emails`

- Só o cron a chama. Sem CORS. Valida o Bearer contra a chave de serviço; senão 401. `verify_jwt = false` em `supabase/config.toml`, como as demais funções do projeto, com a checagem do Bearer feita no código.
- `EMAIL_SENDING_ENABLED !== 'true'` → responde `{ skipped: 'disabled' }` sem chamar o RPC.
- Ligado: chama `claim_notification_emails(now, 40, allowlist)`. Para cada item, monta o e-mail, envia ao Resend (`POST https://api.resend.com/emails`, `Idempotency-Key: <outbox_id>`), registra `mark_email_result`. Um envio por vez com pausa de ~600 ms (limite de 2 req/s). Falha num item não interrompe os demais.
- Resposta: `{ claimed, sent, failed }`, para o log.

### Configuração (secrets da função)

| secret | uso |
|---|---|
| `RESEND_API_KEY` | autenticação no Resend |
| `EMAIL_FROM` | ex.: `Class Cash <avisos@dominio>`; no teste, `onboarding@resend.dev` |
| `EMAIL_SENDING_ENABLED` | `"true"` liga; qualquer outro valor desliga (padrão: ausente) |
| `EMAIL_ALLOWLIST` | opcional, endereços separados por vírgula; vira `p_only_emails` |
| `APP_URL` | base dos links; padrão `https://class-cash-tan.vercel.app` |

## Conteúdo do e-mail

Módulo puro `supabase/functions/_shared/notificationEmail.ts`: `buildNotificationEmail(item, ctx) → { subject, html, text }`, `ctx = { appUrl, schoolName }`.

- **Assunto:** o título do aviso, sem quebras de linha (anti header injection).
- **Corpo:** nome da escola, título, subtítulo, botão com o rótulo da ação apontando para `appUrl + actionPath`. Rodapé: "Você recebe este e-mail porque ativou avisos por e-mail" + link para `appUrl/notificacoes/preferencias`.
- HTML em tabelas com estilos inline, sem imagens, cores só com contraste adequado; todo texto vindo do banco (ex.: descrição de despesa) é **escapado**. Versão em texto puro sempre.
- Os textos vêm de `describeNotification` (E8). O botão "Ver parcelas"/"Ver contratos" segue G11 da S3.

### Texto compartilhado (E8)

`describeNotification`, `groupByDay` e `formatRelativeTime` ficam em `supabase/functions/_shared/notificationText.ts`, **sem imports**, com formatador de moeda próprio (`Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`). `src/lib/notificationText.ts` reexporta. Os testes existentes em `src/lib/notificationText.test.ts` continuam valendo sem mudança. Verificado no plano: `tsconfig.app.json` já tem `allowImportingTsExtensions`, então o Vite importa o mesmo arquivo com extensão `.ts` explícita, como o Deno.

## Tratamento de erros

| Situação | Resultado |
|---|---|
| Resend responde 4xx (endereço inválido, domínio não verificado) | `failed`, `last_error`; nova tentativa na hora seguinte até 3 |
| Resend 429 (limite diário do plano) ou 5xx | idem |
| Função cai entre enviar e registrar | linha fica `sending`; após 30 min volta à fila; `Idempotency-Key` impede o e-mail duplicado (válida por 24 h) |
| 3 tentativas esgotadas | permanece `failed`; não volta a ser elegível; o dia seguinte gera uma linha nova |
| Interruptor desligado | nada é reivindicado nem registrado |

## Testes

- **Vitest** `supabase/functions/_shared/notificationEmail.test.ts`: 5 eventos (assunto, botão, rodapé), escape de HTML (`<script>` na descrição da despesa), assunto sem `\n`, versão em texto.
- **Matriz SQL** `supabase/tests/email_outbox_matrix.sql` (`BEGIN … ROLLBACK`, escola de teste e escola-isca, como a `notifications_matrix.sql`): antes das 08:00 locais não reivindica; depois reivindica; fuso diferente usa o "hoje" dele; sem `confirmed_at` nada; `email = false` nada; sem linha de preferência nada; financeiro não recebe `reenrollment`; e-mail não confirmado nada; aviso de ontem nada; `p_only_emails` filtra; não duplica na segunda chamada; `failed` com 2 tentativas volta, com 3 não; `sending` antigo volta, recente não; `mark_email_result` com status inválido falha; escola isca não vaza; usuário comum não chama os RPCs; RLS da `email_outbox` (só as próprias linhas; escrita direta falha).
- **Manual** (etapa 3 do rollout): com a allowlist do seu e-mail, um aviso real chega com assunto, botão e rodapé corretos; reexecução não duplica.

## Rollout (cada passo que grava em produção só com autorização, mostrando `--dry-run`)

1. **Apagado:** migration (`pg_net`, `email_outbox`, RPCs, job) + deploy da função, com `EMAIL_SENDING_ENABLED` ausente. O job roda de hora em hora e a função responde "desligado".
2. **Preparação (usuário):** criar conta no Resend, gerar `RESEND_API_KEY`, gravar a chave de serviço no Vault (`vault.create_secret`).
3. **Teste:** `EMAIL_FROM=onboarding@resend.dev`, `EMAIL_ALLOWLIST=<e-mail do usuário>`, `EMAIL_SENDING_ENABLED=true`.
4. **No ar (usuário, DNS):** registrar domínio, verificar no Resend, trocar `EMAIL_FROM`, remover `EMAIL_ALLOWLIST`.

## Observabilidade

Consultas prontas no `docs/STATUS.md`: contagem de `email_outbox` por `status` e dia, últimos `last_error`, e `cron.job_run_details` do job (que só prova que a chamada HTTP foi disparada). Logs da função no painel do Supabase.

## Riscos e avisos

- **Limite do plano grátis do Resend** (100 e-mails/dia, 3.000/mês): ao estourar, os envios viram `failed` e tentam de novo nas horas seguintes, sem perda; crescimento de volume pede upgrade.
- **LGPD:** o Resend passa a ser operador de dados (recebe endereços de e-mail dos usuários). Pode exigir atualização da política de privacidade — decisão do usuário, fora do código.
- **Cobertura da Edge Function:** só o teste manual cobre a integração real com o Resend; a lógica de decisão está toda no SQL (testada pela matriz) e no montador do e-mail (testado no Vitest).
- **Dependência manual:** o segredo no Vault e os secrets da função são passos do usuário; sem eles o envio simplesmente não liga (falha segura).

## Limitação conhecida

O e-mail é montado a partir de linhas em `notifications`, e o gerador só cria a linha quando o canal "no sistema" daquele evento está ligado. Logo, quem desliga "no sistema" e liga e-mail para um evento não recebe e-mail nenhum. Decisão pendente com o dono do produto antes de ligar o envio: (a) gerar a linha quando in_app OU e-mail (o sino passaria a mostrá-la também), ou (b) amarrar o interruptor de e-mail ao de sistema na tela de preferências. Não corrigido na S4a; com o envio desligado, não há impacto hoje.

## Notas para a S4b

- O resumo reaproveita `email_outbox` (novo tipo de linha ou tabela irmã) e o mesmo transporte, a mesma função de envio e o mesmo interruptor.
- Decidir lá se evento + resumo ligados ao mesmo tempo mandam dois e-mails.
