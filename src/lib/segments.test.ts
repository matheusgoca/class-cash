import { describe, it, expect } from "vitest";
import {
  getGradeGroupsForSegments,
  ALL_GRADE_GROUPS,
  SEGMENTS,
  SEGMENT_VALUES,
  segmentLabel,
  normalizeSegments,
} from "./segments";

describe("getGradeGroupsForSegments", () => {
  it("escola sem segmento nenhum (array vazio) vê todos os grupos", () => {
    expect(getGradeGroupsForSegments([])).toEqual(ALL_GRADE_GROUPS);
  });

  it("escola sem segmento nenhum (null/undefined) também vê todos os grupos", () => {
    expect(getGradeGroupsForSegments(null)).toEqual(ALL_GRADE_GROUPS);
    expect(getGradeGroupsForSegments(undefined)).toEqual(ALL_GRADE_GROUPS);
  });

  it("só mostra os grupos dos segmentos marcados", () => {
    const groups = getGradeGroupsForSegments(["infantil", "medio"]);
    expect(groups.map((g) => g.label)).toEqual(["Educação Infantil", "Ensino Médio"]);
  });

  it("mantém a ordem pedagógica, não a ordem em que a escola marcou", () => {
    const groups = getGradeGroupsForSegments(["medio", "infantil", "fundamental_2", "fundamental_1"]);
    expect(groups.map((g) => g.label)).toEqual([
      "Educação Infantil",
      "Fundamental I",
      "Fundamental II",
      "Ensino Médio",
    ]);
  });

  it("técnico e idiomas não têm grupo de série (sem lista oficial) e não quebram a função", () => {
    const groups = getGradeGroupsForSegments(["tecnico", "idiomas"]);
    expect(groups).toEqual([]);
  });

  it("ignora valor desconhecido no array sem lançar erro", () => {
    expect(() => getGradeGroupsForSegments(["infantil", "valor_invalido_do_futuro"])).not.toThrow();
    const groups = getGradeGroupsForSegments(["infantil", "valor_invalido_do_futuro"]);
    expect(groups.map((g) => g.label)).toEqual(["Educação Infantil"]);
  });

  it("fundamental_1 e fundamental_2 cobrem 1º ao 9º ano juntos, sem sobreposição", () => {
    const groups = getGradeGroupsForSegments(["fundamental_1", "fundamental_2"]);
    const allGrades = groups.flatMap((g) => g.grades);
    expect(allGrades).toEqual(["1º Ano", "2º Ano", "3º Ano", "4º Ano", "5º Ano", "6º Ano", "7º Ano", "8º Ano", "9º Ano"]);
    expect(new Set(allGrades).size).toBe(allGrades.length);
  });
});

describe("SEGMENTS", () => {
  it("tem exatamente os 6 valores novos, sem o antigo 'fundamental' solto", () => {
    expect(SEGMENT_VALUES).toEqual(["infantil", "fundamental_1", "fundamental_2", "medio", "tecnico", "idiomas"]);
  });

  it("técnico e idiomas são marcados como secundários; os demais não", () => {
    const secondary = SEGMENTS.filter((s) => s.secondary).map((s) => s.value);
    expect(secondary).toEqual(["tecnico", "idiomas"]);
  });
});

describe("segmentLabel", () => {
  it("traduz o valor salvo pro rótulo em português", () => {
    expect(segmentLabel("fundamental_1")).toBe("Fundamental I");
  });

  it("valor desconhecido cai no próprio valor, não quebra", () => {
    expect(segmentLabel("algo_novo")).toBe("algo_novo");
  });
});

describe("normalizeSegments", () => {
  it("expande o valor antigo 'fundamental' nos dois novos", () => {
    expect(normalizeSegments(["infantil", "fundamental", "medio"])).toEqual([
      "infantil",
      "fundamental_1",
      "fundamental_2",
      "medio",
    ]);
  });

  it("devolve na ordem pedagógica, não na ordem de entrada", () => {
    expect(normalizeSegments(["medio", "infantil"])).toEqual(["infantil", "medio"]);
  });

  it("remove duplicados (ex: 'fundamental' duas vezes, ou já expandido + o antigo)", () => {
    expect(normalizeSegments(["fundamental", "fundamental_1"])).toEqual(["fundamental_1", "fundamental_2"]);
  });

  it("descarta valor desconhecido em vez de deixar passar pro banco", () => {
    expect(normalizeSegments(["infantil", "valor_invalido_do_futuro"])).toEqual(["infantil"]);
  });

  it("array vazio, null e undefined viram array vazio, sem quebrar", () => {
    expect(normalizeSegments([])).toEqual([]);
    expect(normalizeSegments(null)).toEqual([]);
    expect(normalizeSegments(undefined)).toEqual([]);
  });

  it("segmentos já no formato novo passam direto, só reordenados", () => {
    expect(normalizeSegments(["idiomas", "infantil", "tecnico"])).toEqual(["infantil", "tecnico", "idiomas"]);
  });
});
