# Resumo — Sprint S4c, Rematrícula, etapa 2 (interface) — 24/11/2026

Branch `feature/s4c-etapa2-interface`. Spec: `docs/superpowers/specs/2026-11-19-s4c-rematricula-design.md`. Plano: `docs/superpowers/plans/2026-11-19-s4c-etapa2-interface.md` (7 tarefas).

## O que foi feito
- **Página `/rematricula`** (menu Financeiro, logo depois de Contratos; owner, admin e financeiro):
  - lista dos contratos que terminam na janela escolhida;
  - filtros por turma, estado e busca;
  - resumo por estado;
  - decisão da família ("Contatado", "Vai renovar", "Não vai renovar" com motivo obrigatório e observação de até 500 caracteres, "Sem resposta");
  - paginação que preserva a seleção.
- **Renovação em lote** (diálogo):
  - reajuste em %, taxa de rematrícula opcional e mapa de turmas;
  - prévia editável por aluno (valor e turma);
  - aviso de capacidade, que não bloqueia;
  - envio em blocos de 100;
  - resultado com renovados, mensalidades criadas e contratos já renovados pulados;
  - em caso de falha, "Renovação interrompida" com o parcial gravado.
- **Uma regra só de mensalidades** (`src/lib/tuitionRows.ts`), extraída de `generateTuitions.ts` sem mudar o comportamento. É usada pela geração normal, pela prévia e pelo lote. O "Renovar" individual e o lote usam o mesmo cálculo de período (`nextTerm`).
- **Aviso de rematrícula:** o botão agora é "Abrir rematrícula" e leva à página nova. O texto mostra também quem não vai renovar ("6 já rematriculados · 3 não vão renovar · 9 pendentes").
- **Contratos:** o painel de renovação virou um resumo com link para a página, e ignora renovações canceladas, como a página e o servidor.
- **Testes:** 224 passando (eram 164 no início da etapa). Build ok. Cada tarefa passou por revisão, e o branch inteiro passou por uma revisão final.

## O que não foi feito / pendente
- **QA no navegador**: não executado. O roteiro está no `QA_CHECKLIST.md`, seção S4c etapa 2. A renovação em lote grava contratos de verdade, então só pode rodar na escola de teste e com autorização.
- **`supabase functions deploy send-notification-emails`**: necessário para o e-mail usar o texto novo do aviso. Não foi feito, porque é escrita em produção. O envio de e-mail está desligado, então não há impacto hoje.
- **Limites conhecidos:**
  - no máximo 1000 linhas por consulta (documentado em `renewalData.ts`);
  - `enrollments` não é atualizada pela renovação;
  - não dá para editar o motivo de um "Não vai renovar" já gravado (backlog).

## Migrations
- Nenhuma nesta etapa. O banco (etapa 1) já estava em produção.

## Roteiro de QA manual (resumo; completo no `QA_CHECKLIST.md`)
1. **Owner ou admin, na escola de teste:**
   - a página abre;
   - filtros e resumo batem com a lista;
   - "Não vai renovar" pede o motivo e tira o contrato da seleção;
   - as decisões continuam lá depois de recarregar.
2. **Lote com 2 contratos, só na escola de teste e com autorização:**
   - na prévia, conferir valores, datas e mensalidades;
   - editar o valor de uma linha;
   - trocar a turma no mapa e escolher a taxa;
   - depois de confirmar, conferir os contratos e mensalidades novos em Contratos e Mensalidades.
   - Repetir com um contrato já renovado: ele aparece como pulado.
3. **Financeiro:** abre a página, decide e renova.
4. **Professor:** não vê o item de menu, e a rota redireciona.
5. **Master visualizando outra escola:** a página lê e renova a escola visualizada. Conferir que nada aparece na escola do próprio master.
6. **375 px e tema escuro:** cabeçalho e filtros quebram linha, e a tabela e a prévia rolam dentro da caixa. O mapa de turmas do diálogo pode transbordar (conhecido).
7. **Casos de borda:**
   - renovar um contrato já vencido e ainda ativo: período no passado e mensalidades já vencidas;
   - filtrar por turma com selecionados fora do filtro: a prévia lista todos;
   - o aviso de rematrícula leva à página;
   - uma escrita manual logo depois do lote não falha (auditoria).
