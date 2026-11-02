/**
 * Tipos do `neuralLearner.mjs` — a matriz de ligação do aprendizado.
 *
 * A rede em si é um objeto JS puro (pesos + estatísticas de palavras): quem
 * a cria/treina/lê é o módulo; aqui só o contrato que o TypeScript confere.
 */

/** A rede neural viva (criada por `createNetwork`, restaurada por `deserialize`). */
export interface NeuralNetwork {
  intents: string[];
  intentIndex: Record<string, number>;
  W1: number[][];
  b1: number[];
  W2: number[][];
  b2: number[];
  /** Ligação palavra → intenção: { palavra: { intent: vezes } }. */
  wordStats: Record<string, Record<string, number>>;
  intentTotals: Record<string, number>;
  wordTotals: Record<string, number>;
  totalExamples: number;
  interactions: number;
  /** `true` depois que a base inicial (`neuralSeed.mjs`) foi aplicada. */
  seeded: boolean;
}

/** Resultado da predição: melhor intenção + confiança + mapa completo. */
export interface NeuralPrediction {
  intent: string | null;
  confidence: number;
  probabilities: Record<string, number>;
}

export const MIN_CONFIDENCE: number;
export const CORRECTION_MIN_OVERLAP: number;
export const NEURAL_CONFIG: {
  INPUT_SIZE: number;
  HIDDEN_SIZE: number;
  LEARNING_RATE: number;
  WORD_MODEL_WEIGHT: number;
  MIN_CONFIDENCE: number;
  MAX_WORDS: number;
  CORRECTION_MIN_OVERLAP: number;
};

export function createNetwork(): NeuralNetwork;

/** Aprende uma frase: treina a rede e a ligação de palavras. */
export function train(net: NeuralNetwork, text: string, intent: string, epochs?: number): NeuralNetwork;

/** Melhor aposta da matriz: frase → intenção. */
export function predict(net: NeuralNetwork, text: string): NeuralPrediction;

/** Sobreposição de conteúdo (Jaccard) entre duas frases, de 0 a 1. */
export function contentOverlap(a: string, b: string): number;

/** Palavras de conteúdo da frase (sem artigos, cortesias e verbos genéricos). */
export function contentWords(text: string): string[];

/**
 * Aprendizado por correção: a frase que falhou aprende a intenção da
 * repetição que deu certo (se falarem do mesmo assunto).
 * @returns `true` quando a ligação foi aprendida.
 */
export function learnFromCorrection(
  net: NeuralNetwork,
  failedText: string,
  resolvedText: string,
  intent: string,
): boolean;

/** Intenção fantasma que marca "essa ligação está errada". */
export const NEGATIVE_INTENT: string;

/** Feedback negativo: a frase passa a não auto-executar mais. */
export function registerNegative(net: NeuralNetwork, text: string): NeuralNetwork;

/** Interações aprendidas até agora. */
export function interactionCount(net: NeuralNetwork): number;

export function serialize(net: NeuralNetwork): string;
export function deserialize(json: string | object): NeuralNetwork;
