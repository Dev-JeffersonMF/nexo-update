/**
 * Texto falado (ou digitado) na correria.
 *
 * Quando a gente fala rápido, o reconhecedor erra: falta uma letra
 * ("musicha"), falta uma sílaba ("musi"), sobra uma ("musicas") ou a palavra
 * sai torta ("whatsap"). E na digitação é igual: "climma", "tca", "radu".
 *
 * Sem corrigir isso, o pedido cai na pesquisa — que entende, mas devolve uma
 * resposta genérica. O Nexus é melhor quando **entende o pedido localmente**:
 * "toca musicha do bohemian" tem que virar a mesma coisa que "toca música do
 * Bohemian Rhapsody".
 *
 * ## Como a correção funciona
 *
 * O texto é dobrado (minúsculas, sem acento) e cada PALAVRA é comparada com o
 * vocabulário de comandos do Nexus (`COMMAND_WORDS`):
 *
 * - palavra que já é do vocabulário → fica como está;
 * - palavra parecida com **uma só** palavra do vocabulário → é trocada;
 * - palavra parecida com várias → fica como está (é melhor errar o comando do
 *   que inventar um pedido).
 *
 * ## As três travas que impedem o estrago
 *
 * 1. **A primeira letra tem que ser a mesma.** É o que impede "Amanda" (nome
 *    de contato) de virar "manda" (comando). O erro de digitação costuma ser no
 *    MEIO da palavra, não no começo.
 * 2. **O corpo da mensagem nunca é tocado.** "manda pro João: toca violão" — o
 *    "toca" do meio é da MENSAGEM, não do pedido. Só a parte do comando é
 *    corrigida.
 * 3. **Palavra curta é exata.** "por", "e", "a" são perigosos de trocar.
 */

/** Normaliza para minúsculas, sem acento e com espaços simples. */
export function normalizeSpeech(input) {
  return String(input ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');
}

/**
 * O vocabulário do Nexus: as palavras que os roteadores entendem.
 *
 * Tudo que aparece aqui é "palavra de comando". Qualquer outra palavra é
 * comparada com esta lista para ver se é um erro de ditado.
 */
export const COMMAND_WORDS = [
  // música e rádio
  'toca', 'tocar', 'toque', 'coloca', 'colocar', 'coloque', 'bota', 'botar',
  'poe', 'poem', 'por', 'ouvir', 'ouve', 'escuta', 'escute', 'reproduz',
  'reproduzir', 'reproduza', 'musica', 'musicas', 'som', 'sons', 'cancao',
  'cancoes', 'playlist', 'playlists', 'album', 'albuns', 'radio', 'radios',
  'emissora', 'emissoras', 'outra', 'outro', 'proxima', 'proximo',

  // mídia
  'pausa', 'pausar', 'continua', 'continuar', 'retoma', 'retomar', 'avanca',
  'pula', 'pular', 'anterior', 'volta', 'voltar', 'parar', 'paro', 'pare',
  'desliga', 'desligar', 'desligue', 'encerra', 'encerrar',

  // WhatsApp
  'whatsapp', 'whatssap', 'whatsap', 'watsap', 'uatsap', 'zap', 'zapzinho',
  'zapzap', 'zappro', 'whats', 'wpp', 'manda', 'mandar', 'mande', 'envia',
  'enviar', 'envie', 'escreve', 'escrever', 'mensagem', 'mensagens', 'msg',
  'responde', 'responder', 'resposta',

  // ligação
  'liga', 'ligar', 'ligue', 'liguem', 'chama', 'chamar', 'chame', 'chamem',
  'disca', 'discar', 'ligacao', 'ligacoes', 'chamada', 'chamadas', 'video',
  'videochamada', 'voz', 'audio',

  // conversa e notificação
  'leia', 'ler', 'le', 'ver', 've', 'mostra', 'mostrar', 'chegou', 'chegaram',
  'quem', 'mandou',

  // buscas
  'pesquise', 'pesquisar', 'procure', 'buscar', 'busca', 'internet',
  'encontre', 'acha', 'achou',

  // aberturas
  'abra', 'abrir', 'acessar', 'acesse', 'google', 'wikipedia', 'youtube',
  'oitube', 'aplicativo', 'app', 'calculadora', 'galeria', 'camera',

  // clima
  'clima', 'tempo', 'temperatura', 'previsao',

  // notas e lembretes
  'lembrete', 'lembretes', 'lembra', 'lembre', 'lembrar', 'anota', 'anote',
  'anotacao', 'anotacoes', 'nota', 'notas', 'anotar', 'alarme', 'despertador',
  'acorda', 'acordar', 'guarda', 'salva',

  // conversa
  // Palavras de tempo NÃO entram aqui: "amanha" a uma letra de "amanda" (nome
  // de contato) fazia o nome virar data. O reconhecimento de tempo mora no
  // `assistantTasks`, que não usa esta correção.
  'ajuda', 'comandos', 'confirma', 'confirmar', 'cancela', 'cancelar', 'desiste',
  'esquece', 'quanto', 'calcula', 'calcule', 'resultado',
  // saudações (para não serem "corrigidas" para outra coisa)
  'ola', 'olá', 'oi', 'ei',
  // conectivos (entram na lista para nunca serem "corrigidos")
  'para', 'pro', 'pra', 'com', 'de', 'do', 'da', 'e', 'o', 'a', 'os', 'as',
  'em', 'no', 'na', 'num', 'numa', 'sim', 'nao', 'ok', 'isso', 'certo', 'que',
  'me', 'se', 'ai', 'aqui', 'la', 'foi',
];

const VOCABULARY = new Set(COMMAND_WORDS);

/** Onde a MENSAGEM começa (o pedido é tudo que vem antes). */
const MESSAGE_MARKERS = [
  /\b(?:dizendo|falando|com a mensagem|com o texto|que)\b/u,
  /:\s/u,
  /\s+-\s+/u,
];

/** Índice onde a mensagem começa (o fim da string quando não há mensagem). */
export function messageStartIndex(text) {
  let cut = text.length;
  for (const marker of MESSAGE_MARKERS) {
    const found = text.search(marker);
    if (found >= 0 && found < cut) cut = found;
  }
  return cut;
}

/**
 * Distância de edição (Levenshtein) com teto.
 *
 * O teto corta o cálculo: quando a distância já passou do limite, o resto não
 * interessa — e isso mantém o custo baixo mesmo com o dicionário inteiro.
 */
export function editDistance(a, b, limit = Infinity) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;

  let previous = new Array(b.length + 1);
  let current = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) previous[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    let best = current[0];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
      if (current[j] < best) best = current[j];
    }
    if (best > limit) return limit + 1;
    const swap = previous;
    previous = current;
    current = swap;
  }

  return previous[b.length];
}

/** Quantas trocas a palavra tolera antes de deixar de ser ela mesma. */
function tolerance(word) {
  if (word.length <= 3) return 0;
  if (word.length <= 4) return 1;
  if (word.length <= 9) return 2;
  if (word.length <= 14) return 3;
  return 4;
}

/**
 * Preposições: a palavra que vem DEPOIS delas é nome de gente, de música ou de
 * lugar — e nome não se corrige.
 *
 * "manda pro amanda" — o "amanda" é o nome do contato. Trocar o nome da pessoa
 * pelo nome de um comando é o pior erro possível: a mensagem vai para outra
 * pessoa.
 */
const NAME_MARKERS = new Set([
  'para', 'pro', 'pra', 'pelo', 'pela', 'no', 'na', 'nos', 'nas', 'do', 'da',
  'de', 'com', 'ao', 'aos', 'contato', 'amigo', 'amiga',
]);

/** Quantos caracteres as duas palavras têm em comum no começo. */
function commonPrefixLength(a, b) {
  const limit = Math.min(a.length, b.length);
  let index = 0;
  while (index < limit && a[index] === b[index]) index += 1;
  return index;
}

/**
 * A palavra falada é a palavra do vocabulário?
 *
 * @param {string} token A palavra ouvida/digitada.
 * @param {string} word A palavra do vocabulário.
 */
export function isFuzzyMatch(token, word) {
  if (!token || !word) return false;
  if (token === word) return true;

  // Trava 3: palavra curta é exata. "pão" (3 letras) a uma letra de "paro"
  // (4) mudaria a descrição do lembrete — e palavra curta é onde o erro
  // custa mais caro.
  if (token.length < 4 || word.length < 4) return false;

  // Trava 1: a primeira letra tem que ser a mesma. Sem isso, "Amanda" (nome
  // de contato) vira "manda" (comando) e o Nexus manda mensagem para a pessoa
  // errada.
  if (token[0] !== word[0]) return false;

  const limit = tolerance(word);
  if (limit === 0) return false;

  // Faltou a sílaba do fim: "musi" → "musica", "rad" → "radio".
  //
  // Trava extra: infinitivos não contam. "chegar" termina em "chegaram", e a
  // regra virava "quanto tempo a luz do sol leva para CHEGAR na terra" em
  // "...chegaram" — que o roteador lia como "o que chegou?" e abria a
  // mensagem do WhatsApp no meio de uma curiosidade. Palavra CORTADA pelo
  // ditado não termina em "r"/"s": quem termina é o verbo certo que o
  // usuário falou.
  if (
    word.length > token.length &&
    word.length - token.length <= 3 &&
    word.startsWith(token) &&
    !/[rs]$/i.test(token)
  ) {
    return true;
  }

  const distance = editDistance(token, word, limit);
  if (distance > limit) return false;

  /*
   * Trava 4: o erro de ditado é no FIM da palavra, não no começo.
   *
   * É o que separa "cerca" (nome de música) de "certo" (palavra do
   * vocabulário) e "maria" (nome de contato) de "manda" (comando): as duas
   * palavras de cada par estão a uma ou duas trocas uma da outra, mas o
   * começo delas é diferente.
   *
   * O que NÃO vale como erro de ditado: "tempo" → "tenta", "video" → "viado".
   */
  const prefix = commonPrefixLength(token, word);
  if (prefix < Math.min(token.length, word.length) - 1) return false;

  /*
   * Trava 5: token COMPLETO + sufixo NÃO é erro de ditado.
   *
   * "chegar" + "am" = "chegaram": a "correção" inventava uma flexão de
   * verbo que o usuário não falou — "quanto tempo a luz do sol leva para
   * chegar na Terra" virava "...chegaram", que o roteador lia como
   * "o que chegou?" e abria a mensagem do WhatsApp no meio da curiosidade.
   * Palavra do vocabulário que é um infinitivo/plural COMPLETO mais um
   * pedaço é OUTRA palavra, não a mesma dita torta.
   */
  if (word.length > token.length + 1 && word.startsWith(token) && /[rs]$/.test(token)) {
    return false;
  }

  return prefix >= distance + 1;
}

/** Corrige as palavras do pedaço do comando, uma a uma. */
function repairTokens(text) {
  const tokens = text.split(' ');
  let previous = '';

  return tokens
    .map((token) => {
      if (!token) return token;
      if (VOCABULARY.has(token)) return token;
      // Números e símbolos nunca são comando.
      if (/\d/.test(token)) return token;

      // Nome de gente, música ou lugar: não se corrige.
      if (NAME_MARKERS.has(previous)) {
        previous = token;
        return token;
      }
      previous = token;

      // Candidatos: as palavras do vocabulário que a palavra falada poderia ser.
      const candidates = [];
      for (const word of COMMAND_WORDS) {
        if (!isFuzzyMatch(token, word)) continue;
        candidates.push({ word, distance: editDistance(token, word, 4) });
      }
      if (candidates.length === 0) return token;

      // Vence a mais próxima; no empate, a mais curta ("musica" antes de
      // "musicas").
      candidates.sort((a, b) =>
        a.distance === b.distance ? a.word.length - b.word.length : a.distance - b.distance,
      );
      const best = candidates[0];
      const ties = candidates.filter(
        (item) => item.distance === best.distance && item.word.length === best.word.length,
      );

      // Empate de verdade (duas palavras igualmente próximas e do mesmo
      // tamanho): a palavra fica como está. Inventar comando é pior do que não
      // entender.
      if (ties.length > 1) return token;

      return best.word;
    })
    .join(' ');
}

/**
 * Corrige o texto do pedido para o roteador entender.
 *
 * @param {string} text Texto já normalizado (minúsculas, sem acento).
 * @returns {string} O texto com as palavras do pedido corrigidas.
 */
export function repairCommand(text) {
  const source = String(text ?? '');
  if (!source) return source;

  // Trava 2: o corpo da MENSAGEM não é tocado. Só o pedido (a parte antes da
  // mensagem) é corrigido — é lá que está o verbo e o canal.
  const cut = messageStartIndex(source);
  const head = source.slice(0, cut);
  const tail = source.slice(cut);
  if (!head.trim()) return source;

  return repairTokens(head) + tail;
}

/**
 * O texto tem alguma palavra do vocabulário (de forma exata ou parecida)?
 *
 * Usado onde a correção de texto não pode ser aplicada (o texto é usado para
 * cortar a frase original por índice).
 *
 * @param {string} text Texto já normalizado.
 * @param {string[]} words
 */
export function containsAnyFuzzy(text, words) {
  const tokens = String(text ?? '').split(/[^a-z0-9]+/u).filter(Boolean);
  if (tokens.length === 0) return false;

  for (const token of tokens) {
    if (words.some((word) => word === token)) return true;
  }
  for (const token of tokens) {
    if (token.length < 4) continue;
    if (words.some((word) => isFuzzyMatch(token, word))) return true;
  }
  return false;
}

/**
 * O texto contém a FRASE, palavra por palavra, tolerando o erro de ditado?
 *
 * "me lembe as 6" contém "me lembre" — com a palavra do meio faltando a
 * letra. A frase inteira é exigida: "avisa" sozinho não é pedido de lembrete,
 * "me avisa" é.
 *
 * @param {string} text Texto já normalizado.
 * @param {string} phrase Frase do vocabulário (pode ter espaço).
 */
export function containsPhraseFuzzy(text, phrase) {
  const words = String(phrase ?? '').split(' ').filter(Boolean);
  if (words.length === 0) return false;

  const tokens = String(text ?? '').split(/[^a-z0-9]+/u).filter(Boolean);
  for (let start = 0; start + words.length <= tokens.length; start += 1) {
    let ok = true;
    for (let k = 0; k < words.length; k += 1) {
      const token = tokens[start + k];
      const word = words[k];
      if (token === word) continue;
      if (!isFuzzyMatch(token, word)) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/**
 * Índice (no texto normalizado) onde termina a última palavra-chave achada.
 *
 * Devolve o mesmo que uma busca exata faria, mas aceitando a palavra falada
 * torta ("lembre" → "lembrete"). É o índice que corta a frase original: por
 * isso ele aponta para o fim do token ACHADO, e não para o fim da palavra do
 * vocabulário.
 *
 * @param {string} text Texto já normalizado.
 * @param {string[]} terms
 */
export function findNounIndexFuzzy(text, terms) {
  let end = 0;

  // Frase exata ("me avisa") e palavra exata ("lembrete").
  for (const term of terms) {
    const found = text.lastIndexOf(term);
    if (found >= 0 && found + term.length > end) end = found + term.length;
  }
  if (end > 0) return end;

  // Palavra falada torta ("lembre" no lugar de "lembrete").
  const single = terms.filter((term) => !term.includes(' '));
  if (single.length === 0) return end;

  const tokens = String(text ?? '').split(/[^a-z0-9]+/u);
  let cursor = 0;
  for (const token of tokens) {
    const start = cursor;
    cursor += token.length + 1;
    if (!token || token.length < 4) continue;
    if (!single.some((term) => isFuzzyMatch(token, term))) continue;
    if (start + token.length > end) end = start + token.length;
  }

  return end;
}
