# Class Cash

> **SaaS de gestão financeira escolar** — contratos, mensalidades, inadimplência e relatórios em um só lugar. Sem planilhas.

[![Deploy](https://img.shields.io/badge/deploy-vercel-black)](https://class-cash-tan.vercel.app)
[![Stack](https://img.shields.io/badge/stack-React%20%2B%20Supabase-blue)]()

---

## O que é o Class Cash

Class Cash é uma plataforma multi-tenant para gestão financeira de escolas particulares. O sistema centraliza o controle de contratos, geração automática de mensalidades, acompanhamento de inadimplência e visualização da saúde financeira por turma — substituindo planilhas por um painel intuitivo e sempre atualizado.

**Acesso:** [class-cash-tan.vercel.app](https://class-cash-tan.vercel.app)

---

## Funcionalidades

### Gestão escolar
- Cadastro de turmas com capacidade, mensalidade base e múltiplos professores
- Cadastro de alunos com matrícula e vínculo à turma
- Cadastro de professores com salário e especialização

### Financeiro
- Contratos por aluno com desconto percentual e dia de vencimento configurável
- Geração automática de mensalidades ao ativar um contrato
- Kanban de mensalidades por status: pendente, pago e atrasado
- Registro de pagamento com data, método e valor final

### Relatórios
- Dashboard com receita recebida, inadimplência, ocupação e gastos com salários
- Saúde financeira por turma: ocupação, receita realizada vs potencial e eficiência
- Rentabilidade por turma: receita menos custo de professores com margem percentual
- Relatório de inadimplência: lista de alunos em atraso ordenada por valor em aberto

### Multi-tenant e acesso
- Cada escola vê apenas seus próprios dados via RLS no Supabase
- Painel master para o administrador da plataforma visualizar e acessar todas as escolas
- Suporte a múltiplos usuários por escola com roles: Admin e Financeiro

---

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React + TypeScript + Vite |
| Estilização | Tailwind CSS + shadcn/ui |
| Backend / Banco | Supabase (PostgreSQL + Auth + RLS) |
| Deploy | Vercel |
| Gráficos | Recharts |

---

## Arquitetura

```
┌─────────────────────────────────────────────────────┐
│                    USUÁRIOS                         │
│  Master Admin     Admin da Escola     Financeiro    │
│  Todas as escolas Sua escola          Sua escola    │
└──────────────┬───────────────┬────────────┬─────────┘
               │               │            │
               ▼               ▼            ▼
┌─────────────────────────────────────────────────────┐
│                  SUPABASE AUTH                      │
│  profiles.school_id → escola do usuário             │
│  profiles.is_master_admin → bypass de RLS           │
│  user_roles(user_id, role) → permissões             │
└─────────────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────┐
│               FLUXO FINANCEIRO                      │
│                                                     │
│  Turma (monthly_fee)                                │
│    └── Contrato (aluno + desconto + due_day)        │
│          └── final_amount (coluna computada)        │
│                └── Tuitions (1 por mês)             │
│                      └── Pagamento                  │
└─────────────────────────────────────────────────────┘
```

### Tabelas principais

| Tabela | Descrição |
|---|---|
| `schools` | Escolas cadastradas na plataforma |
| `profiles` | Perfil do usuário com school_id e flag de master admin |
| `user_roles` | Roles por usuário (admin, financial) |
| `classes` | Turmas com capacidade e mensalidade base |
| `class_teachers` | Relacionamento N:N entre turmas e professores |
| `teachers` | Professores com salário mensal |
| `students` | Alunos matriculados |
| `enrollments` | Vínculo aluno ↔ turma |
| `contracts` | Contrato financeiro aluno ↔ escola |
| `tuitions` | Mensalidades geradas pelos contratos |

### Segurança (RLS)
Todas as tabelas têm Row Level Security habilitado. Cada usuário acessa apenas os dados da sua escola via `profiles.school_id`. O master admin tem bypass via função `is_master_admin()` com `SECURITY DEFINER` para evitar recursão.

---

## Estrutura do projeto

```
src/
├── components/
│   ├── dashboard/      # Componentes do dashboard financeiro
│   ├── ui/             # Componentes base (shadcn)
│   └── layout/         # Sidebar, header, banner master
├── contexts/
│   ├── AuthContext     # Autenticação e perfil do usuário
│   ├── SchoolContext   # Escola ativa no contexto
│   └── MasterAdminContext # Controle de acesso master
├── pages/
│   ├── Dashboard       # Painel financeiro principal
│   ├── Students        # Gestão de alunos
│   ├── Teachers        # Gestão de professores
│   ├── Classes         # Gestão de turmas
│   ├── Contracts       # Gestão de contratos
│   ├── Tuitions        # Mensalidades (kanban + tabela)
│   ├── Reports         # Relatórios financeiros
│   ├── MasterAdmin     # Painel do administrador da plataforma
│   └── Settings        # Configurações da escola
├── hooks/              # Hooks customizados
├── lib/                # Configuração do Supabase
└── types/              # Interfaces TypeScript
```

---

## Variáveis de ambiente

```env
VITE_SUPABASE_URL=sua_url_do_supabase
VITE_SUPABASE_ANON_KEY=sua_chave_anonima
```

---

## Roadmap

- [x] Motor financeiro — geração automática de tuitions
- [x] Dashboard com métricas reais
- [x] Relatório de inadimplência
- [x] Painel master multi-escola
- [ ] Renegociação de mensalidades
- [ ] Notificações por email ao responsável
- [ ] Convite de staff por email
- [ ] Importação via planilha
- [ ] Documentação técnica e de usuário

---

<p align="center">
  Class Cash — Gestão financeira escolar simplificada
</p>
