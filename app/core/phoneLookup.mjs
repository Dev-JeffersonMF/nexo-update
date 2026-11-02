/**
 * Busca de telefone na internet — a parte "pensante", sem rede.
 *
 * O Nexus precisa ligar para lugares que NÃO estão na agenda ("UPA de
 * Matozinhos", "táxi", "farmácia"). Ele pesquisa, extrai o telefone do
 * resultado, e só então pede confirmação ao usuário antes de discar.
 *
 * Este arquivo não faz requisição nenhuma: recebe o HTML já baixado e devolve a
 * melhor aposta. É de propósito — assim dá para testar com HTML de exemplo, sem
 * depender da internet nem de um serviço específico.
 */

/**
 * Cidade padrão usada quando o usuário não diz onde fica o lugar.
 *
 * É o município do usuário; serve só para a busca não trazer uma UPA de outro
 * estado. Mudar aqui muda o padrão de todas as buscas.
 */
export const DEFAULT_CITY = 'Matozinhos MG';

/** Palavras que não ajudam a identificar o lugar (saem da pontuação de acerto). */
const STOPWORDS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'e', 'o', 'a', 'os', 'as', 'em', 'no', 'na',
  'nos', 'nas', 'para', 'pra', 'por', 'com', 'um', 'uma', 'que', 'qual', 'seu',
  'sua', 'meu', 'minha', 'the', 'and',
  // palavras do próprio pedido
  'telefone', 'telefonar', 'ligar', 'ligacao', 'ligação', 'numero', 'número',
  'fone', 'contato', 'chamar', 'chama', 'quero', 'queria', 'preciso', 'favor',
  'por', 'me', 'ai', 'ai', 'agora', 'rapido', 'rápido', 'numero', 'discar',
]);

/**
 * Palavras que indicam um LUGAR/estabelecimento (e não uma pessoa).
 *
 * Só quando uma delas aparece é que o Nexus vai procurar telefone na internet.
 * Sem isso, "liga para o João" que não está na agenda viraria uma ligação para
 * um João aleatório encontrado na web.
 */
const PLACE_WORDS = [
  'upa', 'ubs', 'hospital', 'posto de saude', 'posto', 'clinica', 'farmacia',
  'drogaria', 'laboratorio', 'taxi', 'policia', 'bombeiro', 'samu', 'mercado',
  'supermercado', 'padaria', 'restaurante', 'lanchonete', 'pizzaria',
  'posto de gasolina', 'mecanica', 'escola', 'colegio', 'faculdade', 'cartorio',
  'banco', 'loterica', 'correios', 'prefeitura', 'academia', 'salao',
  'barbearia', 'veterinaria', 'petshop', 'pet shop', 'hotel', 'pousada',
  'oficina', 'loja', 'papelaria', 'hortifruti', 'acougue', 'sorveteria',
  'igreja', 'delegacia', 'detran', 'inss', 'agencia', 'consultorio',
  'dentista', 'otica', 'farmacia popular', 'ubs', 'cemig', 'copasa',
];

/**
 * Tira acento, caixa e pontuação — a base de toda comparação de texto.
 *
 * NUNCA usar em telefone: a pontuação faz parte do número.
 */
export function foldText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `true` quando o texto cita um lugar/estabelecimento conhecido. */
export function isPlaceQuery(text) {
  const folded = foldText(text);
  if (!folded) return false;
  return PLACE_WORDS.some((word) => {
    const target = foldText(word);
    return new RegExp(`(^|\\s)${target.replace(/\s+/g, '\\s+')}(\\s|$)`).test(folded);
  });
}

/** `true` quando o texto JÁ é um telefone digitado/falado. */
export function looksLikePhoneNumber(text) {
  const digits = String(text ?? '').replace(/\D/g, '');
  if (digits.length < 8) return false;
  // Sobra de texto além dos dígitos/sinais de telefone? Então não é número.
  const leftovers = String(text ?? '')
    .replace(/[\d\s()+-]/g, '')
    .replace(/[a-z]/gi, '');
  return leftovers.length === 0;
}

/** Monta a consulta de busca, acrescentando a cidade quando ela não foi dita. */
export function buildPhoneSearchQuery(text, city = DEFAULT_CITY) {
  const base = String(text ?? '').trim();
  const folded = foldText(base);
  const cityToken = foldText(city).split(' ')[0];
  const needsCity = Boolean(city) && cityToken.length > 2 && !folded.includes(cityToken);
  return `${base}${needsCity ? ` ${city}` : ''} telefone`.trim();
}

// ---------------------------------------------------------------------
// Extração de telefones brasileiros
// ---------------------------------------------------------------------

/**
 * Padrões aceitos (do mais específico para o mais solto):
 *  - (31) 3712-0401 / (31) 99999-9999
 *  - +55 31 3712-0401 / 55 31 99999-9999
 *  - 0800 123 4567
 *  - 31 3712-0401 / 31 99999-9999
 *
 * O padrão solto exige um separador depois do DDD, então CEPs como "35720-000"
 * e códigos como "CNES 2158639" ficam de fora.
 */
const PHONE_PATTERNS = [
  /\(\s*(\d{2})\s*\)\s*(\d{4,5})[\s.-]?(\d{4})/g,
  /(?:\+|\b)55\s*\(?\s*(\d{2})\s*\)?[\s.-]*(\d{4,5})[\s.-]?(\d{4})\b/g,
  /\b(0800)[\s.-]?(\d{3})[\s.-]?(\d{4})\b/g,
  /\b(\d{2})[\s.-](\d{4,5})[\s.-]?(\d{4})\b/g,
];

/** DDD válido no Brasil + tamanho certo. Corta ruído (CEP, código, ano). */
export function isValidPhone(digits) {
  if (!/^\d+$/.test(digits)) return false;
  if (/^0800\d{7}$/.test(digits)) return true;
  if (digits.length !== 10 && digits.length !== 11) return false;
  const ddd = Number(digits.slice(0, 2));
  if (ddd < 11 || ddd > 99) return false;
  const subscriber = digits.slice(2);
  if (/^0+$/.test(subscriber)) return false;
  // Números de 11 dígitos são celulares: começam com 9.
  if (digits.length === 11 && subscriber[0] !== '9') return false;
  return true;
}

/** Formata para leitura/fala: "(31) 3712-0401". */
export function formatPhoneBR(digits) {
  if (/^0800\d{7}$/.test(digits)) {
    return `0800 ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return digits;
}

/**
 * Todos os telefones válidos de um texto, sem repetir.
 *
 * @returns {{digits: string, formatted: string, raw: string}[]}
 */
export function extractPhones(text) {
  const source = String(text ?? '');
  const found = new Map();

  for (const pattern of PHONE_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const digits = match.slice(1).join('');
      if (!isValidPhone(digits)) continue;
      if (!found.has(digits)) {
        found.set(digits, { digits, formatted: formatPhoneBR(digits), raw: match[0] });
      }
      // Evita loop infinito em padrões que casam vazio.
      if (match.index === pattern.lastIndex) pattern.lastIndex += 1;
    }
  }

  return [...found.values()];
}

// ---------------------------------------------------------------------
// Leitura do HTML de resultado do DuckDuckGo
// ---------------------------------------------------------------------

/**
 * Entidades HTML que aparecem de verdade nos resultados em português.
 *
 * A tabela cobre o bloco Latin-1 (acentos, cedilha, ordinais) e as versões em
 * maiúscula são derivadas dela — não vale a pena escrever as duas.
 */
const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  deg: '°',
  ordf: 'ª',
  ordm: 'º',
  aacute: 'á',
  agrave: 'à',
  acirc: 'â',
  atilde: 'ã',
  auml: 'ä',
  aring: 'å',
  aelig: 'æ',
  ccedil: 'ç',
  eacute: 'é',
  egrave: 'è',
  ecirc: 'ê',
  euml: 'ë',
  iacute: 'í',
  igrave: 'ì',
  icirc: 'î',
  iuml: 'ï',
  ntilde: 'ñ',
  oacute: 'ó',
  ograve: 'ò',
  ocirc: 'ô',
  otilde: 'õ',
  ouml: 'ö',
  oslash: 'ø',
  uacute: 'ú',
  ugrave: 'ù',
  ucirc: 'û',
  uuml: 'ü',
  yacute: 'ý',
  yuml: 'ÿ',
  szlig: 'ß',
};

// &Ccedil; → Ç, &Aacute; → Á...
for (const [name, char] of Object.entries(ENTITIES)) {
  ENTITIES[name[0].toUpperCase() + name.slice(1)] = char.toUpperCase();
}

/** Converte um código numérico em caractere, sem quebrar com valor inválido. */
function codePointToChar(code) {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/** Troca entidades HTML comuns e numéricas pelo caractere real. */
export function decodeHtmlEntities(value) {
  return String(value ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => codePointToChar(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => codePointToChar(Number(dec)))
    .replace(/&([a-z][a-z0-9]*);/gi, (_, name) => ENTITIES[name] ?? ENTITIES[name.toLowerCase()] ?? '');
}

/** Remove as tags e devolve texto puro, com espaços normalizados. */
export function stripTags(value) {
  return decodeHtmlEntities(String(value ?? '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Lê o HTML do endpoint `html.duckduckgo.com/html/` e devolve os resultados.
 *
 * @returns {{title: string, url: string, snippet: string}[]}
 */
export function parseDuckDuckGoResults(html) {
  const source = String(html ?? '');
  const titles = collectMatches(source, /<a[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/g);
  const urls = collectMatches(source, /<a[^>]*class="result__url"[^>]*>([\s\S]*?)<\/a>/g);
  const snippets = collectMatches(source, /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g);

  return titles.map((title, index) => ({
    title: stripTags(title),
    url: stripTags(urls[index] ?? ''),
    snippet: stripTags(snippets[index] ?? ''),
  }));
}

function collectMatches(source, pattern) {
  const values = [];
  let match;
  while ((match = pattern.exec(source)) !== null) values.push(match[1]);
  return values;
}

/** Domínio do resultado, usado só para dizer de onde veio o número. */
export function hostOf(url) {
  const match = String(url ?? '').match(/^(?:[a-z]+:\/\/)?([^/\s]+)/i);
  return (match?.[1] ?? '').replace(/^www\./i, '');
}

/**
 * Escolhe o telefone mais provável para a consulta.
 *
 * Regra: vale a "votação" dos resultados. Um número que aparece em vários
 * resultados — e cujos títulos batem com o que o usuário pediu — ganha de um
 * número solto em um resultado qualquer.
 *
 * @returns {null | {
 *   found: boolean, digits: string, formatted: string, title: string,
 *   source: string, confidence: 'alta'|'média'|'baixa', votes: number,
 *   candidates: {digits: string, formatted: string, title: string}[]
 * }}
 */
export function pickPhoneCandidate(results, query = '') {
  const list = Array.isArray(results) ? results : [];
  const tokens = foldText(query)
    .split(' ')
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));

  const scores = new Map();

  list.forEach((result, index) => {
    const phones = extractPhones(`${result.title} ${result.snippet}`);
    if (phones.length === 0) return;

    const foldedTitle = foldText(result.title);
    const matched = tokens.filter((token) => foldedTitle.includes(token)).length;
    const needed = Math.max(1, Math.ceil(tokens.length * 0.6));
    // Resultado que não tem nada a ver com o pedido não vota: sem isso, uma
    // busca por "padaria do zé" podia devolver o telefone de qualquer página
    // que aparecesse junto.
    const weight = tokens.length === 0 ? 1 : matched >= needed ? 3 : matched > 0 ? 2 : 0;
    if (weight === 0) return;

    for (const phone of phones) {
      const entry = scores.get(phone.digits) ?? {
        digits: phone.digits,
        formatted: phone.formatted,
        score: 0,
        hits: 0,
        title: result.title,
        source: hostOf(result.url),
        index,
      };
      entry.score += weight;
      entry.hits += 1;
      if (index < entry.index) {
        entry.title = result.title;
        entry.source = hostOf(result.url);
        entry.index = index;
      }
      scores.set(phone.digits, entry);
    }
  });

  const ranked = [...scores.values()].sort(
    (a, b) => b.score - a.score || b.hits - a.hits || a.index - b.index,
  );

  const best = ranked[0];
  if (!best) return null;

  return {
    found: true,
    digits: best.digits,
    formatted: best.formatted,
    title: best.title,
    source: best.source,
    votes: best.hits,
    confidence: best.score >= 6 && best.hits >= 2 ? 'alta' : best.score >= 3 ? 'média' : 'baixa',
    candidates: ranked.slice(0, 3).map((entry) => ({
      digits: entry.digits,
      formatted: entry.formatted,
      title: entry.title,
    })),
  };
}
