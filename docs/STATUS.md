# Status do projeto — passagem de bastão

**Atualizado em:** 2026-11-25 (S5: diagnósticos do sino com o master, do item I e do go-live do e-mail). Atualize este arquivo ao final de cada sessão: ele é o que permite continuar em outra máquina, porque a memória local do Claude não vai junto com o git.

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
| S4c, etapa 2 (interface): página `/rematricula`, lote com prévia, texto do aviso | ✅ **mergeada** (PR #17, 2026-11-24, merge `d36efd8`; 225 testes, build verde); **QA no navegador feito em 24/11** na escola de teste (resultados em `QA_CHECKLIST.md`; dados do QA removidos, contagens de volta a 87/965/197/0). Transbordo a 375 px (página e prévia do lote) **corrigido** com `min-w-0` no layout e no diálogo e reverificado pelo usuário em claro e escuro (24/11). Financeiro testado pelo usuário (OK). Não testados na UI: aviso no sino, erro parcial do lote e renovar como master em outra escola (lacuna de matriz abaixo); professor não tem acesso ao produto; `supabase functions deploy send-notification-emails` **feito em 25/11** | ✅ front em produção (deploy da Vercel confirmado em 24/11); Edge Function com o texto novo implantada em 25/11 (envio continua desligado) |
| Dívida: revogar `TRUNCATE` de `anon`/`authenticated` | ✅ **mergeada** (PR #18, 24/11, merge `7cfdc6b`, depois do teste rápido do usuário no app); migration `20261123130000` **aplicada em 24/11** (`db push` com aval, dry-run antes mostrou só ela). Conferido em produção: 0 relações do `public` com TRUNCATE para `anon`/`authenticated` (antes 26 tabelas cada); SELECT/INSERT/UPDATE/DELETE iguais a antes (`anon` 26 tabelas em cada; `authenticated` SELECT 27, demais 26); default privileges do `postgres` sem TRUNCATE. | ✅ aplicada |
| Proteção de branch na `main` | ✅ **feita em 25/11** (regra do GitHub): PR obrigatório + check "Vercel" obrigatório; bypass list vazia. Testado: push direto recusado com GH013 ("Changes must be made through a pull request" e "Required status check Vercel is expected"); force push também recusado. Todo commit, inclusive de documentação, passa por PR. | ✅ |
| LP: blur no saldo do hero, sem selo do topo, sem depoimento | ✅ mergeada na `main` (commit `606257f`, branch `fix/lp-ajustes`) | deploy após o push da `main` |
| S4b: resumo diário por e-mail | ⬜ não iniciada (depende da S4a funcionando) | — |

Documentos de referência:
- Plano das sprints: `docs/PLANO_SPRINTS_NOV2026.md` (§3 tem as regras herdadas para o gerador e a S4).
- Spec do gerador e da etapa 2 (inclui o contrato dos RPCs que a UI vai consumir): `docs/superpowers/specs/2026-11-18-gerador-notificacoes-design.md`.
- Spec das preferências: `docs/superpowers/specs/2026-11-18-preferencias-notificacao-design.md`.
- Mockups: `docs/mockups/` (README explica cada tela).
- Histórico do que foi entregue: `CHANGELOG.md`. Roteiros de QA: `QA_CHECKLIST.md`.

## O que fazer em seguida (em ordem)

1. ✅ **S4c fechada em 25/11:** `functions deploy send-notification-emails` feito (texto novo do aviso de rematrícula) e caso do master em escola alheia na `renewal_matrix.sql` (seção 3, 82/82 verificações). Próximo da S4c: aprovar o desenho do endurecimento (`docs/superpowers/specs/2026-11-25-renew-contracts-endurecimento-design.md`) e implementar (casos na matriz primeiro, depois migration).
2. **QA pendente:** S3 etapa 2 (sino, central e card "Precisa da sua atenção"; roteiro em `QA_CHECKLIST.md`; o PR #9 foi mergeado sem esse QA); S2 Fase 3 (troca de senha, carência do admin, financeiro sem 2FA); S3 preferências (tela a 375 px; professor não entra mais: o papel não tem acesso ao produto).
   A 1ª execução real do gerador já foi conferida em 2026-11-19: `succeeded`, avisos `tuition_overdue` gerados na escola de teste.
3. **Dívidas e endurecimento** (detalhes na seção S4c abaixo): `final_amount` do contrato sem arredondar (ligado ao item I das sprints) e deadlock real do H4 sem teste; achados diferidos da S4c etapa 1; `enrollments` não atualizada pelo lote; remover o papel `teacher` (limpeza futura); monitorar falhas do job do gerador; erros antigos do `tsc` (`StudentForm.tsx`, `generate*.ts`; o build passa).
4. **Ligar a S4a** (Task 7 do plano `docs/superpowers/plans/2026-11-19-s4a-email-notificacoes.md`; o banco, a função e o job já estão em produção, falta só configuração). Passos do usuário:
   - ✅ Conta no Resend criada (25/11). **Pendentes:** domínio de envio e DNS. **As chaves (`RESEND_API_KEY`, `service_role_key`) nunca passam por chat nem por commit:** o usuário as cadastra direto no painel do Supabase (secrets da função e Vault).
   - Registrar o domínio de envio (DNS) e, depois de verificado, trocar `EMAIL_FROM`.
   - Secrets da Edge Function: `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_SENDING_ENABLED` (interruptor), `EMAIL_ALLOWLIST` (opcional, para a fase de teste) e `APP_URL` (opcional; padrão `https://class-cash-tan.vercel.app`).
   - ✅ Deploy de `send-notification-emails` com o texto novo da rematrícula feito em 25/11 (antes dele, o Pensar foi conferido: 0 linhas em `notification_settings`, 0 `confirmed_at`, 0 preferências de e-mail ligadas, `email_outbox` vazia).
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

## Plano de 25/11 (tudo via PR; escrita em produção só com autorização)

1. ✅ **Deploy da função** (25/11): `functions deploy send-notification-emails`.
2. ✅ **Caso novo na `renewal_matrix.sql`** (25/11): seção 3, master renovando/decidindo em escola de outro dono (dono = `u_admin`, perfil em outra escola), master sempre com `aal2`, nada vazando para a escola do perfil dele, e contraprova de auditoria na escola alheia. 82/82 contra o schema aplicado, `BEGIN … ROLLBACK`, nada persistiu.
3. ✅ **Bloco 3(b) fechado como seed** para Colegio Teste e Colégio Estrela (decisão do dono, 25/11). Evidência: a auditoria só começou em 13/11 e não tem nenhum `insert` dessas mensalidades; elas foram criadas em rajadas (abr–out) com vencimentos uniformes de fev a nov; os `update` registrados são do job das 03:00 UTC.
4. ✅ **Endurecimento de `renew_contracts` concluído e em produção (25/11):** desenho aprovado (`docs/superpowers/specs/2026-11-25-renew-contracts-endurecimento-design.md`: H1 teto de 25 mensalidades, confirmado nos dados (maior contrato real: 17; Pensar: 0 contratos); H2 `overdue` não pode ser futuro, vencidas preservadas; H3 JSON malformado vira `INVALID_ITEM` com mensagem em português; H4 itens ordenados por `source_contract_id`; H5 teto de R$ 30.000 validado na prévia). PR #21 mergeado (`94b47f0`, deploy de produção `success`); migration `20261125120000_renew_contracts_hardening.sql` **aplicada** (`db push` com `--dry-run` antes e autorização; `migration list` alinhado). Matriz contra o schema aplicado, sem marcador: **111/111**; nenhuma escola de teste ficou no banco (3 escolas, 327 contratos, 0 contratos no Pensar, 0 auditoria nova). Tela: `MAX_MONTHLY_AMOUNT` na prévia do lote e `INVALID_ITEM(S)` em `friendlyError.ts`.

## S5 (25/11): diagnósticos, sem código de produto

Regras desta rodada: Pensar só leitura; matrizes em `BEGIN … ROLLBACK`; migrations e deploys só com `--dry-run` e autorização; sem Co-Authored-By; merge só quando o PM pedir. **Nada foi escrito em produção nesta rodada.**

**Bloco 0.** PR #22 (STATUS) já estava mergeado (`faf923e`).

**Bloco 1 — sino e central com o master (decisão D4, documentada).** Diagnóstico pelo código e pelo banco:
- `NotificationBell`, o item **Notificações** da barra lateral e o card "Precisa da sua atenção" usam a mesma regra (`useShowNotifications` → `showNotificationsItem`): **somem** quando o master está sem escola (painel `/master`) **ou visualizando outra escola**; aparecem só na escola de casa. Escondido, o sino nem consulta o banco (o `useEffect` não dispara).
- **Não há vazamento de avisos entre escolas.** `list_notifications` e `mark_notifications_read` filtram por `n.user_id = auth.uid()` **e** `n.school_id = get_user_school_id()` (a escola do perfil); `school_id` nunca vem do cliente. Hoje os 3 avisos existentes são da Colegio Teste.
- **Inconsistência menor, não vazamento:** a rota `/notificacoes` **não tem o guard** que a página de preferências já tem (`isMasterViewingOtherSchool`). Quem digita a URL com o master visualizando outra escola vê os avisos **da escola de casa** sob o banner da escola visualizada. Correção sugerida (pequena, com teste): espelhar o guard de `NotificationPreferences.tsx`. **Não foi feita** (não é vazamento; aguarda o PM).
- Comportamento registrado no `CLAUDE.md` (convenções).

**Bloco 2 — item I (valor da mensalidade em três lugares), Fase 0.** Documento: `docs/DIAGNOSTICO_ITEM_I_VALOR_MENSALIDADE.md`. **Aguarda a decisão do PM (A, B ou C) antes de qualquer spec ou migration.** Números:
- Contrato diverge da base da turma: Estrela 0/240, Teste 1/86 (+R$ 30), **Pensar sem contratos**. Contrato diverge do valor-base do aluno: Estrela 0, Teste 4/87 (+R$ 750 a +R$ 1.000), Pensar n/a.
- **Pensar: 201 alunos com valor 0 no cadastro, 13 turmas com `monthly_fee`, 0 contratos, 0 mensalidades.**
- Mensalidades com `amount` diferente do contrato: Estrela 2/2.642, Teste 11/965, Pensar 0; **todas são parcelas de renegociação** (esperado); **0** por arredondamento de 1 centavo; **0** contratos com fração de centavo no `final_amount` (o 299,997 é latente).
- `contracts.final_amount` é lido em `generateTuitions.ts`, `Students.tsx`, `renew_contracts` e `auditFormat.ts`; sem views.
- **Correção de premissa:** a turma **já sugere** a mensalidade no `ContractForm` em contrato novo (commit `60d4ea2`).
- Recomendação: **A** (contrato como fonte única; turma sugere; campo do aluno some ou exibe o do contrato; `final_amount` com `round(...,2)` via `SET EXPRESSION`, PG 17.6, 0 linhas afetadas).

**Bloco 3 — go-live do e-mail (sem enviar nada).** Documento: `docs/EMAIL_GO_LIVE.md` (secrets, job, freios, 9 consultas de monitoramento validadas, roteiro do primeiro teste, pendências do Pensar). Pontos-chave:
- Secrets da função (só nomes): `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_SENDING_ENABLED` (só `true` liga), `EMAIL_ALLOWLIST` (opcional, recomendada), `APP_URL` (opcional); automáticos: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Vault: `service_role_key` (JWT legado, igual ao `SUPABASE_SERVICE_ROLE_KEY`). **Não há** `reply-to` nem `List-Unsubscribe` no código.
- Job `send-notification-emails` ativo de hora em hora e **respondendo 401** até hoje (falta o segredo do Vault): esperado e inofensivo.
- Freios: interruptor global, allowlist, `confirmed_at` + e-mail ligado por evento (padrão desligado) + aviso do dia + a partir das 08:00 locais. **Não há freio por escola** (decisão pendente). Hoje, com o interruptor ligado e sem allowlist, sairia 1 e-mail, da Colegio Teste; nada do Pensar.
- **Pensar:** 3 usuários, 0 preferências confirmadas, 0 avisos e **nenhum dado a notificar** (0 mensalidades, 0 despesas, 0 contratos).
- **DECISÃO pendente:** só depois de o PM confirmar domínio verificado e secrets configurados, propor o dia e a ordem do primeiro envio.

**Pendências abertas da S5:** (1) PM escolhe A/B/C do item I; (2) PM decide se quer o guard de `/notificacoes` para o master e o freio por escola do e-mail; (3) PM confirma domínio verificado e secrets do Resend; (4) `reply-to`/`List-Unsubscribe`, se desejados.

## Escolas em produção e regras de QA (25/11)

| Escola | O que é | Uso |
|---|---|---|
| **Colégio Pensar** | **Escola real da família: produção de verdade** e **piloto previsto do e-mail** | **Nenhuma escrita de QA** (lote, usuários de teste, edições). Só leitura de diagnóstico. |
| Colegio Teste | Escola de teste (seed; contém o usuário master e os de teste) | QA e matrizes |
| Colégio Estrela | Escola de teste (seed) | QA |

- **Matrizes SQL** escolhem personagens por consulta, mas sempre dentro de `BEGIN … ROLLBACK`, e **nunca** com `COMMIT` no Pensar. A `renewal_matrix.sql` usa o master, o admin e o financeiro da escola do perfil do master (hoje a Colegio Teste), então não toca usuários do Pensar.
- **Ordem do piloto de e-mail** (quando ligar a S4a): usuário do dono na Colegio Teste → Colégio Pensar → demais escolas. Antes de cada passo: conferir `notification_settings.confirmed_at` e as preferências de e-mail da escola (consulta acima), e usar `EMAIL_ALLOWLIST` na fase de teste.
- **Pendência do dono:** o `primary_segment` do Pensar foi gravado por **backfill arbitrário**, não por escolha dele. O dono deve ajustá-lo em Configurações.

## Decisões do PM de 19/11 (ordem de execução; parar entre os blocos para confirmação)

Regras gerais: **não ligar o envio de e-mail** (sem data; o checklist de go-live é o item 4 acima), **não fazer push sem avisar**, nada grava em produção sem autorização (`db push` só depois do `--dry-run`).

| Bloco | O que | Estado |
|---|---|---|
| 1. Git | Mergear o plano da etapa 2 e `fix/lp-ajustes` na `main`; listar o conteúdo dos arquivos soltos e propor destino (não decidir sozinho) | **Merges feitos.** Arquivos soltos **aguardando decisão** (abaixo) |
| 2. Preferências de notificação | O e-mail só liga se "No sistema" estiver ligado no mesmo evento: front desabilita o switch de e-mail e o desliga ao desligar o sistema (texto "o e-mail acompanha o aviso no sistema"); `save_notification_preferences` rejeita `email=true` com `in_app=false` (errcode mapeado em `friendlyError.ts`); caso novo na matriz SQL (`BEGIN…ROLLBACK`); Vitest da regra no catálogo; o gerador não muda; migration em arquivo, `db push` só com autorização | ✅ mergeado (PR #16; migration `20261123120000` aplicada). Resolveu a "limitação conhecida" da S4a |
| 3. Dívidas | (a) migration revogando `TRUNCATE` de `anon` e `authenticated` nas tabelas do `public`: listar antes os grants existentes e confirmar que nenhuma função `security definer` nem o PostgREST depende deles; (b) queries de `created_at`/`source` em `audit_logs` e do padrão de `due_date` para saber se as mensalidades vencidas da escola de teste são seed ou reais | (a) ✅ aplicada e mergeada (PR #18, 24/11); (b) ✅ fechado como seed (25/11) |
| 4. S4c etapa 2 | Executar as 7 tarefas do plano (subagentes com revisão por tarefa, se independentes); a Task 4 resolve o texto do aviso com `declined_count`. Ao final: CHANGELOG, resumo da etapa no formato dos anteriores e roteiro de QA manual com renovação em lote **só na Escola C**, incluindo financeiro, professor, master visualizando outra escola e 375 px | ✅ mergeada e em produção (PR #17, 24/11); deploy da função feito em 25/11 |

**Arquivos soltos da outra máquina (decidido em 23/11):** `docs/backups/` e `docs/designs/` estão no `.gitignore`; `RUBRICA_AVALIACAO.md` e `docs/RESUMO_SPRINT_S1_CLAUDE_PROJECT.md` não são commitados; os documentos de `docs/designs/` não entram no repositório (público).

## S4c — rematrícula

**Etapas 1 e 2 concluídas** (etapa 2 mergeada no PR #17 e em produção em 24/11, QA em `QA_CHECKLIST.md`); o `functions deploy send-notification-emails` foi feito em 25/11 (o texto novo do aviso já está na função). Spec em `docs/superpowers/`. Notas para a Etapa 2 (contrato do cliente com `renew_contracts`, `declined_count` no texto da notificação): seção "Notas para a Etapa 2" da spec.

Bug pré-existente achado na revisão final: `audit_trigger_fn` quebrava (23514) a primeira escrita manual numa conexão que antes tinha usado `set_config('app.audit_source', ..., true)`, porque o Postgres deixa `''` na configuração. Vale para TODAS as tabelas auditadas (inclui a falha latente depois de `insert_generated_tuitions` e dos RPCs de importação). Corrigido na migration `20261119135900_audit_source_nullif.sql` (um `nullif`).

Endurecimento (achados diferidos da etapa 1): **resolvido e aplicado em produção em 25/11 (PR #21)** (teto de 25 mensalidades, `overdue` futuro, JSON não numérico, ordenação contra deadlock, teto de `monthly_amount`, e os casos `class_id` nulo, tolerância de R$ 0,01 e arredondamento com desconto na matriz). Continuam abertos: `p_items` não-array já é tratado (`INVALID_ITEMS`) e testado; **prova de deadlock entre duas sessões não coberta** (não cabe numa transação com ROLLBACK). Lista original:
- Sem teto para o número de mensalidades por contrato em `renew_contracts` (cliente hostil poderia mandar centenas de linhas; sugestão: limitar a 25).
- `overdue` é aceito com vencimento futuro.
- Valores JSON não numéricos dão erro cru 22P02 em vez de `INVALID_ITEM`.
- Possível deadlock raro com dois lotes em ordem inversa (ordenar itens por `source_contract_id`).
- `monthly_amount` sem teto.
- A matriz não cobre: master admin em outra escola, `p_items` não-array, `class_id` nulo, borda da tolerância de R$ 0,01 e arredondamento com desconto.
- ✅ **Lacuna fechada (25/11): master renovando em escola alheia.** `renewal_matrix.sql`, seção 3 (casos 3a–3m): o master (sempre `aal2`) decide e renova em escola de outro dono; a gravação cai na escola do contrato, nada vaza para a escola do perfil dele (inclusive auditoria), `aal1` é bloqueado com `MFA_REQUIRED`, e o dono de outra escola sem ser master não ganha acesso. Os demais itens da lista acima continuam abertos e estão no documento de desenho.
- **Dívida: `contracts.final_amount` é gerado sem arredondar, e a mensalidade guarda 2 casas.** A coluna é `monthly_amount * (1 - discount/100)` sem `round` (ex.: 333,33 com 10% = **299,997** no contrato) e `tuitions.amount` é `numeric(10,2)` (**300,00**). Achado ao escrever o caso 4r2 da matriz; `renew_contracts` está certo (grava o `final_amount` do contrato novo na coluna de 2 casas, e confere o valor do cliente com a tolerância de R$ 0,01), mas o número que o contrato "vale" e o que a mensalidade cobra divergem em frações de centavo. Ligado ao **item I do plano das sprints** (`docs/PLANO_SPRINTS_NOV2026.md`, "Mensalidade em 3 lugares": aluno, turma, contrato), que continua com decisão de produto pendente: ao decidir a fonte única do valor, decidir também o arredondamento (por exemplo `round(..., 2)` na coluna gerada) e rever os pontos que somam `final_amount` de contrato. Não mexer antes dessa decisão.
- **Dívida: o deadlock real do H4 não tem cobertura de teste.** A matriz (`BEGIN … ROLLBACK`, uma transação) prova só a ordenação determinística (casos 4k-4m): dois lotes simultâneos sobre os mesmos contratos precisam de **duas sessões commitando** para exercitar o travamento de linhas, e commitar dados de teste em produção está fora de questão. Para cobrir: Supabase local (Docker) com dois `psql` em paralelo, ou um teste de integração com duas conexões; o resultado esperado é que as duas terminem sem `40P01` (deadlock detected).
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
