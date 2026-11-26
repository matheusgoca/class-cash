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
