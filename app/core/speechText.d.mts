/** Normaliza para minúsculas, sem acento e com espaços simples. */
export function normalizeSpeech(input: string): string;

/** Distância de edição (Levenshtein) com teto. */
export function editDistance(a: string, b: string, limit?: number): number;

/** A palavra falada é a palavra do vocabulário? */
export function isFuzzyMatch(token: string, word: string): boolean;

/** Índice onde a mensagem começa (o fim da string quando não há mensagem). */
export function messageStartIndex(text: string): number;

/** Corrige o texto do pedido para o roteador entender. */
export function repairCommand(text: string): string;

/** O texto tem alguma palavra do vocabulário (de forma exata ou parecida)? */
export function containsAnyFuzzy(text: string, words: string[]): boolean;

/** O texto contém a FRASE, palavra por palavra, tolerando o erro de ditado? */
export function containsPhraseFuzzy(text: string, phrase: string): boolean;

/** Índice onde termina a última palavra-chave achada. */
export function findNounIndexFuzzy(text: string, terms: string[]): number;

/** O vocabulário de comandos do Nexus. */
export const COMMAND_WORDS: string[];
