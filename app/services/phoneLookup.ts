import {
  buildPhoneSearchQuery,
  parseDuckDuckGoResults,
  pickPhoneCandidate,
  type PhoneCandidate,
} from '../core/phoneLookup.mjs';

/**
 * Busca de telefone na internet, pelo próprio aparelho e sem abrir navegador.
 *
 * Faz uma consulta no endpoint HTML do DuckDuckGo (que devolve os resumos em
 * texto simples, sem exigir chave de API nem JavaScript), lê os resultados e
 * deixa o módulo puro escolher o telefone mais provável.
 *
 * Nunca disca nada: devolve o número encontrado para o app confirmar com o
 * usuário antes.
 */

const SEARCH_ENDPOINT = 'https://html.duckduckgo.com/html/';
const REQUEST_TIMEOUT_MS = 9000;

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 14; moto g84 5G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  Accept: 'text/html,application/xhtml+xml',
};

export type PhoneLookupResult = PhoneCandidate;

async function fetchHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: BROWSER_HEADERS,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Procura o telefone de um lugar. Devolve `null` quando não acha nada (ou a
 * internet falha) — quem chama decide o que dizer ao usuário.
 */
export async function lookupPhoneNumber(query: string): Promise<PhoneLookupResult | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;

  try {
    const url = `${SEARCH_ENDPOINT}?q=${encodeURIComponent(buildPhoneSearchQuery(trimmed))}`;
    const html = await fetchHtml(url);
    const results = parseDuckDuckGoResults(html);
    return pickPhoneCandidate(results, trimmed);
  } catch (error) {
    console.warn('[Nexus] Busca de telefone falhou:', error);
    return null;
  }
}
