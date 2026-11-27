// Chamada às Edge Functions que nunca fica pendurada nem lança: timeout de 30 s (AbortController) e erro de rede
// viram um resultado com mensagem em português. Motivo: um fetch sem catch deixava a tela em "Enviando" para sempre
// quando o navegador bloqueava o POST por CORS (app aberto em classcash.com.br) ou a função demorava.

export const EDGE_TIMEOUT_MS = 30_000;

export const INVITE_NETWORK_MESSAGE =
  'Não foi possível enviar o convite. Verifique se você está em app.classcash.com.br e tente novamente.';
export const INVITE_TIMEOUT_MESSAGE =
  'O envio do convite demorou demais e foi interrompido. Tente novamente em alguns minutos.';
export const GENERIC_NETWORK_MESSAGE =
  'Não foi possível concluir a operação. Verifique se você está em app.classcash.com.br e tente novamente.';
export const GENERIC_TIMEOUT_MESSAGE = 'A operação demorou demais e foi interrompida. Tente novamente em alguns minutos.';

export interface EdgeCallResult {
  ok: boolean;
  /** Status HTTP; 0 quando a requisição nem chegou a ter resposta (rede, CORS ou timeout). */
  status: number;
  /** Código estável do erro (`error` do corpo, ex.: "user_exists", "invite_timeout") ou "network"/"timeout". */
  code: string | null;
  /** Texto para mostrar ao usuário (`message` do corpo, senão `error`, senão uma mensagem padrão). */
  message: string;
  data: Record<string, unknown>;
}

export interface EdgeCallOptions {
  timeoutMs?: number;
  networkMessage?: string;
  timeoutMessage?: string;
  /** Só para teste. */
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  apiKey?: string;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

export async function callEdgeFunction(
  name: string,
  payload: object,
  accessToken: string,
  opts: EdgeCallOptions = {},
): Promise<EdgeCallResult> {
  const {
    timeoutMs = EDGE_TIMEOUT_MS,
    networkMessage = GENERIC_NETWORK_MESSAGE,
    timeoutMessage = GENERIC_TIMEOUT_MESSAGE,
    fetchImpl = (...a: Parameters<typeof fetch>) => fetch(...a),
    baseUrl = import.meta.env.VITE_SUPABASE_URL,
    apiKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  } = opts;

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const res = await fetchImpl(`${baseUrl}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        apikey: apiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    let data: Record<string, unknown> = {};
    try {
      const parsed = await res.json();
      if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>;
    } catch (e) {
      if (timedOut) throw e; // estourou o tempo lendo o corpo
      // corpo vazio ou que não é JSON: segue só com o status
    }
    return {
      ok: res.ok,
      status: res.status,
      code: str(data.error),
      message: str(data.message) ?? str(data.error) ?? (res.ok ? '' : `Erro ${res.status}. Tente novamente.`),
      data,
    };
  } catch {
    // TypeError "Failed to fetch" (rede, CORS) ou AbortError (timeout)
    return timedOut
      ? { ok: false, status: 0, code: 'timeout', message: timeoutMessage, data: {} }
      : { ok: false, status: 0, code: 'network', message: networkMessage, data: {} };
  } finally {
    clearTimeout(timer);
  }
}

export type InviteFunctionName = 'invite-user' | 'invite-school-owner';

/** Convites (admin/financeiro da escola e dono de escola nova). Mensagens específicas de convite. */
export function callInviteFunction(name: InviteFunctionName, payload: object, accessToken: string, opts: EdgeCallOptions = {}) {
  return callEdgeFunction(name, payload, accessToken, {
    networkMessage: INVITE_NETWORK_MESSAGE,
    timeoutMessage: INVITE_TIMEOUT_MESSAGE,
    ...opts,
  });
}
