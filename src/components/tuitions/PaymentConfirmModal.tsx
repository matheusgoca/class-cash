import { useState } from "react";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface PaymentConfirmData {
  paid_date: string;
  payment_method: string;
}

interface PaymentConfirmModalProps {
  studentName: string;
  description: string;
  amount: number;
  onConfirm: (data: PaymentConfirmData) => void;
  onCancel: () => void;
}

const PAYMENT_METHODS = ["PIX", "Dinheiro", "Cartão de Débito", "Cartão de Crédito", "Transferência", "Boleto"];

export function PaymentConfirmModal({ studentName, description, amount, onConfirm, onCancel }: PaymentConfirmModalProps) {
  const [paidDate, setPaidDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [paymentMethod, setPaymentMethod] = useState("");

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

  return (
    <Dialog open onOpenChange={onCancel}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Registrar Pagamento</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <p className="text-sm font-medium">{studentName}</p>
            <p className="text-sm text-muted-foreground">{description}</p>
            <p className="text-lg font-semibold mt-1">{formatCurrency(amount)}</p>
          </div>
          <div className="space-y-2">
            <Label>Data de pagamento</Label>
            <Input
              type="date"
              value={paidDate}
              onChange={e => setPaidDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Forma de pagamento</Label>
            <Select value={paymentMethod || "none"} onValueChange={v => setPaymentMethod(v === "none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Não informado</SelectItem>
                {PAYMENT_METHODS.map(m => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancelar</Button>
          <Button onClick={() => onConfirm({ paid_date: paidDate, payment_method: paymentMethod })}>
            Confirmar Pagamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
