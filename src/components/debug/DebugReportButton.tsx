import { useState } from 'react';
import { Bug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRole } from '@/hooks/use-role';
import { DebugReportSheet } from './DebugReportSheet';

export function DebugReportButton() {
  const { hasRole } = useRole();
  const [open, setOpen] = useState(false);

  if (!hasRole('admin', 'financial')) return null;

  return (
    <>
      <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setOpen(true)}>
        <Bug className="h-4 w-4" />
        <span className="sr-only">Reportar um problema</span>
      </Button>
      <DebugReportSheet open={open} onOpenChange={setOpen} />
    </>
  );
}
