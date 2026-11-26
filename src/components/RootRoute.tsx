import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useMasterAdmin } from "@/contexts/MasterAdminContext";
import Landing from "@/pages/Landing";
import { isAppHost } from "@/lib/hostRouting";

/**
 * Rota raiz: usuário logado vai para /master (master admin) ou /dashboard; visitante vê o login nos domínios do app
 * (app.classcash.com.br, class-cash-tan.vercel.app) e a landing page nos demais (classcash.com.br, www, previews, localhost).
 * `hostname` existe só para teste; em produção vale o host da janela.
 */
export function RootRoute({ hostname = window.location.hostname }: { hostname?: string }) {
  const { user, loading } = useAuth();
  const { isMasterAdmin } = useMasterAdmin();
  // Enquanto a sessão carrega não redireciona: um link com token (confirmação de e-mail) não pode perder o fragmento.
  if (loading) return null;
  if (user) return <Navigate to={isMasterAdmin ? "/master" : "/dashboard"} replace />;
  if (isAppHost(hostname)) return <Navigate to="/auth" replace />;
  return <Landing />;
}
