/**
 * Rateio de custo por turma — usado tanto no relatório de Rentabilidade
 * quanto no card de Saúde da Turma no Dashboard, para os dois nunca
 * divergirem no critério de cálculo.
 *
 * Duas fontes de custo por turma:
 *  1. Salário de professor — dividido igualmente entre as turmas em que
 *     ele leciona (evita contar o salário inteiro em cada turma quando um
 *     professor dá aula em mais de uma).
 *  2. Despesas — uma despesa com `class_id` preenchido é custo direto
 *     daquela turma. Uma despesa geral (class_id nulo) é rateada conforme
 *     `allocation_method` da categoria:
 *       - 'school'      → custo geral da escola, NÃO entra no custo por turma
 *       - 'per_class'   → dividido igualmente entre todas as turmas ativas
 *       - 'per_student' → dividido proporcionalmente por aluno matriculado
 */

export interface ClassCostClassInput {
  id: string;
  studentCount: number;
}

export interface ClassCostTeacherAssignment {
  classId: string;
  teacherId: string;
  salary: number;
}

export interface ClassCostExpenseInput {
  amount: number;
  classId: string | null;
  allocationMethod: 'school' | 'per_class' | 'per_student';
}

export interface ClassCostResult {
  salaryCost: Record<string, number>;
  expenseCost: Record<string, number>;
  totalCost: Record<string, number>;
}

export function computeClassCosts(
  classes: ClassCostClassInput[],
  teacherAssignments: ClassCostTeacherAssignment[],
  expenses: ClassCostExpenseInput[]
): ClassCostResult {
  const salaryCost: Record<string, number> = {};
  const expenseCost: Record<string, number> = {};
  for (const cls of classes) {
    salaryCost[cls.id] = 0;
    expenseCost[cls.id] = 0;
  }

  // 1. Salário — cada professor divide seu salário pelo nº de turmas em que dá aula
  const classCountByTeacher: Record<string, number> = {};
  for (const a of teacherAssignments) {
    classCountByTeacher[a.teacherId] = (classCountByTeacher[a.teacherId] || 0) + 1;
  }
  for (const a of teacherAssignments) {
    const classCount = classCountByTeacher[a.teacherId] || 1;
    if (salaryCost[a.classId] === undefined) salaryCost[a.classId] = 0;
    salaryCost[a.classId] += a.salary / classCount;
  }

  // 2. Despesas — diretas (class_id preenchido) ou rateadas (class_id nulo)
  const totalStudents = classes.reduce((s, c) => s + c.studentCount, 0);
  const activeClassCount = classes.length;

  for (const e of expenses) {
    if (e.classId) {
      if (expenseCost[e.classId] === undefined) expenseCost[e.classId] = 0;
      expenseCost[e.classId] += e.amount;
      continue;
    }
    if (e.allocationMethod === 'school') continue; // custo geral, fora do rateio por turma
    if (e.allocationMethod === 'per_class') {
      if (activeClassCount === 0) continue;
      const share = e.amount / activeClassCount;
      for (const cls of classes) expenseCost[cls.id] += share;
    } else if (e.allocationMethod === 'per_student') {
      if (totalStudents === 0) continue;
      for (const cls of classes) {
        expenseCost[cls.id] += e.amount * (cls.studentCount / totalStudents);
      }
    }
  }

  const totalCost: Record<string, number> = {};
  for (const cls of classes) {
    totalCost[cls.id] = (salaryCost[cls.id] || 0) + (expenseCost[cls.id] || 0);
  }

  return { salaryCost, expenseCost, totalCost };
}
