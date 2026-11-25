# Importação de pagamentos por planilha: desenho (S6b, bloco G)

**Status:** DESENHO. Nada foi implementado. Aguarda o **layout real da planilha do financeiro** e a decisão do PM.
**Por quê:** o financeiro do Pensar terá de dar baixa em meses já pagos (hoje, uma a uma na tela; não há baixa em lote). Sem isso, o cadastro real depende de centenas de cliques.
**Reaproveita:** o fluxo de importação existente (`src/lib/import`: `parse.ts`, `validate.ts`, `execute.ts`, `templates.ts`; telas em Configurações), o padrão "RPC com `set_config('app.audit_source','import', true)`" (`import_contract`) e o estorno de baixa do bloco D.

## 1. Modelo de planilha

**Formato LONGO (recomendado, uma linha por pagamento)**: o que o importador valida melhor, linha a linha.

| coluna | obrigatória | observação |
|---|---|---|
| `aluno` | sim | nome completo; ver identificação (seção 2) |
| `mes` | sim | mês de **competência** (vencimento): `2026-03`, `03/2026` ou "março/2026" |
| `valor_pago` | não | vazio = o valor esperado da mensalidade; informado = confere (seção 6) |
| `data_pagamento` | não | `dd/mm/aaaa`; vazio ou só mês = regra da seção 3 |
| `forma_pagamento` | não | PIX, Dinheiro, Cartão, Transferência, Boleto; vazio = "Não informado" |
| `turma`, `contrato` | não | só para desempate (seção 2) |

**Formato LARGO (aluno x mês)**: uma linha por aluno e uma coluna por mês (`jan/2026`, `fev/2026`...), célula com o valor pago, a data ou um "x". É o que o financeiro costuma ter. **Proposta:** aceitar o largo convertendo-o para o longo no cliente (`parse.ts`) antes de validar; a prévia mostra sempre o longo. Célula vazia = não pago (ignora); célula com valor = paga; célula com data = paga naquela data; "x", "ok" ou "pago" = paga no valor esperado.

## 2. Identificação do aluno e do contrato
1. Aluno por **nome normalizado** (sem acento, caixa e espaços extras) dentro da escola. Homônimo = erro de linha com a lista de candidatos (turma e nascimento mascarados); a planilha pode trazer `turma` ou `data_nascimento` para desempatar.
2. Contrato: o **contrato ativo do aluno cuja vigência cobre o mês**; havendo mais de um (a trava do bloco C evita sobreposição), é erro de linha.
3. Mensalidade: a do contrato com `due_date` no mês pedido (chave natural: `contract_id` + mês de `due_date`).

## 3. Data de pagamento só com o mês
Duas opções (DECISÃO quando houver o layout):
- (a) **recomendada:** sem dia, usa o **dia do vencimento** da mensalidade (`paid_date = due_date`): mantém o Realizado no mês certo e não inventa atraso;
- (b) usa o último dia do mês informado.
Em ambas, a prévia marca a linha com "data estimada" e o relatório final conta quantas foram. `paid_date` nunca fica no futuro (data maior que hoje = erro de linha).

## 4. Pagamento parcial
O modelo atual **não tem parcial**: `final_amount` é o valor pago, não "pago até agora". **Proposta v1:** valor menor que o esperado vira **erro de linha** ("pagamento parcial: renegocie ou informe o valor integral"), sem gravar. v2 (se o financeiro precisar): importar como baixa do valor pago mais uma nova mensalidade do saldo, ou encaminhar para a renegociação existente. Não implementar parcial sem decisão de produto (afeta Realizado, inadimplência e avisos).

## 5. Aluno que entrou no meio do ano e mensalidade inexistente
- Mês anterior ao início do contrato, ou sem mensalidade naquele mês = **erro de linha** "não há mensalidade em {mês}". A importação **nunca cria mensalidade**; quem cria é o contrato.
- Aluno sem contrato ativo no mês = erro "aluno sem contrato em {mês}", com atalho para a tela de contratos.
- Mensalidade **cancelada** ou renegociada no mês = erro, a menos que a planilha aponte a parcela da renegociação (v2).

## 6. Valor divergente do esperado
Esperado = `getTuitionValue` da mensalidade (valor do contrato, já líquido de desconto; bolsa 100% não entra, bloco H). `valor_pago` diferente do esperado:
- **maior** (multa ou juros): aceita como `penalty_amount = valor_pago - esperado`, **com aviso** na prévia;
- **menor**: parcial (seção 4) = erro, **salvo** se a coluna `desconto` justificar (aceita como `discount_applied`).
Tolerância de R$ 0,01 (a mesma de `renew_contracts`).

## 7. Reimportação idempotente
Chave natural: `(contrato, mês de vencimento)`. Para cada linha:
- mensalidade **aberta**: baixa;
- **já paga** com a mesma data e o mesmo valor: "já importada" (não conta como erro, não grava, não duplica);
- **já paga** com data ou valor diferente: **conflito**, erro de linha (a trava do bloco D impede sobrescrever; para corrigir, estornar antes).
Duas linhas da mesma planilha para a mesma mensalidade = erro das duas ("linha duplicada").

## 8. Prévia, erros por linha e total conferido
Seguir o padrão da importação de contratos: prévia com **N linhas ignoradas e o motivo de cada uma** e **quantas válidas seguem**; "a linha com erro não é importada e as válidas seguem". Acrescentar o **conferido financeiro**: total de linhas, total em R$ a baixar, total por mês, **total em R$ da planilha informado pelo usuário** (campo opcional "total da planilha") e a diferença; se o usuário informar o total e ele não bater com a soma das linhas lidas (antes dos erros), a confirmação pede revisão. O resultado final repete importadas, ignoradas, já importadas, falhas de gravação e o total baixado.

## 9. Auditoria e reversão
- RPC nova `import_tuition_payments(p_school_id, p_rows jsonb)`: `SECURITY DEFINER`, `assert_mfa_gate()` primeiro, só admin e financeiro, **`set_config('app.audit_source','import', true)`** antes dos updates (a trigger genérica grava `old_data`), lotes de até 100 linhas (cada chamada atômica, como `renew_contracts`), devolve contagens e a lista de ignoradas.
- **Reversão do lote:** estorno por linha (bloco D) ou em lote por janela de auditoria (`source='import'`, escola, ator, intervalo de tempo). **Proposta:** `batch_id` (uuid gerado no cliente e passado ao RPC) gravado em uma tabela leve `payment_import_batches (id, school_id, created_by, created_at, rows, total, file_name)`; assim "desfazer a importação X" vira um RPC `reverse_payment_import(batch_id)` que estorna só o que ainda estiver paga com os mesmos dados daquele lote. Sem o `batch_id`, o desfazer é por SQL guiado (ver `supabase/tests/reversao_matrix.sql`).

## 10. Esforço e riscos
| item | esforço |
|---|---|
| Parser longo, largo para longo, normalização de nome e de mês | 1 dia |
| Validação (aluno, contrato, mensalidade, valor, data, duplicatas, conflitos) + testes | 1,5 dia |
| RPC `import_tuition_payments` + matriz SQL (papéis, outra escola, idempotência, conflito, lote de 100) | 1,5 dia |
| Prévia, resultado e total conferido na tela + testes | 1 dia |
| Reversão por lote (`batch_id` + RPC) | 1 dia |
| **Total** | **cerca de 6 dias** (sem parcial); mais 2 a 3 dias com parcial |

Riscos: (1) **homônimos e grafias**, a maior fonte de erro (exigir desempate e mostrar candidatos); (2) **data só com mês** muda o mês do Realizado se mal escolhida (decidir a regra com o financeiro); (3) **parcial**, pedido recorrente que o modelo não suporta; (4) planilha com **totais e linhas de resumo** misturados aos alunos (detectar e ignorar com aviso); (5) importar sobre **dado já baixado à mão** (conflito da seção 7); (6) confiança excessiva na importação (exigir sempre a prévia e o total conferido); (7) reversão sem `batch_id` é manual.

## Perguntas que dependem do layout (DECISÃO do PM)
1. Formato largo ou longo? Colunas e nomes reais (aluno, mês, valor, data)?
2. A planilha traz a **data de pagamento** ou só o mês? Qual regra usar (seção 3)?
3. Há **pagamentos parciais**, multas ou descontos na planilha?
4. Os valores da planilha são **líquidos de desconto** (iguais ao contrato) ou de tabela?
5. Quantos alunos e meses (volume) e qual o período a baixar?
