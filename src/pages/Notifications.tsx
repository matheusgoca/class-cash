import { Link } from 'react-router-dom';
import { Bell, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/** Central de notificações. Por enquanto só o estado vazio: o gerador entra nos próximos passos da S3. */
const Notifications = () => (
  <div className="space-y-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Notificações</h1>
        <p className="text-muted-foreground">Lembretes de cobrança, renegociação, despesas e rematrícula</p>
      </div>
      <Button variant="outline" asChild>
        <Link to="/notificacoes/preferencias">
          <SlidersHorizontal className="mr-2 h-4 w-4" />
          Preferências
        </Link>
      </Button>
    </div>

    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Bell className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        </div>
        <p className="font-medium">Nenhuma notificação ainda.</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Os avisos começam a aparecer aqui nas próximas versões.
        </p>
        <Button variant="link" asChild>
          <Link to="/notificacoes/preferencias">Ajustar preferências</Link>
        </Button>
      </CardContent>
    </Card>
  </div>
);

export default Notifications;
