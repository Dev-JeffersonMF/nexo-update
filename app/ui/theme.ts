/**
 * Design system da Nexo.
 *
 * Fonte única de cores, espaçamentos, raios e tipografia.
 *
 * A identidade visual vem do Nexo-Biuld2: noite roxa/rosa, vidro fosco e
 * neon suave. Todos os nomes de token antigos foram mantidos como aliases,
 * então nenhuma tela precisa saber que a paleta mudou — quem quiser mudar a
 * cara do app muda aqui.
 */

export const colors = {
  // ---------------------------------------------------------------------
  // Base
  // ---------------------------------------------------------------------
  background: '#07040F',
  backgroundElevated: '#120A21',
  /** Painéis e barras. */
  panel: '#150C24',
  /** Cartões e superfícies elevadas. */
  card: 'rgba(255, 255, 255, 0.055)',
  cardStrong: 'rgba(255, 255, 255, 0.09)',

  // Aliases de fundo usados pelo layout novo.
  bg: '#07040F',
  bgMid: '#120A21',
  bgTop: '#1C0F30',

  // ---------------------------------------------------------------------
  // Texto
  // ---------------------------------------------------------------------
  text: '#F8F2FF',
  textSoft: '#D9CCF0',
  textMuted: '#BCA9DA',
  /** Texto apagado (dicas, legendas). */
  muted: '#8B7AA6',
  textFaint: '#8B7AA6',
  /** Texto sobre botões cheios (roxo/rosa). */
  onCyan: '#140A22',
  onAccent: '#140A22',

  // ---------------------------------------------------------------------
  // Marca
  // ---------------------------------------------------------------------
  /** Roxo principal da Nexo. */
  accent: '#B57BFF',
  accentDeep: '#7C4DFF',
  violet: '#B57BFF',
  pink: '#FF7AC8',
  pinkDeep: '#E0509F',
  cyan: '#B57BFF',
  cyanSoft: 'rgba(181, 123, 255, 0.14)',
  cyanGlow: 'rgba(181, 123, 255, 0.42)',
  neonCyan: '#C08BFF',
  neonBlue: '#FF7AC8',
  neonViolet: '#7C4DFF',
  neonPink: '#FF3D9A',
  /** Microfone: o "quente" da paleta (rosa). */
  gold: '#FF7AC8',
  goldHot: '#E0509F',

  // ---------------------------------------------------------------------
  // Estados
  // ---------------------------------------------------------------------
  success: '#6BE3A2',
  warning: '#FFC46B',
  danger: '#FF6B81',
  error: '#FF6B81',
  dangerSoft: 'rgba(255, 107, 129, 0.12)',

  // ---------------------------------------------------------------------
  // Superfícies de vidro
  // ---------------------------------------------------------------------
  glass: 'rgba(24, 14, 38, 0.62)',
  glassStrong: 'rgba(9, 5, 17, 0.92)',
  glassBorder: 'rgba(181, 123, 255, 0.24)',
  border: 'rgba(255, 255, 255, 0.10)',
  borderStrong: 'rgba(181, 123, 255, 0.35)',
  line: 'rgba(255, 255, 255, 0.10)',
  lineActive: 'rgba(181, 123, 255, 0.55)',

  // ---------------------------------------------------------------------
  // Balões
  // ---------------------------------------------------------------------
  bubbleNexo: 'rgba(181, 123, 255, 0.13)',
  bubbleTratis: 'rgba(255, 122, 200, 0.14)',
  bubbleFemVerity: 'rgba(255, 122, 200, 0.14)',
  bubbleUser: 'rgba(255, 122, 200, 0.16)',
  overlay: 'rgba(4, 2, 9, 0.72)',
} as const;

export const radius = {
  sm: 10,
  md: 16,
  lg: 22,
  xl: 30,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

/** Escala tipográfica nova. */
export const font = {
  tiny: 11,
  small: 13,
  body: 15,
  title: 18,
  hero: 22,
  xl: 20,
  lg: 16,
  md: 15,
  sm: 13,
  xs: 11,
} as const;

/** Escala tipográfica antiga (mantida para as telas existentes). */
export const fontSize = {
  caption: 11,
  small: 13,
  body: 15,
  title: 18,
  display: 26,
  hero: 34,
} as const;

/**
 * Sombras prontas.
 *
 * No Android o `elevation` é o que funciona de verdade; no iOS as
 * propriedades de sombra.
 */
export const shadow = {
  card: {
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  glow: {
    shadowColor: colors.accent,
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
} as const;

/** Brilho colorido para botões e ícones ativos. */
export function glow(color: string = colors.accent, opacity = 0.45) {
  return {
    shadowColor: color,
    shadowOpacity: opacity,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  };
}

/** Gradientes da marca, para não espalhar arrays de cor pelas telas. */
export const gradients = {
  brand: ['#B57BFF', '#FF7AC8'] as const,
  brandDeep: ['#7C4DFF', '#B57BFF'] as const,
  warm: ['#FF8ACB', '#A46BFF'] as const,
  mic: ['#FF8ACB', '#E0509F'] as const,
  background: ['#1C0F30', '#120A21', '#07040F'] as const,
  hairline: ['#B57BFF', '#FF7AC8', 'transparent'] as const,
} as const;
