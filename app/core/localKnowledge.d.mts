/**
 * Resposta do conhecimento de bolso, ou `undefined` quando o Nexus não sabe.
 */
export function answerFromLocalKnowledge(input: string): string | undefined;

/** Quantos fatos o conhecimento de bolso tem. */
export function localKnowledgeCount(): number;
