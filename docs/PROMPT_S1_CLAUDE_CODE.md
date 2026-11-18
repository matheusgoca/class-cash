# Prompt — Sprint S1 (Claude Code)

Cole o bloco abaixo no Claude Code, na raiz de `C:\dev\class-cash`.

---

Leia `CLAUDE.md`, `docs/PLANO_SPRINTS_NOV2026.md` (seções 1, 2 e 4) e `docs/mockups/README.md`. Vamos executar a **Sprint S1**: confiança nos números, base de logs e novo copy da LP. Trabalhe como tech lead: passo a passo, diagnosticando antes de codar, e **pare e me pergunte** nos pontos marcados "DECISÃO".

## Regras
- Diagnosticar antes de codar. Não assuma schema a partir do histórico de migrations; me dê as queries SQL (`information_schema`, `pg_constraint`, `pg_policies`) e espere eu colar o resultado quando precisar de produção.
- Toda query nova filtra por `school_id` explicitamente, mesmo com RLS.
- Cálculo de custo por turma continua só em `src/lib/classCost.ts`.
- Erros do Postgres passam por `getFriendlyErrorMessage`.
- Migrations: você não executa SQL em produção. Entregue arquivos em `supabase/migrations/` e me diga como rodar. Funções PL/pgSQL grandes: dividir em partes menores ou indicar `supabase db push`.
- Um commit por item, mensagem em português descrevendo o porquê. Não faça push.

## Fase 0 — Diagnóstico (sem alterar código)
1. `git log` em `src/components/dashboard/FinancialMetrics.tsx`: o seletor de mês do Dashboard (doc de 13/09) existia e foi perdido? Quando e por quê?
2. Em `generateTuitions.ts`, `TuitionForm`, `RenegotiationModal` e nas RPCs de renegociação: `tuitions.amount` já vem líquido ou `final_amount` = `amount − discount_applied + penalty_amount`? Liste todos os pontos do app que somam `amount` e todos que usam `final_amount`.
3. Liste onde cada tela calcula: receita recebida, inadimplência, saldo, custo (Dashboard, Mensalidades, Relatórios, ClassHealthCards, DashboardCharts, ClassProfitability).
4. Me entregue as queries SQL para confirmar em produção: colunas e constraints de `tuitions`, `service_charges`, `expenses`; quantidade de mensalidades `pending` com `due_date` vencida; existência de `paid_date` preenchido.
Resuma em uma tabela e **espere minha confirmação** antes da Fase 1.

## Fase 1 — Correções financeiras (itens A–I do plano)
Implemente nesta ordem, cada uma com teste (Vitest se já houver setup; senão, função pura em `src/lib/` com casos de exemplo documentados):

- **A (corrigido após sua Fase 0).** `tuitions.final_amount` só existe quando a mensalidade está paga. Regra: pagas = `final_amount ?? amount`; pendentes e atrasadas = `amount`. Aplique em `FinancialMetrics` (que hoje soma `amount` nas pagas) e confira `DashboardCharts`, Mensalidades e `ClassHealthCards`. Extraia um helper único (ex.: `getTuitionValue(t)`) em `src/lib/calculations.ts`. Não confundir com `contracts.final_amount`.
- **E.** Receita Recebida e Inadimplência passam a seguir o mesmo período do Saldo e a incluir `service_charges`, ou ficam claramente rotuladas como acumuladas. Escolha a opção que mantenha o Dashboard coerente e me explique.
- **D.** Se o seletor de mês foi perdido, recriar (mesmo padrão do Kanban); Saldo, Despesas do mês e tendência seguem o mês escolhido.
- **G.** Relatório de Rentabilidade: linha "Custos gerais da escola (não rateados)" para o custo por turma + gerais fechar com o total.
- **H.** Proponha (migration em arquivo) um job diário que promove `pending` vencida a `overdue` no banco, e ajuste a UI para não depender só de `isTuitionOverdue`. Mantenha `isTuitionOverdue` como segurança.
- **B/C — DECIDIDO (12/11):** Saldo **Realizado (caixa)** como número principal e **Previsto** como apoio.
  - Realizado: receita das pagas no mês por `paid_date` (valor `final_amount ?? amount`); despesas pagas no mês por `paid_date`.
  - Previsto: todas as não canceladas com vencimento no mês (receita e despesas).
  - Salários: salário mensal ativo, integral no mês, com rótulo na tela explicando isso.
  - `FinancialMetrics` passa a bater com `DashboardCharts` (que já usa `paid_date`); a tendência vs mês anterior usa o mesmo regime.
  - Antes de implementar: com o resultado da query de `paid_date`, me diga se há mensalidades `paid` sem `paid_date` e proponha fallback/backfill (migration em arquivo).
  - Rotule na UI qual saldo é qual, sem criar jargão novo para o dono da escola.
- **F e I:** apenas liste o que seria necessário (histórico de salário com vigência; unificar valor da mensalidade). Não implemente nesta sprint.

## Fase 2 — Base de logs (`audit_logs`)
Siga a seção 4 do plano. Entregue em arquivos separados e pequenos:
1. Migration da tabela `audit_logs` (append-only, sem policies de UPDATE/DELETE) + RLS: SELECT para owner/admin da própria escola e master admin.
2. Função de trigger genérica `AFTER INSERT/UPDATE/DELETE` registrando ator (`auth.uid()`), papel, `is_master_action`, tabela, registro, campos alterados, `old_data`/`new_data`.
3. Triggers nas tabelas listadas no plano. Antes de escrever, confirme com `information_schema` que cada tabela existe e quais colunas são sensíveis.
4. Regras de ruído: INSERT gerado em lote (mensalidades, despesas recorrentes, importação) vira evento agregado ou `source='generated'`; em `tuitions` logar só mudanças de status, valores e datas.
5. Privacidade: `teachers.salary` segue a regra de acesso atual; nunca logar tokens, senhas ou dados de auth.
6. Queries de verificação: faça uma alteração de teste e mostre a linha gerada, inclusive via RPC `SECURITY DEFINER` e como master admin em outra escola.
**Não** crie as telas de histórico agora (são da S2).

## Fase 3 — LP
Atualize `src/pages/Landing.tsx` conforme `docs/mockups/LP.dc.html`: público principal escolas do infantil ao médio; técnico e idiomas como "também atende"; copy por problema ("quem está inadimplente?", "essa turma dá lucro?", "quanto sobrou este mês?"). Mantenha os componentes e tokens do projeto (variáveis do tema, `ui/`), não copie hex do mockup. Sem números ou depoimentos inventados: deixe um espaço claramente marcado para depoimento real.

## Ao terminar
- Atualize `CHANGELOG.md` (e me diga o que levar ao Claude Project).
- Liste: o que foi feito, o que ficou pendente, migrations que preciso rodar e em que ordem, e um roteiro curto de QA manual (mensalidade com desconto + multa; paga em mês diferente do vencimento; renegociação; professor em 2 turmas; ação de master em outra escola gerando log).
