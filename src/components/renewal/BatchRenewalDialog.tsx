// src/components/renewal/BatchRenewalDialog.tsx  (STUB da Task 5; substituído na Task 6)
import type { RenewalClass, RenewalContract } from '@/lib/renewal';
import type { RenewalService } from '@/lib/renewalData';

export interface BatchRenewalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sources: RenewalContract[];
  classes: RenewalClass[];
  activeByClass: Record<string, number>;
  services: RenewalService[];
  schoolId: string;
  onDone: () => void; // recarrega a lista depois de renovar
}

export function BatchRenewalDialog(_props: BatchRenewalDialogProps) {
  return null;
}
