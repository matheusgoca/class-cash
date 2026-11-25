# Item I — contrato como fonte única do valor da mensalidade (opção A)

**Data:** 2026-11-25. **Estado:** **proposta para aprovação do PM**. Nenhuma migration escrita (só o desenho e uma validação em `BEGIN…ROLLBACK`).
**Origem:** `docs/PLANO_SPRINTS_NOV2026.md` item I; diagnóstico em `docs/DIAGNOSTICO_ITEM_I_VALOR_MENSALIDADE.md` (números por escola).
**Decisão do PM (25/11):** opção **A**. O formulário do aluno esconde o campo de valor e mostra o valor do contrato vigente (somente leitura) ou a "referência da turma" quando não há contrato; **não apagar a coluna do aluno**; verificar a planilha de importação e propor ajuste; `final_amount` com 2 casas via `SET EXPRESSION`, com `--dry-run` e conferência de contagem e soma, sem mudar valor de nenhuma linha; **prioridade: antes de o Pensar lançar contratos** (hoje 0 contratos, 0 mensalidades).
**Plano de execução:** `docs/superpowers/plans/2026-11-25-item-i-contrato-fonte-unica.md`.

## Regras do modelo

| # | Regra |
|---|---|
| R1 | **O valor cobrado nasce do contrato** (`contracts.monthly_amount` e `discount`). As mensalidades (`tuitions`) são geradas dele (`generateTuitions`, `renew_contracts`, importação). Nada mais é fonte de preço. |
| R2 | **A turma só sugere.** `classes.monthly_fee` pré-preenche o valor ao criar contrato (o `ContractForm` já faz, só em contrato novo) e, a partir deste item, também na importação de contratos quando a planilha não traz o valor. Mudar o preço da turma **nunca** altera contratos existentes. |
| R3 | **O aluno não digita valor.** `students.full_tuition_value`, `discount` e `final_tuition_value` **ficam no banco** (histórico, auditoria, nenhum dado perdido) mas saem de qualquer tela de entrada. |
| R4 | **Contrato vigente** = contrato do aluno com `status = 'active'` cujo período contém hoje; se nenhum contém hoje, o ativo com `start_date` mais recente (cobre contrato ativo já vencido e contrato futuro). Uma função pura única (`src/lib/studentTuition.ts`) decide isso para o formulário e para a lista. |
| R5 | **Aluno sem contrato** vê a **referência da turma**: `classes.monthly_fee` da turma dele, rotulada como referência. O período do futuro contrato é desconhecido, então a referência é sempre `monthly_fee` (nunca `monthly_fee_integral`, que ninguém usa hoje). Sem turma, ou turma sem mensalidade: "—". |
| R6 | **`contracts.final_amount` tem 2 casas na origem** (`round(..., 2)`): o valor que o contrato "vale" é o que a mensalidade cobra. |

## Mudanças

### 1. Formulário do aluno (`StudentForm.tsx`)
- Saem os campos **Mensalidade base**, **Desconto (%)** e o bloco **Valor final calculado**, e saem do schema do formulário e dos `defaultValues`.
- Entra um bloco **somente leitura** "Mensalidade":
  - **Com contrato vigente:** valor final (já com desconto), "Desconto de N%" quando houver, período do contrato e a turma, mais o link **Ver contrato** (rota de contratos).
  - **Sem contrato:** "**Referência da turma:** R$ X" (reativo: muda quando o usuário troca a turma no formulário) e a frase "Sem contrato ativo. O valor definitivo é definido ao criar o contrato."
  - **Sem turma ou turma sem mensalidade:** "—" e a mesma frase.
- Aluno **novo** não tem contrato: o bloco mostra a referência da turma escolhida.

### 2. Gravação do aluno (`Students.tsx`, `handleSubmit`)
- **Para de enviar** `full_tuition_value`, `discount` e `final_tuition_value` (hoje calcula `final_tuition_value` no cliente, e com o campo oculto viraria `NaN`).
- **Edição não apaga nada:** os campos não vão no `update`, então os valores antigos ficam intactos. Em aluno novo o banco aplica o default (0).

### 3. Lista de alunos (`Students.tsx` + `StudentTable.tsx`)
- Coluna **Mensalidade:** valor final do contrato vigente (R4); sem contrato, a referência da turma com o rótulo "(ref.)"; senão "—". **Deixa de usar** `students.final_tuition_value`.
- A busca dos contratos traz `student_id, final_amount, start_date, end_date, status` (sempre com `school_id`), e a página já tem as turmas.

### 4. Importação (verificado em 25/11)
| Planilha | Hoje | Proposta |
|---|---|---|
| **Alunos** (`modelo-alunos.xlsx`) | **Não tem coluna de valor**; `import_student` não grava `full_tuition_value`, `discount` nem `final_tuition_value` | **Nenhuma mudança de código.** Só acrescentar na aba de instruções: "O valor da mensalidade é definido no contrato." |
| **Contratos** (`modelo-matriculas.xlsx`) | `valor_mensalidade` **obrigatório**; `desconto_percentual` opcional (0); `import_contract` grava `monthly_amount` e `discount` | **`valor_mensalidade` passa a opcional.** Vazio **e** turma informada com `monthly_fee`: usa o valor da turma (R2) e avisa na prévia ("valor da turma usado"). Vazio e sem valor da turma: erro de linha claro ("informe o valor ou escolha uma turma com mensalidade"). Informado: vale o informado (valor negociado). |
| **Turmas** (`modelo-turmas.xlsx`) | `mensalidade_turma` opcional; grava `monthly_fee`, `monthly_fee_integral` nulo | **Sem mudança** (é a fonte da sugestão). |

### 5. Banco: `final_amount` arredondado (R6)
`ALTER TABLE public.contracts ALTER COLUMN final_amount SET EXPRESSION AS (round(monthly_amount * (1 - coalesce(discount, 0) / 100), 2))`, no Postgres 17.6. Como a coluna é `STORED`, o Postgres reescreve a tabela (160 kB, 327 linhas: instantâneo).

**Garantia de "nenhuma linha muda" (atômica):** a migration roda dentro de um bloco que, **antes** do `ALTER`, grava contagem, soma e um hash `md5` de `id:round(final_amount,2)` linha a linha, aborta se existir qualquer contrato com fração de centavo, e **depois** do `ALTER` compara contagem, soma e hash; se algo diferir, `raise exception` e a transação inteira desfaz. Além disso, conferência manual de contagem e soma **por escola**, antes e depois do `db push`.

**Validado em 25/11 em `BEGIN…ROLLBACK` contra a produção** (nada persistiu; a expressão original voltou): 327 contratos antes e depois; soma R$ 328.060,00 antes e depois; hash linha a linha idêntico; 0 contratos com fração de centavo antes e depois; sem índices, constraints, policies, views nem triggers dependentes da coluna.

Efeitos colaterais: nenhum nos dados. `renew_contracts` continua conferindo o valor do cliente com tolerância de R$ 0,01 (agora folga, não necessidade). `generateTuitions.ts` e `Students.tsx` leem o valor já com 2 casas. O espelho `finalAmountOf` no cliente (`renewal.ts`) já aplica `round2`; a pré-visualização do `ContractForm` passa a usar a mesma função.

## O que NÃO muda
- Colunas de `students` (nada é apagado), `classes.monthly_fee_integral` (inalterado, segue sem uso), `tuitions.*`, `getTuitionValue()`, relatórios, dashboard, rematrícula.
- Histórico de auditoria: `auditFormat.ts` mantém os rótulos dos campos antigos do aluno.

## Riscos e mitigação
| Risco | Mitigação |
|---|---|
| Quem hoje digita o valor no aluno procura o campo | O bloco explica ("definido no contrato") e leva ao contrato; a referência da turma cobre a pré-matrícula |
| Editar aluno zerar o valor antigo | Os campos saem do `update` (caso de teste) |
| `SET EXPRESSION` mudar algum valor | Guarda atômica + hash linha a linha + conferência por escola; validado em ROLLBACK |
| Importar contrato sem valor com a turma errada | Prévia sinaliza "valor da turma usado" e o usuário vê antes de confirmar |
| Pensar lançar contratos antes da entrega | Prioridade 1 do plano: front e banco primeiro; o Pensar hoje tem 0 contratos |

## Aceite
1. Formulário do aluno sem campo de valor; bloco somente leitura correto nos 3 estados (contrato, referência, "—"), a 375 px também.
2. Editar um aluno de teste **não altera** `full_tuition_value`/`discount`/`final_tuition_value` (conferido por consulta).
3. Lista de alunos mostra o valor do contrato e, sem contrato, a referência com "(ref.)".
4. Importação de contratos: com valor, sem valor + turma com mensalidade, sem valor + sem turma (erro).
5. `final_amount` com 2 casas: `333,33` com 10% = `300,00`; contagem, soma e hash por escola idênticos antes e depois.
6. Matriz de rematrícula verde com os casos novos; suíte e build verdes.
7. QA manual **somente** na Colegio Teste e no Colégio Estrela (nunca no Pensar).

## Decisões residuais (propostas, o PM pode só aprovar)
1. **Rótulos:** "Mensalidade" (bloco), "Referência da turma" e "Sem contrato ativo. O valor definitivo é definido ao criar o contrato."
2. **Importação de contratos com valor opcional** (recomendado) em vez de manter obrigatório.
3. **Referência = `monthly_fee`** (meio período) mesmo se a turma tiver `monthly_fee_integral`.
