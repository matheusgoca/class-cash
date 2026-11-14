import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { SEGMENTS } from "@/lib/segments";

interface SegmentPickerProps {
  selected: string[];
  primary: string | null;
  onChange: (selected: string[], primary: string | null) => void;
}

/**
 * Seleção de segmentos (S2, Fase 2): marca vários, um principal. Compartilhado
 * entre Onboarding e Configurações — antes cada tela tinha sua própria lista
 * de segmentos (valores antigos, sem conceito de principal).
 */
export function SegmentPicker({ selected, primary, onChange }: SegmentPickerProps) {
  const toggle = (value: string) => {
    const isSelected = selected.includes(value);
    if (isSelected) {
      const nextSelected = selected.filter((v) => v !== value);
      const nextPrimary = primary === value ? nextSelected[0] ?? null : primary;
      onChange(nextSelected, nextPrimary);
    } else {
      const nextSelected = [...selected, value];
      onChange(nextSelected, primary ?? value);
    }
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {SEGMENTS.map((seg) => {
        const isSelected = selected.includes(seg.value);
        const isPrimary = primary === seg.value;
        const Icon = seg.icon;
        return (
          <div
            key={seg.value}
            role="button"
            tabIndex={0}
            onClick={() => toggle(seg.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggle(seg.value);
              }
            }}
            className={cn(
              "flex flex-col items-start gap-1 rounded-xl border-2 p-3 text-left transition-all cursor-pointer",
              isSelected ? "border-primary bg-primary/5 shadow-sm" : "border-border hover:border-primary/40 hover:bg-accent",
            )}
          >
            <div className="flex items-center justify-between w-full gap-2">
              <Icon className={cn("h-4 w-4", isSelected ? "text-primary" : "text-muted-foreground")} />
              {isPrimary ? (
                <Badge className="bg-primary text-primary-foreground hover:bg-primary">Principal</Badge>
              ) : seg.secondary ? (
                <Badge variant="secondary">Secundário</Badge>
              ) : null}
            </div>
            <span className={cn("text-xs font-semibold leading-tight", isSelected ? "text-primary" : "")}>
              {seg.label}
            </span>
            <span className="text-xs text-muted-foreground leading-tight">{seg.description}</span>
            {isSelected && !isPrimary && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(selected, seg.value);
                }}
                className="text-xs text-primary underline mt-1"
              >
                Tornar principal
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
