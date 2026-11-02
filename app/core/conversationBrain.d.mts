/** Par de conversa aprendido (pergunta → resposta). */
export interface LearnedChatPair {
  q: string;
  a: string;
}

export const MAX_LEARNED_PAIRS: number;

/** Resposta variada de um tópico (aleatória de propósito). */
export function answerByTopic(topicId: string): string | null;

/** O tópico de conversa de uma frase, pelos padrões locais. */
export function answerConversation(input: string): { topic: string; text: string } | null;

/** É papo (e não comando/pergunta de fato)? */
export function isConversational(input: string): boolean;

/** Resposta aprendida com a internet para uma pergunta parecida (Jaccard ≥ 0.5). */
export function answerFromLearned(input: string, learned: LearnedChatPair[]): string | null;

/** Normaliza um par antes de guardar (só papo com resposta curta). */
export function learnConversationPair(question: string, answer: string): LearnedChatPair | null;

/** Mantém a lista de pares dentro do limite (mais antigos saem primeiro). */
export function pruneLearnedPairs(pairs: LearnedChatPair[], max?: number): LearnedChatPair[];
