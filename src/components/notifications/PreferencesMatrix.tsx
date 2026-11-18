import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { EVENT_LABELS, formatOffset, type EventPreference } from '@/lib/notificationEvents';

interface Props {
  preferences: EventPreference[];
  onChange: (next: EventPreference[]) => void;
  disabled?: boolean;
}

export function PreferencesMatrix({ preferences, onChange, disabled }: Props) {
  const update = (i: number, patch: Partial<EventPreference>) =>
    onChange(preferences.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  return (
    <div className="divide-y rounded-md border">
      <div className="hidden grid-cols-[1fr_96px_120px_180px] gap-4 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:grid">
        <span>Evento</span>
        <span>No sistema</span>
        <span>E-mail</span>
        <span>Antecedência</span>
      </div>
      {preferences.map((p, i) => {
        const { label, description } = EVENT_LABELS[p.event];
        return (
          <div key={p.event} className="grid gap-3 px-4 py-4 md:grid-cols-[1fr_96px_120px_180px] md:items-center md:gap-4">
            <div>
              <p className="text-sm font-medium">{label}</p>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id={`${p.event}-in-app`}
                checked={p.inApp}
                onCheckedChange={(v) => update(i, { inApp: v })}
                disabled={disabled}
                aria-label={`${label} no sistema`}
              />
              <Label htmlFor={`${p.event}-in-app`} className="text-sm font-normal md:hidden">No sistema</Label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Switch
                id={`${p.event}-email`}
                checked={p.email}
                onCheckedChange={(v) => update(i, { email: v })}
                disabled={disabled}
                aria-label={`${label} por e-mail`}
              />
              <Label htmlFor={`${p.event}-email`} className="text-sm font-normal md:hidden">E-mail</Label>
              {p.emailRecommended && <Badge variant="secondary">Recomendado</Badge>}
            </div>
            <Select
              value={String(p.offsetDays)}
              onValueChange={(v) => update(i, { offsetDays: Number(v) })}
              disabled={disabled}
            >
              <SelectTrigger aria-label={`Antecedência: ${label}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {p.options.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {formatOffset(p.direction, n)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      })}
    </div>
  );
}
