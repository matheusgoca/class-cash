# CLAUDE.md

Contexto para qualquer sessão do Claude (Claude Code ou Cowork) trabalhando neste repositório. Para stack, árvore de diretórios e tabelas principais, ver `README.md` — este arquivo não duplica isso, só registra o que não está óbvio olhando o código.

## O que é o projeto

Class Cash — SaaS multi-tenant de gestão financeira para escolas particulares: turmas, professores, alunos, contratos, mensalidades, despesas e relatórios de rentabilidade por turma.

## Documentação viva do projeto

O histórico de decisões, QA e revisões de produto deste projeto é mantido no Claude Project **"Controle financeiro para Escolas"** (acessível via Claude Cowork/claude.ai), não neste repositório. Antes de reinvestigar uma decisão de design ou um bug do zero, vale checar lá — os documentos incluem: revisão completa de UX por tela, proposta e implementação do módulo de Despesas, checklist e validação de QA, e o resumo de sincronização de schema citado abaixo. `CHANGELOG.md`, `QA_CHECKLIST.md` e `SCHEMA_SYNC_SUMMARY.md` na raiz deste repo são cópias desses mesmos documentos.

## Convenções acumuladas de como trabalhar neste projeto

- **Diagnosticar antes de codar.** Antes de assumir a forma de uma constraint, coluna ou comportamento, confirme com uma query direta em produção. Ver "Drift de schema" abaixo — já economizou retrabalho mais de uma vez.
- **Padrão "molde → lançamento".** Toda entidade recorrente segue este padrão: uma tabela "molde" (`contracts`, `recurring_expenses`) guarda a regra, e uma função idempotente (`generateTuitions`, `generateExpenses` em `src/lib/`) gera os lançamentos mês a mês (`tuitions`, `expenses`). Ao adicionar algo recorrente novo, siga esse mesmo padrão em vez de inventar um novo.
- **Custo por turma é centralizado em `src/lib/classCost.ts`.** É a única fonte de verdade para calcular custo alocado por turma (salário de professor dividido entre as turmas em que ele leciona + despesas diretas/rateadas por categoria). Usado tanto no Dashboard (`ClassHealthCards.tsx`) quanto no relatório (`ClassProfitability.tsx`) — os dois nunca devem calcular isso de formas diferentes. Se um dia o rateio de despesas ganhar mais métodos além de `school`/`per_class`/`per_student`, mude só ali.
- **Erros amigáveis.** Use `getFriendlyErrorMessage` (`src/lib/friendlyError.ts`) para traduzir erros do Postgres (ex: `23505` unique_violation) em mensagens em português, em vez de expor `error.message` cru na tela.
- **Máscaras de moeda/telefone.** `src/components/ui/currency-input.tsx` e `phone-input.tsx` tratam cada tecla como dígito puro (modelo "calculadora/POS"), não reformatam uma string já formatada — evita os bugs clássicos de cursor pulando e vírgula decimal quebrada. Ainda não aplicado em todos os campos financeiros (ver histórico de QA no Claude Project).
- **Todas as tabelas são multi-tenant por `school_id` + RLS.** Ao escrever uma query nova, filtre por `school_id` explicitamente mesmo confiando no RLS — já foi encontrada mais de uma tela que dependia só do RLS e por acidente não filtrava (`ClassProfitability.tsx`, corrigido).

## Drift de schema (risco conhecido)

O histórico de migrations neste repo **nem sempre reflete o schema real em produção**. Casos já confirmados:
- `user_roles` tem `UNIQUE(user_id)` em produção, mas uma migration antiga do histórico implica `UNIQUE(user_id, role)`.
- Colunas como `students.full_name` e `teachers.specialization` existem em produção sem `ADD COLUMN` correspondente no histórico de migrations do repo.

Antes de assumir a forma de uma constraint ou coluna a partir do histórico de migrations, confirme com uma query direta (`pg_constraint`, `information_schema.columns`) em produção.

## Executando SQL em produção

Sessões do Claude neste projeto normalmente não têm uma ferramenta de execução SQL direta — migrations novas precisam ser entregues para o usuário rodar via Supabase Studio (SQL Editor) ou `supabase db push`. O SQL Editor do Studio (editor Monaco) já corrompeu o paste de blocos `$$ ... $$` PL/pgSQL grandes — para migrations com funções grandes, prefira dividir em partes menores ou recomendar `supabase db push` pelo CLI.

## Comportamento esperado

Comportamento de gerente de projeto / PO / tech lead: pensar passo a passo, elaborar bem as respostas, e não pular etapas de validação (diagnóstico, confirmação de schema, QA) antes de propor ou aplicar mudanças estruturais.

## Pastas a ignorar / limpar

- `class-cash/` (aninhada dentro deste repo) — um clone antigo e desatualizado do próprio projeto, com seu próprio `.git`. Não é usado por nada; seguro remover.
- `Claude outputs/` — anotações soltas de sessões anteriores, sem relação com o Claude Project atual. `revisao-class-cash.md` ali é um rascunho antigo já superado por `claude/REVISAO_UI_E_DESPESAS.md` no Claude Project.
- `docs/arquitetura.md` — desatualizado (descreve como "pendente" funcionalidades que já existem: renegociação, painel master, relatório de inadimplência). Mantido só como referência histórica; a arquitetura atual está no `README.md` e nos docs do Claude Project.

## gstack (recommended)

This project uses [gstack](https://github.com/garrytan/gstack) for AI-assisted workflows.
Install it for the best experience:

```bash
git clone --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
cd ~/.claude/skills/gstack && ./setup --team
```

Skills like /qa, /ship, /review, /investigate, and /browse become available after install.
Use /browse for all web browsing (Aside first, the bundled gstack browser as fallback). Use ~/.claude/skills/gstack/... for gstack file paths.
