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
| `EMAIL_JOB_SECRET` | sim | **segredo dedicado do job** (26/11): a função só atende a chamada cujo cabeçalho `x-job-secret` for idêntico. Hex de 64 caracteres (mínimo 32; abaixo disso a função recusa tudo). Mesmo valor do segredo `email_job_secret` do Vault. Ver seção 7 |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | automáticos | injetados pelo Supabase; a função os usa **só** para o cliente interno que chama os RPCs (claim, email_may_send, mark_email_result). **Não** autenticam mais o pedido (o `Authorization` deixou de ser aceito) |

**Vault (banco, não a função):** segredo de nome `email_job_secret`, **com o mesmo valor** do secret `EMAIL_JOB_SECRET` da função (gerado e cadastrado pelo PM; ninguém o imprime). O job o lê em tempo de execução. O antigo `service_role_key` do Vault **deixa de ser usado** e deve ser apagado pelo PM depois que o corte funcionar (seção 7).

**Reply-to e cancelamento:** `EMAIL_REPLY_TO` (acima) existe desde 25/11 (código mergeado, deploy pendente). O rodapé do e-mail **já tem** o link "Ajustar preferências" (HTML e texto, com teste). **`List-Unsubscribe` fica de fora por enquanto** (decisão do PM, 25/11).

**Segredo do job:** `EMAIL_JOB_SECRET` (função) = `email_job_secret` (Vault), cabeçalho `x-job-secret`. Detalhes, rotação e modo saúde na seção 7.

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

> **Atualização 26/11:** o freio por escola foi desenhado e aprovado (PR do bloco 1: `schools.email_enabled`, só o master liga, checado no enfileiramento e no envio). Enquanto ele não estiver em produção o portão abaixo continua valendo; depois dele, ver o checklist da seção 6.

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
- Domínio de envio **verificado** no Resend; `RESEND_API_KEY` e `EMAIL_FROM` gravados nos secrets; `EMAIL_JOB_SECRET` na função e `email_job_secret` no Vault.
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

## 6. Checklist do dia do go-live (ordem segura; decisão do PM de 26/11)

**Nada disto foi executado.** O Vault fica para o dia do go-live (feito pelo PM, no painel, junto com os secrets do Resend). Nenhum valor de chave passa por chat, commit ou PR: aqui só há **nomes**. Cada passo só começa quando o anterior foi conferido; qualquer conferência que falhe **para** o processo.

| # | Passo | Quem | Conferir antes de seguir (somente leitura) |
|---|---|---|---|
| 1 | **Interruptor por escola em produção** (PR do bloco 1): migration `20261126140000` aplicada (dry-run + autorização) e Edge Function implantada (autorização) | dev, com autorização do PM | `schools.email_enabled` existe e **todas** as escolas estão `false`; matriz `school_email_switch_matrix.sql` 43/43; `email_outbox_matrix.sql` 34/34 |
| 2 | **DNS e domínio verificados no Resend** (SPF, DKIM e o que o painel pedir) | PM | domínio com status "Verified" no painel do Resend |
| 3 | **Secrets da função** (Supabase, Edge Functions, Secrets): `RESEND_API_KEY`, `EMAIL_FROM` (remetente do domínio verificado), `APP_URL`, `EMAIL_REPLY_TO` (opcional). **Ainda NÃO** criar `EMAIL_SENDING_ENABLED` com o valor `true` (ausente = desligado) nem tirar a allowlist | PM | `supabase secrets list` mostra os nomes (nunca os valores) |
| 4 | **Segredo do job**: `EMAIL_JOB_SECRET` (secret da função) e `email_job_secret` (Vault) com o **mesmo** valor de 64 hex (seção 7) | PM, no painel | nomes existem; tamanho 64; o hash do Vault bate com o da função (só "igual"); depois do corte, o job deixa de responder 401 e passa a `{"skipped":"disabled"}` (envio global ainda desligado) |
| 5 | **Allowlist só com o e-mail do PM**: `EMAIL_ALLOWLIST` = o e-mail do PM e mais nenhum | PM | `supabase secrets list` mostra `EMAIL_ALLOWLIST` |
| 6 | **Ligar o envio global**: `EMAIL_SENDING_ENABLED` = `true` (só o texto exato liga) | PM | a resposta do job passa de `skipped: disabled` para `claimed: 0` (nada elegível ainda, porque nenhuma escola está ligada) |
| 7 | **O master liga a Colegio Teste** no painel master (toggle "E-mail de avisos", com confirmação) | PM (master, com 2FA) | `schools.email_enabled = true` só na Teste; `email_enabled_by` = o master; auditoria mostra "Suporte Class Cash" |
| 8 | **Teste ponta a ponta** (roteiro da seção 4): o PM confirma as preferências na Colegio Teste e liga o e-mail em um evento; a partir das 08:00 locais conferir a fila (`email_outbox`) e o recebimento | PM e dev | 1 e-mail só, para o e-mail do PM; `email_outbox` com `sent` e `provider_message_id`; nenhuma outra escola na fila |

**Só depois** de o passo 8 dar certo discutir o Pensar (seção 5): o dono do Pensar confirma as preferências, o PM liga a escola no painel master e a allowlist passa a incluir os e-mails dele. A allowlist só é removida depois do piloto.

**Como desfazer, do mais leve ao mais forte (qualquer um para o envio):**
1. Painel master: desligar o toggle da escola (a fila dela vira `skipped`, sem apagar).
2. `EMAIL_SENDING_ENABLED` diferente de `true` (apagar ou `false`): a função responde `skipped: disabled` antes de reivindicar.
3. Apagar o segredo do Vault: a função responde 401.
4. `select cron.unschedule('send-notification-emails');` (escrita no banco: só com autorização).

**O que NÃO fazer:** ligar `EMAIL_SENDING_ENABLED=true` antes do passo 1; remover a allowlist antes do piloto; ligar uma escola sem o dono dela ter confirmado as preferências (nada sairia, mas o aviso prévio à família é do PM); colar chave em qualquer lugar fora do painel.

## 7. Segredo dedicado do job (substitui o `service_role_key`; 26/11/2026)

**Por quê.** O job mandava a chave `service_role` do Vault e a função a comparava com o `SUPABASE_SERVICE_ROLE_KEY` que o Supabase injeta nela; os dois valores nunca batiam (401 toda hora). Agora o job usa um segredo **só dele**.

**Como funciona.**
- O job (`pg_cron` → `pg_net`, `0 * * * *`) envia o cabeçalho `x-job-secret`, lido do Vault (`email_job_secret`) em tempo de execução. Nada de valor no comando do `cron.job` nem em migration.
- A função (`handler.ts`) só atende POST com `x-job-secret` idêntico ao secret `EMAIL_JOB_SECRET`. A comparação é em tempo constante (SHA-256 dos dois lados). **Falha fechada:** secret ausente, com menos de 32 caracteres ou cabeçalho ausente/errado = 401 igual para tudo, sem tocar no banco nem no Resend. O `Authorization` (inclusive a chave de serviço) **não é mais aceito**.
- A função continua com `verify_jwt = false` (o gateway não exige JWT; a autenticação é toda dela). Risco: o endpoint é público; a barreira é o segredo de 256 bits e o 401 antes de qualquer trabalho.
- As **travas não mudam**: ordem = segredo do job, modo saúde (só com o segredo), `EMAIL_SENDING_ENABLED`, secrets do Resend, claim (allowlist, preferências confirmadas, e-mail ligado no evento, interruptor por escola, 08:00 locais, lote de 40) e `email_may_send` por item.
- A chave `service_role` injetada continua sendo usada **só** pelo cliente interno que chama os RPCs (concedidos ao papel `service_role`); quem controla essa chave é o Supabase.

**Passo a passo do PM (sem valores em chat, commit ou PR).**
1. Gere o valor no seu computador: PowerShell `$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | % { $_.ToString('x2') })` (64 caracteres hexadecimais).
2. Supabase → Edge Functions → Secrets: crie `EMAIL_JOB_SECRET` com o valor (sem aspas, espaço ou quebra de linha).
3. Supabase → Vault: crie `email_job_secret` com o **mesmo** valor.
4. Limpe a área de transferência e o histórico do terminal. Avise só "criei".
5. O dev confere **em leitura** (nomes, tamanho 64, hash igual) e segue: deploy da função, migration do job, conferência do disparo seguinte.
6. **Depois do corte funcionando, o PM apaga o `service_role_key` do Vault** (o job não precisa mais dele e é uma chave de alto privilégio guardada no banco).

**Modo saúde (`x-job-mode: health`).** Com o segredo certo, a função chama só `email_may_send` com um UUID aleatório (devolve falso, sem efeito colateral) e responde `{"health":"ok"}` se o cliente interno falou com o banco, ou `{"health":"falha"}` (500) sem vazar mensagem. Roda **antes** do portão de envio, então funciona com `EMAIL_SENDING_ENABLED` desligado. Disparo manual, uma vez, pelo banco (`net.http_post` com o segredo do Vault, resposta em `net._http_response`), sempre com autorização.

**Rotação: a cada 6 meses** (ou na hora, se houver suspeita de vazamento). Gere um valor novo e troque **os dois lados** (secret da função e Vault); entre uma troca e outra o job recebe 401, que é inofensivo. Depois confira em leitura que o hash dos dois bate e que o disparo seguinte volta a `skipped: disabled` (ou ao envio, se já estiver ligado). Anote a data da troca no STATUS.

**Rollback.** Migration que volta o comando antigo (ou `select cron.unschedule('send-notification-emails');`, com autorização); redeploy da versão anterior da função; o PM apaga `EMAIL_JOB_SECRET` e `email_job_secret`.
