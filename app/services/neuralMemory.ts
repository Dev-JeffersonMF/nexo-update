import { isNativeAvailable, nexusNative } from './nexusNative';
import { createNetwork, deserialize, serialize } from '../core/neuralLearner.mjs';
import { applySeedOnce } from '../core/neuralSeed.mjs';
import { pruneLearnedPairs } from '../core/conversationBrain.mjs';

/**
 * Memória de longo prazo do Nexus: a rede neural e a biblioteca de conversa.
 *
 * No build Android o aprendizado vive nas preferências privadas do app e
 * sobrevive ao reinício. Sem o módulo nativo (modo Expo) fica em memória: o
 * aprendizado acontece dentro da sessão — só não atravessa o fechamento.
 *
 * Nunca lança: aprendizado é melhoria, não requisito. Se o armazenamento
 * falhar, o app segue funcionando com a rede que já está na memória.
 */

/** Par de conversa aprendido com a internet (pergunta → resposta). */
export interface LearnedChatPair {
  q: string;
  a: string;
}

/** Caminho de navegação aprendido (ex.: WhatsApp › lista de transmissão). */
export interface LearnedPath {
  /** Intenção dona do caminho ("whatsapp-broadcast"). */
  intent: string;
  /** Passos na ordem em que o Nexus executa. */
  steps: string[];
  /** Quantas vezes o caminho terminou com sucesso. */
  successes: number;
  /** Última vez que funcionou (epoch ms). */
  updatedAt: number;
}

/** Tudo que o Nexus aprende e precisa sobreviver ao reinício. */
export interface NeuralMemory {
  /** A matriz de ligação (rede neural; JS puro de app/core/neuralLearner.mjs). */
  net: any;
  /** Perguntas de papo respondidas na internet, para valer offline. */
  chat: LearnedChatPair[];
  /** Caminhos de tela que já deram certo (o "como fazer"). */
  paths: LearnedPath[];
}

/** Estado em memória (fallback quando o nativo não existe). */
let memory: NeuralMemory = {
  net: applySeedOnce(createNetwork()),
  chat: [],
  paths: [],
};

/** Se o estado em memória já veio carregado do aparelho. */
let loaded = !isNativeAvailable();

/** Estado salvo esperando o(a) debouncer terminar. */
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function parseState(raw: string): NeuralMemory | null {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return null;
    const net = deserialize(parsed.net);
    let chat: LearnedChatPair[] = [];
    if (Array.isArray(parsed.chat)) {
      chat = (parsed.chat as unknown[])
        .filter(
          (pair): pair is LearnedChatPair =>
            !!pair &&
            typeof (pair as { q?: unknown }).q === 'string' &&
            typeof (pair as { a?: unknown }).a === 'string' &&
            (pair as { q: string }).q.length > 0 &&
            (pair as { a: string }).a.length > 0,
        )
        .slice(-300);
    }
    let paths: LearnedPath[] = [];
    if (Array.isArray(parsed.paths)) {
      paths = (parsed.paths as unknown[])
        .filter(
          (path): path is LearnedPath =>
            !!path &&
            typeof (path as { intent?: unknown }).intent === 'string' &&
            Array.isArray((path as { steps?: unknown }).steps),
        )
        .map((path) => ({
          intent: path.intent,
          steps: path.steps.filter((step): step is string => typeof step === 'string').slice(0, 30),
          successes:
            typeof path.successes === 'number' && Number.isFinite(path.successes)
              ? Math.max(0, Math.round(path.successes))
              : 1,
          updatedAt:
            typeof path.updatedAt === 'number' && Number.isFinite(path.updatedAt)
              ? path.updatedAt
              : 0,
        }))
        .slice(-30);
    }
    return { net: applySeedOnce(net), chat, paths };
  } catch {
    return null;
  }
}

/** Serializa o estado para guardar no aparelho. */
function stringifyState(state: NeuralMemory): string {
  return JSON.stringify({
    net: JSON.parse(serialize(state.net)),
    chat: state.chat.slice(-300),
    paths: state.paths.slice(-30),
  });
}

/**
 * Carrega a memória de aprendizado (uma vez por sessão).
 *
 * Sem aparelho guardado, nasce com a base inicial (`neuralSeed`) — nunca
 * com a rede vazia.
 */
export async function loadNeuralMemory(): Promise<NeuralMemory> {
  if (loaded) return memory;

  if (isNativeAvailable()) {
    try {
      const raw = await nexusNative.loadNeuralState();
      const restored = parseState(raw);
      if (restored) {
        memory = restored;
      } else {
        memory = { net: applySeedOnce(createNetwork()), chat: [], paths: [] };
      }
    } catch {
      memory = { net: applySeedOnce(createNetwork()), chat: [], paths: [] };
    }
  }

  loaded = true;
  return memory;
}

/**
 * Salva a memória com um pequeno atraso: aprender acontece a cada interação e
 * escrever no aparelho TUDO seria desperdício — o atraso junta os treinos
 * seguidos em uma única escrita.
 */
export function scheduleNeuralSave(state: NeuralMemory, delayMs = 1500): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (!isNativeAvailable()) return;
    void nexusNative.saveNeuralState(stringifyState(state)).catch(() => {
      // Sem armazenamento: o aprendizado segue só na memória.
    });
  }, delayMs);
}

/** Salva imediatamente (usado quando o app vai para o fundo). */
export function flushNeuralSave(state: NeuralMemory): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!isNativeAvailable()) return;
  void nexusNative.saveNeuralState(stringifyState(state)).catch(() => {
    // idem: aprendizado é melhoria, nunca requisito.
  });
}

/** Memória viva desta sessão (sem tocar no armazenamento). */
export function currentNeuralMemory(): NeuralMemory {
  return memory;
}

/**
 * Guarda um par de conversa aprendido na internet.
 *
 * @returns a lista atualizada (já limitada).
 */
export function rememberChatPair(
  state: NeuralMemory,
  pair: { q: string; a: string },
): LearnedChatPair[] {
  if (!pair.q || !pair.a) return state.chat;
  state.chat = pruneLearnedPairs([...state.chat, pair]);
  return state.chat;
}

/**
 * Guarda o CAMINHO de tela que terminou com sucesso.
 *
 * A rede neural aprende a frase → intenção; este registro guarda o "como
 * fazer": a sequência de passos que funcionou no aparelho. Quando o mesmo
 * caminho dá certo de novo, os passos são atualizados e o contador sobe —
 * é a memória que o auto bot consulta antes de repetir o percurso.
 */
export function rememberPath(
  state: NeuralMemory,
  intent: string,
  steps: string[],
): LearnedPath | null {
  if (!intent || steps.length === 0) return null;
  const clean = steps
    .map((step) => step.trim())
    .filter(Boolean)
    .slice(0, 30);
  if (clean.length === 0) return null;

  const existing = state.paths.find((path) => path.intent === intent);
  if (existing) {
    existing.steps = clean;
    existing.successes += 1;
    existing.updatedAt = Date.now();
    state.paths = [...state.paths.filter((path) => path.intent !== intent), existing].slice(-30);
    return existing;
  }

  const created: LearnedPath = {
    intent,
    steps: clean,
    successes: 1,
    updatedAt: Date.now(),
  };
  state.paths = [...state.paths, created].slice(-30);
  return created;
}

/** O caminho aprendido para a intenção (o último que funcionou). */
export function recallPath(state: NeuralMemory, intent: string): LearnedPath | null {
  return state.paths.find((path) => path.intent === intent) ?? null;
}
