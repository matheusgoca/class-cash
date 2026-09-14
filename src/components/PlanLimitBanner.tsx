import { AlertTriangle } from 'lucide-react';

interface PlanLimitBannerProps {
  message: string;
}

export function PlanLimitBanner({ message }: PlanLimitBannerProps) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex-wrap">
      <div className="flex items-center gap-2 text-sm text-amber-800">
        <AlertTriangle className="h-4 w-4 flex-shrink-0" />
        <span>{message}</span>
      </div>
      <a
        href="mailto:contato@classcash.com.br?subject=Upgrade%20de%20plano"
        className="text-sm font-medium text-amber-900 underline underline-offset-2 whitespace-nowrap"
      >
        Falar com vendas
      </a>
    </div>
  );
}
