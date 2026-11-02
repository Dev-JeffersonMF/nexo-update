/**
 * Os "extras do dia": a frase para animar e as manchetes reais.
 *
 * Módulo puro — não busca nada na internet e não guarda estado. Ele só decide o
 * que o usuário pediu ("frase para animar meu dia", "fofoca do dia", "quais as
 * notícias de hoje") e monta o texto que vai ser FALADO. Quem busca as
 * manchetes é `app/services/newsFeed.ts`.
 *
 * Duas regras que sustentam a honestidade daqui:
 *
 *  1. NENHUMA frase é inventada: elas saem de uma lista fixa, escolhida pelo dia
 *     do calendário. O mesmo dia devolve sempre a mesma frase — comportamento de
 *     assistente, que "tem" uma frase do dia, e não de sorteio;
 *  2. NENHUMA manchete é inventada: elas vêm do feed real. Quando o feed não
 *     responde, a lista chega vazia e a resposta diz que não deu, em vez de
 *     preencher com o que "deveria" estar acontecendo.
 */

/**
 * Frases prontas para animar o dia.
 *
 * Curtas de propósito: elas são faladas em voz alta. Nada de conselho médico,
 * financeiro ou promessa de resultado — só um empurrão honesto.
 */
const PHRASES = [
  'Cada passo pequeno conta. Vamos com calma, sem parar.',
  'Você já venceu dias piores que este. Hoje também dá conta.',
  'Comece pelo mais fácil e o resto pega embalo.',
  'Feito é melhor que perfeito. Ninguém faz tudo impecável.',
  'Respire fundo: o que for seu vai dar certo no tempo certo.',
  'Um dia de cada vez, uma tarefa de cada vez.',
  'A constância vence o talento quando o talento não é constante.',
  'Você é mais forte do que a pressa que te ronda.',
  'Coragem não é ausência de medo, é seguir com ele do lado.',
  'Hoje é uma boa chance de recomeçar de onde você parou.',
  'Faça o seu melhor com o que você tem hoje.',
  'Grandes mudanças começam com uma decisão pequena.',
];

/** Pedido de frase: o assunto (frase/palavra/mensagem) + a intenção (animar). */
const PHRASE_NOUN = /\b(frase|palavra|mensagem|algo|coisa)\b/;
const PHRASE_INTENT =
  /\b(animar|anima|animacao|motivar|motiva|motivacao|motivacional|inspirar|inspira|inspiracao|levantar o astral|alegrar)\b/;

/** "Frase do dia" é pedido de frase mesmo sem o verbo de animar. */
const PHRASE_OF_DAY = /\bfrase do dia\b/;

/** Pedido direto, sem o substantivo: "me anima", "me motiva aí". */
const PHRASE_DIRECT = /\bme (anima|anime|motiva|motive|inspira|inspire)\b/;

/** Fofoca: entretenimento e famosos. */
const GOSSIP_TERMS = /\b(fofoca|fofocas|famosos|celebridade|celebridades|novela|bbb)\b/;

/** Notícia em geral. */
const NEWS_TERMS =
  /\b(noticia|noticias|manchete|manchetes|jornal|o que aconteceu|aconteceu hoje|novidades do dia|ultimas noticias)\b/;

/** Texto sem acento, sem pontuação e em minúsculas. */
function fold(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Número do dia no calendário LOCAL.
 *
 * É o que faz a "frase do dia" ser a mesma durante todo o dia, em qualquer
 * aparelho, sem guardar nada em disco.
 */
export function dayIndex(date = new Date()) {
  const utc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor(utc / 86_400_000);
}

/** A frase do dia: sempre a mesma dentro do mesmo dia. */
export function pickDailyPhrase(day = dayIndex()) {
  const index = Math.abs(Math.trunc(day)) % PHRASES.length;
  return PHRASES[index];
}

/**
 * Decide se a frase é um pedido de frase ou de notícia.
 *
 * @returns {{action: 'phrase'} | {action: 'news', topic: 'general'|'gossip'} | undefined}
 */
export function planDailyExtra(rawInput) {
  const folded = fold(rawInput);
  if (!folded) return undefined;

  // Notícia primeiro: "fofoca do dia" e "quais as notícias" são pedidos claros,
  // e nenhum deles contém o assunto de frase.
  if (GOSSIP_TERMS.test(folded) || NEWS_TERMS.test(folded)) {
    return { action: 'news', topic: GOSSIP_TERMS.test(folded) ? 'gossip' : 'general' };
  }

  const wantsPhrase =
    PHRASE_OF_DAY.test(folded) ||
    PHRASE_DIRECT.test(folded) ||
    (PHRASE_NOUN.test(folded) && PHRASE_INTENT.test(folded));

  return wantsPhrase ? { action: 'phrase' } : undefined;
}

/**
 * Títulos reais de um feed RSS.
 *
 * Leitura de propósito simples (sem biblioteca de XML): o que interessa são os
 * títulos dos `<item>`. `CDATA` é desembrulhado e as entidades mais comuns são
 * traduzidas, porque o texto é FALADO e "&amp;" soaria como "e comercial".
 *
 * @param {string} xml
 * @param {number} [limit]
 * @returns {string[]}
 */
export function parseRssTitles(xml, limit = 6) {
  const source = typeof xml === 'string' ? xml : '';
  if (!source) return [];

  const titles = [];
  const items = source.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];

  for (const item of items) {
    const match = item.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!match) continue;

    const title = decodeEntities(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim();
    if (title) titles.push(title);
    if (titles.length >= limit) break;
  }

  return titles;
}

/** Entidades mais comuns em RSS; números decimais e hexadecimais inclusos. */
function decodeEntities(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => safeChar(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => safeChar(parseInt(code, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function safeChar(code) {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/**
 * Texto falado das manchetes.
 *
 * A lista chega como veio do feed (só títulos reais). Vazia = o Nexus diz que
 * não conseguiu, nunca inventa o que "estaria" acontecendo.
 */
export function summarizeHeadlines(items, options = {}) {
  const topic = options.topic === 'gossip' ? 'gossip' : 'general';
  const limit = Number.isInteger(options.limit) ? options.limit : 4;

  const titles = (Array.isArray(items) ? items : [])
    .map((title) => String(title ?? '').trim())
    .filter((title) => title.length > 0)
    .slice(0, Math.max(1, limit));

  if (titles.length === 0) {
    return topic === 'gossip'
      ? 'Não consegui buscar as fofocas de agora. Tente de novo em instantes.'
      : 'Não consegui buscar as notícias de agora. Tente de novo em instantes.';
  }

  const intro = topic === 'gossip' ? 'As fofocas de agora' : 'As manchetes de agora';
  const spoken = titles.map((title, position) => `${position + 1}. ${title}.`).join(' ');
  return `${intro}: ${spoken}`;
}
