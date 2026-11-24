# Status do projeto — passagem de bastão

**Atualizado em:** 2026-11-24. Atualize este arquivo ao final de cada sessão: ele é o que permite continuar em outra máquina, porque a memória local do Claude não vai junto com o git.

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
| S4c, etapa 2 (interface): página `/rematricula`, lote com prévia, texto do aviso | ✅ **mergeada** (PR #17, 2026-11-24, merge `d36efd8`; 225 testes, build verde); **QA no navegador feito em 24/11** na escola de teste (resultados em `QA_CHECKLIST.md`; dados do QA removidos, contagens de volta a 87/965/197/0). Transbordo a 375 px (página e prévia do lote) **corrigido** com `min-w-0` no layout e no diálogo e reverificado pelo usuário em claro e escuro (24/11). Financeiro testado pelo usuário (OK). Não testados na UI: aviso no sino, erro parcial do lote e renovar como master em outra escola (lacuna de matriz abaixo); professor não tem acesso ao produto; `supabase functions deploy send-notification-emails` pendente (texto do e-mail) | ✅ front em produção (deploy da Vercel confirmado em 24/11); Edge Function com o texto novo ainda não implantada |
| Dívida: revogar `TRUNCATE` de `anon`/`authenticated` | ✅ **mergeada** (PR #18, 24/11, merge `7cfdc6b`, depois do teste rápido do usuário no app); migration `20261123130000` **aplicada em 24/11** (`db push` com aval, dry-run antes mostrou só ela). Conferido em produção: 0 relações do `public` com TRUNCATE para `anon`/`authenticated` (antes 26 tabelas cada); SELECT/INSERT/UPDATE/DELETE iguais a antes (`anon` 26 tabelas em cada; `authenticated` SELECT 27, demais 26); default privileges do `postgres` sem TRUNCATE. | ✅ aplicada |
| LP: blur no saldo do hero, sem selo do topo, sem depoimento | ✅ mergeada na `main` (commit `606257f`, branch `fix/lp-ajustes`) | deploy após o push da `main` |
| S4b: resumo diário por e-mail | ⬜ não iniciada (depende da S4a funcionando) | — |

Documentos de referência:
- Plano das sprints: `docs/PLANO_SPRINTS_NOV2026.md` (§3 tem as regras herdadas para o gerador e a S4).
- Spec do gerador e da etapa 2 (inclui o contrato dos RPCs que a UI vai consumir): `docs/superpowers/specs/2026-11-18-gerador-notificacoes-design.md`.
- Spec das preferências: `docs/superpowers/specs/2026-11-18-preferencias-notificacao-design.md`.
- Mockups: `docs/mockups/` (README explica cada tela).
- Histórico do que foi entregue: `CHANGELOG.md`. Roteiros de QA: `QA_CHECKLIST.md`.

## O que fazer em seguida (em ordem)

1. **Fechar a S4c:** `npx supabase@2.117.0 functions deploy send-notification-emails` (texto novo do aviso de rematrícula no e-mail; escrita em produção, só com autorização) e caso novo na `renewal_matrix.sql` para o master renovando em escola de outro dono (lacuna abaixo, em `BEGIN … ROLLBACK`).
2. **QA pendente:** S3 etapa 2 (sino, central e card "Precisa da sua atenção"; roteiro em `QA_CHECKLIST.md`; o PR #9 foi mergeado sem esse QA); S2 Fase 3 (troca de senha, carência do admin, financeiro sem 2FA); S3 preferências (tela a 375 px; professor não entra mais: o papel não tem acesso ao produto).
   A 1ª execução real do gerador já foi conferida em 2026-11-19: `succeeded`, avisos `tuition_overdue` gerados na escola de teste.
3. **Dívidas e endurecimento** (detalhes na seção S4c abaixo): proteção de branch na `main` antes do primeiro cliente real; Bloco 3(b) (mensalidades vencidas da escola de teste: seed ou reais?); achados diferidos da S4c etapa 1; `enrollments` não atualizada pelo lote; remover o papel `teacher` (limpeza futura); monitorar falhas do job do gerador; erros antigos do `tsc` (`StudentForm.tsx`, `generate*.ts`; o build passa).
4. **Ligar a S4a** (Task 7 do plano `docs/superpowers/plans/2026-11-19-s4a-email-notificacoes.md`; o banco, a função e o job já estão em produção, falta só configuração). Passos do usuário:
   - Criar conta no Resend.
   - Registrar o domínio de envio (DNS) e, depois de verificado, trocar `EMAIL_FROM`.
   - Secrets da Edge Function: `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_SENDING_ENABLED` (interruptor), `EMAIL_ALLOWLIST` (opcional, para a fase de teste) e `APP_URL` (opcional; padrão `https://class-cash-tan.vercel.app`).
   - **Obrigatório antes do primeiro envio:** `npx supabase@2.117.0 functions deploy send-notification-emails`. A função implantada ainda tem o texto antigo do aviso de rematrícula (botão "Ver contratos" e sem "não vão renovar"); o texto novo da S4c etapa 2 vive em `supabase/functions/_shared/notificationText.ts` e só chega ao e-mail com esse deploy (escrita em produção: só com autorização).
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
   - **Limitação da S4a resolvida (PR #16, 23/11):** a decisão foi a opção (b): o e-mail de um evento só liga se o aviso "no sistema" do mesmo evento estiver ligado (a tela amarra os interruptores e `save_notification_preferences` rejeita `email=true` com `in_app=false`).

## Decisões do PM de 19/11 (ordem de execução; parar entre os blocos para confirmação)

Regras gerais: **não ligar o envio de e-mail** (sem data; o checklist de go-live é o item 4 acima), **não fazer push sem avisar**, nada grava em produção sem autorização (`db push` só depois do `--dry-run`).

| Bloco | O que | Estado |
|---|---|---|
| 1. Git | Mergear o plano da etapa 2 e `fix/lp-ajustes` na `main`; listar o conteúdo dos arquivos soltos e propor destino (não decidir sozinho) | **Merges feitos.** Arquivos soltos **aguardando decisão** (abaixo) |
| 2. Preferências de notificação | O e-mail só liga se "No sistema" estiver ligado no mesmo evento: front desabilita o switch de e-mail e o desliga ao desligar o sistema (texto "o e-mail acompanha o aviso no sistema"); `save_notification_preferences` rejeita `email=true` com `in_app=false` (errcode mapeado em `friendlyError.ts`); caso novo na matriz SQL (`BEGIN…ROLLBACK`); Vitest da regra no catálogo; o gerador não muda; migration em arquivo, `db push` só com autorização | ✅ mergeado (PR #16; migration `20261123120000` aplicada). Resolveu a "limitação conhecida" da S4a |
| 3. Dívidas | (a) migration revogando `TRUNCATE` de `anon` e `authenticated` nas tabelas do `public`: listar antes os grants existentes e confirmar que nenhuma função `security definer` nem o PostgREST depende deles; (b) queries de `created_at`/`source` em `audit_logs` e do padrão de `due_date` para saber se as mensalidades vencidas da escola de teste são seed ou reais | (a) ✅ aplicada e mergeada (PR #18, 24/11); (b) ⬜ não iniciado |
| 4. S4c etapa 2 | Executar as 7 tarefas do plano (subagentes com revisão por tarefa, se independentes); a Task 4 resolve o texto do aviso com `declined_count`. Ao final: CHANGELOG, resumo da etapa no formato dos anteriores e roteiro de QA manual com renovação em lote **só na Escola C**, incluindo financeiro, professor, master visualizando outra escola e 375 px | ✅ mergeada e em produção (PR #17, 24/11); falta só o `functions deploy send-notification-emails` (escrita em produção: com autorização) |

**Arquivos soltos da outra máquina (decidido em 23/11):** `docs/backups/` e `docs/designs/` estão no `.gitignore`; `RUBRICA_AVALIACAO.md` e `docs/RESUMO_SPRINT_S1_CLAUDE_PROJECT.md` não são commitados; os documentos de `docs/designs/` não entram no repositório (público).

## S4c — rematrícula

**Etapas 1 e 2 concluídas** (etapa 2 mergeada no PR #17 e em produção em 24/11, QA em `QA_CHECKLIST.md`); falta só o `functions deploy send-notification-emails` para o texto novo do aviso chegar ao e-mail. Spec em `docs/superpowers/`. Notas para a Etapa 2 (contrato do cliente com `renew_contracts`, `declined_count` no texto da notificação): seção "Notas para a Etapa 2" da spec.

Bug pré-existente achado na revisão final: `audit_trigger_fn` quebrava (23514) a primeira escrita manual numa conexão que antes tinha usado `set_config('app.audit_source', ..., true)`, porque o Postgres deixa `''` na configuração. Vale para TODAS as tabelas auditadas (inclui a falha latente depois de `insert_generated_tuitions` e dos RPCs de importação). Corrigido na migration `20261119135900_audit_source_nullif.sql` (um `nullif`).

Endurecimento pendente (achados diferidos da etapa 1):
- Sem teto para o número de mensalidades por contrato em `renew_contracts` (cliente hostil poderia mandar centenas de linhas; sugestão: limitar a 25).
- `overdue` é aceito com vencimento futuro.
- Valores JSON não numéricos dão erro cru 22P02 em vez de `INVALID_ITEM`.
- Possível deadlock raro com dois lotes em ordem inversa (ordenar itens por `source_contract_id`).
- `monthly_amount` sem teto.
- A matriz não cobre: master admin em outra escola, `p_items` não-array, `class_id` nulo, borda da tolerância de R$ 0,01 e arredondamento com desconto.
- **Lacuna: master renovando em escola alheia.** A `renewal_matrix.sql` não tem caso com `p_school_id` de uma escola que não é do master (o master só cria as escolas X/Y da própria matriz), e o QA da etapa 2 não testou isso na UI (sem autorização de escrita fora da escola de teste). Hoje nada prova que `renew_contracts` e `set_renewal_decision` aceitam o master na escola visualizada nem que não vazam para a escola do perfil dele. Próximo passo: caso novo na matriz, em `BEGIN … ROLLBACK`, com uma escola criada na própria transação e de outro dono.
- **Dívida: proteção de branch na `main`, antes do primeiro cliente real.** Hoje a `main` aceita push direto (confirmado em 24/11). Ativar no GitHub uma regra para a `main` exigindo PR e os checks da Vercel passando antes do merge, e bloquear force push. Commits de documentação passam então a ir por PR.
- **Dívida (não fazer agora): papel `teacher`.** Professor não tem acesso ao produto, e nenhum usuário tem esse papel em produção (`user_roles`, 24/11). Numa limpeza futura, avaliar remover o valor `teacher` do enum `app_role` (exige recriar o enum ou trocar o tipo da coluna; conferir antes funções, policies e o `types.ts` que o referenciam) e os ramos de rota e menu de professor: `allowedRoles` em `src/App.tsx`, `roles` em `src/components/layout/AppSidebar.tsx` e `AppRole`/`isTeacher` em `src/hooks/use-role.ts`.

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
