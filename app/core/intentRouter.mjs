import { normalizeSpeech, repairCommand } from './speechText.mjs';

const QUICK_LINKS = {
  google: {
    url: 'https://www.google.com/',
    name: 'Google',
  },
  youtube: {
    url: 'https://www.youtube.com/',
    name: 'YouTube',
  },
  wikipedia: {
    url: 'https://www.wikipedia.org/',
    name: 'Wikipedia',
  },
  whatsapp: {
    url: 'https://wa.me/',
    name: 'WhatsApp',
  },
};

function parseExpression(source) {
  const expression = source.replace(/,/g, '.');
  const tokens = expression.match(/\d+(?:\.\d+)?|[()+\-*/%×÷]/g);
  if (!tokens || tokens.join('') !== expression.replace(/\s/g, '') || tokens.length > 80) {
    return undefined;
  }

  let position = 0;
  const peek = () => tokens[position];
  const consume = () => tokens[position++];

  function parseFactor() {
    if (peek() === '+') {
      consume();
      return parseFactor();
    }
    if (peek() === '-') {
      consume();
      return -parseFactor();
    }
    if (peek() === '(') {
      consume();
      const value = parseSum();
      if (consume() !== ')') throw new Error('Parênteses inválidos.');
      return value;
    }
    const token = consume();
    if (token === undefined || !/^\d+(?:\.\d+)?$/.test(token)) {
      throw new Error('Expressão inválida.');
    }
    return Number(token);
  }

  function parseProduct() {
    let value = parseFactor();
    while (['*', '/', '%', '×', '÷'].includes(peek())) {
      const operator = consume();
      const right = parseFactor();
      if ((operator === '/' || operator === '÷' || operator === '%') && right === 0) {
        throw new Error('Não é possível dividir por zero.');
      }
      if (operator === '*' || operator === '×') value *= right;
      else if (operator === '%') value %= right;
      else value /= right;
    }
    return value;
  }

  function parseSum() {
    let value = parseProduct();
    while (peek() === '+' || peek() === '-') {
      const operator = consume();
      const right = parseProduct();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  }

  try {
    const result = parseSum();
    if (position !== tokens.length || !Number.isFinite(result)) return undefined;
    return result;
  } catch {
    return undefined;
  }
}

function formatNumber(value) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 8 }).format(value);
}

/**
 * Verbos de ligação, usados para NÃO confundir pesquisa de telefone com
 * pesquisa na web ("pesquise o número da UPA e ligue" é uma chamada).
 */
const CALL_TOKENS =
  /\b(liga|ligue|ligar|chama|chame|chamar|disca|disque|discar|telefona|telefone|telefonar)\b/;

/**
 * Resolves only deterministic, explicitly supported local requests.
 * @param {string} input
 * @param {Date} [now]
 * @param {{name?: string}} [options] Nome do usuário (saudação pessoal).
 * @returns {{kind: 'reply', text: string} | {kind: 'open-link', url: string, confirmation: string} | {kind: 'search', query: string} | undefined}
 */
export function resolveLocalCommand(input, now = new Date(), options = {}) {
  const text = input.trim().replace(/\s+/g, ' ');
  // O texto dobrado E corrigido ("que horas sao" ditado torto ainda é understood).
  // A busca na internet usa o texto ORIGINAL: corrigir o que o usuário pediu
  // para pesquisar seria mudar o pedido dele.
  const normalized = repairCommand(normalizeSpeech(text));

  if (
    /^(?:oi|ola|e ai|bom dia|boa tarde|boa noite|tudo bem)(?:\s+\w+)?(?:\s*,?\s*(tudo bem|tudo bom|beleza))?[!.?\s]*$/.test(
      normalized,
    )
  ) {
    // Saudação pessoal: o Nexus sabe o nome (veio do onboarding) e responde de
    // acordo com a hora do dia. Sem o nome, a frase continua funcionando.
    // Aceita "Olá Neto", "Oi Edson", etc. (nome opcional após a saudação).
    const hour = now.getHours();
    const salutation = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
    const who = typeof options?.name === 'string' ? options.name.trim() : '';
    const call = who ? `, ${who}` : '';
    return { kind: 'reply', text: `${salutation}${call}! Estou aqui. O que você precisa?` };
  }

  if (/^(ajuda|o que voce faz|quais comandos|que comandos voce entende|como voce pode ajudar)[?.! ]*$/.test(normalized)) {
    return {
      kind: 'reply',
      text: 'Posso responder data e hora, fazer contas simples, criar lembretes e alarmes, avisar das mensagens e pesquisar na internet sem abrir o navegador. Também abro Google, YouTube, Wikipedia ou WhatsApp quando você pedir.',
    };
  }

  if (
    /^(?:que horas(?: sao| e agora)?(?: agora)?|qual (?:e )?(?:a hora|o horario)(?: agora)?|me (?:diga|informa|informe) as horas|as horas|horas)[?.! ]*$/.test(
      normalized,
    )
  ) {
    return {
      kind: 'reply',
      text: `Agora são ${new Intl.DateTimeFormat('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      }).format(now)}.`,
    };
  }

  if (/^(que dia e hoje|qual e a data(?: de hoje)?|qual a data de hoje|data de hoje)[?.! ]*$/.test(normalized)) {
    return {
      kind: 'reply',
      text: `Hoje é ${new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'full',
      }).format(now)}.`,
    };
  }

  const calculation = normalized.match(/^(?:quanto (?:e|da|sao)|calcule?|resultado de)\s+(.+?)[?.!]*$/);
  if (calculation) {
    const result = parseExpression(calculation[1]);
    return {
      kind: 'reply',
      text: result === undefined
        ? 'Não consegui calcular essa expressão. Confira os números e operadores (+, -, ×, ÷) e tente novamente.'
        : `${calculation[1]} = ${formatNumber(result)}.`,
    };
  }

  const search = text.match(/^(?:pesquise|pesquisar|procure|buscar)\s+(?:na internet\s+)?(.+)$/iu);
  /*
   * "pesquise o número da UPA de Matozinhos E LIGUE" é uma LIGAÇÃO, não uma
   * pesquisa na web: se a busca da internet pegasse a frase primeiro, o Nexus
   * abriria o Google e nunca discaria. Quem cuida desse pedido é o roteador de
   * comandos nativos (com busca de telefone e confirmação antes de ligar).
   *
   * A pesquisa em si é INTERNA: devolve a consulta para a interface chamar a
   * busca do Nexus e falar a resposta. Abrir o navegador aqui tirava o usuário
   * do app no meio do pedido.
   */
  if (search && !CALL_TOKENS.test(normalized)) {
    return { kind: 'search', query: search[1].trim() };
  }

  const open = normalized.match(
    /^(?:abra|abrir|acesse|acessar)\s+(?:o |a |os |as )?(google|youtube|wikipedia|whatsapp)[?.! ]*$/,
  );
  if (open) {
    const site = QUICK_LINKS[open[1]];
    return {
      kind: 'open-link',
      url: site.url,
      confirmation: `Abri o site do ${site.name}.`,
    };
  }

  // Pausa / retoma a fila de notificações de mensagens.
  // Quando pausado, novas notificações ainda entram na fila mas o NEXOS não
  // começa a ler a próxima até o usuário retomar — ideal para não ser
  // interrompido no meio de outro comando.
  if (/^(?:pausa|pausar|para|parar|pare|cala a boca|cale a boca|nexos pare|nexo pare)\s+(?:as |a |os |as )?(notificações|notificacoes|mensagens|avisos)?[?.! ]*$/.test(normalized)) {
    return { kind: 'pause-notifications' };
  }
  if (/^(?:retoma|retomar|volta|voltar|despausa|despausar)\s+(?:as |a |os |as )?(notificações|notificacoes|mensagens|avisos)?[?.! ]*$/.test(normalized)) {
    return { kind: 'resume-notifications' };
  }

  return undefined;
}
