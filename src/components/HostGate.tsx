import { useEffect, type ReactNode } from "react";
import { appRedirectTarget, type LocationParts } from "@/lib/hostRouting";

/**
 * Domínio único do app: em classcash.com.br e www.classcash.com.br, qualquer rota que não seja página da LP
 * ("/", "/privacidade", "/termos") vai para https://app.classcash.com.br com o mesmo caminho, query e hash.
 * Fica fora do BrowserRouter para não montar sessão nem providers antes de sair. `location` e `replace` existem
 * só para teste; em produção valem a janela e `window.location.replace`.
 */
export function HostGate({
  children,
  location = window.location,
  replace = (url: string) => window.location.replace(url),
}: {
  children: ReactNode;
  location?: LocationParts;
  replace?: (url: string) => void;
}) {
  const target = appRedirectTarget(location);
  useEffect(() => {
    if (target) replace(target);
  }, [target, replace]);
  return target ? null : <>{children}</>;
}
