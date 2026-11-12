# Class Cash — Plano de sprints (pós-MVP) — 11/11/2026

Base: leitura do código em `C:\dev\class-cash` (FinancialMetrics, classCost, calculations, Settings, ClassForm, migrations de RLS/master admin). Itens marcados **[confirmado no código]** foram vistos no fonte; **[verificar]** precisam de query/teste.

Mockups: `docs/mockups/` (ver `docs/mockups/README.md`) e canvas online: https://claude.ai/artifact/2fEgRBzPVPJUvYUxEE4dQu

## Decisões (11/11/2026)
- **2FA:** sim, via MFA TOTP do Supabase Auth (app autenticador). Exigido só de owner e admin (configurável); opcional para financeiro/professor. Confirmar disponibilidade no plano do Supabase antes da S2.
- **Logs:** o owner vê as ações do master, identificadas como "Suporte Class Cash".
- **Correções da auditoria:** feitas no Claude Code, em paralelo aos layouts.
- **Regime do Saldo (12/11):** Realizado (caixa, por `paid_date`) como principal e Previsto como apoio; detalhes na seção 1, item C.
- **Segmentos:** escopo reduzido a 2 usos (seção 5): (1) filtrar séries na criação de turma; (4) visão por segmento no painel master. Categorias de despesa por segmento e relatórios por segmento ficam fora por ora.

## Sprints

| Sprint | Foco | Entregas |
|---|---|---|
| S1 | Confiança nos números + base de logs | Correções da auditoria (seção 1); migration `audit_logs` + triggers (seção 4), para começar a acumular histórico já; novo copy da LP (seção 2) |
| S2 | Logs (UI) + Configurações | Histórico de alterações (owner) e global (master); segmentos (principal/secundário, filtro de séries na turma, visão no painel master); segurança em etapas (troca de senha + 2FA); tela de preferências de notificação |
| S3 | Notificações no sistema | Sino no header, central de notificações, card "Precisa da sua atenção" no Dashboard |
| S4 | E-mail + rematrícula | Rotina diária (pg_cron + Edge Function), e-mail, resumo diário, ciclo de rematrícula |

## 1. Auditoria financeira

**[confirmado, corrigido após Fase 0] A. Dashboard soma `amount` também nas mensalidades pagas.** `tuitions.final_amount` só é preenchido quando a mensalidade vira `paid` (`amount − discount_applied + penalty_amount`). Para pendentes/atrasadas, `amount` é o valor correto; o erro está nas **pagas**: `FinancialMetrics.tsx` soma `amount` e ignora desconto/multa aplicados no pagamento. Regra: pagas = `final_amount ?? amount`; pendentes e atrasadas = `amount`. Atenção à homonímia: `contracts.final_amount` (valor mensal líquido do desconto contratual, usado para popular `tuitions.amount`) é outro campo; não misturar. (A versão inicial deste plano dizia que o Dashboard devia usar `final_amount` em tudo; estava incorreta.)

**[confirmado] B. `FinancialMetrics` aloca a receita paga pelo mês de vencimento (`due_date`), não pelo mês do pagamento.** Mensalidade vencida em outubro e paga em novembro cai no saldo de outubro. Achado da Fase 0: `DashboardCharts` já agrupa por `paid_date` (caixa). Hoje há dois regimes dentro do mesmo Dashboard.

**[confirmado] C. Saldo mistura regimes.** Receita = só paga (por vencimento); despesas = todas não canceladas do mês, inclusive pendentes. **DECISÃO TOMADA (12/11):** Saldo **Realizado (caixa)** como número principal e **Previsto** como apoio:

| | Realizado (principal) | Previsto (apoio) |
|---|---|---|
| Receita | pagas no mês por `paid_date`, valor `final_amount ?? amount` | todas as não canceladas com vencimento no mês |
| Despesas | pagas no mês por `paid_date` | todas as não canceladas com vencimento no mês |
| Salários | salário mensal ativo, integral no mês (sem data de pagamento no sistema); rotular na tela | idem |

Consequência: `FinancialMetrics` passa a bater com `DashboardCharts` (por `paid_date`). Pendência: confirmar em produção se toda mensalidade `paid` tem `paid_date`; se não, definir fallback e backfill.

**[confirmado, corrigido após Fase 0] D. Seletor de mês do Dashboard não existe; o de Mensalidades existe.** `FinancialMetrics.tsx`/`DashboardCharts.tsx` (Dashboard) sempre usam o mês corrente, sem seletor. `TuitionTable.tsx` (tela de Mensalidades) **já tem** um filtro de mês funcional (`monthFilter`, dropdown "Mês", por `due_date`) — diagnóstico inicial da Fase 0 errou ao dizer que não existia (buscou só pelo nome antigo `selectedMonth` do extinto `FinancialKanban`). Escopo real do item D: só recriar o seletor no Dashboard.

**[confirmado] E. Receita Recebida e Inadimplência são vitalícias**, enquanto o Saldo é mensal; e essas duas ignoram `service_charges`, que o Saldo inclui.

**[confirmado] F. Salário atual aplicado a meses passados.** Vira problema real após qualquer reajuste. Solução: histórico de salário com vigência (`teacher_salary_history`), que os logs da seção 4 ajudam a backfillar.

**[confirmado] G. Custo por turma não fecha com custo total.** Despesas com `allocation_method='school'` ficam fora do custo por turma (por desenho). Exibir uma linha "Custos gerais da escola (não rateados)" no relatório.

**[verificar] H. `pendingRevenue` inclui pendentes já vencidas** (status ainda `pending` no banco). Qualquer notificação/relatório que use `status='overdue'` vai perder essas parcelas. Recomendado: job diário que promove `pending` vencida a `overdue`.

**[verificar] I. Mensalidade em 3 lugares** (aluno, turma, contrato) sem sincronia. Decisão de produto pendente.

Testes sugeridos: caso numérico com desconto 10% + multa; mensalidade paga em mês diferente do vencimento; renegociação (cancelada não entra); professor em 2 turmas com e sem horas semanais.

## 2. LP
Público principal: escolas particulares do infantil ao médio. Técnico e idiomas numa seção "também atende". Copy por problema concreto ("quem está inadimplente?", "essa turma dá lucro?", "quanto sobrou este mês?"). Sem números/depoimentos inventados (depoimento real entra quando houver autorização). Mockup: `mockups/LP.dc.html`.

## 3. Notificações
Eventos: vencimento próximo/atraso de mensalidade, parcela de renegociação, despesa a pagar, fim de contrato (rematrícula). `contracts.renewed_from_id` já existe e permite saber quem já rematriculou; falta o conceito de ciclo letivo para disparar o lembrete. Tabelas: `notifications`, `notification_preferences` (evento × canal × antecedência × resumo diário). Envio: pg_cron + Edge Function + e-mail transacional. Mockups: `Main.dc.html` (sino + card de atenção), `Notificacoes.dc.html`, `Config-Notificacoes-Seguranca.dc.html`.

## 4. Logs de alteração (novo)

**Dois públicos:** owner da escola (só a própria escola) e master admin (todas, com filtro por escola).

**Por que agora:** a migration `20261111240000_master_admin_cross_school_rls` permite ao master ler/escrever em qualquer escola. Sem log, não há como mostrar ao owner o que foi mexido por suporte.

**Tabela `audit_logs` (append-only):** `id`, `school_id`, `actor_user_id`, `actor_role`, `is_master_action` (true quando `is_master_admin()` e a escola ≠ escola de casa), `table_name`, `record_id`, `action` (insert/update/delete), `changed_fields text[]`, `old_data jsonb`, `new_data jsonb`, `created_at`.

**Captura:** função de trigger genérica `AFTER INSERT/UPDATE/DELETE` em: `students`, `teachers`, `classes`, `class_teachers`, `contracts`, `tuitions`, `expenses`, `recurring_expenses`, `service_charges`, `school_services`, `student_services`, `renegotiations`, `user_roles`, `invitations`, `schools`. `auth.uid()` continua válido dentro de funções `SECURITY DEFINER`, então o ator é registrado corretamente.

**Cuidados:**
- Ruído: geração em lote e importação em massa gerariam centenas de linhas. Registrar INSERT gerado automaticamente como evento agregado (ou `source='generated'`, oculto por padrão); em `tuitions`, log completo só de mudanças em status, valores e datas.
- `teachers.salary` é privado a admin/financial: logs de `teachers` seguem a mesma regra.
- RLS: SELECT para owner/admin da própria escola e master; sem policies de UPDATE/DELETE (imutável). Retenção sugerida: 24 meses.
- Não logar tokens, senhas ou dados de auth.
- Lembrete do CLAUDE.md: confirmar schema real em produção (`information_schema`) antes de escrever a migration.

**UI (mockups):** Owner: Configurações → "Histórico de alterações" (`Historico-Owner.dc.html`). Master: painel global com filtro por escola, usuário, tabela e "só ações master" (`Historico-Master.dc.html`).

Em aberto: exportação CSV (mockada, a confirmar).

## 5. Configurações

**Segmentos — o que fazem hoje:** nada. `schools.segments` é gravado no onboarding e em Configurações e carregado no `SchoolContext`, mas nenhuma tela ou cálculo o lê. É um cadastro descritivo.

**Escopo aprovado:**
1. **Filtrar séries na turma:** o campo "Série/Ano" do `ClassForm` (que já tem os grupos Infantil, Fundamental Anos Iniciais, Anos Finais e Médio, em `GRADE_GROUPS`) passa a mostrar só os grupos dos segmentos da escola, mais "Outra série (digitar)". Turmas existentes não mudam. Mockup: `Config-Escola.dc.html`.
2. **Visão por segmento no painel master:** mistura de clientes por segmento (quantas escolas atendem cada um e quantas o marcam como principal), com filtro na lista de escolas. Mockup: `Master-Escolas.dc.html`.

Segmentos passam a ser: Infantil, Fundamental I, Fundamental II, Médio, Técnico, Idiomas; com um **principal** e os demais secundários. Recomendação: coluna `primary_segment` em `schools` (consulta do painel master mais simples, sem depender da ordem do array).

Fora do escopo por ora: categorias de despesa iniciais por segmento; relatórios de rentabilidade por segmento. Se nenhum uso futuro justificar, remover a pergunta de Configurações.

**Nota de correção:** versão anterior deste plano dizia que o seletor de série só ia até o 9º ano. O `ClassForm` atual já cobre infantil ao médio; o CHANGELOG do projeto estava defasado.

**Segurança em etapas:** troca de senha em 3 passos + 2FA TOTP (ativação em 3 passos), com opção de exigir 2FA de owner/admin. Mockup: `Config-Notificacoes-Seguranca.dc.html`.

**Preferências de notificação:** matriz evento × canal (sistema/e-mail) × antecedência, mais resumo diário com horário.
