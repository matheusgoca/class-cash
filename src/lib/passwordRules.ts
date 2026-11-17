export interface PasswordRule {
  id: "length" | "number" | "symbol";
  label: string;
  ok: boolean;
  required: boolean;
}

export function evaluatePassword(pw: string): { rules: PasswordRule[]; valid: boolean } {
  const rules: PasswordRule[] = [
    { id: "length", label: "Pelo menos 10 caracteres", ok: pw.length >= 10, required: true },
    { id: "number", label: "Pelo menos um número", ok: /\d/.test(pw), required: true },
    { id: "symbol", label: "Um símbolo (recomendado)", ok: /[^A-Za-z0-9]/.test(pw), required: false },
  ];
  return { rules, valid: rules.filter((r) => r.required).every((r) => r.ok) };
}
