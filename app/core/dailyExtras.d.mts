export type DailyExtraPlan =
  | { action: 'phrase' }
  | { action: 'news'; topic: 'general' | 'gossip' };

/** Número do dia no calendário local (mesmo valor durante todo o dia). */
export function dayIndex(date?: Date): number;

/** A frase do dia (sempre a mesma dentro do mesmo dia). */
export function pickDailyPhrase(day?: number): string;

export function planDailyExtra(rawInput: string): DailyExtraPlan | undefined;

export function summarizeHeadlines(
  items: readonly string[],
  options?: { topic?: 'general' | 'gossip'; limit?: number },
): string;

/** Títulos reais de um feed RSS (CDATA e entidades resolvidos). */
export function parseRssTitles(xml: string, limit?: number): string[];
