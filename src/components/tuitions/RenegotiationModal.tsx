import { useState, useEffect } from "react";
import { addMonths, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

interface OverdueTuition {
  id: string;
  amount: number;
  final_amount: number | null;
  due_date: string;
  contract_id: string | null;
}

interface RenegotiationModalProps {
  studentId: string;
  studentName: string;
  schoolId: string;
  onSuccess: () => void;
  onClose: () => void;
}

export function RenegotiationModal({
  studentId,
  studentName,
  schoolId,
  onSuccess,
  onClose,
}: RenegotiationModalProps) {
  const { toast } = useToast();
  const { user } = useAuth();

  const [overdueTuitions, setOverdueTuitions] = useState<OverdueTuition[]>([]);
  const [loadingTuitions, setLoadingTuitions] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const today = format(new Date(), "yyyy-MM-dd");
  const [newInstallmentAmount, setNewInstallmentAmount] = useState("");
  const [installments, setInstallments] = useState("1");
  const [firstDueDate, setFirstDueDate] = useState(today);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    fetchOverdueTuitions();
  }, [studentId, schoolId]);

  const fetchOverdueTuitions = async () => {
    setLoadingTuitions(true);
    const { data, error } = await supabase
      .from("tuitions")
      .select("id, amount, final_amount, due_date, contract_id")
      .eq("student_id", studentId)
      .eq("school_id", schoolId)
      .eq("status", "pending")
      .lt("due_date", today)
      .order("due_date");

    if (error) {
      toast({ title: "Erro", description: "Não foi possível carregar mensalidades em atraso.", variant: "destructive" });
    } else {
      setOverdueTuitions(data || []);
    }
    setLoadingTuitions(false);
  };

  const originalAmount = overdueTuitions.reduce(
    (sum, t) => sum + Number(t.final_amount ?? t.amount),
    0
  );

  const parsedInstallmentAmount = parseFloat(newInstallmentAmount.replace(",", ".")) || 0;
  const parsedInstallments = Math.max(1, parseInt(installments) || 1);
  const totalRenegotiated = parsedInstallmentAmount * parsedInstallments;

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

  const errors: string[] = [];
  if (parsedInstallmentAmount <= 0) errors.push("Informe o valor por parcela.");
  if (totalRenegotiated < originalAmount)
    errors.push(
      `Total renegociado (${formatCurrency(totalRenegotiated)}) deve ser ≥ valor em atraso (${formatCurrency(originalAmount)}).`
    );
  if (firstDueDate < today) errors.push("Data da primeira parcela deve ser hoje ou futura.");

  const handleSubmit = async () => {
    if (errors.length > 0 || overdueTuitions.length === 0) return;
    setSubmitting(true);

    try {
      // 1. Insert renegotiation record
      const { data: reneg, error: renegError } = await supabase
        .from("renegotiations")
        .insert({
          student_id: studentId,
          school_id: schoolId,
          original_amount: originalAmount,
          new_installment_amount: parsedInstallmentAmount,
          installments: parsedInstallments,
          total_renegotiated: totalRenegotiated,
          first_due_date: firstDueDate,
          notes: notes.trim() || null,
          created_by: user?.id ?? null,
        })
        .select("id")
        .single();

      if (renegError) throw renegError;

      // 2. Cancel all overdue tuitions, linking to this renegotiation
      const { error: cancelError } = await supabase
        .from("tuitions")
        .update({ status: "cancelled", renegotiation_id: reneg.id })
        .in("id", overdueTuitions.map((t) => t.id));

      if (cancelError) throw cancelError;

      // 3. Generate new tuitions
      const contractId = overdueTuitions[0]?.contract_id ?? null;
      const firstDate = new Date(firstDueDate + "T12:00:00"); // noon avoids DST edge
      const newTuitions = Array.from({ length: parsedInstallments }, (_, i) => {
        const dueDate = addMonths(firstDate, i);
        return {
          student_id: studentId,
          school_id: schoolId,
          contract_id: contractId,
          amount: parsedInstallmentAmount,
          final_amount: parsedInstallmentAmount,
          due_date: format(dueDate, "yyyy-MM-dd"),
          status: "pending",
          description: `Parcela renegociada ${i + 1}/${parsedInstallments}`,
          renegotiation_id: reneg.id,
          category: "tuition",
          discount_applied: 0,
          penalty_amount: 0,
        };
      });

      const { error: insertError } = await supabase.from("tuitions").insert(newTuitions);
      if (insertError) throw insertError;

      toast({ title: "Renegociação registrada!", description: `${parsedInstallments} nova(s) parcela(s) gerada(s).` });
      onSuccess();
    } catch (err: any) {
      console.error("Renegotiation error:", err);
      toast({ title: "Erro", description: err.message ?? "Erro ao registrar renegociação.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Renegociar mensalidades — {studentName}</DialogTitle>
        </DialogHeader>

        {loadingTuitions ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : overdueTuitions.length === 0 ? (
          <p className="text-center py-6 text-muted-foreground">
            Nenhuma mensalidade em atraso encontrada para este aluno.
          </p>
        ) : (
          <div className="space-y-5">
            {/* Read-only summary */}
            <div className="rounded-lg bg-red-50 border border-red-200 p-4 space-y-1">
              <p className="text-sm font-medium text-red-700">Mensalidades em atraso</p>
              <p className="text-2xl font-bold text-red-600">{formatCurrency(originalAmount)}</p>
              <p className="text-xs text-red-500">
                {overdueTuitions.length} parcela{overdueTuitions.length !== 1 ? "s" : ""} ·{" "}
                mais antiga em{" "}
                {format(new Date(overdueTuitions[0].due_date + "T12:00:00"), "MMM yyyy", { locale: ptBR })}
              </p>
            </div>

            {/* Form */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="installment-amount">Valor por parcela (R$)</Label>
                <Input
                  id="installment-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="0,00"
                  value={newInstallmentAmount}
                  onChange={(e) => setNewInstallmentAmount(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="installments">Número de parcelas</Label>
                <Input
                  id="installments"
                  type="number"
                  min="1"
                  step="1"
                  value={installments}
                  onChange={(e) => setInstallments(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="first-due-date">Data da primeira parcela</Label>
              <Input
                id="first-due-date"
                type="date"
                min={today}
                value={firstDueDate}
                onChange={(e) => setFirstDueDate(e.target.value)}
              />
            </div>

            {/* Preview */}
            {parsedInstallmentAmount > 0 && (
              <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">
                <span className="font-medium">
                  {parsedInstallments}x de {formatCurrency(parsedInstallmentAmount)}
                </span>{" "}
                = <span className="font-bold">{formatCurrency(totalRenegotiated)} total</span>
                {totalRenegotiated >= originalAmount && (
                  <span className="ml-2 text-green-700 font-medium">
                    (+{formatCurrency(totalRenegotiated - originalAmount)} em relação ao débito)
                  </span>
                )}
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="notes">Observação do acordo (opcional)</Label>
              <Textarea
                id="notes"
                placeholder="Ex: Acordo verbal com responsável em 07/04/2026"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
              />
            </div>

            {/* Validation errors */}
            {errors.length > 0 && (
              <ul className="text-sm text-red-600 space-y-0.5">
                {errors.map((e, i) => (
                  <li key={i}>• {e}</li>
                ))}
              </ul>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose} disabled={submitting}>
                Cancelar
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={submitting || errors.length > 0}
              >
                {submitting ? "Registrando..." : "Confirmar renegociação"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
