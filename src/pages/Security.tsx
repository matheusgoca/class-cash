import { PasswordChangeFlow } from '@/components/settings/PasswordChangeFlow';
import { TwoFactorCard } from '@/components/security/TwoFactorCard';

/** Segurança da conta: pessoal, vale para todos os papéis (inclusive master). */
const Security = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Segurança da conta</h1>
        <p className="text-muted-foreground">Senha e verificação em duas etapas da sua conta</p>
      </div>
      <div className="grid gap-6 max-w-3xl">
        <TwoFactorCard />
        <PasswordChangeFlow />
      </div>
    </div>
  );
};

export default Security;
