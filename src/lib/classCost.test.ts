import { describe, it, expect } from "vitest";
import { computeClassCosts } from "./classCost";

describe("computeClassCosts", () => {
  it("divide o salário igualmente quando nem todas as turmas do professor têm weeklyHours", () => {
    const { salaryCost } = computeClassCosts(
      [{ id: "A", studentCount: 10 }, { id: "B", studentCount: 10 }],
      [
        { classId: "A", teacherId: "t1", salary: 1000, weeklyHours: 10 },
        { classId: "B", teacherId: "t1", salary: 1000, weeklyHours: null },
      ],
      []
    );
    expect(salaryCost["A"]).toBe(500);
    expect(salaryCost["B"]).toBe(500);
  });

  it("divide o salário proporcional às horas quando todas as turmas do professor têm weeklyHours", () => {
    const { salaryCost } = computeClassCosts(
      [{ id: "A", studentCount: 10 }, { id: "B", studentCount: 10 }],
      [
        { classId: "A", teacherId: "t1", salary: 1000, weeklyHours: 10 },
        { classId: "B", teacherId: "t1", salary: 1000, weeklyHours: 30 },
      ],
      []
    );
    expect(salaryCost["A"]).toBe(250);
    expect(salaryCost["B"]).toBe(750);
  });

  it("despesa com class_id é custo direto daquela turma", () => {
    const { expenseCost } = computeClassCosts(
      [{ id: "A", studentCount: 10 }, { id: "B", studentCount: 10 }],
      [],
      [{ amount: 300, classId: "A", allocationMethod: "per_class" }]
    );
    expect(expenseCost["A"]).toBe(300);
    expect(expenseCost["B"]).toBe(0);
  });

  it("despesa geral per_class é dividida igualmente entre as turmas ativas", () => {
    const { expenseCost } = computeClassCosts(
      [{ id: "A", studentCount: 10 }, { id: "B", studentCount: 30 }],
      [],
      [{ amount: 200, classId: null, allocationMethod: "per_class" }]
    );
    expect(expenseCost["A"]).toBe(100);
    expect(expenseCost["B"]).toBe(100);
  });

  it("despesa geral per_student é dividida proporcionalmente por aluno matriculado", () => {
    const { expenseCost } = computeClassCosts(
      [{ id: "A", studentCount: 10 }, { id: "B", studentCount: 30 }],
      [],
      [{ amount: 400, classId: null, allocationMethod: "per_student" }]
    );
    expect(expenseCost["A"]).toBe(100);
    expect(expenseCost["B"]).toBe(300);
  });

  it("despesa geral 'school' não entra no custo de nenhuma turma, mas soma em unallocatedSchoolCost", () => {
    const { expenseCost, unallocatedSchoolCost } = computeClassCosts(
      [{ id: "A", studentCount: 10 }, { id: "B", studentCount: 10 }],
      [],
      [
        { amount: 500, classId: null, allocationMethod: "school" },
        { amount: 150, classId: null, allocationMethod: "school" },
      ]
    );
    expect(expenseCost["A"]).toBe(0);
    expect(expenseCost["B"]).toBe(0);
    expect(unallocatedSchoolCost).toBe(650);
  });

  it("totalCost por turma é salaryCost + expenseCost, e não inclui unallocatedSchoolCost", () => {
    const { totalCost, unallocatedSchoolCost } = computeClassCosts(
      [{ id: "A", studentCount: 10 }],
      [{ classId: "A", teacherId: "t1", salary: 1000, weeklyHours: null }],
      [
        { amount: 50, classId: "A", allocationMethod: "per_class" },
        { amount: 999, classId: null, allocationMethod: "school" },
      ]
    );
    expect(totalCost["A"]).toBe(1050);
    expect(unallocatedSchoolCost).toBe(999);
  });
});
