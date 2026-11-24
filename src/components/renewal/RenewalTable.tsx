// src/components/renewal/RenewalTable.tsx
import { format, parseISO } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency } from '@/lib/calculations';
import { STATE_LABELS, type RenewalContract, type RenewalState } from '@/lib/renewal';

export interface RenewalRowData { contract: RenewalContract; state: RenewalState }

interface Props {
  rows: RenewalRowData[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onTogglePage: (ids: string[], checked: boolean) => void;
  onChangeState: (c: RenewalContract, s: RenewalState) => void;
}

const EDITABLE: RenewalState[] = ['none', 'contacted', 'will_renew', 'will_not_renew'];
const selectable = (s: RenewalState) => s !== 'renewed' && s !== 'will_not_renew';

export function RenewalTable({ rows, selected, onToggle, onTogglePage, onChangeState }: Props) {
  const selectableIds = rows.filter((r) => selectable(r.state)).map((r) => r.contract.id);
  const allChecked = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">
            <Checkbox
              aria-label="Selecionar todos desta página"
              checked={allChecked}
              disabled={selectableIds.length === 0}
              onCheckedChange={(v) => onTogglePage(selectableIds, v === true)}
            />
          </TableHead>
          <TableHead>Aluno</TableHead>
          <TableHead>Turma</TableHead>
          <TableHead>Término</TableHead>
          <TableHead>Valor atual</TableHead>
          <TableHead className="w-[190px]">Estado</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ contract: c, state }) => (
          <TableRow key={c.id}>
            <TableCell>
              <Checkbox
                aria-label={`Selecionar ${c.student_name}`}
                checked={selected.has(c.id)}
                disabled={!selectable(state)}
                onCheckedChange={() => onToggle(c.id)}
              />
            </TableCell>
            <TableCell className="font-medium">{c.student_name}</TableCell>
            <TableCell>{c.class_name ?? 'Sem turma'}</TableCell>
            <TableCell>{format(parseISO(c.end_date), 'dd/MM/yyyy')}</TableCell>
            <TableCell>{formatCurrency(c.monthly_amount)}</TableCell>
            <TableCell>
              {state === 'renewed' ? (
                <Badge variant="secondary">{STATE_LABELS.renewed}</Badge>
              ) : (
                <Select value={state} onValueChange={(v) => onChangeState(c, v as RenewalState)}>
                  <SelectTrigger aria-label={`Estado de ${c.student_name}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EDITABLE.map((s) => (
                      <SelectItem key={s} value={s}>{STATE_LABELS[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
