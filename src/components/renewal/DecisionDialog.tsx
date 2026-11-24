// src/components/renewal/DecisionDialog.tsx
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { REASON_LABELS, type DecisionReason, type RenewalContract } from '@/lib/renewal';

interface Props {
  contract: RenewalContract | null;
  saving: boolean;
  onConfirm: (reason: DecisionReason, note: string) => void;
  onCancel: () => void;
}

export function DecisionDialog({ contract, saving, onConfirm, onCancel }: Props) {
  const [reason, setReason] = useState<DecisionReason | ''>('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (contract) { setReason(''); setNote(''); }
  }, [contract]);

  return (
    <Dialog open={!!contract} onOpenChange={(o) => { if (!o && !saving) onCancel(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Não vai renovar</DialogTitle>
          <DialogDescription>
            {contract ? `Registre por que a família de ${contract.student_name} não vai renovar. O contrato continua ativo até o fim.` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="renewal-reason">Motivo</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as DecisionReason)}>
              <SelectTrigger id="renewal-reason" aria-label="Motivo">
                <SelectValue placeholder="Escolha o motivo" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(REASON_LABELS) as DecisionReason[]).map((r) => (
                  <SelectItem key={r} value={r}>{REASON_LABELS[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="renewal-note">Observação (opcional)</Label>
            <Textarea id="renewal-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} rows={3} />
            <p className="text-xs text-muted-foreground">{note.length}/500</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={saving}>Cancelar</Button>
          <Button onClick={() => reason && onConfirm(reason, note)} disabled={!reason || saving}>
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
