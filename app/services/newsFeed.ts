import { parseRssTitles } from '../core/dailyExtras.mjs';

/**
 * Manchetes reais, direto dos feeds do G1.
 *
 * Sem chave de API e sem abrir navegador: é o mesmo caminho da busca de
 * telefone (uma requisição HTTP e leitura do texto devolvido). O que o Nexus
 * fala são SÓ os títulos que vieram do feed.
 *
 * Devolve lista vazia quando a internet falha ou o feed muda de forma — quem
 * chama avisa o usuário em vez de inventar notícia.
 */

const FEEDS: Record<'general' | 'gossip', string> = {
  general: 'https://g1.globo.com/rss/g1/',
  gossip: 'https://g1.globo.com/rss/g1/pop-arte/',
};

const REQUEST_TIMEOUT_MS = 10_000;

/** Teto de leitura: o feed passa de 100 KB e só o começo interessa. */
const MAX_BODY_CHARS = 300_000;

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 14; moto g84 5G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  Accept: 'application/rss+xml, application/xml, text/xml, */*',
};

async function fetchFeed(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: HEADERS,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.text();
    return body.slice(0, MAX_BODY_CHARS);
  } finally {
    clearTimeout(timer);
  }
}

/** Títulos das manchetes de agora; lista vazia quando não dá para buscar. */
export async function fetchHeadlines(
  topic: 'general' | 'gossip' = 'general',
  limit = 4,
): Promise<string[]> {
  try {
    const xml = await fetchFeed(FEEDS[topic] ?? FEEDS.general);
    return parseRssTitles(xml, limit);
  } catch (error) {
    console.warn('[Nexus] Busca de manchetes falhou:', error);
    return [];
  }
}
