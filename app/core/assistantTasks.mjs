/**
 * Anotações e lembretes: o que o usuário fala vira uma tarefa do Nexus.
 *
 * Módulo puro (sem rede, sem armazenamento): recebe a frase, a hora atual, e
 * devolve o plano. Assim o parsing de data em português — a parte mais fácil de
 * errar — é testável sem aparelho nenhum.
 *
 * A palavra falada na correria vem torta ("me lembe", "anotaí"). A comparação
 * por aqui tolera o erro de ditado (ver `speechText`), SEM trocar a frase
 * original: os índices do corte continuam valendo.
 *
 * Horário aceito:
 *   "às 6"            "às 6 e meia"      "6:30"        "18h"
 *   "meio-dia"        "meia-noite"       "3 da tarde"  "8 da noite"
 *   "amanhã às 7"     "hoje às 20"       "sexta às 9"  "dia 25 às 9"
 *   "25/12 às 8"      "daqui a 10 minutos"             "em 2 horas"
 *
 * Repetição: "todo dia", "todos os dias", "toda manhã".
 */

import {
  containsAnyFuzzy,
  containsPhraseFuzzy,
  findNounIndexFuzzy,
  isFuzzyMatch,
} from './speechText.mjs';
import {
  CREATE_VERBS,
  ENABLE_VERBS,
  NUMBER_WORDS,
  PAUSE_VERBS,
  PERIOD_WORDS,
  SAVE_VERBS,
  TIME_UNITS,
  WEEKDAY_ABBR,
} from './portugueseDict.mjs';

// ---------------------------------------------------------------------
// Vocabulário
// ---------------------------------------------------------------------

/** Palavras que indicam um lembrete/despertador. */
const REMINDER_TERMS = [
  'lembrete',
  'lembretes',
  'me lembra',
  'me lembre',
  'me lembrar',
  'alarme',
  'alarmes',
  'despertador',
  'despertadores',
  'me acorda',
  'me acorde',
  'me acordar',
  // "aviso" sozinho é conversa ("me explica o aviso do dia"): só conta como
  // lembrete quando vem com o pedido explícito ("me avisa...").
  'me avisa',
  'me avise',
  'me avisar',
];

/**
 * O pedido de lembrete SEM o "me": "lembra de ligar para a mãe".
 *
 * É o jeito mais comum de falar, e o reconhecedor às vezes come o "me". Sem
 * esta regra, a frase não entrava no planejador de tarefas e o "ligar para a
 * mãe" que vinha DEPOIS virava uma ligação de verdade.
 *
 * A âncora no começo é de propósito: "você lembra da festa?" é conversa, não
 * um pedido de lembrete.
 */
const REMINDER_IMPERATIVE =
  /^(?:me\s+)?(?:lembra|lembre|lembrar)(?:\s+(?:ai|aqui))?\s+de\b/;

/** Palavras que indicam uma anotação. */
const NOTE_TERMS = ['anota', 'anote', 'anotacao', 'anotacoes', 'nota', 'notas', 'anotar'];

/** Palavras de leitura. São comparadas por palavra inteira ("le" não casa em
 * "lembrete"). */
const READ_TERMS = [
  'quais',
  'qual',
  'lista',
  'listar',
  'ler',
  'le',
  'leia',
  'mostra',
  'mostrar',
  'ver',
  'diga',
  'fala',
  'falar',
];

const ORDINALS = {
  primeiro: 1,
  primeira: 1,
  segundo: 2,
  segunda: 2,
  terceiro: 3,
  terceira: 3,
  quarto: 4,
  quarta: 4,
  quinto: 5,
  quinta: 5,
  sexto: 6,
  sexta: 6,
  setimo: 7,
  setima: 7,
  oitavo: 8,
  oitava: 8,
  nono: 9,
  nona: 9,
  decimo: 10,
  decima: 10,
};

const LAST_WORDS = ['ultima', 'ultimo', 'mais recente'];

/** Conectivos que sobram na frente da descrição. */
const LEADING_STOPWORDS = new Set([
  'para',
  'pra',
  'de',
  'do',
  'da',
  'que',
  'e',
  'o',
  'a',
  'os',
  'as',
  'me',
  'se',
  'por',
  'ai',
  'isso',
  'uma',
  'um',
  'eu',
  'favor',
  'sobre',
]);

/** Conectivos que sobram no fim da descrição. */
const TRAILING_STOPWORDS = new Set(['para', 'pra', 'de', 'do', 'da', 'que', 'as', 'a', 'o', 'e']);

/** Frases de repetição aceitas. */
const REPEAT_PATTERN = /\b(todo dia|todos os dias|todas as manhas|toda manha|toda tarde|toda noite|diariamente)\b/;

/**
 * Minúsculas e sem acento SEM mudar o comprimento da string.
 *
 * Isso é essencial: os índices achados no texto dobrado são usados para cortar a
 * frase ORIGINAL (com acentos) e montar a descrição. Se o comprimento mudasse,
 * o corte sairia errado.
 */
function foldKeepLength(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Igual ao de cima, mas com pontuação e espaços normalizados (comparação). */
function foldWords(value) {
  return foldKeepLength(value)
    .replace(/[^a-z0-9\s:/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Palavra dobrada e sem pontuação, para comparar com os conectivos. */
function wordKey(word) {
  return foldWords(word).replace(/[^a-z0-9]/g, '');
}

/**
 * `true` quando o texto cita alguma das palavras.
 *
 * A palavra falada na correria vem torta ("me lembe", "anotaí", "lembret"), e
 * o Nexus tem que entender do mesmo jeito. Por isso a comparação é por
 * PALAVRA, tolerando o erro de ditado — e sem trocar a palavra original: os
 * índices do corte continuam valendo.
 */
function hasAny(text, terms) {
  if (terms.some((term) => new RegExp(`\\b${term}\\b`).test(text))) return true;

  // Frase com uma palavra faltando ("me lembe as 6" → "me lembre").
  for (const term of terms) {
    if (!term.includes(' ')) continue;
    if (containsPhraseFuzzy(text, term)) return true;
  }

  // Palavra solta e torta ("anotaí", "lembret").
  return containsAnyFuzzy(text, terms.filter((term) => !term.includes(' ')));
}

// ---------------------------------------------------------------------
// Descrição
// ---------------------------------------------------------------------

/**
 * Limpa a sobra da frase para virar a descrição do lembrete/anotação.
 *
 * Conectivos iniciais e finais saem em rodadas, comparando PALAVRA a palavra —
 * assim "anota aí que eu preciso comprar leite" vira "preciso comprar leite", sem
 * perder acento nenhum do que importa.
 */
function cleanDescription(raw) {
  let text = String(raw ?? '').replace(/\s+/g, ' ').trim();

  /*
   * Conectivos de VÁRIAS palavras, que a limpeza palavra a palavra não vê:
   * "com o nome ir ao psicólogo" era guardado como "nome ir ao psicólogo".
   * São removidos antes, da frente do texto.
   */
  for (const prefix of [
    /^com\s+(?:o\s+|a\s+)?nome\s+/i,
    /^(?:chamado|chamada|nomeado|nomeada)\s+/i,
  ]) {
    text = text.replace(prefix, '').trim();
  }

  const words = text
    .split(' ')
    .filter((word) => word.length > 0);

  let start = 0;
  while (start < words.length && (wordKey(words[start]) === '' || LEADING_STOPWORDS.has(wordKey(words[start])))) {
    start += 1;
  }

  let end = words.length;
  while (end - 1 > start && TRAILING_STOPWORDS.has(wordKey(words[end - 1]))) {
    end -= 1;
  }

  return words
    .slice(start, end)
    .join(' ')
    .replace(/^[\s:;,.\-–—]+/, '')
    .replace(/[\s:;,.\-–—]+$/, '')
    .trim();
}

/** Título curto a partir da descrição. */
export function deriveTitle(text, fallback = 'Lembrete') {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return fallback;
  if (clean.length <= 60) return clean;
  return `${clean.slice(0, 57).trimEnd()}...`;
}

// ---------------------------------------------------------------------
// Interpretação de horário
// ---------------------------------------------------------------------

function toNumber(token) {
  if (!token) return undefined;
  if (/^\d{1,2}$/.test(token)) return Number(token);
  return NUMBER_WORDS[token];
}

/**
 * Acha a expressão de horário dentro da frase dobrada.
 *
 * @returns {{hour: number, minute: number, start: number, end: number} | null}
 */
function parseClock(text) {
  // 1) Meio-dia e meia-noite — e as MEIAS: "meio dia e meia" são 12:30, não
  //    12:00. "Meia" no relógio brasileiro sempre vale 30 minutos.
  for (const [word, hour] of [
    ['meio-dia', 12],
    ['meio dia', 12],
    ['meia-noite', 0],
    ['meia noite', 0],
  ]) {
    const start = text.indexOf(word);
    if (start < 0) continue;

    /*
     * "meio dia e meia" são 12:30, não 12:00 — e "meio dia e quinze" são
     * 12:15. "Meia" no relógio brasileiro sempre vale 30 minutos.
     */
    const after = text.slice(start + word.length);
    const minutesMatch = /^(\s+e\s+)(meia|trinta|\d{1,2}|[a-z]{3,13})\b/.exec(after);
    let minute = 0;
    let end = start + word.length;

    if (minutesMatch) {
      const value = toNumber(minutesMatch[2]);
      if (value !== undefined && value <= 59) {
        minute = value;
        end += minutesMatch[0].length;
      }
    }

    return withPeriod(text, { hour, minute, start, end });
  }

  // 2) Hora com marcador: "6h", "6:30", "18 horas", "6h30".
  //
  // A ordem das alternativas importa: com "h" antes de "horas", o "15 horas"
  // era lido como "15 h" e a descrição do lembrete ficava com o resto ("oras").
  const withMarker = /(\d{1,2})\s*(?:horas?|hrs?|hs|h|:)\s*(\d{2})?/g;
  let match;
  while ((match = withMarker.exec(text)) !== null) {
    const hour = Number(match[1]);
    if (hour > 23) continue;
    const minute = match[2] ? Number(match[2]) : 0;
    if (minute > 59) continue;
    return withPeriod(text, {
      hour,
      minute,
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  // 3) "às seis e meia", "as 8", "pelas 14".
  //
  // Só "as"/"pelas" — NUNCA a preposição solta "a". Ela aparece em toda frase
  // ("daqui a 1 minuto", "ligar a Maria", "comprar a 2 reais") e, sem unidade
  // reconhecida, o número virava HORA: "daqui a 1"... virava 01:00 de amanhã.
  // Um horário errado é pior do que perguntar de novo.
  const spoken = /(?:^|\s)(?:as|pelas)\s+([a-z0-9]{1,13})(?:\s+e\s+([a-z0-9]{1,13}))?/g;
  while ((match = spoken.exec(text)) !== null) {
    const hour = toNumber(match[1]);
    if (hour === undefined || hour > 23) continue;
    const minute = match[2] ? toNumber(match[2]) : 0;
    if (minute === undefined || minute > 59) continue;
    return withPeriod(text, {
      hour,
      minute,
      start: match.index + (match[0].startsWith(' ') ? 1 : 0),
      end: match.index + match[0].length,
    });
  }

  // 4) "uma e meia", "duas e meia" (a hora dita sem o "as").
  const halfPast = /(?:^|\s)(uma|duas)\s+e\s+meia\b/.exec(text);
  if (halfPast) {
    const hour = halfPast[1] === 'uma' ? 1 : 2;
    return withPeriod(text, {
      hour,
      minute: 30,
      start: halfPast.index + (halfPast[0].startsWith(' ') ? 1 : 0),
      end: halfPast.index + halfPast[0].length,
    });
  }

  /*
   * 5) "uma da tarde", "seis da manhã" — a hora dita SEM o "as".
   *
   * A conversa por etapas pergunta "para que horas?", e a resposta natural é
   * "uma da tarde". Sem esta regra a resposta não casava com nada e o Nexus
   * perguntava a hora de novo, em loop.
   */
  const bareWithPeriod =
    /(?:^|\s)(\d{1,2}|[a-z]{3,13})(?:\s+e\s+([a-z0-9]{1,13}))?\s+((?:da|de)\s+(?:manha|tarde|noite|madrugada))\b/g;
  while ((match = bareWithPeriod.exec(text)) !== null) {
    const hour = toNumber(match[1]);
    if (hour === undefined || hour > 23) continue;
    const minute = match[2] ? toNumber(match[2]) : 0;
    if (minute === undefined || minute > 59) continue;

    /*
     * O fim do trecho para ANTES do período: é o `withPeriod` que lê o
     * "da tarde" e aplica as 12 horas (senão "uma da tarde" virava 01:00).
     */
    const periodStart = match.index + match[0].lastIndexOf(match[3]);
    return withPeriod(text, {
      hour,
      minute,
      start: match.index + (match[0].startsWith(' ') ? 1 : 0),
      end: periodStart,
    });
  }

  /*
   * 6) Resposta curta da conversa por etapas: "15", "00", "3 pm", "15:30".
   *
   * Só vale quando a frase INTEIRA é o horário. No meio de uma frase, um número
   * solto ("ligar a Maria") continua não sendo hora — quem garante isso é o
   * `^...$`.
   */
  const trimmed = text.trim();
  const bareClock = /^(\d{1,2})(?:\s+e\s+([a-z0-9]{1,13}))?(?:\s*(am|pm))?$/.exec(trimmed);
  if (bareClock) {
    const hour = Number(bareClock[1]);
    const minute = bareClock[2] ? toNumber(bareClock[2]) : 0;
    if (hour <= 23 && minute !== undefined && minute <= 59) {
      const start = text.indexOf(trimmed);
      const period = /\s*(am|pm)$/.exec(trimmed);
      return withPeriod(text, {
        hour,
        minute,
        start,
        // O fim para ANTES do "am"/"pm": é o `withPeriod` que aplica as 12h.
        end: start + trimmed.length - (period ? period[0].length : 0),
      });
    }
  }

  return null;
}

/**
 * "da manhã" / "da tarde" logo DEPOIS do horário.
 *
 * A comparação é ancorada no começo do que vem a seguir: procurar a palavra
 * solta em qualquer lugar faria "todo dia" casar com "do dia" e virar 18h.
 */
function periodAfter(text, fromIndex) {
  const tail = text.slice(fromIndex, fromIndex + 16);
  for (const [word, period] of PERIOD_WORDS) {
    const match = new RegExp(`^\\s*${word}\\b`).exec(tail);
    if (match) return { period, length: match[0].length };
  }
  return { period: '', length: 0 };
}

/**
 * Aplica o "da manhã"/"da tarde" à hora e ESTENDE o trecho casado para engolir
 * esse pedaço (senão ele sobraria na descrição do lembrete).
 */
function withPeriod(text, clock) {
  const period = periodAfter(text, clock.end);
  let hour = clock.hour;

  if (period.period === 'pm' && hour >= 1 && hour <= 11) hour += 12;
  if (period.period === 'am' && hour === 12) hour = 0;

  return {
    hour,
    minute: clock.minute,
    start: clock.start,
    end: clock.end + period.length,
  };
}

function startOfDay(reference) {
  return new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
}

/**
 * Acha a data (dia) mencionada.
 *
 * @returns {{date: Date, start: number, end: number} | null}
 */
function parseDay(text, now) {
  const base = new Date(now);

  const afterTomorrow = text.indexOf('depois de amanha');
  if (afterTomorrow >= 0) {
    const date = startOfDay(base);
    date.setDate(date.getDate() + 2);
    return { date, start: afterTomorrow, end: afterTomorrow + 'depois de amanha'.length };
  }

  // "hj" e "amanh" são as abreviações do dia a dia.
  for (const [word, offset] of [
    ['amanha', 1],
    ['amanh', 1],
    ['hoje', 0],
    ['hj', 0],
  ]) {
    const start = text.search(new RegExp(`\\b${word}\\b`));
    if (start >= 0) {
      const date = startOfDay(base);
      date.setDate(date.getDate() + offset);
      return { date, start, end: start + word.length };
    }
  }

  // "ter as 9" é terça: as abreviações dos dias contam tanto quanto o nome.
  for (const [word, weekday] of Object.entries(WEEKDAY_ABBR)) {
    const start = text.search(new RegExp(`\\b${word}\\b`));
    if (start < 0) continue;

    /*
     * "ter" é também o verbo ("me lembra de TER paciência") — e virar terça
     * seria um lembrete no dia errado. Ele só conta como dia quando está
     * sozinho ("ter", a resposta de "que dia?") ou seguido de um horário
     * ("ter às 9"). As outras abreviações não são palavras comuns.
     */
    if (word === 'ter') {
      const after = text.slice(start + word.length).trim();
      const looksLikeTime = /^(?:as|pelas|a|ao|meio|hora|\d)/.test(after);
      if (after !== '' && !looksLikeTime) continue;
    }

    const date = startOfDay(base);
    const distance = (weekday - date.getDay() + 7) % 7;
    // Hoje é hoje: "hoje é sexta" não vira a sexta que vem.
    if (distance === 0 && text.search(/\bhoje\b/) < 0) {
      date.setDate(date.getDate() + 7);
    } else {
      date.setDate(date.getDate() + distance);
    }
    return { date, start, end: start + word.length };
  }

  const explicit = text.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (explicit && typeof explicit.index === 'number') {
    const day = Number(explicit[1]);
    const month = Number(explicit[2]) - 1;
    const rawYear = explicit[3] ? Number(explicit[3]) : base.getFullYear();
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    if (day >= 1 && day <= 31 && month >= 0 && month <= 11) {
      const date = new Date(year, month, day);
      if (!Number.isNaN(date.getTime())) {
        return { date, start: explicit.index, end: explicit.index + explicit[0].length };
      }
    }
  }

  const dayOfMonth = text.match(/\bdia\s+(\d{1,2})\b/);
  if (dayOfMonth && typeof dayOfMonth.index === 'number') {
    const day = Number(dayOfMonth[1]);
    if (day >= 1 && day <= 31) {
      const date = startOfDay(base);
      date.setDate(day);
      if (date.getTime() <= now) date.setMonth(date.getMonth() + 1, day);
      return { date, start: dayOfMonth.index, end: dayOfMonth.index + dayOfMonth[0].length };
    }
  }

  return null;
}

/**
 * Tempo relativo: "daqui a 10 minutos", "em 2 horas", "daqui a 10 min".
 *
 * As unidades vêm do dicionário (`TIME_UNITS`), então as abreviações do dia a
 * dia ("10 min", "2 h", "30 seg") são entendidas como as formas por extenso.
 */
function parseRelative(text, now) {
  const match = /(?:daqui a|em|dentro de)\s+(\d{1,3}|[a-z]{3,13})\s+([a-z]{1,8})/g.exec(text);
  if (!match) return null;

  const amount = toNumber(match[1]);
  if (amount === undefined) return null;

  const unit = TIME_UNITS[match[2]];
  if (unit === undefined) return null;

  return {
    instant: now + amount * unit,
    start: match.index,
    end: match.index + match[0].length,
  };
}

/**
 * Interpreta quando o lembrete deve tocar.
 *
 * @returns {{
 *   triggerAtMillis: number, repeatDaily: boolean, start: number, end: number,
 *   repeatStart: number | null, repeatEnd: number | null
 * } | null}
 */
export function parseWhen(rawText, now = Date.now()) {
  const text = foldKeepLength(rawText);

  const repeat = REPEAT_PATTERN.exec(text);
  const repeatDaily = repeat !== null;

  const relative = parseRelative(text, now);
  if (relative) {
    return {
      triggerAtMillis: relative.instant,
      repeatDaily,
      start: relative.start,
      end: relative.end,
      repeatStart: repeat ? repeat.index : null,
      repeatEnd: repeat ? repeat.index + repeat[0].length : null,
    };
  }

  const clock = parseClock(text);
  if (!clock) return null;

  const day = parseDay(text, now);
  const date = day ? new Date(day.date) : startOfDay(new Date(now));
  date.setHours(clock.hour, clock.minute, 0, 0);

  if (!day && date.getTime() <= now) {
    // Sem dia dito, um horário que já passou é o de AMANHÃ: quem diz "me acorda
    // às 6" às 22h quer acordar de manhã, não às 6 de hoje. Com "hoje" explícito
    // a data é a de hoje mesmo — quem pediu sabe que o horário já passou.
    date.setDate(date.getDate() + 1);
  }

  return {
    triggerAtMillis: date.getTime(),
    repeatDaily,
    start: Math.min(clock.start, day ? day.start : clock.start),
    end: Math.max(clock.end, day ? day.end : clock.end),
    repeatStart: repeat ? repeat.index : null,
    repeatEnd: repeat ? repeat.index + repeat[0].length : null,
  };
}

// ---------------------------------------------------------------------
// Índices ("a segunda anotação", "apaga a 3", "a última")
// ---------------------------------------------------------------------

/**
 * Número do item citado.
 *
 * @returns {number | null} 1..N, ou `-1` para "a última".
 */
export function parseIndex(text) {
  // Dobra aqui também: a função é usada de fora (e com frase acentuada, "a
  // última" não casaria com a chave "ultima").
  const folded = foldWords(text);

  for (const word of LAST_WORDS) {
    if (new RegExp(`\\b${word}\\b`).test(folded)) return -1;
  }

  const digits = folded.match(/\b(\d{1,3})\b/);
  if (digits) return Number(digits[1]);

  for (const [word, value] of Object.entries(ORDINALS)) {
    if (new RegExp(`\\b${word}\\b`).test(folded)) return value;
  }

  return null;
}

// ---------------------------------------------------------------------
// Planos
// ---------------------------------------------------------------------

/**
 * Decide o que fazer com a frase do usuário.
 *
 * @returns {undefined | object} plano, ou `undefined` quando não é anotação nem
 *   lembrete (aí quem responde é a conversa).
 */
export function planAssistantTask(rawInput, now = Date.now()) {
  const raw = String(rawInput ?? '').trim();
  if (!raw) return undefined;
  const folded = foldWords(raw);

  if (hasAny(folded, REMINDER_TERMS) || REMINDER_IMPERATIVE.test(folded)) {
    return planReminder(raw, folded, now);
  }
  if (hasAny(folded, NOTE_TERMS)) return planNote(raw, folded);

  return undefined;
}

/**
 * Os trechos de DIA e de PERÍODO que não fazem parte de um horário.
 *
 * "me lembra amanhã" não pode virar um lembrete chamado "amanhã": o dia é
 * information, não conteúdo. E o período ("da manhã") idem.
 *
 * @param {string} folded Texto dobrado (mesmo comprimento do original).
 */
function dayAndPeriodSpans(folded) {
  const spans = [];
  const push = (word) => {
    const found = folded.search(new RegExp(`\\b${word}\\b`, 'u'));
    if (found < 0) return;
    spans.push({ start: found, end: found + word.length });
  };

  for (const word of ['depois de amanha', 'hoje', 'hj', 'amanha', 'amanh']) push(word);
  for (const word of [
    'pela manha', 'da madrugada', 'da manha', 'de manha', 'da tarde', 'a tarde',
    'de tarde', 'da noite', 'de noite', 'a noite',
  ]) {
    push(word);
  }

  return spans;
}

/**
 * Junta o DIA e a HORA em um instante único.
 *
 * É o fim da conversa por etapas: o Nexus pergunta o que é, depois o dia,
 * depois a hora, e o que sai daqui é o momento exato do toque.
 *
 * @returns {{triggerAtMillis: number, spokenTime: string} | null}
 */
export function composeReminderTime(dayText, hourText, now = Date.now()) {
  const day = parseDay(foldKeepLength(dayText), now);
  const clock = parseClock(foldKeepLength(hourText));
  if (!day || !clock) return null;

  const date = new Date(day.date);
  date.setHours(clock.hour, clock.minute, 0, 0);
  return {
    triggerAtMillis: date.getTime(),
    spokenTime: describeTrigger(date.getTime(), now),
  };
}

/**
 * Junta trechos que se sobrepõem.
 *
 * O dia pode estar DENTRO do horário ("amanhã às 18h") ou ser um trecho
 * separado ("dia 27/10" + "às 12:30"). Sobrepor é normal; cortar duas vezes a
 * mesma região é que estragaria a frase.
 */
function mergeSpans(spans) {
  const sorted = spans
    .filter((span) => span && span.start < span.end)
    .sort((first, second) => first.start - second.start);

  const merged = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push({ start: span.start, end: span.end });
    }
  }
  return merged;
}

/**
 * Estende o começo de um trecho de data para engolir o "dia" que vem antes.
 *
 * "para o dia 27/10" deixava um "dia" solto na descrição ("ir ao psicólogo
 * dia"). O dia é informação, não conteúdo: sai inteiro, com a preposição.
 */
function expandDayStart(folded, span) {
  const before = folded.slice(0, span.start);
  const match = /(?:\b(?:para|pra|pro|no|do|pelo|ate)\s+)?(?:\b[oa]s?\s+)?\bdia\s+$/.exec(before);
  if (!match) return span;
  return { start: span.start - match[0].length, end: span.end };
}

/** Descrição do lembrete: a frase sem o horário, sem o dia e sem o "todo dia". */
function reminderDescription(raw, folded, nounIndex, when, now) {
  const spans = [];

  if (when) {
    spans.push({ start: when.start, end: when.end });
    if (when.repeatStart !== null && when.repeatEnd !== null) {
      spans.push({ start: when.repeatStart, end: when.repeatEnd });
    }
  }

  /*
   * O DIA sai da descrição mesmo quando já existe hora.
   *
   * Sem isso, "ir ao psicólogo dia 27/10 às 12:30" virava um lembrete chamado
   * "ir ao psicólogo dia 27/10".
   */
  const day = parseDay(folded, now);
  if (day) spans.push(expandDayStart(folded, { start: day.start, end: day.end }));

  // Períodos soltos ("amanhã", "da manhã") que não pertencem a um horário.
  spans.push(...dayAndPeriodSpans(folded));

  let cursor = nounIndex;
  const pieces = [];
  for (const span of mergeSpans(spans)) {
    // O trecho de horário que já ficou PARA TRÁS do verbo não corta nada.
    if (span.end <= cursor) continue;
    if (span.start > cursor) pieces.push(raw.slice(cursor, span.start));
    cursor = Math.max(cursor, span.end);
  }
  pieces.push(raw.slice(cursor));

  return cleanDescription(pieces.join(' '));
}

/**
 * Separa a frase nas três peças de um lembrete: o QUE, o DIA e a HORA.
 *
 * É o que a conversa por etapas usa quando o usuário responde uma pergunta
 * ("ir ao psicólogo amanhã às 9" já responde o que, o dia e a hora de uma vez).
 *
 * @returns {{description: string, dayText: string | null, hourText: string | null}}
 */
export function extractReminderPieces(rawText, now = Date.now()) {
  const text = String(rawText ?? '');
  const folded = foldKeepLength(text);
  const day = parseDay(folded, now);
  const clock = parseClock(folded);

  const spans = [];
  if (day) spans.push(expandDayStart(folded, { start: day.start, end: day.end }));
  if (clock) spans.push({ start: clock.start, end: clock.end });
  spans.push(...dayAndPeriodSpans(folded));

  let cursor = 0;
  const pieces = [];
  for (const span of mergeSpans(spans)) {
    if (span.start > cursor) pieces.push(text.slice(cursor, span.start));
    cursor = Math.max(cursor, span.end);
  }
  pieces.push(text.slice(cursor));

  return {
    description: cleanDescription(pieces.join(' ')),
    dayText: day ? text.slice(day.start, day.end).trim() : null,
    hourText: clock ? text.slice(clock.start, clock.end).trim() : null,
  };
}

/** `true` quando a frase tem algum dos verbos (como palavra inteira). */
function hasVerb(folded, verbs) {
  return verbs.some((verb) => new RegExp(`\\b${verb}\\b`, 'u').test(folded));
}

function planReminder(raw, folded, now) {
  const wantsRead = hasAny(folded, READ_TERMS);
  const wantsDelete = hasVerb(folded, [
    'apaga', 'apagar', 'remove', 'remover', 'deleta', 'deletar', 'exclui', 'excluir',
  ]);
  // Cuidado com "para": é preposição em "lembrete PARA tomar remédio". Só conta
  // como desativar quando vem antes do nome da tarefa ("para o alarme").
  const wantsDisable =
    /\b(parar|desliga|desligar|desativa|desativar|suspende|suspender)\b/.test(folded) ||
    /\bpara\s+(?:o|a|os|as|meu|minha)\s+(?:lembrete|alarme|despertador|aviso)/.test(folded);
  // "liga" e "ligar" NÃO entram: eles são "ligar para alguém" ("me lembra de
  // ligar para a mãe"). A reativação é "ativa o lembrete".
  const wantsEnable = hasVerb(folded, ENABLE_VERBS);
  const wantsEdit = /\b(muda|mudar|troca|trocar|altera|alterar|edita|editar|ajusta|ajustar|corrige|corrigir)\b/.test(folded);
  // A PAUSA é diferente de desligar: o lembrete volta a tocar em 5 minutos.
  const wantsPause = hasVerb(folded, PAUSE_VERBS) && !wantsEdit;

  /*
   * Quem pede a CRIAÇÃO é o verbo do começo ("me lembra", "cria", "me acorda").
   *
   * Sem isso, "me lembra de LIGAR para o dentista" era lido como pedido de
   * reativar lembrete (o "ligar" da descrição virava comando) e o Nexus
   * desligava um lembrete em vez de criar outro.
   */
  const isCreate = hasVerb(folded, CREATE_VERBS);

  const index = parseIndex(folded);
  const all = /\b(todos|todas|tudo)\b/.test(folded);

  const when = parseWhen(raw, now);
  // "lembra de ..." não tem o "me lembra" no vocabulário: o corte começa
  // depois do "de" para a descrição nascer só com o assunto.
  const imperative = REMINDER_IMPERATIVE.exec(folded);
  const noun = imperative
    ? imperative.index + imperative[0].length
    : findNounIndex(folded, REMINDER_TERMS);
  const description = reminderDescription(raw, folded, noun, when, now);

  /*
   * As PEÇAS do pedido, uma a uma: o dia dito e a hora dita.
   *
   * A conversa por etapas (o que é → o dia → a hora) precisa saber o que o
   * usuário JÁ disse: "criar um lembrete para o dia 27/10 às 12 horas com o
   * nome ir ao psicólogo" já traz dia e hora — o Nexus não pergunta de novo.
   */
  const dayPart = parseDay(folded, now);
  const clockPart = parseClock(folded);
  const dayText = dayPart ? raw.slice(dayPart.start, dayPart.end).trim() : null;
  const hourText = clockPart ? raw.slice(clockPart.start, clockPart.end).trim() : null;

  /*
   * O TIPO do pedido: LEMBRETE ou ALARME.
   *
   * É o que decide a TELA que abre quando toca: o alarme é o despertador (fala
   * o horário para o usuário levantar); o lembrete é o recado ("ir ao
   * psicólogo"). "me acorda" é despertador — mas "me lembra de acordar cedo"
   * é lembrete, por isso o "me" colado no verbo.
   */
  const kind =
    /\b(alarme|alarmes|despertador|despertadores)\b/.test(folded) ||
    /\bme\s+acord/.test(folded)
      ? 'alarme'
      : 'lembrete';

  /*
   * Título quando o usuário não disse O QUE.
   *
   * A descrição fica VAZIA de propósito: é assim que a conversa por etapas
   * sabe que ainda precisa perguntar "que tipo de lembrete?". Inventar
   * "Acordar" aqui faria o Nexus pular a pergunta e criar um lembrete sem
   * assunto.
   */
  const title = deriveTitle(description, kind === 'alarme' ? 'Despertador' : 'Lembrete');

  // Apagar e pausar vêm ANTES da criação: "pausa o lembrete por 5 minutos" tem
  // tempo na frase, e sem esta ordem viraria "cria um lembrete".
  if (wantsDelete) {
    return all ? { action: 'reminder-delete', all: true } : { action: 'reminder-delete', index };
  }
  if (wantsPause) {
    return all ? { action: 'reminder-pause', all: true } : { action: 'reminder-pause', index };
  }

  // Horário dito e sem "muda/troca" é CRIAÇÃO, mesmo que a descrição tenha
  // palavras que parecem comando: "me lembra de ligar para a mãe às 3" tem um
  // "ligar" que, sozinho, parecia pedido de reativar lembrete.
  const conflicts = wantsDisable || wantsEnable;
  if (when && !wantsEdit && (isCreate || !conflicts)) {
    return {
      action: 'reminder-create',
      title,
      description,
      triggerAtMillis: when.triggerAtMillis,
      repeatDaily: when.repeatDaily,
      spokenTime: describeTrigger(when.triggerAtMillis, now),
      dayText,
      hourText,
      kind,
    };
  }

  if (wantsDisable && !wantsEnable) {
    return all ? { action: 'reminder-disable', all: true } : { action: 'reminder-disable', index };
  }
  if (wantsEnable) {
    return all ? { action: 'reminder-enable', all: true } : { action: 'reminder-enable', index };
  }
  if (wantsRead && !wantsEdit) {
    return { action: 'reminder-list' };
  }

  if (wantsEdit && index !== null && !all) {
    // "muda o lembrete 2 para as 9" deixa só o "2" como sobra: o número é o
    // índice, não uma descrição nova. Só mandamos descrição quando sobra texto
    // de verdade ("2 para comprar pão" → "comprar pão").
    const newDescription = cleanDescription(description.replace(/^\d{1,3}\s*/, ''));
    const plan = { action: 'reminder-edit', index };
    if (/[a-zà-ú]{4,}/i.test(newDescription)) plan.description = newDescription;

    if (when) {
      plan.triggerAtMillis = when.triggerAtMillis;
      plan.repeatDaily = when.repeatDaily;
      plan.spokenTime = describeTrigger(when.triggerAtMillis, now);
    }

    return plan;
  }

  return {
    action: 'reminder-create',
    title,
    description,
    triggerAtMillis: 0,
    repeatDaily: false,
    dayText,
    hourText,
    kind,
  };
}

function planNote(raw, folded) {
  const wantsDelete = /\b(apaga|apagar|remove|remover|deleta|deletar|exclui|excluir)\b/.test(folded);
  const all = /\b(todas|todos|tudo)\b/.test(folded);
  const index = parseIndex(folded);
  // "anota aí que eu preciso comprar leite": o verbo no COMEÇO manda guardar.
  // Sem isso, "anota: qual é a capital?" cairia na leitura da lista.
  // O verbo também pode vir torto ("anotaí", "anota") ou ser um sinônimo do
  // ditado ("cria uma nota", "manda uma nota").
  const firstWord = folded.split(/[^a-z0-9]+/).find((word) => word.length > 0) ?? '';
  const startsWithSave =
    /^(?:anota|anote|anotar|guarda|guardar|salva|salvar|faz|faca|cria|criar|crio)\b/.test(folded) ||
    SAVE_VERBS.some((verb) => isFuzzyMatch(firstWord, verb)) ||
    /\b(cria|criar|manda|me manda|me cria)\s+(uma?\s+)?(nota|anotacao)\b/.test(folded);
  const wantsRead = hasAny(folded, READ_TERMS);

  if (wantsDelete) {
    return all ? { action: 'note-delete', all: true } : { action: 'note-delete', index };
  }

  if (!startsWithSave && wantsRead) {
    return index !== null && !all ? { action: 'note-read', index } : { action: 'note-list' };
  }

  const noun = findNounIndex(folded, NOTE_TERMS);
  const text = cleanDescription(raw.slice(noun));
  if (!text) return { action: 'note-list' };

  return { action: 'note-save', text, title: deriveTitle(text, 'Anotação') };
}

/** Fim da última palavra-chave da tarefa (onde o assunto começa). */
function findNounIndex(folded, terms) {
  // Aceita a palavra falada torta ("me lembe as 6", "anotaí"): o índice aponta
  // para o fim do token ACHADO, para o corte da descrição sair no lugar certo.
  return findNounIndexFuzzy(folded, terms);
}

// ---------------------------------------------------------------------
// Fala e lista
// ---------------------------------------------------------------------

/** "hoje às 8 da manhã", "amanhã às 6 e meia da noite", "25/12 às 9". */
/**
 * Minutos por extenso, de 1 a 59.
 *
 * A hora é FALADA: "meio-dia e quarenta e cinco" soa como gente; "meio-dia e
 * 45" soa como leitura de tela.
 */
function spellMinutes(value) {
  const units = [
    'zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito',
    'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis',
    'dezessete', 'dezoito', 'dezenove',
  ];
  if (value < units.length) return units[value];

  const tens = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta'];
  const ten = Math.floor(value / 10);
  const unit = value % 10;
  return unit === 0 ? tens[ten] : `${tens[ten]} e ${units[unit]}`;
}

export function describeTrigger(millis, now = Date.now()) {
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) return 'sem horário';

  const days = Math.round(
    (startOfDay(date).getTime() - startOfDay(new Date(now)).getTime()) / 86_400_000,
  );
  const dayLabel =
    days === 0
      ? 'hoje'
      : days === 1
        ? 'amanhã'
        : days === 2
          ? 'depois de amanhã'
          : `${date.getDate()}/${date.getMonth() + 1}`;
  const hour = date.getHours();
  const minute = date.getMinutes();

  /*
   * A hora é falada no formato de 12 HORAS com o período — é como o relógio
   * brasileiro fala: "doze e quarenta e cinco da tarde", "uma da tarde".
   *
   * E "meia" é sempre 30 minutos: 12:30 é "meio-dia e meia", 00:30 é
   * "meia-noite e meia". Ao meio-dia e à meia-noite, os minutos continuam
   * valendo: 12:45 é "meio-dia e quarenta e cinco".
   */
  const minutesLabel = minute === 0 ? '' : minute === 30 ? ' e meia' : ` e ${spellMinutes(minute)}`;

  if (hour === 12) return `${dayLabel} ao meio-dia${minutesLabel}`;
  if (hour === 0) return `${dayLabel} à meia-noite${minutesLabel}`;

  const period = hour < 12 ? 'da manhã' : hour < 18 ? 'da tarde' : 'da noite';
  const hour12 = hour % 12;
  const minutes = minutesLabel;

  return `${dayLabel} às ${hour12}${minutes} ${period}`;
}

/**
 * O dia no formato curto: "hoje", "amanhã", "depois de amanhã" ou "25/10".
 */
function shortDayLabel(millis, now = Date.now()) {
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) return 'sem data';

  const days = Math.round(
    (startOfDay(date).getTime() - startOfDay(new Date(now)).getTime()) / 86_400_000,
  );
  if (days === 0) return 'hoje';
  if (days === 1) return 'amanhã';
  if (days === 2) return 'depois de amanhã';
  return `${date.getDate()}/${date.getMonth() + 1}`;
}

/**
 * Horário curto e falado: "às 14:00 para amanhã".
 *
 * A lista de lembretes é curta de propósito: "dentista às 14:00 para amanhã"
 * diz o que importa — o que é, que horas e quando — sem a data por extenso.
 */
export function describeReminderShort(millis, now = Date.now()) {
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) return 'sem horário';

  const pad = (value) => String(value).padStart(2, '0');
  return `às ${pad(date.getHours())}:${pad(date.getMinutes())} para ${shortDayLabel(millis, now)}`;
}

/** Data e hora no formato curto, para a lista escrita na tela. */
export function formatDateTime(millis) {
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Formata a descrição do alarme/lembrete dizendo o nome do usuário primeiro,
 * seguido da descrição, sem data/hora no áudio.
 *
 * Exemplo: "Jefferson, trabalho."
 * Ou para TRABALHO: "Jefferson, mensagem motivacional sobre trabalho"
 *
 * @param {string} userName - Nome do usuário
 * @param {string} description - Descrição do alarme/lembrete
 * @param {boolean} isWorkAlarm - Se true, usa mensagem motivacional sobre trabalho
 * @returns {string} - Frase formatada para ser falada
 */
export function formatAlarmReminderSpeech(userName, description, isWorkAlarm = false) {
  if (!userName) userName = '';

  // Para alarmes/lembretes com tema "TRABALHO", usa mensagem motivacional
  if (isWorkAlarm && description) {
    // Tema trabalho - mensagem motivacional curta
    const workMessages = [
      'Levante-se e vá atrás!',
      'Novo dia, novas conquistas.',
      'Seu esforço vale a pena.',
      'Mantenha o foco e conquiste.',
      'Comece strong, termine stronger.',
    ];
    const msg = workMessages[Math.floor(Math.random() * workMessages.length)];
    return `${userName}, ${msg}`;
  }

  // Formato padrão: apenas nome + descrição, sem data/hora
  if (userName && description) {
    return `${userName}, ${description}`;
  }
  if (userName) {
    return userName;
  }
  if (description) {
    return description;
  }
  return '';
}

/** Lista de lembretes pronta para o Nexus falar. */
export function speakReminderList(reminders, now = Date.now()) {
  if (!reminders || reminders.length === 0) {
    return 'Você não tem nenhum lembrete agendado.';
  }

  const lines = reminders.map((reminder, index) => {
    // A lista é ABREVIADA: "dentista às 14:00 para amanhã".
    const when = describeReminderShort(reminder.triggerAtMillis, now);
    const what = reminder.description || reminder.title;
    const repeat = reminder.repeatDaily ? ' (todo dia)' : '';
    const off = reminder.enabled ? '' : ' — desativado';
    return `${index + 1}. ${what} ${when}${repeat}${off}`;
  });

  const total = reminders.length;
  return `Você tem ${total} ${total === 1 ? 'lembrete' : 'lembretes'}:\n${lines.join('\n')}`;
}
