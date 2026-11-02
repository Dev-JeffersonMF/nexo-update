/** Largura estimada de um texto em dp (mesma conta do app/ui). */
export function estimateTextWidthDp(text: string, fontSizeDp: number): number;

/** Largura do balão (dp) para o texto caber sem quebra desnecessária. */
export function estimateBubbleWidthDp(
  text: string,
  options: {
    fontSizeDp: number;
    maxWidthDp: number;
    paddingDp?: number;
  },
): number;
