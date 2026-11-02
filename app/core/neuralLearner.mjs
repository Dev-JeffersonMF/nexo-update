// Rede neural leve (JS puro) para aprender com o uso do NexusAssistente.
//
// É a MATRIZ DE LIGAÇÃO do aprendizado: recebe frases (ditado informal
// brasileiro), liga cada palavra/frase a uma INTENÇÃO e devolve a melhor
// aposta. Ela NÃO executa nada — quem executa são os roteadores determinísticos
// do Nexus (via `neuralIntent.mjs`), que transformam a intenção aprendida em um
// pedido canônico com as MESMAS confirmações e travas de segurança de sempre.
//
// Duas visões do mesmo aprendizado, somadas na predição:
//  1. Rede feedforward 256 -> 32 -> N (intents), SGD online — aprende a frase
//     inteira (unigramas + bigramas via hashing trick);
//  2. Ligação de PALAVRAS (Naive Bayes multinomial): cada palavra de conteúdo
//     acumula a intenção das frases em que apareceu. É o que faz "tempo" virar
//     "clima" com UM exemplo: "tempo" e "clima" passam a puxar para a MESMA
//     intenção porque apareceram no mesmo tipo de pedido.
//
// Aprendizado no dia a dia (todo ele persistido):
//  - acerto:   `train(texto, intent)` a cada comando que deu certo;
//  - correção: `learnFromCorrection` liga a frase que o Nexus não entendeu à
//     intenção da frase que o usuário REPETIU de outro jeito (janela curta e
//     sobreposição de palavras — sem isso a rede não aprende erro);
//  - feedback negativo: `registerNegative` cria a intenção fantasma
//     `resposta_errada`, que rouba probabilidade das outras — a frase volta a
//     não auto-executar.

const INPUT_SIZE = 256;
const HIDDEN_SIZE = 32;
const LEARNING_RATE = 0.05;

/**
 * Peso do classificador de palavras (Naive Bayes) no somatório.
 *
 * 0.75 de propósito: quem generaliza a LIGAÇÃO de palavras com um ou dois
 * exemplos ("tempo" passa a valer "clima") é o modelo de palavras — a rede
 * feedforward precisa de centenas de repetições para o mesmo efeito, e no
 * começo do uso ela só atrapalharia. Com o tempo as duas convergem para a
 * mesma resposta e o peso exato deixa de importar.
 */
const WORD_MODEL_WEIGHT = 0.75;

/** Confiança mínima para a predição valer como intenção. */
export const MIN_CONFIDENCE = 0.62;

/** Limite de palavras guardadas (controla o tamanho do estado persistido). */
const MAX_WORDS = 800;

/** Arredonda para 4 casas: é o que mantém o JSON salvo pequeno. */
function round4(value) {
  return Math.round(value * 10000) / 10000;
}

/**
 * Palavras que não carregam intenção: artigos, preposições, cortesias e
 * verbos que aparecem em TODO tipo de pedido ("me passa", "quero").
 *
 * Palavras de CONTEÚDO ("tempo", "clima", "chuva", "matozinhos") ficam de
 * fora da lista de propósito: a ligação entre elas é justamente o que a
 * rede tem que aprender.
 *
 * Inclui gíria escolar, juvenil e informal brasileira (faixa 10-40 anos).
 */
const NEUTRAL_WORDS = new Set([
  // cortesia e pedido (incluindo variações informais brasileiras)
  'me', 'informe', 'informar', 'informa', 'passa', 'passar', 'diga', 'fala',
  'falar', 'quero', 'queria', 'quero', 'gostaria', 'pode', 'poderia', 'por',
  'favor', 'pfv', 'voce', 'vc', 'voce', 'eu', 'pra', 'pro', 'para', 'por favor',
  'manda', 'mandar', 'mande', 'faz', 'fazer', 'faca', 'fazer', 'da', 'deu',
  'ta', 'tava', 'to', 'esta', 'estou', 'estamos', 'vai', 'vou', 'vem',
  // conectivos e artigos
  'e', 'o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da',
  'dos', 'das', 'em', 'no', 'na', 'nos', 'nas', 'que', 'qual', 'quais',
  'como', 'esta', 'esta', 'ta', 'sobre', 'saber', 've', 'ver', 'mostra',
  'mostrar', 'la', 'ai', 'aqui', 'hoje', 'agora', 'sim', 'nao', 'ok',
  'entao', 'entao', 'porque', 'pq', 'pqe', 'so', 'tambem', 'tb',
  // verbos que aparecem em (quase) toda intenção
  'toca', 'tocar', 'toque', 'coloca', 'colocar', 'coloque', 'bota', 'botar',
  'poe', 'por', 'quero', 'ouvir', 'ouve', 'escuta', 'escute',
  'liga', 'ligar', 'liga', 'chama', 'chamar', 'manda', 'mandar',
  'pesquisa', 'pesquisar', 'procura', 'procurar', 'busca', 'buscar',
  'abre', 'abrir', 'abre', 'fecha', 'fechar',
  // gíria/informal escolar/juvenil (10-40 anos) — não carregam intenção
  'ta', 'tao', 'tao', 'tipo', 'tipo', 'né', 'ne', 'entao', 'então', 'ai',
  'aí', 'é', 'eh', 'é', 'mano', 'mana', 'véi', 'vei', 'velho', 'bro',
  'brother', 'parça', 'parca', 'colega', 'galera', 'turma', 'pessoal',
  'cara', 'cara', 'truta', 'irmão', 'irmao', 'irma', 'brother',
  'demais', 'top', 'topzera', 'show', 'showzera', 'massa', 'legal',
  'daora', 'irado', 'sinistro', 'brabo', 'cabra', 'firmeza', 'fechou',
  'beleza', 'blz', 'blz', 'certo', 'certinho', 'exato', 'combinado',
  'bora', 'bora', 'vamo', 'vambora', 'partiu', 'partiu', 'bora lá',
  'relaxa', 'relaxa', 'de boa', 'deboa', 'suave', 'tranquilo', 'tranqui',
  'sem estresse', 'sem problema', 'sem prob', 'tá tudo bem', 'tudo bem',
  'escola', 'colégio', 'colegio', 'aula', 'prova', 'trabalho', 'tarefa',
  'lição', 'licao', 'dever', 'estudo', 'estudar', 'estudando', 'estudei',
  'nota', 'notas', 'conceito', 'recuperação', 'recuperacao', 'reprova',
  'aprovado', 'passar', 'passou', 'reprovado', 'reprovei',
  'professor', 'professora', 'prof', 'mestre', 'diretor', 'coordenador',
  'colegio', 'faculdade', 'uni', 'universidade', 'vestibular', 'enem',
  'simulado', 'redação', 'redacao', 'dissertação', 'dissertacao',
  'matemática', 'matematica', 'português', 'portugues', 'história',
  'historia', 'geografia', 'biologia', 'química', 'quimica', 'física',
  'fisica', 'inglês', 'ingles', 'espanhol', 'filosofia', 'sociologia',
  'cola', 'colar', 'colou', 'cola na prova', 'chute', 'chutou', 'chutando',
  'resposta', 'respostas', 'gabarito', 'questão', 'questao', 'alternativa',
  'multiple choice', 'v ou f', 'verdadeiro ou falso',
  // slang de resposta curta / conversa
  'sim', 'não', 'nao', 'num', 'num', 'hum', 'hmm', 'aha', 'aham',
  'certo', 'exato', 'com certeza', 'com certeza', 'óbvio', 'obvio',
  'pode crer', 'pode crer', 'fechado', 'fechou', 'combinado', 'tá',
  'ta', 'ok', 'beleza', 'blz', 'show', 'certo', 'entendido', 'entendi',
  'não sei', 'nao sei', 'sei lá', 'seila', 'sei la', 'talvez',
  'provavelmente', 'provavelmente', 'as vezes', 'as vezes', 'quem sabe',
  'pode ser', 'pode ser', 'depende', 'depende',
  // interjeições e preenchedores
  'ah', 'oh', 'eh', 'ehn', 'hum', 'hmm', 'é', 'é', 'né', 'ne',
  'poxa', 'puxa', 'caramba', 'caraca', 'nossa', 'nossa',
  'putz', 'pqp', 'foda', 'foda-se', 'fodasse', 'merda', 'merda',
  'droga', 'droga', 'aff', 'affs', 'ai', 'ai', 'ui', 'ui',
]);

function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % INPUT_SIZE;
}

function normalizePt(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Palavras de conteúdo da frase (sem as neutras). */
export function contentWords(text) {
  const norm = normalizePt(text);
  if (!norm) return [];
  return norm.split(' ').filter((word) => word && !NEUTRAL_WORDS.has(word));
}

/** Palavras que alimentam o classificador de palavras (unigramas de conteúdo). */
function signalWords(text) {
  return contentWords(text);
}

function tokenize(text) {
  const norm = normalizePt(text);
  if (!norm) return [];
  const words = norm.split(' ');
  const feats = [];
  for (let i = 0; i < words.length; i++) {
    feats.push(words[i]);
    if (i + 1 < words.length) feats.push(words[i] + '_' + words[i + 1]);
  }
  return feats;
}

function vectorize(text) {
  const v = new Array(INPUT_SIZE).fill(0);
  for (const f of tokenize(text)) {
    v[hash(f)] += 1;
  }
  let norm = 0;
  for (let i = 0; i < INPUT_SIZE; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < INPUT_SIZE; i++) v[i] /= norm;
  return v;
}

function sigmoid(x) {
  if (x > 20) return 1;
  if (x < -20) return 0;
  return 1 / (1 + Math.exp(-x));
}

function softmax(arr) {
  let max = -Infinity;
  for (const x of arr) if (x > max) max = x;
  const exps = arr.map((x) => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((x) => x / sum);
}

function rand() {
  return (Math.random() - 0.5) * 0.1;
}

export function createNetwork() {
  return {
    intents: [],
    intentIndex: {},
    W1: Array.from({ length: HIDDEN_SIZE }, () => Array.from({ length: INPUT_SIZE }, () => rand())),
    b1: new Array(HIDDEN_SIZE).fill(0),
    W2: [],
    b2: [],
    /** Ligação palavra -> intenção: { palavra: { intent: vezes } } */
    wordStats: {},
    /** Total de exemplos por intenção (para o Naive Bayes). */
    intentTotals: {},
    /** Quantas vezes cada palavra apareceu em frases de treino. */
    wordTotals: {},
    /** Total de exemplos de treino (todos os intents). */
    totalExamples: 0,
    interactions: 0,
    /** `true` depois que a base inicial (`neuralSeed.mjs`) foi aplicada. */
    seeded: false,
  };
}

function ensureIntent(net, intent) {
  if (net.intentIndex[intent] === undefined) {
    const idx = net.intents.length;
    net.intents.push(intent);
    net.intentIndex[intent] = idx;
    net.W2.push(Array.from({ length: HIDDEN_SIZE }, () => rand()));
    net.b2.push(0);
  }
  return net.intentIndex[intent];
}

function forward(net, x) {
  const hidden = new Array(HIDDEN_SIZE);
  for (let j = 0; j < HIDDEN_SIZE; j++) {
    let s = net.b1[j];
    const row = net.W1[j];
    for (let i = 0; i < INPUT_SIZE; i++) s += row[i] * x[i];
    hidden[j] = sigmoid(s);
  }
  const out = new Array(net.intents.length);
  for (let k = 0; k < net.intents.length; k++) {
    let s = net.b2[k];
    const row = net.W2[k];
    for (let j = 0; j < HIDDEN_SIZE; j++) s += row[j] * hidden[j];
    out[k] = s;
  }
  const probs = softmax(out);
  return { hidden, probs };
}

/**
 * Ligação de palavras: probabilidade de cada intenção dado o vocabulário
 * da frase (Naive Bayes em espaço logarítmico, com suavização de Laplace).
 *
 * Devolve `null` quando nenhuma palavra da frase já foi vista: um palpite
 * sem nenhuma palavra conhecida é chute, não aprendizado.
 */
function wordModelPredict(net, text) {
  const words = signalWords(text);
  if (words.length === 0 || net.totalExamples === 0) return null;

  const intents = net.intents;
  const vocabularySize = Math.max(1, Object.keys(net.wordStats).length);
  const total = Math.max(1, net.totalExamples);

  const logProbs = intents.map((intent) => {
    const intentTotal = net.intentTotals[intent] || 0;
    // Prior: P(intenção)
    let logP = Math.log((intentTotal + 1) / (total + intents.length));
    for (const word of words) {
      const counts = net.wordStats[word];
      const count = counts ? counts[intent] || 0 : 0;
      const wordTotal = net.wordTotals[word] || 0;
      // Verossimilhança: P(palavra | intenção) com suavização
      logP += Math.log((count + 1) / (intentTotal + vocabularySize + 1)) -
        Math.log((wordTotal + 1) / (total + vocabularySize + 1));
    }
    return logP;
  });

  // Log-softmax: volta para probabilidades comparáveis.
  let max = -Infinity;
  for (const v of logProbs) if (v > max) max = v;
  const exps = logProbs.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((v) => v / sum);
}

/**
 * Melhor aposta da matriz: frase -> intenção.
 *
 * @param {object} net
 * @param {string} text
 * @returns {{intent: string | null, confidence: number, probabilities: Record<string, number>}}
 */
export function predict(net, text) {
  if (!net || net.intents.length === 0) {
    return { intent: null, confidence: 0, probabilities: {} };
  }

  const x = vectorize(text);
  const { probs: nn } = forward(net, x);
  const nb = wordModelPredict(net, text);

  const combined = nn.map((p, i) => {
    if (!nb) return p;
    return (1 - WORD_MODEL_WEIGHT) * p + WORD_MODEL_WEIGHT * nb[i];
  });

  let bestIdx = 0;
  for (let i = 1; i < combined.length; i++) if (combined[i] > combined[bestIdx]) bestIdx = i;

  const probabilities = {};
  net.intents.forEach((label, idx) => {
    probabilities[label] = combined[idx];
  });

  return {
    intent: net.intents[bestIdx],
    confidence: combined[bestIdx],
    probabilities,
  };
}

/** Registra a ligação palavra -> intenção (o coração do "tempo" = "clima"). */
function learnWordLinks(net, text, intent) {
  for (const word of signalWords(text)) {
    if (!net.wordStats[word]) net.wordStats[word] = {};
    net.wordStats[word][intent] = (net.wordStats[word][intent] || 0) + 1;
    net.wordTotals[word] = (net.wordTotals[word] || 0) + 1;
  }
  net.intentTotals[intent] = (net.intentTotals[intent] || 0) + 1;
  net.totalExamples += 1;
}

/** Mantém o vocabulário dentro do limite (remove as palavras mais fracas). */
function pruneWordStats(net) {
  const words = Object.keys(net.wordStats);
  if (words.length <= MAX_WORDS) return;
  const byUse = words.sort((a, b) => (net.wordTotals[a] || 0) - (net.wordTotals[b] || 0));
  const excess = byUse.slice(0, words.length - MAX_WORDS);
  for (const word of excess) {
    const counts = net.wordStats[word] || {};
    for (const [intent, count] of Object.entries(counts)) {
      net.intentTotals[intent] = Math.max(0, (net.intentTotals[intent] || 0) - count);
      net.totalExamples = Math.max(0, net.totalExamples - count);
    }
    delete net.wordStats[word];
    delete net.wordTotals[word];
  }
}

/**
 * Aprende uma frase: treina a rede neural E a ligação de palavras.
 *
 * @param {object} net
 * @param {string} text A frase do usuário (será normalizada).
 * @param {string} intent Intenção aprendida (ex.: 'weather').
 * @param {number} [epochs]
 */
export function train(net, text, intent, epochs = 1) {
  if (!net || !text || !intent) return net;
  const targetIdx = ensureIntent(net, intent);
  const x = vectorize(text);
  for (let e = 0; e < epochs; e++) {
    const { hidden, probs } = forward(net, x);
    const dOut = probs.slice();
    dOut[targetIdx] -= 1;
    for (let k = 0; k < net.intents.length; k++) {
      for (let j = 0; j < HIDDEN_SIZE; j++) {
        net.W2[k][j] -= LEARNING_RATE * dOut[k] * hidden[j];
      }
      net.b2[k] -= LEARNING_RATE * dOut[k];
    }
    const dHidden = new Array(HIDDEN_SIZE).fill(0);
    for (let j = 0; j < HIDDEN_SIZE; j++) {
      let s = 0;
      for (let k = 0; k < net.intents.length; k++) s += dOut[k] * net.W2[k][j];
      dHidden[j] = s * hidden[j] * (1 - hidden[j]);
    }
    for (let j = 0; j < HIDDEN_SIZE; j++) {
      for (let i = 0; i < INPUT_SIZE; i++) {
        net.W1[j][i] -= LEARNING_RATE * dHidden[j] * x[i];
      }
      net.b1[j] -= LEARNING_RATE * dHidden[j];
    }
  }
  learnWordLinks(net, text, intent);
  pruneWordStats(net);
  net.interactions += 1;
  return net;
}

/**
 * Sobreposição de conteúdo entre duas frases (Jaccard sobre palavras de
 * conteúdo). É a trava da correção: só liga uma frase à outra quando as duas
 * falam do MESMO pedido — "tempo/tempo da cidade de matozinhos" sobrepõe,
 * "clima" e "toca música" não.
 */
export function contentOverlap(a, b) {
  const setA = new Set(contentWords(a));
  const setB = new Set(contentWords(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let common = 0;
  for (const word of setA) if (setB.has(word)) common += 1;
  return common / (setA.size + setB.size - common);
}

/** Sobreposição mínima para a correção valer como "mesmo pedido". */
export const CORRECTION_MIN_OVERLAP = 0.25;

/**
 * Aprendizado por CORREÇÃO do dia a dia.
 *
 * O Nexus não entendeu `failedText` (foi pesquisar/respondeu errado) e o
 * usuário REPETIU o pedido de outro jeito (`resolvedText`), que deu certo com
 * `intent`. Quando as duas frases falam do mesmo assunto, a que falhou aprende
 * a mesma intenção — na próxima vez a rede entende o primeiro jeito de falar.
 *
 * @returns {boolean} `true` quando a ligação foi aprendida.
 */
export function learnFromCorrection(net, failedText, resolvedText, intent) {
  if (!net || !failedText || !intent) return false;
  if (normalizePt(failedText) === normalizePt(resolvedText)) return false;
  if (contentOverlap(failedText, resolvedText) < CORRECTION_MIN_OVERLAP) return false;
  train(net, failedText, intent, 1);
  return true;
}

/**
 * Feedback negativo do usuário ("não é isso", "errado").
 *
 * A frase ganha a intenção fantasma `resposta_errada`: ela passa a competir
 * com as intenção reais e, enquanto vence, o Nexus não auto-executa mais a
 * frase — exatamente o pedido do usuário.
 */
export const NEGATIVE_INTENT = 'resposta_errada';

export function registerNegative(net, text) {
  if (!net || !text) return net;
  return train(net, text, NEGATIVE_INTENT, 2);
}

/**
 * Auto-melhoria: enfraquece a ligação de uma frase com uma intenção errada.
 *
 * Usado quando o usuário diz "não é isso", "não é essa", "errado" —
 * remove a força da ligação palavra->intenção para que a rede pare de
 * prever essa intenção para essa frase.
 *
 * @param {object} net
 * @param {string} text Frase que o usuário corrigiu
 * @param {string} [wrongIntent] Intenção que a rede previu errado (se conhecida)
 * @returns {boolean} true se conseguiu enfraquecer
 */
export function unlearn(net, text, wrongIntent) {
  if (!net || !text) return false;
  const norm = normalizePt(text);
  const words = signalWords(norm);
  if (words.length === 0) return false;

  let weakened = false;

  // 1. Enfraquece a ligação palavra->intenção na estatística Naive Bayes
  if (wrongIntent && net.wordStats) {
    for (const word of words) {
      const counts = net.wordStats[word];
      if (counts && counts[wrongIntent]) {
        counts[wrongIntent] = Math.max(0, (counts[wrongIntent] || 0) - 1);
        if (counts[wrongIntent] === 0) delete counts[wrongIntent];
        net.wordTotals[word] = Math.max(0, (net.wordTotals[word] || 0) - 1);
        net.intentTotals[wrongIntent] = Math.max(0, (net.intentTotals[wrongIntent] || 0) - 1);
        net.totalExamples = Math.max(0, net.totalExamples - 1);
        weakened = true;
      }
    }
  }

  // 2. Treina a rede neural para DIMINUIR a probabilidade da intenção errada
  //    (faz um passo de gradiente inverso para a intenção errada)
  if (wrongIntent) {
    const targetIdx = net.intentIndex[wrongIntent];
    if (targetIdx !== undefined) {
      const x = vectorize(text);
      const { hidden, probs } = forward(net, x);
      // Gradiente INVERSO: empurra a probabilidade da intenção errada PRA BAIXO
      const dOut = probs.slice();
      dOut[targetIdx] += 1; // inverso do normal (que seria -= 1)
      for (let k = 0; k < net.intents.length; k++) {
        for (let j = 0; j < HIDDEN_SIZE; j++) {
          net.W2[k][j] += LEARNING_RATE * dOut[k] * hidden[j]; // sinal invertido
        }
        net.b2[k] += LEARNING_RATE * dOut[k];
      }
      const dHidden = new Array(HIDDEN_SIZE).fill(0);
      for (let j = 0; j < HIDDEN_SIZE; j++) {
        let s = 0;
        for (let k = 0; k < net.intents.length; k++) s += dOut[k] * net.W2[k][j];
        dHidden[j] = s * hidden[j] * (1 - hidden[j]);
      }
      for (let j = 0; j < HIDDEN_SIZE; j++) {
        for (let i = 0; i < INPUT_SIZE; i++) {
          net.W1[j][i] += LEARNING_RATE * dHidden[j] * x[i]; // sinal invertido
        }
        net.b1[j] += LEARNING_RATE * dHidden[j];
      }
      weakened = true;
    }
  }

  // 3. Se a intenção errada for a fantasma 'resposta_errada', também remove
  if (!wrongIntent && net.wordStats) {
    for (const word of words) {
      const counts = net.wordStats[word];
      if (counts && counts[NEGATIVE_INTENT]) {
        counts[NEGATIVE_INTENT] = Math.max(0, (counts[NEGATIVE_INTENT] || 0) - 2);
        if (counts[NEGATIVE_INTENT] === 0) delete counts[NEGATIVE_INTENT];
        net.wordTotals[word] = Math.max(0, (net.wordTotals[word] || 0) - 2);
        net.totalExamples = Math.max(0, net.totalExamples - 2);
        weakened = true;
      }
    }
  }

  return weakened;
}

/**
 * Enfraquece a intenção fantasma 'resposta_errada' para uma frase.
 * Usado quando o usuário aceita a resposta ("sim", "pode ser", "ok") —
 * remove o bloqueio que impedia a auto-execução.
 */
export function weakenNegative(net, text) {
  return unlearn(net, text, NEGATIVE_INTENT);
}

/**
 * Interações aprendidas até agora (contador simples, para telemetria local).
 */
export function interactionCount(net) {
  return net ? net.interactions || 0 : 0;
}

/**
 * Extrai parâmetros conhecidos de uma frase baseado no vocabulário aprendido.
 *
 * Para cada intenção, a rede aprende quais palavras são "parâmetros" (ex.: nomes
 * de cidades para weather, nomes de contatos para whatsapp-message). As palavras
 * que aparecem FREQUENTEMENTE em frases da MESMA intenção mas variam entre
 * exemplos são candidatas a parâmetros.
 *
 * @param {object} net
 * @param {string} text Frase original
 * @param {string} intent Intenção identificada
 * @returns {Record<string, string>} Parâmetros extraídos (ex.: { city: 'matozinhos' })
 */
export function extractParams(net, text, intent) {
  const params = {};
  if (!net || !text || !intent) return params;

  const norm = normalizePt(text);
  const words = norm.split(' ').filter(w => w && !NEUTRAL_WORDS.has(w));
  if (words.length === 0) return params;

  const intentStats = net.wordStats;
  // Para cada palavra de conteúdo, vê se ela é "específica" desta intenção
  // (aparece muito nesta intenção e pouco nas outras) = é parâmetro variável
  for (const word of words) {
    const counts = intentStats[word];
    if (!counts) continue;
    const thisIntentCount = counts[intent] || 0;
    const totalCount = Object.values(counts).reduce((a, b) => a + b, 0);
    // Se a palavra aparece >70% das vezes nesta intenção, é provável que seja
    // um termo fixo do comando (ex.: "clima" para weather). Se <30%, é parâmetro.
    if (totalCount > 0) {
      const specificity = thisIntentCount / totalCount;
      if (specificity < 0.3 && thisIntentCount > 0) {
        // Palavra que varia: candidata a parâmetro
        // Heurística simples: cidades para weather, contatos para whatsapp
        if (intent === 'weather' || intent === 'weather-tomorrow') {
          params.city = word;
        } else if (intent.startsWith('whatsapp-') || intent.startsWith('call-')) {
          params.contact = word;
        } else if (intent === 'music' || intent === 'youtube' || intent === 'oitube') {
          params.query = word;
        } else if (intent.startsWith('radio-')) {
          params.station = word;
        } else if (intent.startsWith('reminder-') || intent.startsWith('alarm-')) {
          params.description = word;
        }
      }
    }
  }
  return params;
}

export function serialize(net) {
  return JSON.stringify({
    intents: net.intents,
    intentIndex: net.intentIndex,
    W1: net.W1.map((row) => row.map(round4)),
    b1: net.b1.map(round4),
    W2: net.W2.map((row) => row.map(round4)),
    b2: net.b2.map(round4),
    wordStats: net.wordStats,
    intentTotals: net.intentTotals,
    wordTotals: net.wordTotals,
    totalExamples: net.totalExamples,
    interactions: net.interactions,
    seeded: net.seeded,
  });
}

export function deserialize(json) {
  try {
    const d = typeof json === 'string' ? JSON.parse(json) : json;
    if (!d || !Array.isArray(d.intents)) return createNetwork();
    const net = createNetwork();
    net.intents = d.intents;
    net.intentIndex = d.intentIndex || {};
    net.W1 = d.W1 || net.W1;
    net.b1 = d.b1 || net.b1;
    net.W2 = d.W2 || [];
    net.b2 = d.b2 || [];
    net.wordStats = d.wordStats || {};
    net.intentTotals = d.intentTotals || {};
    net.wordTotals = d.wordTotals || {};
    net.totalExamples = d.totalExamples || 0;
    net.interactions = d.interactions || 0;
    net.seeded = d.seeded === true;
    return net;
  } catch {
    return createNetwork();
  }
}

export const NEURAL_CONFIG = {
  INPUT_SIZE,
  HIDDEN_SIZE,
  LEARNING_RATE,
  WORD_MODEL_WEIGHT,
  MIN_CONFIDENCE,
  MAX_WORDS,
  CORRECTION_MIN_OVERLAP,
};
