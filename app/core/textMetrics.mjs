/**
 * Estimativa de largura de texto (em dp) para o balão da conversa.
 *
 * Por que existe: no Android, um `Text` dentro de um balão de largura
 * automática é medido com uma largura um pouco menor que a do desenho. O
 * resultado é que a frase que caberia em UMA linha acaba quebrando em duas,
 * mas a altura do `Text` foi calculada para uma linha só — e a segunda linha
 * some (é o "falta palavra" que o usuário viu).
 *
 * A correção é dar ao balão uma largura DEFINIDA. Para isso, o app precisa
 * saber quanto o texto vai medir: aqui está a estimativa, com a largura média
 * de cada caractere no Roboto (medida no aparelho).
 *
 * A estimativa é boa o bastante para a frase caber; se mesmo assim a frase
 * quebrar, o balão continua com largura definida e a altura sai certa.
 */

/** Caracteres estreitos e suas larguras (múltiplos do tamanho da fonte). */
const NARROW = "ilj|!.,;:'`";
const NARROW_W = 0.33;
const THIN = 'ftr()[]-/';
const THIN_W = 0.4;
const SPACE = 0.27;
const UPPER = 0.68;
const DIGIT = 0.58;
const WIDE = 0.56; // a-z e acentos

/**
 * Margem sobre a estimativa.
 *
 * O Android mede o texto um pouco mais estreito que o desenho (uns 5%): se o
 * balão ficar exatamente na medida, a frase quebra e a segunda linha é
 * cortada. A margem cobre essa folga.
 *
 * E é generosa de propósito: com a folga no limite, a última linha da frase
 * fica exatamente na borda — e é ela que o Android corta. Mais folga aqui é
 * uma linha a menos na tela; folga curta é uma palavra faltando.
 */
const SAFETY = 1.18;

/**
 * Folga FIXA, em dp.
 *
 * Garante que mesmo a frase mais curta não fique com o texto colado na borda
 * do balão (e que a última linha nunca caia no limite da medição).
 */
const MIN_SLACK = 8;

/**
 * Largura estimada do texto em dp.
 *
 * @param {string} text Texto que será desenhado.
 * @param {number} fontSizeDp Tamanho da fonte em dp.
 * @returns {number} Largura estimada em dp.
 */
export function estimateTextWidthDp(text, fontSizeDp) {
  const value = String(text ?? '');
  if (!value) return 0;

  let em = 0;
  for (const char of value) {
    if (char === ' ') em += SPACE;
    else if (char === '\n') em += 0;
    else if (NARROW.includes(char)) em += NARROW_W;
    else if (THIN.includes(char)) em += THIN_W;
    else if (char >= 'A' && char <= 'Z') em += UPPER;
    else if (char >= '0' && char <= '9') em += DIGIT;
    else em += WIDE;
  }
  return em * fontSizeDp;
}

/**
 * Largura do balão (dp) para o texto caber sem quebra desnecessária.
 *
 * @param {string} text Texto do balão.
 * @param {object} options
 * @param {number} options.fontSizeDp Tamanho da fonte do balão.
 * @param {number} options.maxWidthDp Largura máxima do balão.
 * @param {number} [options.paddingDp] Padding horizontal do balão.
 * @returns {number} Largura do balão em dp.
 */
export function estimateBubbleWidthDp(text, options) {
  const { fontSizeDp, maxWidthDp } = options ?? {};
  const paddingDp = options?.paddingDp ?? 32;
  const textWidth = estimateTextWidthDp(text, fontSizeDp);
  // A margem cobre a diferença entre a medição do app e o desenho do Android.
  const wanted = textWidth * SAFETY + paddingDp + MIN_SLACK;
  return Math.max(64, Math.min(Math.round(wanted), Math.round(maxWidthDp)));
}
