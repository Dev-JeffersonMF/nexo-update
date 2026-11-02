/**
 * Loteria: dezenas para jogar, não previsão.
 *
 * "Me dá números da Mega-Sena" não é pergunta de fato: é um pedido de jogo. Sem
 * um intent próprio, a frase caía na pesquisa da internet e o Nexus respondia
 * com qualquer assunto — no teste real, falou de Brasil x Alemanha em 2014.
 *
 * O mesmo módulo também entende o pedido de RESULTADO ("qual foi o último
 * resultado?"). Esse caminho depende da rede e por isso a busca fica em
 * `app/services/megaSena.ts`: aqui só mora o parsing e a formatação, que são
 * puros e testáveis sem aparelho.
 *
 * ## Regras
 *
 *  1. Só responde quando a frase menciona a Mega-Sena e pede JOGO ou RESULTADO.
 *  2. As dezenas são sorteadas de verdade (aleatórias), únicas, entre 1 e 60.
 *     Todo jogo tem exatamente seis dezenas — não importa quantos jogos o
 *     usuário peça.
 *  3. Pedido de resultado NÃO vira jogo aleatório: são coisas diferentes, e o
 *     texto deixa claro qual é qual.
 *  4. Módulo puro: sem rede, sem estado; o gerador aleatório é injetável para
 *     os testes.
 */

const MEGA = /\bmega[\s-]?(?:sena|senna|cena|sema)\b/u;

/** Verbo/palavra que pede um jogo (não o resultado do sorteio). */
const PLAY =
  /\b(?:jog(?:ar|o|os|ada|adas|uinho|uinhos)?|apost(?:a|as|ar|inha|inhas)?|surpresinha|montagem|combinacao|combinacoes)\b/u;

/** "Números" e "dezenas" podem ser pedido de jogo ou de resultado. */
const NUMBERS = /\b(?:dezenas?|numeros?)\b/u;

/** Palavras que apontam para o resultado já sorteado. */
const DRAW =
  /\b(?:resultado|sorteio|sortead[oa]s?|saiu|sairam|ganhador(?:es)?|premio|acumul(?:ou|ado|ada)|concurso|ultimo)\b/u;

/** Quantos jogos o usuário pediu; acima disso o pedido é aparado. */
export const MAX_GAMES = 20;

const COUNT_WORDS = new Map([
  ['um', 1],
  ['uma', 1],
  ['dois', 2],
  ['duas', 2],
  ['tres', 3],
  ['quatro', 4],
  ['cinco', 5],
  ['seis', 6],
  ['sete', 7],
  ['oito', 8],
  ['nove', 9],
  ['dez', 10],
  ['onze', 11],
  ['doze', 12],
  ['treze', 13],
  ['quatorze', 14],
  ['catorze', 14],
  ['quinze', 15],
  ['dezesseis', 16],
  ['dezessete', 17],
  ['dezoito', 18],
  ['dezenove', 19],
  ['vinte', 20],
]);

/** Remove acentos e caixa para comparar do jeito que a pessoa fala. */
function fold(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

/** Dezenas com dois dígitos, como saem no volante. */
function formatNumbers(numbers) {
  return numbers.map((number) => String(number).padStart(2, '0')).join(', ');
}

/**
 * Sorteia `count` dezenas distintas de 1 a `max`, em ordem crescente.
 *
 * Fisher-Yates sobre a faixa inteira: cada dezena tem a mesma chance e não há
 * repetição. `random` existe para o teste ser determinístico.
 */
export function pickNumbers(count = 6, max = 60, random = Math.random) {
  const pool = Array.from({ length: max }, (_, index) => index + 1);
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const pick = Math.min(Math.floor(random() * (index + 1)), index);
    [pool[index], pool[pick]] = [pool[pick], pool[index]];
  }
  return pool.slice(0, count).sort((a, b) => a - b);
}

/**
 * Quantos jogos foram pedidos.
 *
 * Só conta o número colado em "jogo(s)"/"aposta(s)": "seis dezenas" é o tamanho
 * do jogo, nunca a quantidade de jogos.
 */
function parseGameCount(folded) {
  const suffix = String.raw`\s+(?:jogos?|joguinhos?|apostas?|combinacoes?)\b`;
  const numeric = folded.match(new RegExp(String.raw`\b(\d{1,3})` + suffix, 'u'));
  if (numeric) return Math.max(1, Math.min(MAX_GAMES, Number(numeric[1])));

  const word = folded.match(new RegExp(String.raw`\b([a-z]+)` + suffix, 'u'));
  if (word && COUNT_WORDS.has(word[1])) return COUNT_WORDS.get(word[1]);

  return 1;
}

/**
 * Traduz a frase em um pedido de loteria.
 *
 * @param {string} text
 * @returns {{ wantsResult: boolean, wantsGames: boolean, count: number } | null}
 *   `null` quando a frase não é sobre a Mega-Sena.
 */
export function parseLotteryRequest(text) {
  const folded = fold(text);
  if (!MEGA.test(folded)) return null;

  const asksNumbersDirectly =
    NUMBERS.test(folded) && /\b(?:quais|qual)\b/u.test(folded) && !PLAY.test(folded);
  const wantsResult = DRAW.test(folded) || asksNumbersDirectly;
  const wantsGames = PLAY.test(folded) || (NUMBERS.test(folded) && !wantsResult);

  if (!wantsResult && !wantsGames) return null;

  return {
    wantsResult,
    // "Qual foi o resultado e me dá 2 jogos" pede as duas coisas.
    wantsGames,
    count: wantsGames ? parseGameCount(folded) : 0,
  };
}

/**
 * Fala dos jogos sorteados.
 *
 * @param {number} count quantidade de jogos (1 a [MAX_GAMES]).
 * @param {() => number} random gerador injetável nos testes.
 * @returns {string}
 */
export function formatLotteryGames(count = 1, random = Math.random) {
  const requested = Number.isFinite(count) ? Math.floor(count) : 1;
  const total = Math.max(1, Math.min(MAX_GAMES, requested));
  const games = Array.from({ length: total }, () => pickNumbers(6, 60, random));

  if (total === 1) {
    return `A Mega-Sena é sorteio, não tem número certo. Aqui vão seis dezenas aleatórias para jogar: ${formatNumbers(
      games[0],
    )}. São sugestões sem garantia de acerto — boa sorte!`;
  }

  const list = games
    // "Jogo 2: 09..." era lido pelo TTS como "jogo duas da manhã" (2:09 é
    // hora). A vírgula separa o número das dezenas e o dois-pontos fica depois
    // da palavra "dezenas", onde é só uma pausa.
    .map((game, index) => `Jogo ${index + 1}, dezenas: ${formatNumbers(game)}`)
    .join('. ');

  return `A Mega-Sena é sorteio, não tem número certo. Aqui vão ${total} jogos aleatórios, cada um com seis dezenas de 1 a 60: ${list}. São sugestões sem garantia de acerto — boa sorte!`;
}

/**
 * Responde apenas o pedido de JOGO (compatível com o fluxo antigo).
 *
 * Pedido de resultado devolve `null`: quem busca o sorteio é o serviço de rede.
 *
 * @returns {string | null}
 */
export function answerLottery(text, random = Math.random) {
  const request = parseLotteryRequest(text);
  if (!request || !request.wantsGames) return null;
  return formatLotteryGames(request.count, random);
}

/**
 * Normaliza a resposta JSON da Caixa.
 *
 * A API muda de tempos em tempos; tudo é lido com desconfiança. Sem seis
 * dezenas válidas não existe resultado — é melhor devolver `null` do que falar
 * um concurso pela metade.
 *
 * @param {unknown} raw
 * @returns {{
 *   contest: number,
 *   date: string,
 *   numbers: number[],
 *   accumulated: boolean,
 *   sixWinners: number,
 *   nextDate: string,
 *   estimatedPrize: number | null,
 * } | null}
 */
export function normalizeMegaSenaResult(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const data = /** @type {Record<string, unknown>} */ (raw);
  const source = Array.isArray(data.listaDezenas)
    ? data.listaDezenas
    : Array.isArray(data.dezenasSorteadasOrdemSorteio)
      ? data.dezenasSorteadasOrdemSorteio
      : [];

  const numbers = source
    .map((value) => Number.parseInt(String(value), 10))
    .filter((number) => Number.isInteger(number) && number >= 1 && number <= 60);

  if (numbers.length !== 6 || new Set(numbers).size !== 6) return null;

  const contest = Number(data.numero);
  if (!Number.isInteger(contest) || contest <= 0) return null;

  const prizes = Array.isArray(data.listaRateioPremio) ? data.listaRateioPremio : [];
  const mainPrize = prizes.find(
    (item) => item && typeof item === 'object' && Number(item.faixa) === 1,
  );
  const sixWinners = Number(mainPrize?.numeroDeGanhadores) || 0;
  const estimatedPrize = Number(data.valorEstimadoProximoConcurso);

  return {
    contest,
    date: typeof data.dataApuracao === 'string' ? data.dataApuracao.trim() : '',
    numbers: numbers.sort((a, b) => a - b),
    accumulated: data.acumulado === true,
    sixWinners: sixWinners > 0 ? sixWinners : 0,
    nextDate:
      typeof data.dataProximoConcurso === 'string' ? data.dataProximoConcurso.trim() : '',
    estimatedPrize: Number.isFinite(estimatedPrize) && estimatedPrize > 0 ? estimatedPrize : null,
  };
}

/** Valor em reais sem depender de ICU/Intl (o Hermes nem sempre tem). */
function formatBRL(value) {
  if (!Number.isFinite(value) || value <= 0) return '';
  const cents = Math.round(value * 100);
  const reais = Math.floor(cents / 100);
  const rest = String(cents % 100).padStart(2, '0');
  const withDots = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${withDots},${rest}`;
}

/**
 * Fala o último resultado da Mega-Sena a partir dos dados normalizados.
 *
 * @param {ReturnType<typeof normalizeMegaSenaResult>} result
 * @returns {string} texto pronto; vazio quando não há resultado válido.
 */
export function formatMegaSenaResult(result) {
  if (!result || !Array.isArray(result.numbers) || result.numbers.length !== 6) return '';

  const parts = [
    `No concurso ${result.contest}${result.date ? `, sorteado em ${result.date},` : ','} as dezenas da Mega-Sena foram: ${formatNumbers(result.numbers)}.`,
  ];

  if (result.sixWinners === 1) {
    parts.push('Uma aposta acertou as seis dezenas.');
  } else if (result.sixWinners > 1) {
    parts.push(`${result.sixWinners} apostas acertaram as seis dezenas.`);
  } else if (result.accumulated) {
    parts.push('Ninguém acertou as seis dezenas, e o prêmio acumulou.');
  } else {
    parts.push('Não houve ganhador de seis acertos.');
  }

  if (result.nextDate) {
    const prize = formatBRL(result.estimatedPrize);
    parts.push(
      `O próximo concurso é em ${result.nextDate}${prize ? `, com prêmio estimado de ${prize}` : ''}.`,
    );
  }

  return parts.join(' ');
}
