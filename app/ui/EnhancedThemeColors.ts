// Enhanced theme with new color palette for Nexus Assistant
// Extended color system for improved visual depth and animation support

export const enhancedColors = {
  // Enhanced background palette with depth layers
  background: {
    base: '#02040B',
    primary: '#050B16',
    secondary: '#080F1F',
    tertiary: '#0A1424',
    elevated: '#0E1B2E',
  },

  // Glassmorphism effects
  glass: {
    base: 'rgba(15, 27, 48, 0.72)',
    strong: 'rgba(7, 12, 26, 0.92)',
    ultra: 'rgba(5, 11, 22, 0.96)',
    hover: 'rgba(15, 27, 48, 0.88)',
  },

  // Enhanced cyan gradient system
  cyan: {
    base: '#3ED8EC',
    light: '#6FEEF8',
    dark: '#1A7A8A',
    ultraDark: '#0F4A5A',
    gradientStart: '#00F2FE',
    gradientEnd: '#0097E6',
    glow: 'rgba(62, 216, 236, 0.5)',
    glowSoft: 'rgba(62, 216, 236, 0.22)',
    glowUltra: 'rgba(62, 216, 236, 0.1)',
  },

  // Neon accents
  neon: {
    cyan: '#00F2FE',
    blue: '#0097E6',
    violet: '#9B51E0',
    pink: '#FF007A',
    gold: '#FFD700',
    emerald: '#00FF9F',
  },

  // Text system with improved contrast
  text: {
    primary: '#FFFFFF',
    secondary: '#F2F7FC',
    tertiary: '#C2D0E0',
    muted: '#7E8FA6',
    dim: '#4F627A',
    inverse: '#04121A',
  },

  // Card gradients
  gradients: {
    primary: ['#0E1B2E', '#0A1424'],
    cyan: ['#00F2FE', '#0097E6'],
    neon: ['#7C6BFF', '#3ED8EC'],
    success: ['#34D399', '#10B981'],
    warning: ['#FBBF24', '#F59E0B'],
  },

  // Motion blur colors
  motion: {
    trail: 'rgba(62, 216, 236, 0.15)',
    trailSoft: 'rgba(62, 216, 236, 0.06)',
    particle: '#3ED8EC',
  },

  // UI states
  state: {
    success: '#34D399',
    warning: '#FBBF24',
    error: '#FF5A5A',
    info: '#3ED8EC',
    disabled: '#4A5568',
  },

  // Border colors with opacity
  border: {
    base: 'rgba(120, 160, 200, 0.18)',
    focused: 'rgba(62, 216, 236, 0.6)',
    hover: 'rgba(62, 216, 236, 0.35)',
    active: 'rgba(62, 216, 236, 0.8)',
  },

  // Glass border highlight (mesma cor do token legado `colors.glassBorder`)
  glassBorder: 'rgba(62, 216, 236, 0.35)',
} as const;

// Animated theme transitions
export const themeTransitions = {
  primary: {
    duration: 400,
    easing: [0.25, 0.46, 0.45, 0.94],
  },
  secondary: {
    duration: 300,
    easing: [0.25, 0.46, 0.45, 0.94],
  },
  instant: {
    duration: 0,
    easing: [1, 0, 0, 1],
  },
};

// Shadow system with depth levels
export const shadows = {
  subtle: {
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  medium: {
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  strong: {
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  glow: {
    shadowColor: '#00F2FE',
    shadowOpacity: 0.45,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  massive: {
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 16 },
    elevation: 16,
  },
};

// Animation speeds for consistent motion
export const animationSpeeds = {
  ultraFast: 150,
  fast: 250,
  normal: 350,
  slow: 500,
  ultraSlow: 800,
  continuous: 2000,
};

// Micro-interaction timings
export const microInteractions = {
  press: {
    scale: 0.96,
    duration: 120,
  },
  hover: {
    scale: 1.02,
    duration: 200,
  },
  focus: {
    scale: 1.03,
    duration: 250,
  },
};

// Backwards compatibility - export colors with same name (hardcoded for Hermes production build)
export const colors = {
  background: '#050B16',
  backgroundElevated: '#0E1B2E',
  panel: '#080F1F',
  card: '#0A1424',
  cardStrong: '#0E1B2E',
  cyan: '#3ED8EC',
  cyanSoft: 'rgba(62, 216, 236, 0.22)',
  cyanGlow: 'rgba(62, 216, 236, 0.5)',
  violet: '#9B51E0',
  text: '#F2F7FC',
  textSoft: '#C2D0E0',
  muted: '#7E8FA6',
  line: 'rgba(120, 160, 200, 0.18)',
  lineActive: 'rgba(62, 216, 236, 0.6)',
  success: '#34D399',
  warning: '#FBBF24',
  danger: '#FF5A5A',
  dangerSoft: 'rgba(255, 107, 122, 0.12)',
  onCyan: '#04121A',
  glass: 'rgba(15, 27, 48, 0.72)',
  glassStrong: 'rgba(7, 12, 26, 0.92)',
  glassBorder: 'rgba(62, 216, 236, 0.35)',
  neonCyan: '#00F2FE',
  neonBlue: '#0097E6',
  neonViolet: '#9B51E0',
  neonPink: '#FF007A',
  gold: '#FFD700',
  goldHot: '#FF5252',
} as const;
