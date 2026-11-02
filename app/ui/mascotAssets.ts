/**
 * Assets dos mascotes.
 *
 * Dois personagens, mesma assistente: a Nexo (coruja) e a Tratis (retrato
 * pixel-art). Trocar de mascote é só uma escolha visual — a personalidade, a
 * voz e o cérebro continuam sendo os do Nexus Assistente.
 */

export type CharacterId = 'nexo' | 'tratis';

export type CharacterAssets = {
  /** Imagem base (ocioso). */
  idle: any;
  /** Boca fechada (base da fala). */
  mouthClosed: any;
  /** Boca aberta (sobreposta durante a fala). */
  mouthOpen: any;
  /** Quadros de "ouvindo" (pixel-art). */
  listeningFrames?: any[];
  /** Quadros de fala (boca abre/fecha na pixel-art). */
  talkingFrames?: any[];
  /** Retrato para a tela de configurações. */
  portrait: any;
  /** Ícone do app/launcher. */
  icon: any;
  /** Expressões (estágios de afeto da arte). */
  expressions?: {
    affection0?: any;
    affection1?: any;
    affection2?: any;
    affection3?: any;
  };
};

export const NEXO_ASSETS: CharacterAssets = {
  idle: require('../../assets/mascote-ocioso.png'),
  mouthClosed: require('../../assets/mascote-boca-fechada.png'),
  mouthOpen: require('../../assets/mascote-boca-aberta.png'),
  portrait: require('../../assets/mascote-ocioso.png'),
  icon: require('../../assets/icon.png'),
};

export const TRATIS_ASSETS: CharacterAssets = {
  idle: require('../../assets/femverity/afecto_0.png'),
  mouthClosed: require('../../assets/femverity/afecto_0.png'),
  mouthOpen: require('../../assets/femverity/afecto_1.png'),
  listeningFrames: [
    require('../../assets/femverity/frame_0.png'),
    require('../../assets/femverity/frame_1.png'),
    require('../../assets/femverity/frame_2.png'),
    require('../../assets/femverity/frame_3.png'),
  ],
  // Boca aberta (frame_3) alternando com o rosto calmo: dá a sensação de fala.
  talkingFrames: [
    require('../../assets/femverity/frame_0.png'),
    require('../../assets/femverity/frame_3.png'),
    require('../../assets/femverity/frame_0.png'),
    require('../../assets/femverity/frame_1.png'),
  ],
  portrait: require('../../assets/femverity/femverity_portrait.png'),
  icon: require('../../assets/femverity/icon.png'),
  expressions: {
    affection0: require('../../assets/femverity/afecto_0.png'),
    affection1: require('../../assets/femverity/afecto_1.png'),
    affection2: require('../../assets/femverity/afecto_2.png'),
    affection3: require('../../assets/femverity/afecto_3.png'),
  },
};

export const CHARACTERS: Record<CharacterId, CharacterAssets> = {
  nexo: NEXO_ASSETS,
  tratis: TRATIS_ASSETS,
};

export type CharacterMeta = {
  name: string;
  subtitle: string;
  description: string;
  /** Cor de destaque do personagem (borda, selo, nome). */
  accent: string;
  /** Fundo do balão do personagem. */
  bubble: string;
  /** Brilho do halo atrás da arte. */
  halo: string;
  /** Arte pixelada: escala sem suavizar na cabeça pequena. */
  pixelArt: boolean;
};

export const CHARACTER_META: Record<CharacterId, CharacterMeta> = {
  nexo: {
    name: 'Nexo',
    subtitle: 'sua assistente',
    description: 'A coruja azul original — fala, escuta e resolve as coisas do dia a dia.',
    accent: '#B57BFF',
    bubble: 'rgba(181, 123, 255, 0.13)',
    halo: 'rgba(181, 123, 255, 0.18)',
    pixelArt: false,
  },
  tratis: {
    name: 'Tratis',
    subtitle: 'seu outro eu',
    description: 'O retrato pixel-art da Tratis — mesmo cérebro, outra cara.',
    accent: '#FF7AC8',
    bubble: 'rgba(255, 122, 200, 0.14)',
    halo: 'rgba(255, 122, 200, 0.18)',
    pixelArt: true,
  },
};

export function getCharacterAssets(characterId: CharacterId): CharacterAssets {
  return CHARACTERS[characterId] ?? NEXO_ASSETS;
}

export function getCharacterMeta(characterId: CharacterId): CharacterMeta {
  return CHARACTER_META[characterId] ?? CHARACTER_META.nexo;
}

export const AVAILABLE_CHARACTERS: CharacterId[] = ['nexo', 'tratis'];

/** Compatibilidade com imports antigos. */
export const MASCOT = NEXO_ASSETS;
export const APP_ICON = NEXO_ASSETS.icon;

export const mascotImages = {
  ocioso: NEXO_ASSETS.idle,
  bocaFechada: NEXO_ASSETS.mouthClosed,
  bocaAberta: NEXO_ASSETS.mouthOpen,
};
