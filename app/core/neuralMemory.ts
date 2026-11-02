/**
 * Memória de aprendizado do Nexus.
 *
 * Ponte entre a rede neural leve (app/core/neuralLearner.mjs) e o armazenamento
 * nativo do aparelho (via nexusNative.saveNeuralState / loadNeuralState).
 *
 * O que ela guarda:
 *   - Pesos da rede (matrizes W1/W2 e vieses b1/b2) = as "ligações de palavras"
 *     que o Nexus aprendeu no dia a dia.
 *   - Biblioteca de intents já vistas (ex.: "tempo", "clima", "whatsapp-message").
 *   - Contador de interações.
 *
 * Como aprende:
 *   - Cada interação do usuário ajusta os pesos (SGD) e, da próxima vez, a
 *     rede classifica mais parecido com o que já deu certo.
 *   - feedback = +1 acerto, -1 erro.
 */

import { nexusNative, isNativeAvailable } from '../services/nexusNative';

// Carrega o módulo ESM puro sem tipos.
// @ts-ignore
import * as NL from './neuralLearner.mjs';

const NL_any: any = NL;
const createNetwork = NL_any.createNetwork;
const predict = NL_any.predict;
const train = NL_any.train;
const learnInteraction = NL_any.learnInteraction;
const serialize = NL_any.serialize;
const deserialize = NL_any.deserialize;

let net = createNetwork();
let dirty = false;

/** Carrega o estado salvo no aparelho (ou cria rede nova se não houver). */
export async function loadNeuralMemory(): Promise<void> {
  if (!isNativeAvailable()) return;
  try {
    const json = await nexusNative.loadNeuralState();
    if (json && json.trim().length > 0) {
      net = deserialize(json);
    }
  } catch (e) {
    console.warn('[Nexus] Falha ao carregar memória neural:', e);
  }
  dirty = false;
}

/** Salva o estado atual no aparelho (só se mudou algo). */
export async function saveNeuralMemory(): Promise<void> {
  if (!isNativeAvailable() || !dirty) return;
  try {
    await nexusNative.saveNeuralState(serialize(net));
    dirty = false;
  } catch (e) {
    console.warn('[Nexus] Falha ao salvar memória neural:', e);
  }
}

/** Classifica o texto do usuário numa intent já aprendida. */
export function neuralPredict(text: string) {
  return predict(net, text);
}

/**
 * Aprende com uma interação real.
 *
 * @param userInput o que o usuário disse
 * @param assistantReply o que o Nexus respondeu
 * @param feedback +1 acerto, -1 erro
 * @param learnedIntent a intent que de fato correspondeu (quando conhecida)
 */
export function neuralLearn(
  userInput: string,
  assistantReply: string,
  feedback: number,
  learnedIntent?: string,
): void {
  if (!userInput) return;
  if (learnedIntent) {
    train(net, userInput, learnedIntent, 1);
  } else {
    learnInteraction(net, userInput, assistantReply, feedback);
  }
  dirty = true;
}

/** Força salvamento (útil antes de fechar/suspender o app). */
export async function flushNeuralMemory(): Promise<void> {
  await saveNeuralMemory();
}

export function getNeuralInteractions(): number {
  return net.interactions;
}
