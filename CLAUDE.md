# CLAUDE.md

Contexto para qualquer sessão do Claude (Claude Code ou Cowork) trabalhando neste repositório. Para stack, árvore de diretórios e tabelas principais, ver `README.md` — este arquivo não duplica isso, só registra o que não está óbvio olhando o código.

## O que é o projeto

Class Cash — SaaS multi-tenant de gestão financeira para escolas particulares: turmas, professores, alunos, contratos, mensalidades, despesas e relatórios de rentabilidade por turma.

## Onde paramos

**Leia `docs/STATUS.md` primeiro.** Ele diz o que está em produção, o próximo passo, o setup em outra máquina (`.env`, Supabase CLI) e as armadilhas conhecidas. A memória local do Claude não vai junto com o git — o `STATUS.md` é a passagem de bastão entre máquinas; atualize-o ao final de cada sessão.

## Documentação viva do projeto

O histórico de decisões, QA e revisões de produto deste projeto é mantido no Claude Project **"Controle financeiro para Escolas"** (acessível via Claude Cowork/claude.ai), não neste repositório. Antes de reinvestigar uma decisão de design ou um bug do zero, vale checar lá — os documentos incluem: revisão completa de UX por tela, proposta e implementação do módulo de Despesas, checklist e validação de QA, e o resumo de sincronização de schema citado abaixo. `CHANGELOG.md`, `QA_CHECKLIST.md` e `SCHEMA_SYNC_SUMMARY.md` na raiz deste repo são cópias desses mesmos documentos.

## Convenções acumuladas de como trabalhar neste projeto

- **Diagnosticar antes de codar.** Antes de assumir a forma de uma constraint, coluna ou comportamento, confirme com uma query direta em produção. Ver "Drift de schema" abaixo — já economizou retrabalho mais de uma vez.
- **Padrão "molde → lançamento".** Toda entidade recorrente segue este padrão: uma tabela "molde" (`contracts`, `recurring_expenses`) guarda a regra, e uma função idempotente (`generateTuitions`, `generateExpenses` em `src/lib/`) gera os lançamentos mês a mês (`tuitions`, `expenses`). Ao adicionar algo recorrente novo, siga esse mesmo padrão em vez de inventar um novo.
- **Custo por turma é centralizado em `src/lib/classCost.ts`.** É a única fonte de verdade para calcular custo alocado por turma (salário de professor dividido entre as turmas em que ele leciona + despesas diretas/rateadas por categoria). Usado no relatório de rentabilidade (`ClassProfitability.tsx`). **Correção (Sprint S2):** `ClassHealthCards.tsx` (cards de saúde da turma no Dashboard) **não** usa `classCost.ts` — calcula só ocupação, receita e inadimplência por turma, sem nenhum cálculo de custo. Se um dia `ClassHealthCards.tsx` precisar mostrar custo/lucro por turma, deve passar a usar `computeClassCosts()` em vez de duplicar a lógica. Se um dia o rateio de despesas ganhar mais métodos além de `school`/`per_class`/`per_student`, mude só em `classCost.ts`.
- **Valor da mensalidade sempre via `getTuitionValue()` (`src/lib/calculations.ts`).** Centraliza `final_amount ?? amount` — é assim que `tuitions.final_amount` só fica preenchido quando a mensalidade vira `paid`. Usado em Mensalidades, `FinancialMetrics.tsx`, `DashboardCharts.tsx` e `ClassProfitability.tsx`; qualquer tela nova que some valor de mensalidade usa esse helper, nunca soma `amount` ou `final_amount` direto.
- **Saldo do Dashboard tem dois regimes, calculados em `src/lib/financialBalance.ts`.** Saldo Realizado (caixa, por `paid_date`) é o número principal; Saldo Previsto (competência, por `due_date`, incluindo pendentes) é o apoio. Os dois são expostos por `calculateMonthlyBalance()` — não recalcular isso inline numa tela nova.
- **Toda mutação relevante é auditada em `audit_logs` (append-only, sem UPDATE/DELETE).** Uma trigger genérica (`audit_trigger_fn()`) cobre as tabelas principais; não precisa de código novo no client para isso acontecer. A coluna `source` (`manual` / `generated` / `import`) marca a origem: ausente (ação direta do usuário na tela) vira `'manual'` por padrão; para lançamentos em lote (geração de mensalidades/despesas recorrentes, importação de planilha), a RPC chamada seta `select set_config('app.audit_source', 'generated'::text, true)` (ou `'import'`) **antes** do insert, dentro da mesma transação — nunca grava `source` direto numa coluna de `tuitions`/`expenses`, é só do `audit_logs`. Ao adicionar uma RPC nova de geração/importação, replicar esse `set_config` local à transação.
- **Erros amigáveis.** Use `getFriendlyErrorMessage` (`src/lib/friendlyError.ts`) para traduzir erros do Postgres (ex: `23505` unique_violation) em mensagens em português, em vez de expor `error.message` cru na tela.
- **Máscaras de moeda/telefone.** `src/components/ui/currency-input.tsx` e `phone-input.tsx` tratam cada tecla como dígito puro (modelo "calculadora/POS"), não reformatam uma string já formatada — evita os bugs clássicos de cursor pulando e vírgula decimal quebrada. Ainda não aplicado em todos os campos financeiros (ver histórico de QA no Claude Project).
- **Todas as tabelas são multi-tenant por `school_id` + RLS.** Ao escrever uma query nova, filtre por `school_id` explicitamente mesmo confiando no RLS — já foi encontrada mais de uma tela que dependia só do RLS e por acidente não filtrava (`ClassProfitability.tsx`, corrigido).
- **Gate de 2FA no banco = policy RESTRICTIVE `mfa_gate` por tabela + `assert_mfa_gate()` nas RPCs `SECURITY DEFINER`.** A decisão está em `public.mfa_gate_ok()` (espelho no front: `resolveMfaGate()` em `src/lib/mfaGate.ts`). Exigidos: owner/admin de escola com `schools.require_2fa = true`, e o master admin **sempre**. **Tabela nova com dados de escola** precisa ganhar a policy `mfa_gate` (ver `20261117130000_mfa_restrictive_policies.sql`); **RPC `SECURITY DEFINER` nova** que lê/escreve dados de escola precisa de `perform public.assert_mfa_gate();` como primeira instrução (ver `20261117131000_mfa_gate_in_definer_rpcs.sql`) — senão vira porta lateral ao gate. Ficam de fora de propósito: `profiles`, `schools`, `user_roles`, `invitations` (a tela de ativação depende delas em `aal1`), `debug_reports` e `mfa_grace`. View nova sobre tabela com gate: usar `security_invoker` ou colocar `(select public.mfa_gate_ok())` no `where`, como em `teachers_directory`.
- **Notificações são da escola de casa do usuário (decisão D4).** Sino, central, card "Precisa da sua atenção" e preferências usam `get_user_school_id()` dentro dos RPCs (`list_notifications`, `mark_notifications_read`, preferências); `school_id` **nunca** vem do cliente. Por isso, quando o master está sem escola ou **visualizando outra escola**, o sino, o item Notificações e o card **somem** (`showNotificationsItem` em `src/lib/accountMenu.ts`, usado por `useShowNotifications`); não é bug. Não há vazamento entre escolas: os RPCs filtram por `user_id = auth.uid()` e pela escola do perfil. Rota nova que consuma esses RPCs deve repetir o guard `isMasterViewingOtherSchool` (as páginas `/notificacoes` e `/notificacoes/preferencias` têm, com teste).
- **Recuperação de 2FA.** Membro de escola: botão "Redefinir 2FA" em Equipe (Edge Function `reset-user-mfa`). **Master que perdeu o aparelho não passa pela Edge Function** (não consegue sessão `aal2`): remover o fator no painel do Supabase (Authentication → Users → MFA) ou `delete from auth.mfa_factors where user_id = '<uid>'`.

## Drift de schema (risco conhecido)

O histórico de migrations neste repo **nem sempre reflete o schema real em produção**. Casos já confirmados:
- `user_roles` tem `UNIQUE(user_id)` em produção, mas uma migration antiga do histórico implica `UNIQUE(user_id, role)`.
- Colunas como `students.full_name` e `teachers.specialization` existem em produção sem `ADD COLUMN` correspondente no histórico de migrations do repo.
- `update_updated_at_column()` não existe em produção: triggers de `updated_at` usam `public.set_updated_at()`. `uuid_generate_v4()` não está no search_path do `supabase db push`: usar `gen_random_uuid()` (padrão de todas as tabelas).

Antes de assumir a forma de uma constraint ou coluna a partir do histórico de migrations, confirme com uma query direta (`pg_constraint`, `information_schema.columns`) em produção.

## Executando SQL em produção

O projeto está linkado ao Supabase CLI (`npx supabase@2.117.0 ...` funciona mesmo sem o CLI instalado globalmente): `migration list --linked` e `db query --linked "<sql>"` servem para diagnóstico de leitura; validação com `BEGIN ... ROLLBACK` também. Escrita em produção (`db push`, `functions deploy`, DML) só com autorização explícita do usuário, mostrando o `--dry-run` antes. O SQL Editor do Studio (editor Monaco) já corrompeu o paste de blocos `$$ ... $$` PL/pgSQL grandes — para migrations com funções grandes, prefira dividir em partes menores ou recomendar `supabase db push` pelo CLI.

## Comportamento esperado

Comportamento de gerente de projeto / PO / tech lead: pensar passo a passo, elaborar bem as respostas, e não pular etapas de validação (diagnóstico, confirmação de schema, QA) antes de propor ou aplicar mudanças estruturais.

## Pastas a ignorar / limpar

- `class-cash/` (aninhada dentro deste repo) — um clone antigo e desatualizado do próprio projeto, com seu próprio `.git`. Não é usado por nada; seguro remover.
- `Claude outputs/` — anotações soltas de sessões anteriores, sem relação com o Claude Project atual. `revisao-class-cash.md` ali é um rascunho antigo já superado por `claude/REVISAO_UI_E_DESPESAS.md` no Claude Project.
- `docs/arquitetura.md` — desatualizado (descreve como "pendente" funcionalidades que já existem: renegociação, painel master, relatório de inadimplência). Mantido só como referência histórica; a arquitetura atual está no `README.md` e nos docs do Claude Project.
