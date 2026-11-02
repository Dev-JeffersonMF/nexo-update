import { normalizeMegaSenaResult } from '../core/lottery.mjs';

/**
 * Último resultado da Mega-Sena, direto da Caixa.
 *
 * É o mesmo caminho das manchetes (uma requisição HTTP e leitura do JSON): sem
 * chave de API, sem abrir navegador. A resposta da Caixa é antiga e muda de
 * tempos em tempos, então quem valida os campos é `normalizeMegaSenaResult` —
 * aqui não se inventa resultado: se a rede falhar ou o formato mudar, devolve
 * `null` e o app avisa com honestidade.
 */

export interface MegaSenaLatestResult {
  contest: number;
  date: string;
  numbers: number[];
  accumulated: boolean;
  sixWinners: number;
  nextDate: string;
  estimatedPrize: number | null;
}

const ENDPOINT = 'https://servicebus2.caixa.gov.br/portaldeloterias/api/megasena';
const REQUEST_TIMEOUT_MS = 12_000;

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 15; moto g84 5G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  Accept: 'application/json',
};

export async function fetchLatestMegaSena(): Promise<MegaSenaLatestResult | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(ENDPOINT, {
      method: 'GET',
      headers: HEADERS,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const raw: unknown = await response.json();
    return (normalizeMegaSenaResult(raw) as MegaSenaLatestResult | null) ?? null;
  } catch (error) {
    console.warn('[Nexus] Consulta da Mega-Sena falhou:', error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
