import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { DIGEST_HOURS, type DigestPreference } from '@/lib/notificationEvents';

interface Props {
  digest: DigestPreference;
  onChange: (next: DigestPreference) => void;
  disabled?: boolean;
}

export function DigestSettings({ digest, onChange, disabled }: Props) {
  return (
    <div className="flex flex-col gap-4 rounded-md border p-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex items-center gap-3">
        <Switch
          id="digest-enabled"
          checked={digest.enabled}
          onCheckedChange={(v) => onChange({ ...digest, enabled: v })}
          disabled={disabled}
        />
        <Label htmlFor="digest-enabled" className="text-sm font-medium">
          Receber um resumo diário por e-mail
        </Label>
      </div>
      <div className="w-full sm:w-40">
        <Label htmlFor="digest-time" className="mb-1 block text-sm">Horário do resumo</Label>
        <Select
          value={digest.time}
          onValueChange={(v) => onChange({ ...digest, time: v })}
          disabled={disabled || !digest.enabled}
        >
          <SelectTrigger id="digest-time">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DIGEST_HOURS.map((h) => (
              <SelectItem key={h} value={h}>{h}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
