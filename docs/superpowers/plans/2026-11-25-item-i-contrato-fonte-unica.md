# Item I — contrato como fonte única: plano de execução

**Spec:** `docs/superpowers/specs/2026-11-25-item-i-contrato-fonte-unica-design.md` (aguarda aprovação do PM; **não executar antes**).
**Regras:** TDD (teste vermelho primeiro); tudo por branch e PR (a `main` exige PR e o check da Vercel); **sem Co-Authored-By**; merge só quando o PM pedir; migration só com `--dry-run` e autorização; **nenhuma escrita no Pensar** (QA só na Colegio Teste e no Colégio Estrela); toda query nova filtra por `school_id`; erros do Postgres por `getFriendlyErrorMessage`.
**Prioridade:** concluir antes de o Pensar lançar contratos (hoje 0). Ordem sugerida: T1 (banco) → T2–T5 (tela) → T6 (importação) → T7 (docs/QA). Cada tarefa é um PR pequeno; T1 não depende das outras.

---

## T1 — `final_amount` arredondado (banco) · branch `feature/item-i-final-amount-round`

**Arquivos:** `supabase/tests/renewal_matrix.sql` (casos novos), `supabase/migrations/<timestamp>_contracts_final_amount_round.sql`.

1. **Casos na matriz primeiro (devem falhar antes da migration)**, dentro da seção de endurecimento, escolhendo personagens por consulta, `BEGIN…ROLLBACK`:
   - `5a` contrato `333,33` com 10% → `final_amount = 300.00` e `scale(final_amount) <= 2`.
   - `5b` contrato `99,99` com 33,33% → `final_amount = 66.66` (hoje 66,659333…).
   - `5c` `renew_contracts` com o valor arredondado continua renovando (`'1|12'`) e a mensalidade grava `300.00`.
   - `5d` contrato sem desconto (`discount` nulo) → `final_amount = monthly_amount`.
   Rodar contra o schema atual: esperado **5a, 5b falham**.
2. **Migration** (sem `--dry-run` ainda): um `DO` atômico que (a) grava contagem, soma e `md5(string_agg(id::text || ':' || round(final_amount,2)::text, ',' order by id))`; (b) **aborta** se houver contrato com fração de centavo; (c) executa `alter table public.contracts alter column final_amount set expression as (round(monthly_amount * (1::numeric - coalesce(discount, 0::numeric) / 100::numeric), 2))`; (d) recalcula e **`raise exception`** se contagem, soma ou hash diferirem.
3. **Validar a migration injetada na matriz** (marcador `@@MIGRATION@@`, `BEGIN…ROLLBACK`): todas verdes, incluindo `5a–5d`. Conferir depois que a expressão em produção continua a antiga.
4. **Conferência antes (leitura):** por escola, `count(*)`, `sum(final_amount)`, `count(*) filter (where final_amount <> round(final_amount,2))`. Guardar a saída.
5. **`npx supabase@2.117.0 db push --linked --dry-run`**: tem de listar **só** esta migration. Mostrar ao PM e **esperar autorização**.
6. `db push`; **conferência depois** (mesmas consultas): contagem e soma por escola idênticas; fração de centavo = 0. Rodar a matriz inteira **sem** marcador.
7. Commit (`Item I: final_amount arredondado em 2 casas`), PR, aguardar a Vercel, merge só se o PM pedir.

## T2 — função pura do valor do aluno · branch `feature/item-i-aluno-valor-ui` (T2–T5 no mesmo branch)

**Arquivos:** `src/lib/studentTuition.ts`, `src/lib/studentTuition.test.ts`.

1. Testes vermelhos para `pickCurrentContract(contracts, today)` (R4): contém hoje; vários ativos (o que contém hoje vence); só vencido ativo (o de `start_date` mais recente); só futuro; cancelado/suspenso ignorado; vazio → `null`.
2. Testes para `studentTuitionView({ contract, classFee })` → `{ kind: 'contract' | 'class_reference' | 'none', value, discount?, period? }` (R5: sem contrato usa `monthly_fee`; fee nulo/0 → `none`).
3. Implementar o mínimo; `npx vitest run src/lib/studentTuition.test.ts`.

## T3 — formulário do aluno

**Arquivos:** `src/components/students/StudentForm.tsx`, novo `StudentTuitionInfo.tsx`, testes do componente.

1. Teste vermelho (`@vitest-environment jsdom`): o formulário **não** tem os rótulos "Mensalidade base (R$)" nem "Desconto (%)"; mostra o bloco nos 3 estados; trocar a turma muda a referência; a 375 px não quebra (classe `min-w-0`).
2. Remover os 2 campos, o bloco "Valor final" e `full_tuition_value`/`discount` do `studentSchema` e dos `defaultValues`; incluir `StudentTuitionInfo` com a busca do contrato do aluno (`.eq('school_id', schoolId).eq('student_id', id)`), link "Ver contrato".

## T4 — gravação do aluno

**Arquivo:** `src/pages/Students.tsx` (`handleSubmit`) + teste.

1. Teste vermelho: o payload de create e de update **não** contém `full_tuition_value`, `discount` nem `final_tuition_value`.
2. Remover o cálculo `finalTuitionValue` e os 3 campos do `dataToSubmit`.

## T5 — coluna "Mensalidade" da lista

**Arquivos:** `src/pages/Students.tsx`, `src/components/students/StudentTable.tsx`, teste.

1. Teste vermelho: com contrato → valor do contrato; sem contrato e turma com `monthly_fee` → valor com "(ref.)"; sem nada → "—"; **ignora** `final_tuition_value`.
2. A busca de contratos passa a trazer `student_id, final_amount, start_date, end_date, status`; usar `pickCurrentContract` e `studentTuitionView`; tirar `active_contract_final_amount`/`final_tuition_value` do caminho de exibição.

## T6 — importação de contratos · branch `feature/item-i-import-contratos-valor-opcional`

**Arquivos:** `src/lib/import/types.ts`, `validate.ts`, `templates.ts`, `src/components/settings/ImportSection.tsx`, novo `src/lib/import/validate.contracts.test.ts`.

1. `ImportContext.existingClasses` passa a `{ id, name, monthly_fee }` e o `select` de `ImportSection.tsx` inclui `monthly_fee` (com `school_id`).
2. Testes vermelhos (não existe teste da validação hoje): valor informado vale; vazio + turma com `monthly_fee` → usa o da turma e marca `usedClassFee`; vazio + sem turma → erro de linha; vazio + turma sem mensalidade → erro; valor inválido continua erro.
3. `validate.ts`: `valor_mensalidade` opcional com o fallback acima; a prévia sinaliza "valor da turma usado".
4. `templates.ts`: instruções (`valor_mensalidade` passa a "Não", com a regra do fallback); aba de alunos ganha a linha "O valor da mensalidade é definido no contrato."

## T7 — documentação e QA

1. `CHANGELOG.md`; `QA_CHECKLIST.md` com roteiro **só na Colegio Teste e no Colégio Estrela**: abrir/editar aluno (valor antigo intacto por consulta), 3 estados do bloco, lista, importação de contratos nos 3 casos, 375 px claro e escuro.
2. `CLAUDE.md`: convenção "valor da mensalidade: o contrato é a fonte; a turma só sugere; `getTuitionValue()` para somar mensalidades".
3. `docs/STATUS.md` (tabela e próximos passos). PR; o PM pede o merge.

## Ordem dos PRs e dependências
T1 independente · T2→T3→T4→T5 sequenciais (mesmo PR) · T6 independente · T7 por último. Nenhuma tarefa grava em produção **exceto o `db push` da T1**, que só acontece com `--dry-run` mostrado e autorização.
