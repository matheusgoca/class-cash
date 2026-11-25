# Ensaio geral do financeiro (25/11/2026)

Objetivo: garantir que o que o financeiro fará no Colégio Pensar já funciona nas escolas de teste (Colegio Teste e Colégio Estrela).
Método: diagnóstico em leitura, reconciliação por SQL independente, fluxos ponta a ponta em `BEGIN … ROLLBACK`. **Nenhuma escrita** em escola alguma; no Pensar só contagens agregadas (sem nomes nem valores individuais).
Limite: sem navegador nesta sessão. As telas foram lidas no código; os fluxos foram exercitados direto nas RPCs e tabelas, como admin e como financeiro.

Scripts versionados: `supabase/tests/ensaio_matrix.sql` (35 verificações) e `supabase/tests/reversao_matrix.sql` (18 verificações). Ambos escolhem as personas por consulta (escola de casa do master), rodam em `BEGIN … ROLLBACK` e imprimem uma linha por verificação (`ok` deve ser `true` em todas). As linhas marcadas `LACUNA` registram o comportamento atual e indesejado conhecido: devem ser invertidas quando o bloco que corrige a lacuna entrar.

## 1. Estado atual

| | Teste | Estrela |
|---|---|---|
| Turmas / alunos | 9 / 86 (84 ativos) | 9 / 240 |
| Contratos | 87 (85 ativos, 2 cancelados) | 240 |
| Mensalidades | 965 (734 vencidas, 113 pagas, 29 canceladas) | 2.642 (162 vencidas, 2.238 pagas) |
| Despesas | 64 | 18 |
| Alunos sem contato de responsável | 83 de 86 | 240 de 240 |
| Órfãos, contratos sem mensalidade | 0 | 0 |

- Não existe tabela de responsáveis, só `students.guardian_contact`.
- **Teste:** 5 pares de mensalidades duplicadas (R$ 1.200 original ainda vencida + parcela de R$ 600 de uma renegociação antiga de abril; hoje a renegociação cancela as originais); 1 mensalidade cancelada com `paid_date`; 1 aluno com 2 contratos ativos (o antigo e o renovado); 3 contratos ativos com fim vencido; 2 contratos cancelados com mensalidades abertas; fixtures (turma "Teste Capacidade", um professor de teste).
- **Estrela:** limpa. Nota: 1.895 mensalidades pagas sem `final_amount` (o app usa `amount`; sem efeito).
- **Pensar (só agregados):** 13 turmas (todas só meio período, com valor e capacidade), 201 alunos ativos, 17 professores com salário, **0** contratos, mensalidades, despesas e **categorias de despesa**; `class_teachers` = 0; 0 alunos com contato de responsável; 1 admin e 2 financeiros; 2FA opcional.

## 2. Reconciliação
SQL independente x funções reais do front (`calculateMonthlyBalance`, `getTuitionValue`, `isTuitionOverdue`): 72 meses, 8 métricas por mês, **0 divergências**. Repetido sobre as linhas do próprio ensaio: 0 divergências.

Mês corrente (novembro): Estrela com Realizado R$ 89.938,40, Previsto R$ 205.381,90 e inadimplência de 48,4% (dado semeado); Teste com Realizado −R$ 22.492,01, Previsto R$ 44.030,49 e inadimplência de 100%.

Divergências entre telas (não de conta):
- O gráfico de 6 meses soma só mensalidades; o cartão "Receita Recebida" soma também serviços. Na Teste, o gráfico fica R$ 3.300 a 3.940 abaixo do cartão em jun–set.
- A distribuição de alunos por turma usa `enrollments` e diverge dos contratos ativos em 3 turmas da Teste (±1); o lote de rematrícula não atualiza `enrollments`.

## 3 e 4. Fluxos e casos de borda
Funciona: matrícula com desconto (15% = R$ 850,00), centavos (333,33 com 10% = 300,00; 1.234,57 com 12,5% = 1.080,25), vencimento dia 31, baixa com desconto e com multa (admin e financeiro), renegociação (originais canceladas, sem duplicata), lote de renovação (prévia = servidor; repetir não duplica; servidor recusa valor acima do teto), despesa recorrente e baixa, rateio de custo com turma sem alunos (sem NaN), excluir aluno ou turma com contrato (FK recusa), aluno sem responsável.

Quebra ou confunde:
1. **Editar o valor do contrato não propaga** para as mensalidades abertas (continuam com o valor antigo).
2. **Contrato ativo duplicado e sobreposto** do mesmo aluno é aceito (cobrança em dobro).
3. **Prévia do lote** mostra o total **bruto** (R$ 6.319,76 contra R$ 4.471,17 líquido no ensaio).
4. **Bolsa 100%:** as mensalidades de R$ 0 viram "vencidas" e entram na inadimplência e nos avisos.
5. **Matrícula retroativa** já nasce com mensalidades vencidas.
6. **Baixa dupla** é aceita pelo banco e sobrescreve `paid_date`.
7. **Contrato de origem** continua `active` depois de renovado (desenho atual): superconta a capacidade nos lotes seguintes.
8. **Sem CHECK no banco:** aceita desconto de 120% (`final_amount` −200), valor 0 ou negativo, fim antes do início, vencimento 0 ou 45. O formulário trava desconto e dia (1–28), aceita valor 0 e não valida fim antes do início.
9. Irmãos: não existe vínculo nem desconto de irmãos.

## 5. Prioridades
**Bloqueia a entrada no Pensar:** (1) o Pensar não tem categorias de despesa (`category_id` é obrigatório, não há categorias padrão e só o admin cria); (2) não há como desfazer pela tela (estornar baixa, excluir mensalidade ou contrato); (3) edição de valor não propaga; (4) contrato ativo duplicado sem trava.
**Pode esperar:** total bruto da prévia, gráfico sem serviços, `enrollments`, origem do contrato ativa após renovar, CHECKs no banco, baixa dupla, limpeza das fixtures da Teste. Bolsa 100% vira confusão real se o Pensar tiver bolsistas integrais.

## Roteiro da sessão com o financeiro
1. Antes (dev): o admin cria as categorias de despesa; foto das contagens do Pensar.
2. Turmas e alunos: conferir 201 alunos contra a lista do financeiro, por turma.
3. Professores: vincular às turmas (horas semanais se houver); conferir a soma de salários com a folha.
4. Contratos, piloto com 3 alunos (sem desconto, com desconto, com centavos): conferir `final_amount`, 12 mensalidades e a soma.
5. Contratos em lote por planilha (turmas só com meio período: `valor_mensalidade` pode ficar vazio): conferir ignoradas, "contratos = alunos" e nenhum aluno com 2 ativos.
6. Mensalidades: decidir a data de início de quem entra no meio do ano (a mensalidade nasce vencida); conferir o Previsto do mês.
7. Baixas, uma a uma (não há baixa em lote no código); conferir o Realizado do mês.
8. Despesas: moldes recorrentes e baixas; conferir Previsto e Realizado.
9. Fechamento: dashboard contra a planilha do financeiro.

## Plano de reversão (validado em `reversao_matrix.sql`)
O baseline do Pensar é conhecido (0 contratos, mensalidades, despesas e categorias), então o reset total é simples. Sempre `BEGIN`, `SELECT` de contagem antes, filtro por `school_id` e conferência antes do `COMMIT`.
- **Baixa errada:** voltar `status='pending'` e limpar `paid_date`, `final_amount` e `payment_method` (admin e financeiro conseguem).
- **Contrato errado ou duplicado:** apagar as mensalidades e depois o contrato (ordem obrigatória por causa da FK; estornar antes se houver paga).
- **Lote de renovação:** apagar as mensalidades e depois os sucessores; a origem segue ativa.
- **Importação errada:** localizar por `audit_logs` (`source='import'`, escola, janela de tempo) e apagar (testado com contratos).
- **Auditoria:** guarda `old_data` do que foi apagado e é append-only (nem admin apaga ou altera).
- **Não testado:** desfazer renegociação (cancelar as parcelas novas e reabrir as originais) e desfazer despesa recorrente.
