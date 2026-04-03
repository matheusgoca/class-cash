# Arquitetura do Sistema — Class Cash

## Visão Geral

```
┌─────────────────────────────────────────────────────────────────┐
│                        USUÁRIOS                                 │
│                                                                 │
│  Master Admin          Admin da Escola       Staff              │
│  (matheusgoca)         (dono da escola)      (prof/financeiro)  │
│  Vê todas as escolas   Vê sua escola         Vê sua escola      │
└────────────┬───────────────────┬─────────────────┬─────────────┘
             │                   │                 │
             ▼                   ▼                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                     AUTENTICAÇÃO                                │
│                                                                 │
│  Supabase Auth → profiles → school_id (FK → schools.id)        │
│                                                                 │
│  Owner:   schools.owner_user_id = user.id → role admin auto     │
│  Staff:   user_roles(user_id, school_id, role)                  │
│           role: 'admin' | 'financial' | 'teacher'               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Fluxo de Cadastro de Escola

```
Novo usuário
    │
    ▼
/auth (cadastro)
    │
    ▼
profiles criado automaticamente (sem school_id)
    │
    ▼
ProtectedRoute detecta schoolStatus = 'not_found'
    │
    ▼
/onboarding
  - Nome da escola
  - Segmentos (infantil / fundamental / médio / técnico) — multi-select
    │
    ▼
INSERT schools (name, segments, owner_user_id)
UPDATE profiles SET school_id = nova_escola.id
    │
    ▼
/dashboard ✅
```

---

## Hierarquia de Papéis

```
Master Admin (plataforma)
├── Vê lista de todas as escolas
├── Pode acessar dashboard de qualquer escola
└── Gerencia planos/faturamento (futuro E2)

Admin da Escola (owner)
├── Detectado por schools.owner_user_id = user.id
├── Acesso total à sua escola
├── Cadastra professores e funcionários
├── Define turmas e valores de mensalidade
└── Vê relatórios de lucratividade

Financeiro
├── Contratos e mensalidades
├── Relatórios financeiros
└── NÃO gerencia turmas nem professores

Professor
├── Visualiza alunos da sua turma
├── NÃO acessa financeiro
└── NÃO edita dados de outros professores
```

---

## Fluxo Financeiro Completo

```
ESCOLA
  │
  ├── TURMAS (classes)
  │     ├── nome, nível, cor, capacidade
  │     ├── valor base da mensalidade
  │     └── professores vinculados (class_teachers)
  │
  ├── PROFESSORES (teachers)
  │     ├── salário fixo mensal
  │     └── custo = soma dos salários por turma
  │
  └── ALUNOS (students)
        │
        ▼
   MATRÍCULA (enrollments)
        │ student_id + class_id
        ▼
   CONTRATO (contracts)
        │ aluno + turma + valor acordado + desconto
        │
        │  valor_contrato = valor_turma × (1 - desconto%)
        │
        ▼
   MENSALIDADES (tuitions)
        │ geradas mensalmente a partir do contrato
        │ status: pending → paid | overdue
        │
        └── RECEBIMENTO
              paid_date + payment_method
              final_amount (pode diferir por multa/desconto pontualidade)
```

---

## Página de Contratos

**Objetivo:** Formalizar o acordo financeiro entre escola e responsável pelo aluno.

**Campos essenciais:**
- Aluno + turma
- Valor cheio (herdado da turma)
- Desconto (%) — bolsa, convênio, irmão, etc.
- Valor final do contrato
- Data de início / vencimento
- Dia de vencimento mensal (ex: todo dia 10)
- Status: ativo | suspenso | encerrado

**Regra:** Ao ativar um contrato, o sistema gera automaticamente as tuitions do ano letivo.

---

## Página de Mensalidades

**Objetivo:** Controle mensal de recebimentos por aluno.

**Kanban por status:**
- Pendentes (dentro do prazo)
- Atrasadas (vencimento passou, não pago)
- Pagas

**Ações:**
- Marcar como pago (+ data + método de pagamento)
- Aplicar multa/juros manualmente
- Renegociar (gerar nova tuition com valor diferente)

**Filtros:** mês, turma, status

---

## Página de Relatórios

**Objetivo:** Visão gerencial da saúde financeira da escola.

### Rentabilidade por Turma
```
Turma          | Alunos | Receita   | Custo (salários) | Lucro    | Margem
Ensino Fund. A |   25   | R$12.500  | R$4.200          | R$8.300  | 66%
Ensino Fund. B |   22   | R$11.000  | R$4.200          | R$6.800  | 62%
```

### Receita vs Custo (últimos 6 meses)
- Receita = mensalidades pagas no período
- Custo = soma dos salários dos professores ativos

### Inadimplência
- % de alunos com mensalidades atrasadas
- Valor total em aberto
- Ranking de inadimplentes

### Lucratividade da Escola
```
Receita bruta (mensalidades emitidas)
- Descontos concedidos
= Receita líquida esperada
- Inadimplência
= Receita realizada
- Custo fixo (salários)
= Resultado operacional
```

---

## Matrícula vs Contrato

| Conceito    | O que é                              | Tabela        |
|-------------|--------------------------------------|---------------|
| Matrícula   | Vínculo aluno ↔ turma               | enrollments   |
| Contrato    | Acordo financeiro aluno ↔ escola     | contracts     |
| Mensalidade | Parcela mensal gerada pelo contrato  | tuitions      |

> Um aluno pode trocar de turma (nova matrícula) mantendo o mesmo contrato, ou ter o contrato renegociado sem trocar de turma.

---

## Descontos

**Tipos comuns:**
- Bolsa social (50–100%)
- Desconto de pontualidade (5–10%) — aplicado na tuition
- Desconto irmão (10–20%)
- Convênio empresa (fixo ou %)

**Como funciona no sistema:**
1. Contrato define desconto base → `contracts.discount_percent`
2. Valor final = `valor_turma × (1 - desconto/100)` → `contracts.final_value`
3. Mensalidade gerada com `final_value` como base
4. Desconto de pontualidade pode ser aplicado na hora do pagamento → `tuitions.final_amount`

---

## Lucratividade por Sala — Como Calcular

```
Receita da turma = Σ mensalidades pagas dos alunos dessa turma
Custo da turma   = Σ salários dos professores vinculados à turma

Lucro bruto = Receita - Custo
Margem %    = (Lucro / Custo) × 100

Atenção: professor que dá aula em 2 turmas
→ rateio do salário proporcionalmente às aulas
→ (simplificação atual: salário completo por turma)
```

---

## Próximos Passos Técnicos

| Etapa | O que falta                                              | Status     |
|-------|----------------------------------------------------------|------------|
| E1    | Produto solidificado                                     | ✅ Completo |
| E3    | Landing page SaaS                                        | ✅ Completo |
| E2    | Multi-tenant: school_id em todas as tabelas + RLS        | 🔄 Parcial  |
|       | - Geração automática de tuitions ao ativar contrato      | ⏳ Pendente |
|       | - Renegociação de mensalidades                           | ⏳ Pendente |
|       | - Relatório de inadimplência                             | ⏳ Pendente |
|       | - Convite de staff (prof/financeiro) por email           | ⏳ Pendente |
|       | - Master admin: visão de todas as escolas                | ⏳ Pendente |
