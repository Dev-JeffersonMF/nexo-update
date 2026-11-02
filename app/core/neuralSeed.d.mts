import type { NeuralNetwork } from './neuralLearner.mjs';

/** Uma entrada da base inicial: intenção + falares informais brasileiros. */
export interface NeuralSeedEntry {
  intent: string;
  examples: string[];
}

export const NEURAL_SEED: NeuralSeedEntry[];

/** Aplica a base inicial UMA vez na vida da rede (flag `seeded`). */
export function applySeedOnce(net: NeuralNetwork): NeuralNetwork;
