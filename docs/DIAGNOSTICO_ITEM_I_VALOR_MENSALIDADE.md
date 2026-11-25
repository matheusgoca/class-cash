# Item I — o valor da mensalidade em três lugares (Fase 0, diagnóstico)

**Data:** 2026-11-25 (S5, Bloco 2). **Escopo:** só leitura. Nenhuma migration, nenhuma escrita, nenhuma spec.
**Estado:** **aguardando a escolha do PM** (A, B ou C, seção 6) antes de qualquer spec.
**Origem:** `docs/PLANO_SPRINTS_NOV2026.md`, item I ("Mensalidade em 3 lugares: aluno, turma, contrato, sem sincronia").

> **Correção de premissa.** O enunciado dizia que "a mensalidade base da turma não é sugerida ao criar o contrato". **Ela é sugerida**: `ContractForm.tsx` (efeito em torno da linha 138) preenche `monthly_amount` com `classes.monthly_fee` (ou `monthly_fee_integral`, conforme o período) **só em contrato novo**, para não sobrescrever valor negociado na edição (commit `60d4ea2`). O que falta é o resto: o cadastro do aluno não conversa com ninguém, e o `final_amount` do contrato não é arredondado.

## 1. Onde o valor mora e quem lê

| Tabela | Campo | Tipo | Observação |
|---|---|---|---|
| `students` | `full_tuition_value`, `discount`, `final_tuition_value` | numeric(10,2) | `final_tuition_value` é **calculado no cliente** (`Students.tsx`, `full * (1 - desc/100)`) e gravado; o banco só arredonda ao gravar |
| `classes` | `monthly_fee` (numeric(10,2)), `monthly_fee_integral` (**numeric sem escala**) | | `integral` não é usado por nenhuma turma hoje (0 em todas as escolas) |
| `contracts` | `monthly_amount` (numeric(10,2)), `discount`, **`final_amount` GERADA** | | `final_amount = monthly_amount * (1 - coalesce(discount,0)/100)`, **sem `round`** |
| `tuitions` | `amount` (numeric(10,2)), `final_amount` (só preenchido ao pagar), `discount_applied`, `penalty_amount` | | `amount` nasce igual ao `final_amount` do contrato (arredondado pela coluna) |

**Quem lê (front):**

- `students.full_tuition_value` / `final_tuition_value`: `StudentForm.tsx` (campo "Mensalidade base"), `StudentTable.tsx` (coluna Mensalidade, **só** quando não há contrato ativo), `Students.tsx`, `auditFormat.ts` (histórico). Nenhuma outra tela, relatório, RPC ou view lê estes dois campos.
- `classes.monthly_fee` / `_integral`: `ClassForm.tsx` (edição), `Classes.tsx` (lista), `ContractForm.tsx` (sugestão em contrato novo), `ClassHealthCards.tsx` (dashboard), `import/execute.ts` e `import/validate.ts` (importação), `auditFormat.ts`. RPC: `save_class_with_teachers` (escreve).
- `contracts.monthly_amount`: `ContractForm`, `ContractTable`, `Contracts.tsx`, `Tuitions.tsx`/`TuitionTable.tsx`, a rematrícula (`renewal.ts`, `renewalData.ts`, `RenewalTable.tsx`), `generateTuitions.ts`, `import/validate.ts`, `auditFormat.ts`. RPCs: `import_contract` (escreve), `renew_contracts` (escreve e confere).
- `tuitions.amount` / `final_amount`: Mensalidades (`Tuitions.tsx`, `TuitionTable`, `TuitionForm`, `RenegotiationModal`), Dashboard (`FinancialMetrics`, `DashboardCharts`, `ClassHealthCards`), Rentabilidade (`ClassProfitability`), saldo (`financialBalance.ts`), sempre via `getTuitionValue()` (`final_amount ?? amount`). RPCs: `generate_daily_notifications` (`coalesce(final_amount, amount)`), `renegotiate_tuitions`, `insert_generated_tuitions`.

## 2. Divergência por escola (Pensar: só leitura)

| | Colégio Estrela | **Colégio Pensar** | Colegio Teste |
|---|---|---|---|
| Alunos / com valor no cadastro | 240 / 240 | **201 / 0** (todos com valor 0, o default) | 86 / 83 |
| Turmas / com `monthly_fee` / com `monthly_fee_integral` | 9 / 9 / 0 | **13 / 13 / 0** | 9 / 8 / 0 |
| Contratos (ativos) | 240 (240) | **0 (0)** | 87 (85) |
| Mensalidades | 2.642 | **0** | 965 |
| Contrato diverge da base da turma | 0 | n/a (sem contratos) | **1** (de 86 com base; +R$ 30) |
| Contrato diverge do valor-base do aluno | 0 | n/a | **4** (todas ativas; +R$ 750 a +R$ 1.000) |
| Contrato diverge do valor final do aluno (2 casas) | 0 | n/a | 0 |
| Cadastro do aluno diverge da turma | 0 | 201 (aluno sem valor, turma com valor) | 3 |
| Alunos sem contrato ativo | 0 | **201** | 2 |

Leitura: **a divergência real é pequena e está só na escola de teste** (5 contratos). O dado relevante é outro: **o Pensar tem o preço nas turmas (13/13) e nenhum valor nos alunos (0 de 201) nem contratos**. Quando a família começar a lançar contratos, o fluxo que vai valer é o que já existe: turma sugere, contrato grava.

## 3. Mensalidades x contrato (`amount` contra `round(final_amount, 2)`)

| | Estrela | Pensar | Teste |
|---|---|---|---|
| Mensalidades com contrato | 2.642 | 0 | 965 |
| `amount` diferente do contrato | **2** | 0 | **11** |
| ...por até R$ 0,01 (arredondamento) | **0** | 0 | **0** |
| `amount` diferente de `monthly_amount − desconto`, 2 casas | 2 | 0 | 11 |
| Pagas com `final_amount` diferente do `amount` | 93 | 0 | 7 |
| Contratos com `final_amount` com fração de centavo (ex.: 299,997) | **0** | 0 | **0** |

As 13 mensalidades que divergem são **todas parcelas de renegociação** (descrição de renegociação/parcela): 8 vencidas, 3 canceladas, 1 paga e 1 pendente (11 na Teste, 2 na Estrela), diferenças de −R$ 600 a +R$ 4.500. Divergência **esperada**, não deriva. Nenhuma foi editada pela tela (`audit_logs` só existe desde 13/11).

**Conclusão sobre o 299,997:** é **latente**. Hoje **nenhum** contrato real tem fração de centavo no `final_amount`, então ainda não há mensalidade com valor "errado". Só aparece com um valor como R$ 333,33 com 10% de desconto.

## 4. Onde `contracts.final_amount` é lido

(O `final_amount` de **mensalidades** aparece em muitos lugares e é outra coluna; abaixo só o do **contrato**.)

| Onde | Para quê |
|---|---|
| `src/lib/generateTuitions.ts:24` | gera as mensalidades do contrato: `finalAmount` vai para `buildTuitionRows` e vira `tuitions.amount` (arredondado pela coluna) |
| `src/pages/Students.tsx:63` | coluna "Mensalidade" da lista de alunos (contrato ativo) |
| RPC `renew_contracts` | `returning final_amount` → grava `tuitions.amount` e confere o valor do cliente com tolerância de R$ 0,01 |
| `src/lib/renewal.ts` (`finalAmountOf`) | **espelho** da fórmula no cliente (não lê a coluna); `round2` aplicado em seguida |
| `src/lib/auditFormat.ts` | só exibe no histórico |

Nenhuma view; nenhum trigger além do `audit_trigger_fn` genérico; `import_contract` escreve `monthly_amount` e deixa o banco gerar o resto.

## 5. Fatos técnicos que pesam na decisão

- Postgres 17.6: dá para trocar a expressão da coluna gerada com `ALTER TABLE ... ALTER COLUMN final_amount SET EXPRESSION AS (round(...,2))`, sem recriar a coluna. Como há 0 contratos com fração de centavo, **nenhuma linha muda de valor**.
- `renew_contracts` já confere o valor do cliente com tolerância de R$ 0,01 e grava o do servidor: com `final_amount` arredondado essa tolerância deixa de ser necessária, mas é inofensiva.
- `monthly_fee_integral` não tem escala (`numeric` puro) e **ninguém o usa** (0 turmas); só 1 contrato é `integral` (326 são `meio_periodo`).
- O cadastro do aluno tem um papel documentado em `Students.tsx`: "valor de referência para quem ainda não tem contrato (ex.: pré-matrícula)". No Pensar ele está vazio.

## 6. Opções e recomendação

**A — contrato como fonte única** (recomendada). A turma só **sugere** o valor ao criar o contrato (já faz). O campo do aluno deixa de ser entrada de preço: some da UI **ou** só exibe o valor do contrato vigente (e, para aluno sem contrato, o preço da turma como "referência", em vez do campo próprio). `contracts.final_amount` passa a ser `round(..., 2)` na origem.
- Prós: é de onde a cobrança nasce (`tuitions` são geradas do contrato); elimina o único campo que ninguém mantém (aluno: 0 de 201 no Pensar); não muda dado existente (0 linhas afetadas); mantém desconto e valor negociado por aluno; custo baixo e reversível (os campos de `students` ficam no banco, só saem da tela).
- Contras: a pré-matrícula perde o campo próprio (mitigado exibindo o preço da turma); quem hoje digita o valor no aluno vai ter de passar pelo contrato.

**B — manter os três e alertar divergência nas telas.** Prós: não muda fluxo. Contras: não remove a causa, cria três comparações para manter, e a divergência já é pequena (5 contratos): é custo de UI para um problema que o dado mostra quase inexistente.

**C — turma como fonte, contrato herda.** Contras: quebra valor negociado e desconto por aluno; mudar o preço da turma alteraria contratos vigentes ou exigiria versionamento; o integral nem é usado. Descartada.

**DECISÃO (PM):** escolher A, B ou C. Se A, três sub-decisões antes da spec:
1. Campo do aluno: **some** da UI, ou **exibe** o valor do contrato vigente (e o da turma como referência quando não há contrato)?
2. `final_amount` arredondado com `SET EXPRESSION` (sem efeito nos dados atuais): confirma?
3. Momento: antes do Pensar começar a lançar contratos (hoje 0), para a primeira carga já nascer no modelo novo?

Nenhuma spec nem migration foi escrita.
