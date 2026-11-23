# Status do projeto — passagem de bastão

**Atualizado em:** 2026-11-19. Atualize este arquivo ao final de cada sessão: ele é o que permite continuar em outra máquina, porque a memória local do Claude não vai junto com o git.

## Onde estamos

| Frente | Situação | Produção |
|---|---|---|
| S1: auditoria financeira, `audit_logs`, LP | ✅ concluída | ✅ |
| S2: histórico, segmentos, segurança (senha + 2FA) | ✅ concluída (PRs #1–#5); QA da Fase 3 parcial | ✅ |
| S3: preferências de notificação (tela + dados) | ✅ concluída (PR #6) | ✅ migration `20261118120000` |
| S3, etapa 1: gerador diário de notificações | ✅ concluída (PR #7) | ✅ migrations `20261118150000` e `20261118160000`; job `generate-daily-notifications` ativo às 08:00 UTC (05:00 Brasília) |
| S3, etapa 2: sino, central preenchida, card "Precisa da sua atenção" | ✅ mergeada (PR #9, 2026-11-19); **QA visual no navegador pendente**; migration `20261119120000` (`renewed_count`) | ✅ |
| S4a: e-mail por evento (Resend, fila, job horário) | ✅ mergeada (PR #11); **envio desligado**; falta conta no Resend, segredo no Vault e domínio (Task 7) | ✅ migrations `20261119130000`–`130300` aplicadas; Edge Function `send-notification-emails` implantada; job horário ativo (sem o segredo do Vault a função responde 401: inofensivo) |
| S4c, etapa 1 (banco): rematrícula (`renewal_decisions`, `set_renewal_decision`, `renew_contracts`, `declined_count`) | ✅ mergeada (PR #13); matrizes contra o schema aplicado: renovação 68/68 e notificações 45/45 (2026-11-19) | ✅ 5 migrations aplicadas (`20261119135900` e `20261119140000`–`140300`); `types.ts` regenerado; `renewal_decisions` vazia (a interface é a Etapa 2) |
| S4c, etapa 2 (interface): página `/rematricula`, lote com prévia, texto do aviso | 📝 **plano pronto** (`docs/superpowers/plans/2026-11-19-s4c-etapa2-interface.md`, 7 tarefas); **não executada** | — (nenhuma tarefa grava em produção) |
| LP: blur no saldo do hero, sem selo do topo, sem depoimento | ✅ mergeada na `main` (commit `606257f`, branch `fix/lp-ajustes`) | deploy após o push da `main` |
| S4b: resumo diário por e-mail | ⬜ não iniciada (depende da S4a funcionando) | — |

Documentos de referência:
- Plano das sprints: `docs/PLANO_SPRINTS_NOV2026.md` (§3 tem as regras herdadas para o gerador e a S4).
- Spec do gerador e da etapa 2 (inclui o contrato dos RPCs que a UI vai consumir): `docs/superpowers/specs/2026-11-18-gerador-notificacoes-design.md`.
- Spec das preferências: `docs/superpowers/specs/2026-11-18-preferencias-notificacao-design.md`.
- Mockups: `docs/mockups/` (README explica cada tela).
- Histórico do que foi entregue: `CHANGELOG.md`. Roteiros de QA: `QA_CHECKLIST.md`.

## O que fazer em seguida (em ordem)

1. **QA visual da etapa 2** (roteiro em `QA_CHECKLIST.md`, seção "S3, notificações etapa 2"). O PR #9 já foi mergeado sem esse QA; se achar bug, corrigir em PR novo.
   A 1ª execução real do gerador já foi conferida em 2026-11-19: `succeeded`, avisos `tuition_overdue` gerados na escola de teste (origem das mensalidades vencidas, seed ou reais, a confirmar no Bloco 3).
2. **Outras pendências** (listadas também no fim da spec do gerador):
   - Monitorar falhas do job (uma execução que falha perde os avisos de dia exato daquele dia).
   - Revogar `TRUNCATE` (e demais grants de escrita) de `anon`/`authenticated` nas tabelas — padrão do Supabase, não explorável via REST, endurecimento barato.
3. **QA pendente:** S2 Fase 3 (troca de senha, carência do admin, financeiro sem 2FA); S3 preferências (login como financeiro e professor; tela a 375 px). Ver `QA_CHECKLIST.md`.
4. **Ligar a S4a** (Task 7 do plano `docs/superpowers/plans/2026-11-19-s4a-email-notificacoes.md`; o banco, a função e o job já estão em produção, falta só configuração). Passos do usuário:
   - Criar conta no Resend.
   - Registrar o domínio de envio (DNS) e, depois de verificado, trocar `EMAIL_FROM`.
   - Secrets da Edge Function: `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_SENDING_ENABLED` (interruptor), `EMAIL_ALLOWLIST` (opcional, para a fase de teste) e `APP_URL` (opcional; padrão `https://class-cash-tan.vercel.app`).
   - Gravar no Vault o segredo `service_role_key` com o **JWT legado service_role** (Supabase → Settings → API), **idêntico** ao `SUPABASE_SERVICE_ROLE_KEY` que a função recebe. A função compara o Bearer com essa variável; um valor diferente (por exemplo uma chave nova `sb_secret_…`) faz a função responder 401 em toda chamada.
   - Situação atual: a função e o job **já estão em produção**; falta o segredo do Vault (`service_role_key`) e os secrets da função. Ordem que resta: criar o segredo no Vault (a partir da próxima hora cheia o `net._http_response` deve mostrar a função respondendo `skipped: disabled` em vez de 401), definir `RESEND_API_KEY` e `EMAIL_FROM`, e só então ligar o interruptor (testar antes com `EMAIL_ALLOWLIST`).
   Consultas de monitoramento depois do lançamento:
   ```bash
   npx supabase@2.117.0 db query --linked "select status, count(*), max(updated_at) from public.email_outbox where reference_date >= current_date - 1 group by 1"
   npx supabase@2.117.0 db query --linked "select event, last_error, updated_at from public.email_outbox where status = 'failed' order by updated_at desc limit 10"
   npx supabase@2.117.0 db query --linked "select status, start_time from cron.job_run_details where jobid = (select jobid from cron.job where jobname='send-notification-emails') order by start_time desc limit 3"
   npx supabase@2.117.0 db query --linked "select status_code, content, created from net._http_response order by created desc limit 3"
   ```
   Atenção: `cron.job_run_details` só prova que a chamada HTTP foi disparada (`net.http_post` é assíncrono). Um 401 (chave errada) ou 404 (função não implantada) só aparece em `net._http_response`, a quarta consulta.
   - **Limitação conhecida (não corrigida na S4a):** o e-mail nasce de linhas em `notifications`, e o gerador só cria a linha quando o canal "no sistema" do evento está ligado. Quem desliga "no sistema" e liga e-mail não recebe e-mail. Decisão pendente com o dono do produto antes de ligar o envio: (a) gerar a linha quando in_app OU e-mail (o sino passaria a mostrá-la), ou (b) amarrar o interruptor de e-mail ao de sistema na tela de preferências. Com o envio desligado, não há impacto hoje.

## Decisões do PM de 19/11 (ordem de execução; parar entre os blocos para confirmação)

Regras gerais: **não ligar o envio de e-mail** (sem data; o checklist de go-live é o item 4 acima), **não fazer push sem avisar**, nada grava em produção sem autorização (`db push` só depois do `--dry-run`).

| Bloco | O que | Estado |
|---|---|---|
| 1. Git | Mergear o plano da etapa 2 e `fix/lp-ajustes` na `main`; listar o conteúdo dos arquivos soltos e propor destino (não decidir sozinho) | **Merges feitos.** Arquivos soltos **aguardando decisão** (abaixo) |
| 2. Preferências de notificação | O e-mail só liga se "No sistema" estiver ligado no mesmo evento: front desabilita o switch de e-mail e o desliga ao desligar o sistema (texto "o e-mail acompanha o aviso no sistema"); `save_notification_preferences` rejeita `email=true` com `in_app=false` (errcode mapeado em `friendlyError.ts`); caso novo na matriz SQL (`BEGIN…ROLLBACK`); Vitest da regra no catálogo; o gerador não muda; migration em arquivo, `db push` só com autorização | ⬜ não iniciado. Resolve a "limitação conhecida" da S4a |
| 3. Dívidas | (a) migration revogando `TRUNCATE` de `anon` e `authenticated` nas tabelas do `public`: listar antes os grants existentes e confirmar que nenhuma função `security definer` nem o PostgREST depende deles; (b) queries de `created_at`/`source` em `audit_logs` e do padrão de `due_date` para saber se as mensalidades vencidas da escola de teste são seed ou reais | ⬜ não iniciado |
| 4. S4c etapa 2 | Executar as 7 tarefas do plano (subagentes com revisão por tarefa, se independentes); a Task 4 resolve o texto do aviso com `declined_count`. Ao final: CHANGELOG, resumo da etapa no formato dos anteriores e roteiro de QA manual com renovação em lote **só na Escola C**, incluindo financeiro, professor, master visualizando outra escola e 375 px | ⬜ não iniciado |

**Arquivos soltos da outra máquina (decidido em 23/11):** `docs/backups/` e `docs/designs/` estão no `.gitignore`; `RUBRICA_AVALIACAO.md` e `docs/RESUMO_SPRINT_S1_CLAUDE_PROJECT.md` não são commitados; os documentos de `docs/designs/` não entram no repositório (público).

## S4c — rematrícula

**Próximo passo: Etapa 2 (interface)**; a etapa 1 já está aplicada em produção e os tipos regenerados, e o plano da Etapa 2 está escrito (falta executá-lo). Spec em `docs/superpowers/`. Notas para a Etapa 2 (contrato do cliente com `renew_contracts`, `declined_count` no texto da notificação): seção "Notas para a Etapa 2" da spec.

Bug pré-existente achado na revisão final: `audit_trigger_fn` quebrava (23514) a primeira escrita manual numa conexão que antes tinha usado `set_config('app.audit_source', ..., true)`, porque o Postgres deixa `''` na configuração. Vale para TODAS as tabelas auditadas (inclui a falha latente depois de `insert_generated_tuitions` e dos RPCs de importação). Corrigido na migration `20261119135900_audit_source_nullif.sql` (um `nullif`).

Endurecimento pendente (achados diferidos da etapa 1):
- Sem teto para o número de mensalidades por contrato em `renew_contracts` (cliente hostil poderia mandar centenas de linhas; sugestão: limitar a 25).
- `overdue` é aceito com vencimento futuro.
- Valores JSON não numéricos dão erro cru 22P02 em vez de `INVALID_ITEM`.
- Possível deadlock raro com dois lotes em ordem inversa (ordenar itens por `source_contract_id`).
- `monthly_amount` sem teto.
- A matriz não cobre: master admin em outra escola, `p_items` não-array, `class_id` nulo, borda da tolerância de R$ 0,01 e arredondamento com desconto.

Achado sobre `enrollments`: a S4c não a toca (só a importação a escreve). Promover aluno de turma no lote não a atualiza, e a contagem por turma do Dashboard usa `enrollments`.

## Setup em outra máquina

```bash
git clone https://github.com/matheusgoca/class-cash.git   # ou git pull, se já tiver
cd class-cash
npm install
```

1. **`.env`** (fora do git de propósito; copiar da outra máquina ou do painel do Supabase → Settings → API):
   ```
   VITE_SUPABASE_URL=https://rzkguvbdyaukfzgolpqi.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=<chave anon/publishable do projeto>
   ```
2. **Supabase CLI** (não precisa instalar globalmente; o projeto usa a versão fixa via `npx`):
   ```bash
   npx supabase@2.117.0 login
   npx supabase@2.117.0 link --project-ref rzkguvbdyaukfzgolpqi
   npx supabase@2.117.0 migration list --linked   # deve mostrar todas aplicadas até 20261118160000
   ```
3. `npm run dev` (porta 8080), `npx vitest run` (112 testes), `npm run build`.

## Armadilhas já conhecidas (produção)

- **Drift de schema:** `update_updated_at_column()` **não existe** em produção — triggers usam `public.set_updated_at()`. `uuid_generate_v4()` **não está no search_path do `db push`** — usar `gen_random_uuid()` (padrão de todas as tabelas).
- **Matrizes SQL** (`supabase/tests/*.sql`) rodam contra produção dentro de `BEGIN … ROLLBACK` — nunca remover o `rollback;`. Não rodar `notifications_matrix.sql` perto das 08:00 UTC (travaria o job real).
- Saída do `db query --linked` é JSON precedido de linhas de log; parsear a partir do primeiro `{`.
- Escrita em produção (`db push`, DML, deploy de Edge Function) só com autorização explícita, mostrando o `--dry-run` antes.
- Recarregar a página perde a escola que o master está visualizando (volta ao `/master`) — comportamento antigo; navegar pela interface.
- Master admin precisa de 2FA sempre (Fase 3). Recuperação do master: remover o fator no painel do Supabase (ver `CLAUDE.md`).
