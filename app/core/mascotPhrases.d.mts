/** Como o mascote está neste momento. */
export type MascotMood = 'idle' | 'listening' | 'thinking' | 'speaking';

/** As falas de cada estado do mascote. */
export const MASCOT_PHRASES: Record<MascotMood | 'greeting', string[]>;

/**
 * Escolhe uma frase do estado, sem repetir a que acabou de ser usada.
 *
 * @param mood O estado do mascote.
 * @param previous A frase usada na última vez.
 */
export function pickMascotPhrase(
  mood: MascotMood | 'greeting',
  previous?: string,
): string;
