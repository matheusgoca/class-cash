# QA Testing Checklist

## Roteiro de QA — S4c, rematrícula (etapa 2: interface) (2026-11-24)

Tudo depende do navegador e da escola de teste. A renovação em lote renova contratos de verdade: **só na escola de teste e com autorização expressa**.

**Execução de 24/11 (escola de teste, master que também é admin dela):** fotografia inicial às 18:35 UTC = 87 contratos, 965 mensalidades, 197 cobranças (`service_charges`), 0 decisões. Lote real: aluno 1 (Fund. 2A → Teste Capacidade) e aluno 2 (Fund. 3B), reajuste de 10%, valor do aluno 2 editado para R$ 950,00, taxa de rematrícula de R$ 150,00. **Limpeza feita ao final:** removidos 2 contratos novos, 23 mensalidades, 2 cobranças de taxa e 3 decisões; a contagem voltou a 87/965/197/0. As linhas de `audit_logs` ficam (tabela append-only). Sem conta de professor na escola e sem senha da conta financeiro: esses dois itens ficam para o usuário.

- [x] Como owner/admin: a página `/rematricula` abre pelo menu (grupo Financeiro, depois de Contratos) — **OK 24/11** (master que também é admin da escola de teste, entrando pelo painel master; não há outra conta de admin com senha disponível)
- [ ] Como financeiro: a página abre, dá para decidir e renovar — **pendente: teste do usuário** (a conta financeiro existe; o QA não tinha a senha)
- [x] ~~Como professor: sem item no menu e a rota `/rematricula` redireciona~~ — **papel sem acesso ao produto** (decisão do usuário em 24/11: não criar conta nem testar a rota; nenhum usuário tem o papel `teacher` em produção; remoção do papel registrada como dívida no STATUS)
- [ ] Como master vendo OUTRA escola: a página lê e renova a escola visualizada; conferir em Contratos dessa escola e em Contratos da escola do próprio master que nada vazou — **leitura OK 24/11** (Escola B: 240 contratos, nenhum aluno da escola de teste; contagens da Escola B inalteradas). **Renovar: não testado na UI** (sem autorização de escrita fora da escola de teste). **Atenção:** a `renewal_matrix.sql` **não** cobre o master renovando em escola de outro dono (o master só cria as escolas X/Y da matriz; lacuna já listada no STATUS, seção de endurecimento). Obs.: a escola do próprio master é a escola de teste
- [x] Filtros e resumo por estado batem com a lista — **OK 24/11** (janela 90 dias: 84 contratos, 30 por página; Vai renovar 2, Renovado 1, Sem resposta 80 em 3 páginas)
- [x] "Não vai renovar" pede motivo e o contrato sai da seleção — **OK 24/11** (Salvar desabilitado sem motivo; aluno 3 saiu da seleção, 3 → 2)
- [x] A decisão continua aparecendo depois de recarregar a página — **OK 24/11** (e confirmado em `renewal_decisions`)
- [x] Lote com 2 contratos: prévia correta (valores com reajuste, datas, mensalidades) — **OK 24/11** (1.000 → 1.100 e 900 → 990 com 10%). **Observação para o PO:** o diálogo diz "dura 12 meses", mas a regra (igual a `ContractForm.handleRenew`) termina no último dia do 12º mês contando o de início; para contrato que termina no meio do mês, o novo vai de 21/11/2026 a 31/10/2027, com 11 mensalidades
- [x] Editar o valor de uma linha da prévia recalcula as mensalidades dela — **OK 24/11** (total por mês 2.090 → 2.050; as 11 mensalidades do aluno 2 gravadas a R$ 950,00)
- [x] Mapa de turmas troca a turma do contrato novo; aviso de capacidade aparece quando a turma enche — **OK 24/11** ("Teste Capacidade: 2 alunos para 1 vaga" na prévia; some ao trocar a linha; o contrato do aluno 1 foi gravado em Teste Capacidade). O aviso só aparece na prévia, não no passo do mapa
- [x] Taxa de rematrícula: lançada quando informada — **OK 24/11** (2 × R$ 150,00 em `service_charges`, vencimento = início do novo contrato). Obs.: a do aluno 1 nasceu `pending` com vencimento 01/11 (passado), enquanto a mensalidade de 10/11 nasceu `overdue`
- [x] Resultado do lote conferido: contratos novos em Contratos e mensalidades em Mensalidades — **OK 24/11** ("2 contratos renovados · 23 mensalidades criadas"; Contratos 89, Mensalidades 988). Os contratos de origem continuam `active` (não são alterados pelo lote)
- [x] Contrato já renovado é pulado, com a mensagem de "já renovado" no resultado — **OK 24/11** (prévia antiga numa segunda aba: "0 contratos renovados · 0 mensalidades criadas / 2 contratos já estavam renovados e foram pulados")
- [ ] Resultado de erro: "Renovação interrompida" com as contagens corretas (renovados até ali) e sem reentrada — **não testado na UI** (não há como provocar a falha pela interface sem mexer no banco); coberto pelo teste de componente `BatchRenewalDialog.test.tsx` ("Renovação interrompida")
- [ ] A 375 px: cabeçalho e filtros quebram linha; a tabela e a prévia do lote rolam dentro do container; as linhas do mapa de turmas no diálogo podem transbordar (problema menor conhecido) — **FALHOU 24/11**. (1) A página inteira fica com 609 px de largura: a coluna `flex flex-1 flex-col` de `Layout.tsx` não tem `min-w-0`, então a tabela alarga o layout (pré-existente: Contratos 869 px e Mensalidades 1064 px; Dashboard ok). Com `min-width: 0` aplicado no navegador, cabe em 375 px e a tabela rola no container. (2) A prévia do lote corta título, valores e botões: os filhos do `DialogContent` (grid) não têm `min-w-0`; com `min-width: 0` neles, cabe e a tabela rola dentro do diálogo. Teste feito num iframe de 375 px (o Chrome não estreita a janela abaixo de 500 px). Detalhe: o menu lateral mobile não fecha sozinho ao navegar
- [x] Tema escuro legível em todas as telas da etapa — **OK 24/11** (página, diálogos de decisão e de lote, prévia, resultado, painel de Contratos)
- [ ] O aviso de rematrícula (sino/central) leva à página — **não testado na UI**: a escola de teste não tem aviso de rematrícula real; coberto pelo teste de renderização `Notifications.test.tsx` (botão "Abrir rematrícula" navega para `/rematricula`) e por `notificationText.test.ts`
- [x] Painel de Contratos mostra o resumo e o botão "Abrir rematrícula" leva à página — **OK 24/11** ("3 de 84 já renovados", "81 contratos ainda sem renovação")
- [x] Escrita manual logo depois de um lote não falha (`source` da auditoria) — **OK 24/11** (decisão do aluno 3 mudada para Contatado logo após o lote; auditoria `update`/`manual`; lote gravado como `generated`)
- [x] Renovar um contrato já vencido e ainda ativo: a prévia mostra o novo período começando no passado e mensalidades já vencidas (overdue) — confirmar que é o esperado — **OK 24/11** (aluno 1: início 01/11/2026, mensalidade de 10/11 gravada `overdue`; a prévia não mostra o status por mensalidade, conferido no banco)
- [x] Filtrar por turma com contratos selecionados fora do filtro: a prévia do lote lista todos os selecionados, inclusive os escondidos pelo filtro — **OK 24/11** (filtro Infantil A; o diálogo listou Fund. 2A e Fund. 3B, "2 contratos selecionados")

## Roteiro de QA — S4c, rematrícula (etapa 1: banco) (2026-11-19)

Estado: **aplicado em produção em 2026-11-19** (migrations `20261119135900` e `20261119140000`–`140300`). Itens de interface ficam para a Etapa 2.

- [x] Matrizes rodadas em `BEGIN ... ROLLBACK` com as migrations embutidas (2026-11-19): `renewal_matrix.sql` 68/68 e `notifications_matrix.sql` 45/45; nada persistiu
- [x] Matrizes (`renewal_matrix.sql` e `notifications_matrix.sql`) todas `ok` contra o schema aplicado (2026-11-19: 68/68 e 45/45, em `BEGIN … ROLLBACK`)
- [x] Depois de aplicar, uma escrita manual logo após uma transação que usa `set_config('app.audit_source', …, true)` não falha (2026-11-19: o teste que dava `23514` roda sem erro; 0 logs com `source` vazio)
- [x] Grants: `anon` sem execute em `set_renewal_decision` e `renew_contracts`; `authenticated` com execute (2026-11-19, conferido em produção)
- [ ] Aviso de rematrícula não nasce quando tudo está resolvido (renovado ou "não vai renovar")
- [ ] Usuário sem papel em `user_roles` recebe `NOT_ALLOWED` nos dois RPCs

## Roteiro de QA — S4a, e-mail por evento (2026-11-19)

Estado: aplicado em produção com o envio desligado (2026-11-19). Os itens que dependem de Resend, Vault e domínio seguem abertos.

- [x] Matriz `supabase/tests/email_outbox_matrix.sql` toda `ok` contra o schema aplicado (2026-11-19: 34/34, em `BEGIN ... ROLLBACK`; `email_outbox` seguiu com 0 linhas)
- [x] `cron.job` com `send-notification-emails` (`0 * * * *`, ativo) (2026-11-19)
- [x] Função implantada e protegida: sem Bearer e com Bearer errado respondem 401 (2026-11-19)
- [ ] Com o interruptor desligado e o segredo do Vault criado: `net._http_response` mostra a função respondendo `{"skipped":"disabled"}` e `email_outbox` continua vazia
- [ ] Teste de ponta a ponta com `EMAIL_ALLOWLIST` = e-mail do dono: um e-mail chega com assunto, botão e rodapé certos; reexecução não duplica
- [ ] E-mail aparece corretamente no Gmail e no Outlook (celular e desktop)
- [ ] Domínio verificado e `EMAIL_FROM` trocado; remetente correto
- [ ] Forçar uma falha (ex.: remetente não verificado) e confirmar que a nova tentativa na hora seguinte realmente envia (a `Idempotency-Key` do Resend pode manter a resposta de erro por 24 h); se não enviar, trocar a chave por uma nova a cada tentativa
- [ ] Decidir a limitação sino desligado + e-mail ligado antes de ligar o envio

## Roteiro de QA manual — S3, notificações etapa 2 (interface) (2026-11-19)

Pré-requisito: avisos em `notifications` (job das 08:00 UTC já gerou 3 `tuition_overdue` na Escola C). Não gerar dados em produção sem autorização.

- [ ] Sino aparece para owner, admin e financeiro; não aparece para professor nem para master sem escola
- [ ] Selo mostra o total de não lidas; "9+" acima de 9; some quando 0
- [ ] Popover: até 4 avisos, "Marcar todas como lidas", "Ver todas as notificações", "Tudo em dia." sem não lidos
- [ ] Clicar num aviso marca como lido e abre `/mensalidades?status=overdue` já filtrado
- [ ] Central: abas com contagens corretas; aba sem itens mostra "Nenhuma notificação nesta categoria."
- [ ] Central: não lido tem ponto + negrito; "Mostrando X de Y" e "Carregar mais" (precisa de mais de 20 avisos)
- [ ] Card no Dashboard: título, "N itens", primeiro botão primário, rodapé "Gerado hoje às HH:MM"; "Nada pendente para hoje." quando não há
- [ ] Falha de rede nos RPCs: sino só com o ícone, sem quebrar o cabeçalho
- [ ] 375 px sem rolagem horizontal; tema escuro legível
- [x] Suíte automatizada: 152/152 e `npm run build` ok (2026-11-19). Inclui testes de renderização (jsdom + Testing Library, RPCs simulados) de `NotificationBell`, `AttentionCard` e `Notifications`: visibilidade (sem render e sem consulta para quem não vê), selo e "9+", "Tudo em dia.", falha de rede, marcar como lido (item e todas), navegação, abas e filtros, "Carregar mais" com dedupe, vazio por categoria, "Nada pendente para hoje.".
- [ ] **Não coberto pelos testes (exige navegador):** aparência/layout, 375 px, tema escuro, foco do teclado, e o fluxo real com o Supabase e 2FA. Itens do roteiro acima continuam abertos até alguém rodar `npm run dev`.

## Roteiro de QA — S3, gerador de notificações, etapa 1 (2026-11-18)

- [x] Matriz `supabase/tests/notifications_matrix.sql` toda `ok = true` contra o schema aplicado (2026-11-18: 38/38)
- [x] `cron.job` com `generate-daily-notifications` (`0 8 * * *`, ativo) (2026-11-18: ativo, `0 8 * * *`)
- [x] Na manhã seguinte ao deploy: `cron.job_run_details` com a execução `succeeded` e linhas em `notifications` para owner/admin/financeiro das escolas com dados (2026-11-19: `succeeded` às 08:00 UTC; 3 avisos `tuition_overdue` na Escola C)

## Roteiro de QA manual — S3, preferências de notificação (2026-11-18)

Matriz SQL: `supabase/tests/notification_prefs_matrix.sql` (30 verificações em `BEGIN ... ROLLBACK`).

- [x] Grupo **Conta** na barra lateral (Notificações + Segurança da conta); rodapé só com Sair (2026-11-18: master sem escola vê só Segurança; na própria escola vê Notificações + Segurança; rodapé só com Sair)
- [x] `/notificacoes`: cabeçalho, botão Preferências, estado vazio (2026-11-18)
- [x] 1º acesso: e-mails desligados, selo "Recomendado" em 3 eventos, aviso, Salvar habilitado (2026-11-18; no banco: 5 linhas com e-mail desligado e confirmed_at nulo)
- [x] "Ativar e-mails recomendados" → salvar → recarregar mostra o gravado; aviso some (2026-11-18; no banco: e-mail ligado só nos 3 recomendados, confirmed_at preenchido, fuso America/Sao_Paulo)
- [x] Antecedência e horário do resumo salvos e recarregados; horário desabilitado com o resumo desligado (2026-11-18: 5 dias antes e 08:00 gravados e recarregados; Salvar desabilitado sem mudanças)
- [x] Master visualizando outra escola: item some; URL direta mostra aviso e não carrega (2026-11-18: item some; página acessada pelo histórico mostra o aviso e não carrega nada. Acesso por URL direta não é testável: recarregar a página já perde a escola visualizada — comportamento anterior a este branch)
- [ ] 375 px: matriz em cartões, sem rolagem horizontal (não testado em 375 px: o Chrome não reduz a janela abaixo de 500 px; a 500 px os cartões empilham, sem rolagem horizontal)
- [ ] Financeiro não vê Rematrícula (depende de login com a conta de teste; coberto pela matriz SQL, casos 1c/1d/4b)
- [ ] Professor não vê Notificações (vê Segurança da conta) (depende de login com a conta de teste; coberto por src/lib/accountMenu.test.ts)

## Roteiro de QA manual — Sprint S2, Fase 3: segurança da conta (2026-11-18)

Migrations A/B/C aplicadas em produção e Edge Function `reset-user-mfa` deployada (confirmado em 2026-11-18 via `migration list` / `functions list`). Master admin já tem 1 fator TOTP verificado. **Itens marcados ✅ já foram verificados; o resto ainda precisa ser executado.**

Já coberto por SQL (`BEGIN ... ROLLBACK` contra produção): `supabase/tests/mfa_gate_matrix.sql` 30/30 (cenários C1–C10 do plano) e `supabase/tests/mfa_rls_matrix.sql` 36/36 (RLS real com `SET ROLE`). Decisão de autorização da Edge Function coberta por `supabase/functions/reset-user-mfa/authz.test.ts`.

### 1. Login com 2FA (master)
- [x] Master ativou 2FA e o login passou a pedir o código (testado pelo mantenedor em localhost, 2026-11-17)
- [x] Mesmo teste em produção: login com código e dados carregando (2026-11-18)
- [ ] Código errado mostra "Código incorreto ou expirado..." e não libera

### 2. Troca de senha em 3 passos (`/seguranca`)
- [ ] Senha atual errada → "Senha atual incorreta." e permanece no passo 1
- [ ] Checklist ao vivo: botão desabilitado até ≥ 10 caracteres + número; símbolo aparece como recomendado
- [ ] Confirmação diferente da nova senha bloqueia o envio
- [ ] Sucesso → toast "Senha alterada..." e **outra sessão aberta (outro navegador) é encerrada**
- [ ] Usuário com 2FA continua em `aal2` depois de trocar a senha (não cai no desafio de novo)

### 3. Ativar / desativar 2FA (`/seguranca`)
- [ ] Ativar em 3 passos: QR code + chave manual → código de 6 dígitos → badge "Ativo"
- [ ] Abandonar no passo 2 e voltar: não fica fator duplicado (o não verificado é descartado)
- [ ] Desativar pede o código atual antes de remover
- [ ] Owner/admin de escola com `require_2fa` ligado: botão Desativar oculto, texto "Sua escola exige 2FA"
- [x] Master: botão Desativar oculto, texto "Contas master precisam manter o 2FA ativo" (2026-11-18)

### 4. Exigência por escola (Configurações → Segurança)
- [ ] Owner sem 2FA tenta ligar o toggle → é levado a ativar o próprio 2FA antes
- [x] Owner com 2FA (`aal2`) liga o toggle → salva: toast "Exigência de 2FA ligada", `require_2fa = true` no banco, evento em `audit_logs`, persiste ao recarregar; desligado em seguida (também registrado). Feito como master na Escola C, 2026-11-18
- [ ] Admin sem 2FA da mesma escola, no próximo acesso: faixa de carência "Ative até {data} (7 dias)" e app funcionando
- [ ] Carência vencida (forçar `grace_until` no passado numa escola de teste) → tela cheia de ativação forçada, dados não carregam
- [ ] **Financeiro e professor da escola que exige 2FA continuam entrando sem 2FA**
- [ ] Desligar e religar o toggle reinicia a carência de quem já tinha estourado

### 5. Recuperação (Equipe → "Redefinir 2FA")
- [ ] Admin redefine o 2FA de um membro da própria escola → fator some; membro precisa ativar de novo no próximo acesso
- [x] Caminho autenticado da Edge Function (master `aal2` → admin de teste sem fator): diálogo de confirmação correto, resposta 200 com `removed: 0`, sem linha em `audit_logs` (comportamento intencional: nada a remover). 2026-11-18
- [x] Botão não aparece para o próprio usuário (2026-11-18)
- [ ] Admin de escola não consegue redefinir o 2FA do master (403)
- [ ] Evento aparece em Histórico de alterações

> Nunca verificado ponta a ponta até aqui: Edge Function chamada com sessão autenticada (403 por regra e 200 com remoção real). Ver PR #3.

---

## Roteiro de QA manual — Sprint S1 (2026-11-13)

Cobre os pontos de maior risco tocados nas Fases 1 e 2 (cálculo de valores, regime de caixa, logs de auditoria). Rodar como owner/admin de uma escola de teste e, no último item, também como master admin.

**Executado em 2026-11-13, em produção (`class-cash-tan.vercel.app`), logado como master admin visualizando Escola A. Todos os 6 itens passaram.**

### 1. Mensalidade com desconto + multa — ✅ passou
- [x] Exemplar do seed S1: aluno **Jonas Barbosa**, turma **Fund. 1A**, mensalidade com `due_date = 2026-09-05`, `discount_applied = 50`, `penalty_amount = 35`, paga em `2026-10-02`.
- [x] **Verificado:** tela de Mensalidades mostra `Base: R$850,00 | Desc: R$50,00` e `Multa: R$35,00`, valor final **R$835,00** — bate com `final_amount = amount − discount_applied + penalty_amount`.

### 2. Mensalidade paga em mês diferente do vencimento — ✅ passou
- [x] Mesmo exemplar: vencimento 05/09/2026, pago em 02/10/2026.
- [x] **Verificado:** linha aparece corretamente na tela de Mensalidades com Vencimento e Data de Pagamento em meses diferentes. (Não conferi o Saldo Previsto de setembro separadamente nesta rodada — dá pra fazer trocando o seletor de mês no Dashboard.)

### 3. Renegociação de mensalidade — ✅ passou
- [x] Renegociei a mensalidade de **Wérica Duarte** (Fund. 2A, R$850 vencida em 10/11) em 2 parcelas de R$450 via `RenegotiationModal`.
- [x] **Verificado:** mensalidade original mudou para status **Renegociada**; 2 novas mensalidades `Pendente` de R$450 foram criadas (venc. 13/11 e 13/12); contador de Atrasados caiu de 27 para 25.
- [x] **Verificado em `audit_logs`:** 4 eventos gerados (`insert` em `renegotiations`, `update` em `tuitions` [original→Renegociada], 2× `insert` em `tuitions` [novas parcelas]), todos com `source='manual'`, `actor_role='admin'`, `is_master_action=true`.

### 4. Professor lecionando em 2 turmas — ✅ passou
- [x] **Fernanda Vieira** leciona em Fund. 1A e Fund. 1B (salário R$3.200).
- [x] **Verificado no relatório de Rentabilidade:** Fund. 1A mostra salário R$3.200,00 (Fernanda R$1.600 + Ricardo Alves R$1.600, que também leciona em 2 turmas) — não duplicado. Fund. 1B mostra R$3.100,00 (Fernanda R$1.600 + Juliana Matos R$1.500). Marquei a despesa "Conta de luz" (escola toda) de novembro como paga para validar a linha **"Custos gerais da escola (não rateados)": R$650,00**, que fechou exatamente com `Custo Total = soma das turmas (R$39.400) + R$650 = R$40.050`.

### 7. RLS de `audit_logs` para usuário não-master — ✅ passou (S2, Fase 0, 2026-11-13)
- [x] Owner/admin não-master (Escola B) vê seu próprio log recém-gerado (`is_master_action=false`, `school_id` correto).
- [x] Owner/admin não-master de outra escola (Escola C) não vê esse mesmo log: 0 linhas.
- [x] Financeiro (Escola B) não vê nenhuma linha de `audit_logs`, nem da própria escola: 0 linhas.
- [x] UPDATE e DELETE em `audit_logs`, tentados pelo próprio owner, afetam 0 linhas (sem policy para esses comandos).
- [x] Testado via `BEGIN...ROLLBACK` simulando `request.jwt.claims` + `SET LOCAL ROLE authenticated` — nada foi persistido em produção.
- Não existe nenhuma conta com role `teacher` em produção hoje; o caso "professor não lê" não foi testado com uma conta real, só coberto pela mesma condição de role que exclui `financial`.

### 5. Ação de master admin em outra escola gera log — ✅ passou (equivalente)
- [x] As próprias ações acima (marcar despesa paga, renegociar mensalidade) foram feitas como master admin "visualizando" o Escola A — não precisei trocar de escola de novo porque o mecanismo é o mesmo (`get_user_school_id()` do master é nulo, então `is_master_action` fica `true` em qualquer escola que ele acesse via Painel Master).
- [x] **Verificado em `audit_logs`:** todas as linhas acima têm `is_master_action = true` e `school_id` = Escola A.
- [ ] **RLS (owner/admin vê o log, outro não vê):** não re-testado nesta rodada por falta de credenciais de um usuário não-master — já tinha sido validado na Fase 2 (ver `CHANGELOG.md`).

### 6. Job diário de `overdue` (Item H) — ✅ passou
- [x] **Verificado direto no banco:** `cron.job` tem o job ativo (`select public.promote_overdue_tuitions();`, schedule `0 3 * * *`); `cron.job_run_details` mostra a última execução em 2026-11-13 03:00 UTC com status `succeeded`.
- [x] **Verificado na UI:** filtro "Atrasado" em Mensalidades mostra as mensalidades vencidas corretamente como `overdue` (status no banco, não só cálculo client-side de `isTuitionOverdue()`).

---

## Schema Synchronization Testing Guide

This checklist ensures all application code correctly interacts with the Supabase database schema.

---

## Pre-Testing Setup

- [ ] Database has latest migrations applied
- [ ] Application deployed with updated code
- [ ] Test user has appropriate role (admin/financial for full access)
- [ ] Browser cache cleared
- [ ] Console open to monitor for errors

---

## 1. Student Management Testing

### Create Student
- [ ] Navigate to "Gestão de Alunos"
- [ ] Click "Novo Aluno" button
- [ ] Fill all required fields:
  - [ ] Nome Completo (at least 2 chars)
  - [ ] Email (valid format)
  - [ ] Telefone (at least 10 chars)
  - [ ] Data de Nascimento (valid date)
  - [ ] Data de Matrícula (defaults to today)
  - [ ] Contato do Responsável (at least 10 chars)
  - [ ] Turma (select from dropdown or leave empty)
  - [ ] Valor da Mensalidade (e.g., 500.00)
  - [ ] Desconto % (e.g., 10)
  - [ ] Status (Ativo/Inativo)
- [ ] **Verify:** Final tuition value calculates correctly in real-time
  - Example: R$ 500.00 - 10% = R$ 450.00
- [ ] Click "Criar"
- [ ] **Expected:** Success toast appears
- [ ] **Expected:** New student appears in table
- [ ] **Verify:** Student record in database has:
  - [ ] `final_tuition_value = 450.00`
  - [ ] `discount = 10`
  - [ ] `full_tuition_value = 500`
  - [ ] All other fields populated correctly

### Edit Student
- [ ] Click edit icon on a student row
- [ ] Change discount from 10% to 20%
- [ ] **Verify:** Final value updates immediately (500 * 0.8 = 400)
- [ ] Change base value from 500 to 600
- [ ] **Verify:** Final value updates (600 * 0.8 = 480)
- [ ] Click "Atualizar"
- [ ] **Expected:** Success toast
- [ ] **Expected:** Table updates with new values
- [ ] **Verify:** Database record updated correctly

### Delete Student
- [ ] Click delete icon (trash)
- [ ] Confirm deletion in dialog
- [ ] **Expected:** Success toast
- [ ] **Expected:** Student removed from table
- [ ] **Verify:** Student deleted from database

### Filter & Search
- [ ] Enter partial name in search box
- [ ] **Expected:** Table filters in real-time
- [ ] Select specific class in filter dropdown
- [ ] **Expected:** Only students from that class shown
- [ ] Select "Todas as turmas"
- [ ] **Expected:** All students visible again

### Validation Testing
- [ ] Try creating student without required fields
- [ ] **Expected:** Validation errors appear
- [ ] Enter invalid email format
- [ ] **Expected:** Email validation error
- [ ] Enter discount > 100
- [ ] **Expected:** Discount validation error
- [ ] Enter negative tuition value
- [ ] **Expected:** Validation error

---

## 2. Class Management Testing

### Create Class
- [ ] Navigate to "Gestão de Turmas"
- [ ] Click "Nova Turma"
- [ ] Fill all fields:
  - [ ] Nome da Turma (e.g., "1º Ano A")
  - [ ] Série/Ano (select from dropdown, e.g., "1º Ano")
  - [ ] Descrição (optional text)
  - [ ] Professor Responsável (select from dropdown)
  - [ ] Mensalidade da Turma (e.g., 15000.00)
  - [ ] Mensalidade por Aluno (e.g., 500.00)
  - [ ] Capacidade Máxima (e.g., 30)
  - [ ] Cor da Turma (select color)
- [ ] Click "Criar"
- [ ] **Expected:** Success toast
- [ ] **Expected:** New class appears in table
- [ ] **Verify:** Class record has all fields populated

### Edit Class
- [ ] Click edit icon on a class
- [ ] Change grade and fees
- [ ] Click "Atualizar"
- [ ] **Expected:** Success toast
- [ ] **Expected:** Table reflects changes

### Delete Class
- [ ] Try deleting a class WITH students
- [ ] **Expected:** Error message preventing deletion
- [ ] Create new empty class
- [ ] Delete the empty class
- [ ] **Expected:** Success toast
- [ ] **Expected:** Class removed

### Capacity & Revenue Display
- [ ] **Verify:** Student count shows correctly (X/30)
- [ ] **Verify:** "Receita Total" = mensalidade por aluno × student count
- [ ] **Verify:** Status badge shows:
  - [ ] "Disponível" if < 70% full (green)
  - [ ] "Moderada" if 70-90% full (yellow)
  - [ ] "Quase Lotada" if > 90% full (red)

---

## 3. Teacher Management Testing

### Create Teacher
- [ ] Navigate to "Gestão de Professores"
- [ ] Click "Novo Professor"
- [ ] Fill all fields:
  - [ ] Nome Completo (required)
  - [ ] Email (required, valid format)
  - [ ] Telefone (optional)
  - [ ] Especialização (select from dropdown)
  - [ ] Salário (e.g., 3000.00)
  - [ ] Status (Ativo/Inativo)
- [ ] Click "Criar"
- [ ] **Expected:** Success toast
- [ ] **Expected:** Teacher appears in table with salary formatted

### Edit Teacher
- [ ] Click edit icon
- [ ] Update salary and phone
- [ ] Click "Atualizar"
- [ ] **Expected:** Success toast
- [ ] **Verify:** Changes reflected in table

### Delete Teacher
- [ ] Try deleting teacher assigned to a class
- [ ] **Expected:** Error preventing deletion
- [ ] Create new teacher not assigned to any class
- [ ] Delete that teacher
- [ ] **Expected:** Success

### Display Verification
- [ ] **Verify:** Salary displays as formatted currency (R$ 3.000,00)
- [ ] **Verify:** Email and phone both visible in table
- [ ] **Verify:** Specialization displays correctly

---

## 4. Contract Management Testing

### Create Contract
- [ ] Navigate to "Gestão de Contratos"
- [ ] Click "Novo Contrato"
- [ ] Fill all fields:
  - [ ] Select student (required)
  - [ ] Select class (optional)
  - [ ] Start date (required)
  - [ ] End date (required, >= start date)
  - [ ] Monthly amount (required, > 0)
  - [ ] Discount % (optional, 0-100)
  - [ ] Status (default: active)
- [ ] Click "Criar"
- [ ] **Expected:** Success toast
- [ ] **Expected:** Contract appears in summary cards and table

### Verify Tuition Auto-Generation
- [ ] After creating active contract
- [ ] Navigate to "Gestão de Mensalidades"
- [ ] **Expected:** Tuitions automatically created for contract period
- [ ] **Verify:** Each tuition has:
  - [ ] `contract_id` linked to contract
  - [ ] `amount` = contract monthly_amount
  - [ ] `discount_applied` = amount × discount%
  - [ ] `final_amount` = amount - discount_applied
  - [ ] `due_date` = last day of each month in range
  - [ ] `status` = pending
  - [ ] `description` = "Mensalidade MM/YYYY"

### Contract Status Changes
- [ ] Edit contract and change status to "suspended"
- [ ] **Verify:** No new tuitions generated for future months
- [ ] Change status to "active" again
- [ ] **Verify:** Tuitions generated for remaining period
- [ ] Change status to "cancelled"
- [ ] **Verify:** No future tuitions generated

### Contract Summary Cards
- [ ] **Verify:** "Total" shows count and total monthly revenue
- [ ] **Verify:** "Ativos" shows active count and revenue
- [ ] **Verify:** "Suspensos" shows suspended count
- [ ] **Verify:** "Cancelados" shows cancelled count

---

## 5. Tuition Management Testing

### View Tuitions
- [ ] Navigate to "Gestão de Mensalidades"
- [ ] **Verify:** Tuition table shows:
  - [ ] Student name (from join)
  - [ ] Class name (from nested join)
  - [ ] Due date (formatted dd/MM/yyyy)
  - [ ] Base amount
  - [ ] Discount applied
  - [ ] Penalty (if any)
  - [ ] Final amount
  - [ ] Status badge (color-coded)

### Mark as Paid
- [ ] Click dropdown on a pending tuition
- [ ] Select "Marcar como Pago"
- [ ] **Expected:** Payment dialog opens
- [ ] Select payment method
- [ ] Click confirm
- [ ] **Expected:** Success toast
- [ ] **Verify:** Tuition record updated:
  - [ ] `status = 'paid'`
  - [ ] `paid_date = today`
  - [ ] `payment_method` = selected value

### Overdue Detection
- [ ] Find or create a tuition with `due_date` in the past
- [ ] Keep `status = 'pending'`
- [ ] **Verify:** UI displays status as "Atrasado" (red badge)
- [ ] **Verify:** Database `status` still shows 'pending' (not auto-changed)
- [ ] Summary card "Atrasados" includes this tuition

### Apply Discount/Penalty
- [ ] Edit a tuition
- [ ] Add penalty amount (e.g., 50.00)
- [ ] **Verify:** Final amount recalculates:
  - `final_amount = amount - discount_applied + penalty_amount`
- [ ] Save changes
- [ ] **Expected:** Table shows updated final amount

### Tuition Summary Cards
- [ ] **Verify:** "Total" shows all tuitions count and total amount
- [ ] **Verify:** "Pendentes" shows pending count and amount (yellow)
- [ ] **Verify:** "Pagos" shows paid count and amount (green)
- [ ] **Verify:** "Atrasados" shows overdue count and amount (red)

---

## 6. Dashboard Testing

### Financial Metrics
- [ ] Navigate to Dashboard ("Dashboard Financeiro")
- [ ] **Verify:** Top metric cards show:
  - [ ] Total students count
  - [ ] Total revenue (from paid tuitions)
  - [ ] Pending revenue
  - [ ] Overdue revenue

### Class Health Cards
- [ ] **Verify:** Each class shows:
  - [ ] Class name and color indicator
  - [ ] Payment percentage (paid/total students)
  - [ ] Status badge (Excellent/Good/Warning/Critical)
  - [ ] Total and paid revenue amounts

### Charts
- [ ] **Verify:** Revenue chart displays correctly
- [ ] **Verify:** Payment status distribution chart shows categories
- [ ] **Verify:** Data updates when you mark tuitions as paid

---

## 7. Database Consistency Testing

### Direct Database Queries
Run these queries in Supabase SQL Editor to verify data integrity:

```sql
-- Check student final_tuition_value calculation
SELECT 
  name,
  full_tuition_value,
  discount,
  final_tuition_value,
  full_tuition_value * (1 - discount / 100) as expected_final
FROM students
WHERE final_tuition_value != full_tuition_value * (1 - COALESCE(discount, 0) / 100);
-- Expected: No rows (all calculations correct)

-- Check tuitions final_amount calculation
SELECT 
  id,
  amount,
  discount_applied,
  penalty_amount,
  final_amount,
  amount - COALESCE(discount_applied, 0) + COALESCE(penalty_amount, 0) as expected_final
FROM tuitions
WHERE final_amount != amount - COALESCE(discount_applied, 0) + COALESCE(penalty_amount, 0);
-- Expected: No rows (all calculations correct)

-- Verify contract-tuition linkage
SELECT 
  c.id as contract_id,
  c.student_id,
  COUNT(t.id) as tuition_count
FROM contracts c
LEFT JOIN tuitions t ON t.contract_id = c.id
WHERE c.status = 'active'
GROUP BY c.id, c.student_id
HAVING COUNT(t.id) = 0;
-- Expected: No rows (all active contracts have tuitions)

-- Check for orphaned records
SELECT 'Orphaned student' as issue, id, name FROM students WHERE class_id IS NOT NULL AND class_id NOT IN (SELECT id FROM classes)
UNION ALL
SELECT 'Orphaned class' as issue, id, name FROM classes WHERE teacher_id IS NOT NULL AND teacher_id NOT IN (SELECT id FROM teachers)
UNION ALL
SELECT 'Orphaned contract' as issue, id, student_id FROM contracts WHERE student_id NOT IN (SELECT id FROM students);
-- Expected: No rows
```

---

## 8. Edge Cases & Error Handling

### Invalid Data Entry
- [ ] Try entering decimal discount (e.g., 10.5)
- [ ] **Expected:** Accepts and calculates correctly
- [ ] Try entering very large tuition value (e.g., 999999.99)
- [ ] **Expected:** Accepts if < database max
- [ ] Try entering negative values where not allowed
- [ ] **Expected:** Validation prevents

### Network Errors
- [ ] Disconnect internet
- [ ] Try creating a student
- [ ] **Expected:** Error toast with appropriate message
- [ ] Reconnect internet
- [ ] Retry operation
- [ ] **Expected:** Success

### Concurrent Edits
- [ ] Open same student in two browser tabs
- [ ] Edit in both tabs
- [ ] Save first tab
- [ ] Save second tab
- [ ] **Expected:** Second save overwrites first (last write wins)
- [ ] **Verify:** No data corruption

### Select Dropdowns
- [ ] **Verify:** No `<SelectItem value="">` with empty strings
- [ ] **Verify:** All selects use UUIDs or valid values
- [ ] **Verify:** Placeholder text shows when nothing selected
- [ ] **Verify:** Selected value displays correctly

---

## 9. Performance Testing

### Large Data Sets
- [ ] Create 100+ students
- [ ] **Verify:** Table loads within 2 seconds
- [ ] **Verify:** Search/filter is responsive
- [ ] **Verify:** Pagination works (if implemented)

### Dashboard Load Time
- [ ] Clear cache and reload dashboard
- [ ] **Verify:** Metrics load within 3 seconds
- [ ] **Verify:** Charts render without errors
- [ ] **Verify:** No console errors

---

## 10. Calculation Verification Tests

### Student Final Tuition
Test various discount scenarios:
- [ ] R$ 500, 0% discount → R$ 500.00 ✓
- [ ] R$ 500, 10% discount → R$ 450.00 ✓
- [ ] R$ 500, 50% discount → R$ 250.00 ✓
- [ ] R$ 500, 100% discount → R$ 0.00 ✓
- [ ] R$ 1234.56, 12.5% discount → R$ 1080.24 ✓

### Tuition Final Amount
Test with discounts and penalties:
- [ ] Amount R$ 500, Discount R$ 50, Penalty R$ 0 → R$ 450 ✓
- [ ] Amount R$ 500, Discount R$ 0, Penalty R$ 25 → R$ 525 ✓
- [ ] Amount R$ 500, Discount R$ 50, Penalty R$ 25 → R$ 475 ✓

### Class Revenue
Test revenue calculations:
- [ ] 20 students × R$ 500/student → R$ 10,000.00 ✓
- [ ] 0 students × R$ 500/student → R$ 0.00 ✓
- [ ] 30 students × R$ 0/student → R$ 0.00 ✓

---

## 11. Export & Reports Testing

*Note: If export functionality exists*

- [ ] Export students to CSV
- [ ] **Verify:** All columns use snake_case names
- [ ] **Verify:** final_tuition_value included
- [ ] Export classes to CSV
- [ ] **Verify:** grade and monthly_fee included
- [ ] Export tuitions to CSV
- [ ] **Verify:** contract_id, discount_applied, penalty_amount, final_amount included

---

## 12. Role-Based Access Testing

*If RLS policies are active*

### Teacher Role
- [ ] Login as teacher
- [ ] **Verify:** Can view students, classes, tuitions
- [ ] **Verify:** Cannot create/edit/delete (if restricted)

### Financial Role
- [ ] Login as financial user
- [ ] **Verify:** Can manage contracts and tuitions
- [ ] **Verify:** Can mark tuitions as paid

### Admin Role
- [ ] Login as admin
- [ ] **Verify:** Full access to all features

---

## Test Results Summary

**Date:** ___________  
**Tester:** ___________  
**Environment:** ___________ (dev/staging/production)

### Overall Status
- [ ] ✅ All tests passed
- [ ] ⚠️ Some tests passed with minor issues (document below)
- [ ] ❌ Critical failures found (document below)

### Issues Found
List any issues discovered during testing:

1. ___________________________________________
2. ___________________________________________
3. ___________________________________________

### Sign-off
- [ ] Code review approved
- [ ] QA testing completed
- [ ] Ready for production deployment

**Approved by:** ___________  
**Date:** ___________

---

## Post-Deployment Verification

*After deploying to production*

- [ ] Verify 5 random students have correct final_tuition_value
- [ ] Verify 5 random contracts have generated tuitions
- [ ] Verify dashboard shows correct totals
- [ ] Monitor error logs for 24 hours
- [ ] Confirm no user-reported calculation errors

---

**End of QA Checklist**
