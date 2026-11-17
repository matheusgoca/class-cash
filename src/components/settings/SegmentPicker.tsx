import { cn } from "@/lib/utils";
import { SEGMENTS } from "@/lib/segments";

interface SegmentPickerProps {
  selected: string[];
  onChange: (selected: string[]) => void;
}

/**
 * Seleção de segmentos atendidos pela escola (marca quantos quiser).
 * Compartilhado entre Onboarding e Configurações — antes cada tela tinha sua
 * própria lista de segmentos.
 */
export function SegmentPicker({ selected, onChange }: SegmentPickerProps) {
  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {SEGMENTS.map((seg) => {
        const isSelected = selected.includes(seg.value);
        const Icon = seg.icon;
        return (
          <div
            key={seg.value}
            role="button"
            tabIndex={0}
            aria-pressed={isSelected}
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
            <Icon className={cn("h-4 w-4", isSelected ? "text-primary" : "text-muted-foreground")} />
            <span className={cn("text-xs font-semibold leading-tight", isSelected ? "text-primary" : "")}>
              {seg.label}
            </span>
            <span className="text-xs text-muted-foreground leading-tight">{seg.description}</span>
          </div>
        );
      })}
    </div>
  );
}
