// Roteamento por domínio (S6): o mesmo projeto Vercel serve a LP e o app em domínios diferentes.
//  - app.classcash.com.br e class-cash-tan.vercel.app = APP: o visitante cai no login (/auth);
//  - classcash.com.br, www.classcash.com.br, previews da Vercel e localhost = LP em "/" (como sempre foi).
// A decisão é por lista EXPLÍCITA e match EXATO: nunca por sufixo ou prefixo (app.classcash.com.br.evil.com não é app).
export const APP_HOSTS: readonly string[] = ['app.classcash.com.br', 'class-cash-tan.vercel.app'];

/** Normaliza o host: minúsculas, sem porta e sem o ponto final de FQDN. */
function normalizeHost(raw: string): string {
  return raw.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
}

/** O host é um dos domínios do app? Aceita `window.location.hostname` ou `host` (com porta). */
export function isAppHost(hostname: string): boolean {
  if (typeof hostname !== 'string') return false;
  return APP_HOSTS.includes(normalizeHost(hostname));
}

// ---- Domínio único do app -------------------------------------------------------------------------------------
// O CORS das Edge Functions só aceita as origens do app. Quem abre uma rota do app em classcash.com.br (ou www)
// faz o navegador bloquear o POST. Por isso, nesses hosts, tudo que NÃO é página da LP vai para o domínio do app,
// mantendo caminho, query e hash. classcash.com.br NÃO entra no CORS das funções.
export const APP_ORIGIN = 'https://app.classcash.com.br';
export const LANDING_HOSTS: readonly string[] = ['classcash.com.br', 'www.classcash.com.br'];
/** Páginas públicas que ficam na LP (as rotas "/", "/privacidade" e "/termos" do App.tsx). */
export const LANDING_PATHS: readonly string[] = ['/', '/privacidade', '/termos'];

/** O host é de LP (classcash.com.br ou www)? Match exato, como em isAppHost. */
export function isLandingHost(hostname: string): boolean {
  if (typeof hostname !== 'string') return false;
  return LANDING_HOSTS.includes(normalizeHost(hostname));
}

/** O caminho é página da LP? Ignora maiúsculas (o React Router também ignora) e barras finais. */
export function isLandingPath(pathname: string): boolean {
  if (typeof pathname !== 'string') return false;
  const p = pathname.toLowerCase().replace(/\/+$/, '') || '/';
  return LANDING_PATHS.includes(p);
}

export interface LocationParts {
  hostname: string;
  pathname: string;
  search?: string;
  hash?: string;
}

/**
 * Para onde ir, se esta URL deve ser redirecionada para o app; null se deve ficar onde está.
 * Só redireciona nos hosts de LP e só fora das páginas da LP. App, previews e localhost nunca mudam.
 */
export function appRedirectTarget(loc: LocationParts): string | null {
  if (!isLandingHost(loc.hostname)) return null;
  if (isLandingPath(loc.pathname)) return null;
  const path = loc.pathname.startsWith('/') ? loc.pathname : `/${loc.pathname}`;
  return `${APP_ORIGIN}${path}${loc.search ?? ''}${loc.hash ?? ''}`;
}
