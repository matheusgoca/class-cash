# E-mail por evento (S4a): preparação do go-live

**Data:** 2026-11-25 (S5, Bloco 3). **Estado:** construído e **desligado**; nada foi enviado nem configurado nesta rodada.
**Regra:** nenhuma chave, token ou secret passa por chat, commit ou PR. Este documento só traz **nomes**; os valores são digitados pelo dono no painel do Supabase.

## 1. Secrets e variáveis

Edge Function `send-notification-emails` (`supabase/functions/send-notification-emails/index.ts`). Configurar em **Supabase → Edge Functions → Secrets**.

| Nome | Obrigatório | Para quê |
|---|---|---|
| `RESEND_API_KEY` | sim | chave da API do Resend. Sem ela (ou sem `EMAIL_FROM`) a função responde 500 e não reivindica nada |
| `EMAIL_FROM` | sim | remetente, ex.: `Class Cash <avisos@seu-dominio>`; o domínio precisa estar **verificado** no Resend (DNS) |
| `EMAIL_SENDING_ENABLED` | sim, para enviar | interruptor global: **só o texto exato `true` liga**; ausente, vazio ou qualquer outro valor = desligado |
| `EMAIL_ALLOWLIST` | recomendado | lista separada por vírgula (`a@x.com, b@y.com`); se definida, **só** esses endereços recebem; vazia = sem filtro |
| `EMAIL_REPLY_TO` | não | endereço de resposta (`suporte@x.com` ou `Nome <suporte@x.com>`); vai como `reply_to` no Resend. Ausente ou inválido = sem reply-to (valor inválido é ignorado com um aviso no log, sem expor o valor, e **nunca** derruba o envio). **Código mergeado; só vale depois do deploy da função (aguarda autorização).** |
| `APP_URL` | não | base dos links do e-mail; padrão `https://class-cash-tan.vercel.app` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | automáticos | injetados pelo Supabase; a função exige que o `Authorization: Bearer` do pedido seja **idêntico** ao `SUPABASE_SERVICE_ROLE_KEY` |

**Vault (banco, não a função):** segredo de nome `service_role_key`, com o **JWT legado `service_role`** (Supabase → Settings → API), idêntico ao `SUPABASE_SERVICE_ROLE_KEY` acima. Uma chave nova no formato `sb_secret_…` faz a função responder 401 em toda chamada.

**Reply-to e cancelamento:** `EMAIL_REPLY_TO` (acima) existe desde 25/11 (código mergeado, deploy pendente). O rodapé do e-mail **já tem** o link "Ajustar preferências" (HTML e texto, com teste). **`List-Unsubscribe` fica de fora por enquanto** (decisão do PM, 25/11).

**Segredo do job:** não há um segredo próprio do job; ele só usa o `service_role_key` do Vault.

## 2. Como o job chama a função, o que o desliga, e os freios

**Chamada.** `pg_cron` job `send-notification-emails`, `0 * * * *` (todo início de hora, UTC), executa `net.http_post` (assíncrono) para `https://<projeto>.supabase.co/functions/v1/send-notification-emails`, com `Authorization: Bearer <service_role_key do Vault>` (migration `20261119130300`). `verify_jwt = false` na função: a autenticação é a comparação do Bearer em tempo constante.

**Estado hoje (25/11):** o job está ativo e a função responde **401 toda hora** (`net._http_response`: `{"error":"Não autorizado"}`), porque o segredo do Vault ainda não existe. Inofensivo (falha segura) e é o que se espera até o go-live.

**O que desliga (do mais leve ao mais forte):**
1. `EMAIL_SENDING_ENABLED` diferente de `true`: a função responde `{"skipped":"disabled"}` **antes** de reivindicar qualquer coisa (a fila não acumula).
2. Apagar/trocar o segredo do Vault: a função responde 401.
3. `select cron.unschedule('send-notification-emails');` (escrita no banco: só com autorização).

**O que impede envio a escolas reais, em camadas (todas precisam estar abertas para sair um e-mail):**
1. Interruptor global `EMAIL_SENDING_ENABLED = true`.
2. `EMAIL_ALLOWLIST` (se definida, só aqueles endereços).
3. O usuário precisa ter **confirmado** a tela de preferências (`notification_settings.confirmed_at` não nulo) **e** ter o e-mail ligado no evento (`notification_preferences.email`, padrão `false`) **e** o evento ter o aviso "no sistema" ligado.
4. Tem de existir um aviso (`notifications`) **do dia local** do usuário, e só a partir das **08:00 locais** (fuso do usuário, padrão `America/Sao_Paulo`).
5. E-mail do usuário confirmado; só `admin`/dono (e `financial` nos eventos não restritos).
6. Reenvio: no máximo 3 tentativas por (usuário, escola, evento, dia); 40 e-mails por chamada (a fila continua na hora seguinte); pausa de 600 ms entre envios (limite do Resend).

**PORTÃO OBRIGATÓRIO antes de remover a allowlist e abrir o e-mail para todas as escolas (decisão do PM, 25/11):** não existe freio **por escola** (nenhum `schools.email_enabled`) e **não haverá agora**. Enquanto isso, `EMAIL_ALLOWLIST` fica definida em todas as fases. **Antes** de remover a allowlist ou de abrir para as demais escolas, é obrigatório decidir e implementar um freio por escola (uma coluna + uma condição no `claim_notification_emails`, com caso na matriz de notificações) ou outro equivalente aprovado pelo PM. Sem isso, o único freio por escola seria o opt-in de cada usuário.

**Estado de cada escola (contagens de 25/11, sem endereços):**

| Escola | Usuários (admin/financeiro) | e-mail confirmado | `confirmed_at` | preferências com e-mail ligado | fila |
|---|---|---|---|---|---|
| Colegio Teste | 3 (2/1) | 3 | 1 | 3 | 0 |
| **Colégio Pensar** | 3 (1/2) | 3 | **0** | **0** | 0 |
| Colégio Estrela | 0 | 0 | 0 | 0 | 0 |

Se o interruptor fosse ligado hoje **sem** allowlist, sairia **1 e-mail**, da Colegio Teste (há 1 aviso elegível do dia). Nada sairia do Pensar nem da Estrela.

## 3. Consultas de leitura para monitorar (rodar com o Supabase CLI linkado)

Todas filtram por `school_id` quando agrupam por escola e **não** devolvem endereço de e-mail.

```sql
-- 1. Fila de hoje e de ontem por escola e status
select s.name as escola, o.status, count(*) as n, max(o.updated_at) as ultimo
  from public.email_outbox o
  join public.schools s on s.id = o.school_id
 where o.reference_date >= current_date - 1
 group by s.name, o.status
 order by s.name, o.status;

-- 2. Pendentes: 'sending' parado há mais de 30 minutos (serão retomados na próxima hora)
select o.school_id, o.event, o.reference_date, o.attempts, o.updated_at
  from public.email_outbox o
 where o.status = 'sending' and o.updated_at < now() - interval '30 minutes'
 order by o.updated_at;

-- 3. Falhas (com a causa) e as que esgotaram as 3 tentativas
select o.school_id, o.event, o.reference_date, o.attempts, o.last_error, o.updated_at
  from public.email_outbox o
 where o.status = 'failed'
 order by o.updated_at desc
 limit 20;

-- 4. Duplicidade por usuário e evento no mesmo dia (a constraint impede dentro da escola, esta pega entre escolas)
select o.user_id, o.event, o.reference_date, count(*) as n, array_agg(distinct o.school_id) as escolas
  from public.email_outbox o
 where o.status in ('sending', 'sent')
 group by o.user_id, o.event, o.reference_date
having count(*) > 1;

-- 4b. O mesmo id de mensagem do Resend em mais de uma linha
select o.provider_message_id, count(*) as n
  from public.email_outbox o
 where o.provider_message_id is not null
 group by o.provider_message_id
having count(*) > 1;

-- 5. Horário local do envio (regra: nunca antes das 08:00 no fuso do usuário)
select o.school_id, o.event, o.sent_at,
       (o.sent_at at time zone coalesce(s.timezone, 'America/Sao_Paulo')) as enviado_em_horario_local,
       extract(hour from (o.sent_at at time zone coalesce(s.timezone, 'America/Sao_Paulo'))) < 8 as antes_das_8
  from public.email_outbox o
  left join public.notification_settings s on s.user_id = o.user_id and s.school_id = o.school_id
 where o.status = 'sent'
 order by o.sent_at desc
 limit 20;

-- 6. Quem seria reivindicado agora (sem inserir nada, conta por escola e evento)
select sc.name as escola, n.event, count(*) as avisos_elegiveis
  from public.notifications n
  join public.profiles p on p.user_id = n.user_id and p.school_id = n.school_id
  join auth.users u on u.id = n.user_id
  join public.schools sc on sc.id = n.school_id
  join public.notification_settings s on s.user_id = n.user_id and s.school_id = n.school_id
  join public.notification_preferences np on np.user_id = n.user_id and np.school_id = n.school_id and np.event = n.event
 where s.confirmed_at is not null and np.email and u.email_confirmed_at is not null
   and n.reference_date = (now() at time zone coalesce(s.timezone, 'America/Sao_Paulo'))::date
 group by sc.name, n.event
 order by sc.name, n.event;

-- 7. A função respondeu o quê? (401 = segredo do Vault ausente ou errado, 404 = função não implantada)
select status_code, left(content, 160) as resposta, created
  from net._http_response
 order by created desc
 limit 5;

-- 8. O job rodou? (só prova que a chamada HTTP foi disparada, não que a função aceitou)
select status, start_time
  from cron.job_run_details
 where jobid = (select jobid from cron.job where jobname = 'send-notification-emails')
 order by start_time desc
 limit 5;
```

## 4. Roteiro do primeiro teste (usuário do PM na Colegio Teste)

**Pré-condições (feitas pelo dono, nunca por chat):**
- Domínio de envio **verificado** no Resend; `RESEND_API_KEY` e `EMAIL_FROM` gravados nos secrets; `service_role_key` gravado no Vault.
- `EMAIL_ALLOWLIST` = **somente** o e-mail do PM. `EMAIL_SENDING_ENABLED` continua desligado até o passo 4.

**Passo a passo:**
1. Conferir o desligado: consulta 7 deve mostrar `{"skipped":"disabled"}` (200) na hora seguinte, em vez de 401. Consulta 1 vazia.
2. Logar como o usuário do PM na **Colegio Teste**, abrir Notificações → Preferências, **confirmar** a tela (`confirmed_at`) e ligar **No sistema + E-mail** em **um** evento de teste (sugestão: `tuition_overdue`, que o gerador diário já produz; ou `expense_due`).
3. Garantir que existe o aviso do dia: a geração roda às 08:00 UTC; conferir pela consulta 6 (deve listar 1 linha para o evento escolhido e só da Colegio Teste).
4. Ligar `EMAIL_SENDING_ENABLED = true` **depois das 08:00 do fuso do usuário** e esperar o início da hora seguinte.
5. Conferir na fila: consulta 1 → 1 linha `sent`; consulta 5 → `antes_das_8 = false`; consultas 2, 3 e 4 vazias; consulta 7 → 200 com `claimed/sent` (só contagens, nunca endereços).
6. Conferir na caixa de entrada do PM: remetente e domínio corretos, assunto (título do aviso), nome da escola no topo, botão e link para a tela certa (`APP_URL`), rodapé com "Ajustar preferências", HTML legível no celular, e **não** foi para spam (SPF/DKIM do domínio).
7. Segundo disparo na hora seguinte: **não** deve reenviar (consulta 1 continua com 1 `sent`; consulta 4b vazia).
8. Desligar de novo (`EMAIL_SENDING_ENABLED` ≠ `true`) ao terminar, até a decisão de seguir.

## 5. O que falta para o piloto no Colégio Pensar (sem tocar nele)

Estado em 25/11: 3 usuários (1 admin, 2 financeiros), todos com e-mail confirmado; **0** `notification_settings`, **0** preferências, **0** avisos, **0** mensalidades, **0** despesas, **0** contratos.

1. **Nada para avisar ainda.** Sem contratos/mensalidades/despesas o gerador não produz avisos, então o e-mail não teria o que enviar. O piloto só faz sentido depois de a escola começar a lançar dados (e isto se liga à decisão do **item I**: convém decidir o modelo do valor da mensalidade **antes** da primeira carga).
2. **Preferências salvas:** cada um dos 3 usuários precisa abrir Notificações → Preferências, **confirmar** a tela e escolher os eventos com e-mail (padrão: tudo desligado). Sem `confirmed_at` nada sai.
3. **Aviso prévio à família** (texto do PM): o que vão receber, de qual remetente, quando (a partir das 08:00), como desligar (link "Ajustar preferências" no rodapé), e quem procurar.
4. **Allowlist** com os e-mails da família na fase de piloto; só depois remover.
5. **Ordem:** usuário do PM na Colegio Teste → Colégio Pensar → demais escolas (decisão de 25/11).
6. **Confirmar com o dono** se o interruptor por escola (seção 2, "Lacuna") é desejado antes de abrir para o Pensar.

**DECISÃO:** só depois de o PM confirmar **domínio verificado e secrets configurados**, proponho o dia e a ordem do primeiro envio.
