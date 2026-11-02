import type { NativeCommandPlan } from './nativeCommands.mjs';
import type { NeuralNetwork } from './neuralLearner.mjs';

/** Intenções que a rede pode auto-executar (todas reversíveis ou que perguntam antes). */
export const AUTO_INTENTS: Set<string>;

/**
 * Converte a intenção aprendida + a frase original em um pedido canônico e
 * no plano determinístico correspondente — ou `null` quando não dá para
 * construir algo seguro.
 */
export function canonicalForIntent(
  intent: string,
  input: string,
): { canonical: string; plan: NativeCommandPlan } | null;

/**
 * O caminho completo da memória: frase → predição → pedido canônico → plano.
 * Cada etapa pode vetar (confiança baixa, intenção fora da lista segura,
 * canônico que não virou plano).
 */
export function recallLearnedIntent(
  net: NeuralNetwork,
  input: string,
  options?: { minConfidence?: number },
): { intent: string; confidence: number; canonical: string; plan: NativeCommandPlan } | null;
