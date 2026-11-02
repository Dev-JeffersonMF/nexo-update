/**
 * Política de uso do microfone do Nexus.
 *
 * O microfone tem UM dono por vez. Este arquivo é a regra única dessa posse, e
 * é puro de propósito: dá para testar todos os casos (app na frente, app
 * minimizado, permissão faltando, Nexus falando, captura em andamento) sem
 * ligar aparelho nem módulo nativo.
 *
 * As duas modalidades do motor nativo:
 *
 *  - `inApp`: o botão de microfone da tela principal. UMA captura do pedido;
 *  - `floating`: o toque no mascote. O Nexus avisa "Estou ouvindo" e captura o
 *    pedido — UMA vez por toque.
 *
 * Regras:
 *
 *  1. O microfone NUNCA abre sozinho. Dentro do app só o botão abre; fora dele,
 *     só o toque no mascote. Não existe escuta passiva de palavra de ativação:
 *     era ela que deixava o microfone abrindo sessões em ciclo (com o aviso
 *     sonoro do serviço de reconhecimento) sem acertar a palavra.
 *  2. O mascote pode ficar na tela com o microfone FECHADO — ele é o botão de
 *     falar fora do app, não um ouvinte.
 *  3. Enquanto o Nexus fala (TTS), o microfone fica fechado para ele não se
 *     ouvir — e não reabre depois: quem decide é o estado do app.
 *  4. Durante um pedido de permissão (diálogo ou tela de ajustes) nada liga: o
 *     `onPause` da Activity também dispara ali, e ligar a escuta nesse momento
 *     abria o microfone durante o onboarding.
 *  5. Captura em andamento não é interrompida por mudança de estado do app: quem
 *     manda nela é o toque que a começou e o fim natural da fala.
 */

/** Quem está com o microfone. */
export const VOICE_MODE = {
  /** Microfone fechado. */
  off: 'off',
  /** Captura de um pedido, feita pelo botão da tela principal. */
  inApp: 'inApp',
  /** Captura de um pedido, feita pelo toque no mascote flutuante. */
  floating: 'floating',
};

/**
 * @typedef {object} VoiceSessionSnapshot
 * @property {'active' | 'background' | 'inactive' | string} appState Estado da tela do assistente (AppState do RN).
 * @property {boolean} microphoneGranted Permissão de microfone liberada.
 * @property {boolean} overlayGranted Permissão "Sobrepor outros apps" liberada.
 * @property {boolean} [capturing] Existe captura dentro do app em andamento.
 * @property {boolean} [speaking] O Nexus está falando agora.
 * @property {boolean} [permissionRequestInFlight] Há pedido de permissão aberto.
 *
 * @typedef {object} VoiceSessionPlan
 * @property {boolean} showMascot Deixar o mascote na tela (ele NÃO ouve: só o
 *   toque nele abre o microfone).
 * @property {boolean} stopListening Garantir o microfone fechado.
 * @property {string} reason Motivo, para log e para a interface explicar.
 */

/**
 * Decide o estado do mascote e do microfone a partir do momento do app.
 *
 * Falar com o Nexus fora do app é sempre pelo TOQUE no mascote: ele avisa
 * "Estou ouvindo" e abre o microfone para um pedido. Não existe detector de
 * palavra de ativação segurando o microfone.
 *
 * @param {VoiceSessionSnapshot} snapshot
 * @returns {VoiceSessionPlan}
 */
export function planVoiceSession(snapshot) {
  const {
    appState,
    microphoneGranted,
    overlayGranted,
    capturing = false,
    speaking = false,
    permissionRequestInFlight = false,
  } = snapshot ?? {};

  if (!microphoneGranted) {
    // Sem microfone liberado o toque no mascote não serviria para nada.
    return {
      showMascot: false,
      stopListening: true,
      reason: 'microphone-denied',
    };
  }

  // A captura é do usuário: nada aqui pode desligá-la no meio.
  if (capturing) {
    return {
      showMascot: appState !== 'active',
      stopListening: false,
      reason: 'capturing',
    };
  }

  if (permissionRequestInFlight) {
    return {
      showMascot: false,
      stopListening: true,
      reason: 'permission-pending',
    };
  }

  if (appState === 'active') {
    // Dentro do app o mascote não aparece (a tela tem o botão de microfone).
    return {
      showMascot: false,
      stopListening: true,
      reason: 'assistant-in-foreground',
    };
  }

  if (speaking) {
    // Resposta falada de um pedido feito no mascote: ele continua na tela, com o
    // microfone fechado.
    return {
      showMascot: overlayGranted,
      stopListening: true,
      reason: 'assistant-speaking',
    };
  }

  if (!overlayGranted) {
    // Sem o mascote na tela o usuário não teria como falar fora do app.
    return {
      showMascot: false,
      stopListening: true,
      reason: 'overlay-denied',
    };
  }

  // Fora do app: o mascote fica na tela esperando o toque, com o microfone
  // fechado.
  return {
    showMascot: true,
    stopListening: true,
    reason: 'mascot-idle',
  };
}

/**
 * Traduz o evento nativo de estado da voz para o que a tela mostra.
 *
 * O nativo é a fonte da verdade: se o microfone fechou sozinho (silêncio, erro
 * ou fim da captura), a interface não pode continuar dizendo "ouvindo".
 *
 * @param {{mode?: string, phase?: string, capturing?: boolean} | null | undefined} payload
 * @returns {{ mode: string, phase: string, capturing: boolean, listening: boolean }}
 */
export function describeVoiceState(payload) {
  const mode = typeof payload?.mode === 'string' ? payload.mode : VOICE_MODE.off;
  const phase = typeof payload?.phase === 'string' ? payload.phase : 'idle';
  const capturing = payload?.capturing === true;

  return {
    mode,
    phase,
    capturing,
    // "Ouvindo" na tela = microfone realmente aberto em uma captura.
    listening: capturing,
  };
}

/**
 * Explica ao usuário o fim de uma captura (botão do app ou toque no mascote).
 *
 * Devolve `''` quando não há nada a dizer (o comando chegou e vai ser
 * executado).
 *
 * @param {string} reason Motivo enviado pelo nativo.
 * @returns {string}
 */
export function describeCaptureEnd(reason) {
  switch (reason) {
    case 'silence':
      return 'Não ouvi nada. Toque no microfone (ou no mascote) e fale de novo.';
    case 'noise':
      return 'Só ouvi barulho e não entendi nenhum pedido. Fale mais perto do microfone.';
    case 'network':
      return 'O reconhecimento de voz não conseguiu falar com o serviço do Google. Confira a internet e tente de novo.';
    case 'timeout':
      return 'Fiquei esperando e não ouvi o comando. Toque no microfone para tentar de novo.';
    case 'error':
      return 'Não consegui usar o microfone agora. Confira se ele está liberado e tente de novo.';
    case 'language-not-supported':
      return 'O idioma português não está instalado no reconhecimento de voz do Android. Vá em Ajustes > Idioma e entrada > Reconhecimento de voz do Google e baixe o pacote de português do Brasil.';
    case 'unsupported':
      return 'Este aparelho não tem reconhecimento de voz disponível. Escreva o comando aqui embaixo.';
    default:
      return '';
  }
}
