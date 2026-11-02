/**
 * A PONTE entre a matriz neural e as ações do Nexus.
 *
 * A rede (`neuralLearner.mjs`) só sabe uma coisa: "essa frase parece a
 * intenção X". Ela NÃO executa nada e NÃO inventa parâmetros — quem faz isso
 * aqui é a conversão de volta para um PEDIDO CANÔNICO ("clima em matozinhos"),
 * que passa pelos mesmos roteadores determinísticos de sempre
 * (`planNativeCommand`). É assim que as travas de segurança continuam valendo:
 * clima sem cidade continua perguntando, ligação para lugar continua pedindo
 * confirmação, e mensagem para contato NUNCA é auto-executada pela rede.
 *
 * Só entram intenções SEGURAS de auto-execução (`AUTO_INTENTS`). Intenções de
 * contato/mensagem/WhatsApp ficam de fora de propósito: um nome de pessoa
 * extraído errado significaria ligar ou escrever para a pessoa errada.
 */

import { normalizeCommand, planNativeCommand } from './nativeCommands.mjs';
import { predict, MIN_CONFIDENCE } from './neuralLearner.mjs';

/**
 * Intenções que a rede pode auto-executar (todas reversíveis ou que perguntam
 * antes de agir). `local-call` entra porque o canônico exige alvo explícito
 * ("para/com + nome") e a ligação para LUGAR continua pedindo o "sim".
 */
export const AUTO_INTENTS = new Set([
  'weather',
  'music',
  'radio-play',
  'youtube',
  'oitube',
  'media',
  'volume-up',
  'volume-down',
  'volume-level',
  'open-last-message',
  'launch-app',
  'local-call',
]);

/** Palavras que descrevem o pedido (nunca viram conteúdo/parâmetro). */
const WEATHER_WORDS = new Set([
  'clima', 'climma', 'tempo', 'temperatura', 'previsao', 'chuva', 'chover',
  'chovendo', 'chove', 'ensolarado', 'sol', 'frio', 'calor', 'vento',
  // "tempo DA CIDADE de X": "cidade" é o marcador do pedido, não o lugar.
  'cidade', 'vila', 'municipio', 'regiao',
]);

const MUSIC_WORDS = new Set([
  'musica', 'musicas', 'musicha', 'musiquinha', 'som', 'sons', 'cancao',
  'cancoes', 'playlist', 'playlists', 'album', 'albuns', 'toque', 'tocar',
  'toca', 'ouvir', 'escutar',
]);

/**
 * Palavras que marcam o pedido de rádio. Os NOMES das emissoras ("itatiaia",
 * "98 fm") NÃO estão aqui de propósito: eles são o PARÂMETRO (a estação),
 * não o pedido.
 */
const RADIO_WORDS = new Set([
  'radio', 'radios', 'emissora', 'emissoras',
]);

/** Cortesias e conectivos que sobram quando o usuário pede algo. */
const FILLER_WORDS = new Set([
  'me', 'informe', 'informar', 'informa', 'passa', 'passar', 'passe', 'passes',
  'diga', 'diga', 'fala', 'falar', 'fale', 'quero', 'queria', 'gostaria', 'pode',
  'poderia', 'favor', 'pfv', 'voce', 'vc', 'voce', 'eu', 'mim', 'pra', 'pro',
  'para', 'por', 'e', 'o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas', 'de',
  'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas', 'que', 'qual',
  'quais', 'como', 'esta', 'ta', 'sobre', 'saber', 've', 'ver', 'mostra',
  'mostrar', 'la', 'ai', 'aqui', 'hoje', 'agora', 'ja', 'bota', 'botar',
  'coloca', 'colocar', 'coloque', 'poe', 'faz', 'fazer', 'quero', 'manda',
  'mandar', 'dae', 'ligado', 'ligada', 'esta', 'sera', 'vai',
  // possessivos: "tempo DA MINHA cidade" — a posse não é o lugar.
  'minha', 'minhas', 'meu', 'meus', 'nossa', 'nossas', 'nosso', 'nossos',
]);

/** O que sobra da frase depois de tirar as palavras conhecidas. */
function leftoverWords(text, drop) {
  const tokens = normalizeCommand(text).split(' ').filter(Boolean);
  const kept = [];
  for (const token of tokens) {
    if (drop.has(token)) continue;
    if (FILLER_WORDS.has(token)) continue;
    if (/\d/.test(token)) continue;
    kept.push(token);
  }
  return kept.join(' ').trim();
}

/** Palavra de dia futuro na frase (decide o "amanhã" do clima). */
function hasTomorrow(text) {
  return /\b(amanha|depois de amanha|amanha de manha)\b/.test(normalizeCommand(text));
}

/**
 * Cada conversão devolve `{ canonical, plan }` — ou `null` quando não dá para
 * construir um pedido seguro com o que a frase trouxe.
 *
 * @param {string} intent Intenção prevista pela rede.
 * @param {string} input Frase original do usuário.
 * @returns {{ canonical: string, plan: object } | null}
 */
export function canonicalForIntent(intent, input) {
  const text = normalizeCommand(input);
  if (!text) return null;

  switch (intent) {
    case 'weather': {
      const city = leftoverWords(text, WEATHER_WORDS);
      if (city.split(' ').length > 5) return null; // não parece nome de cidade
      const day = hasTomorrow(text) ? ' amanha' : '';
      const canonical = city ? `clima em ${city}${day}` : `clima${day}`;
      return { canonical, plan: planNativeCommand(canonical) };
    }

    case 'music': {
      const query = leftoverWords(text, MUSIC_WORDS);
      const canonical = query ? `toca ${query}` : 'toca uma musica';
      return { canonical, plan: planNativeCommand(canonical) };
    }

    case 'radio-play': {
      const station = leftoverWords(text, RADIO_WORDS);
      const canonical = station ? `toca radio ${station}` : 'toca radio';
      return { canonical, plan: planNativeCommand(canonical) };
    }

    case 'youtube': {
      const query = leftoverWords(text, new Set(['youtube']));
      const canonical = `toca ${query || 'musica'} no youtube`;
      return { canonical, plan: planNativeCommand(canonical) };
    }

    case 'oitube': {
      const query = leftoverWords(text, new Set(['oitube']));
      const canonical = `toca ${query || 'musica'} no oitube`;
      return { canonical, plan: planNativeCommand(canonical) };
    }

    case 'media': {
      if (/\b(pausar|pausa|pause|pausa isso|parar|para a musica|silenciar)\b/.test(text)) {
        return { canonical: 'pausar a musica', plan: planNativeCommand('pausar a musica') };
      }
      if (/\b(continuar|continua|retoma|retomar|toca de novo|volta a tocar|despausa)\b/.test(text)) {
        return { canonical: 'continuar a musica', plan: planNativeCommand('continuar a musica') };
      }
      if (/\b(proxima|proximo|pula|pular|pula essa|avanca)\b/.test(text)) {
        return { canonical: 'proxima musica', plan: planNativeCommand('proxima musica') };
      }
      if (/\b(anterior|volta essa|retrocede)\b/.test(text)) {
        return { canonical: 'musica anterior', plan: planNativeCommand('musica anterior') };
      }
      return null;
    }

    case 'volume-up':
      return { canonical: 'aumenta o volume', plan: planNativeCommand('aumenta o volume') };

    case 'volume-down':
      return { canonical: 'diminui o volume', plan: planNativeCommand('diminui o volume') };

    case 'volume-level':
      return { canonical: 'qual o volume', plan: planNativeCommand('qual o volume') };

    case 'open-last-message':
      return { canonical: 'leia a mensagem', plan: planNativeCommand('leia a mensagem') };

    case 'launch-app': {
      const name = leftoverWords(text, new Set(['app', 'aplicativo', 'abrir', 'abra', 'abre', 'iniciar', 'inicie']));
      if (!name || name.split(' ').length > 3) return null;
      const canonical = `abrir ${name}`;
      return { canonical, plan: planNativeCommand(canonical) };
    }

    case 'local-call': {
      // O alvo tem que vir DEPOIS de um marcador: "faz uma ligação pra maria".
      // Sem marcador não há como saber quem é — e chutar nome é o pior erro.
      const match = text.match(/\b(?:para|pro|pra|com|ao|aos)\s+(.+)$/u);
      if (!match) return { canonical: 'ligar', plan: planNativeCommand('ligar') };
      const target = match[1]
        .replace(/\b(?:por favor|pfv|agora|ai|rapidinho|hoje|mais tarde)\b/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!target || target.split(' ').length > 4) {
        return { canonical: 'ligar', plan: planNativeCommand('ligar') };
      }
      const canonical = `liga para ${target}`;
      return { canonical, plan: planNativeCommand(canonical) };
    }

    default:
      return null;
  }
}

/**
 * O caminho completo da memória: frase -> predição da rede -> pedido canônico
 * -> plano determinístico.
 *
 * Cada etapa pode vetar: confiança baixa, intenção fora da lista segura ou
 * canônico que não virou plano (aí o Nexus segue o fluxo normal — nunca força).
 *
 * @param {object} net Rede neural viva.
 * @param {string} input Frase do usuário.
 * @param {{minConfidence?: number}} [options]
 * @returns {{ intent: string, confidence: number, canonical: string, plan: object } | null}
 */
export function recallLearnedIntent(net, input, options = {}) {
  const minConfidence = options.minConfidence ?? MIN_CONFIDENCE;
  const prediction = predict(net, input);
  const { intent, confidence } = prediction;
  if (!intent || confidence < minConfidence) return null;
  if (!AUTO_INTENTS.has(intent)) return null;

  const built = canonicalForIntent(intent, input);
  if (!built || !built.plan || built.plan.action !== intent) return null;

  return { intent, confidence, canonical: built.canonical, plan: built.plan };
}
