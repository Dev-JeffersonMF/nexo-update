/**
 * Conversa de uma notificação do WhatsApp, passo a passo.
 *
 * A ideia (pedida pelo usuário): quando chega uma mensagem, o Nexus diz QUEM
 * mandou, pergunta se pode ler (ou tocar, se for áudio), depois pergunta se o
 * usuário quer responder, ligar ou fazer chamada de vídeo. Se quiser responder,
 * captura a fala, escreve a resposta no chat, pede confirmação e só então envia —
 * se o usuário negar, APAGA o que escreveu e volta a esperar novas notificações.
 *
 * Para mídia (áudio, vídeo, imagem): se o Nexus não conseguir reproduzir inline,
 * ele abre o WhatsApp no contato, reproduz/exibe lá, e depois volta para o Nexus.
 * Para imagem: mostra por 5s, pergunta se quer responder; se sim, abre microfone,
 * transcreve, envia, avisa "mensagem enviada" e volta ao Nexus.
 *
 * Este módulo é puro: traduz a notificação e a resposta do usuário em texto para
 * falar e em ações para a interface executar. Não toca em microfone, WhatsApp nem
 * rede — por isso o fluxo inteiro roda em `npm test`, sem aparelho.
 *
 * Ações possíveis (`actions`):
 *   { type: 'open-chat' }                  abre a conversa de quem mandou
 *   { type: 'play-audio' }                 toca o áudio (melhor esforço inline)
 *   { type: 'play-media-in-whatsapp' }     abre WhatsApp e reproduz áudio/vídeo lá
 *   { type: 'view-image-in-whatsapp' }     abre WhatsApp e mostra imagem
 *   { type: 'wait-and-ask-reply' }         espera 5s, pergunta se quer responder
 *   { type: 'listen' }                     abre o microfone para a resposta falada
 *   { type: 'write-reply', text }          escreve no campo, SEM enviar
 *   { type: 'send-reply' }                 toca em enviar
 *   { type: 'clear-reply' }                apaga o que foi escrito
 *   { type: 'answer-call' }                toca no "atender" da chamada na tela
 *   { type: 'decline-call' }               toca no "recusar" da chamada na tela
 *   { type: 'call-back' }                  liga de volta (chamada perdida)
 *   { type: 'call-contact' }               liga (voz ou vídeo) para quem mandou
 *   { type: 'resume-media' }               retoma rádio/música que foram pausados
 *
 * Nas chamadas o módulo NÃO diz "atendendo" nem "recusada": atender e recusar
 * são toques numa tela que pode não expor o botão, então quem fala o resultado é
 * a interface, com o retorno real do aparelho.
 */

import { parseCallRequest } from './nativeCommands.mjs';

/** Limite do trecho da mensagem lido em voz alta. */
export const MAX_QUOTED_LENGTH = 180;

/**
 * Janela em que uma chamada guardada ainda pode ser atendida.
 *
 * O WhatsApp toca por cerca de 30-45 s. Quando o app só vê a notificação
 * depois disso (por exemplo, ao abrir de novo), a oferta honesta é ligar de
 * volta — não perguntar "quer atender?" para uma chamada que já terminou.
 */
export const CALL_RINGING_WINDOW_MS = 60_000;

/**
 * Palavras que o WhatsApp usa no texto da notificação quando é mensagem de voz.
 *
 * Só o texto EXPLÍCITO conta: notificação sem texto pode ser foto, vídeo, áudio
 * ou figurinha, e o Nexus não pode dizer "é um áudio" sem saber. Nesses casos ele
 * pergunta de forma neutra e oferece abrir a conversa.
 */
const AUDIO_PATTERN = /\b(?:audio|mensagem de voz|voice message|gravacao|gravacao de voz)\b/i;

function clean(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/** Minúsculas e sem acento, para comparar palavras (\"Áudio\" → \"audio\"). */
function fold(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Corta a mensagem longa antes de falar. */
function quote(message) {
  const text = clean(message);
  if (text.length <= MAX_QUOTED_LENGTH) return text;
  return `${text.slice(0, MAX_QUOTED_LENGTH - 1).trimEnd()}…`;
}

/**
 * A notificação é de áudio?
 *
 * Aceita a marca explícita do lado nativo (`isAudio`) e, no texto, só as
 * expressões que o próprio WhatsApp escreve.
 */
export function isAudioNotification(notification = {}) {
  if (notification.isAudio === true) return true;
  return AUDIO_PATTERN.test(fold(notification.message));
}

/**
 * Decide se uma notificação de chamada ainda está tocando.
 *
 * A notificação ao vivo chega sem `at` (o chamador marca com `Date.now()`);
 * nesse caso ela É uma chamada em andamento. Já a notificação guardada pelo
 * serviço nativo traz o horário real: se tem mais de [CALL_RINGING_WINDOW_MS],
 * o WhatsApp já desistiu e o fluxo deve oferecer ligar de volta.
 *
 * @param {{ type?: string, at?: number }} notification
 * @param {number} [now] Relógio usado no teste; por padrão, agora.
 * @returns {'message' | 'voice-call' | 'video-call' | 'missed-call'}
 */
export function resolveNotificationType(notification = {}, now = Date.now()) {
  const type = notification.type ?? 'message';
  if (type !== 'voice-call' && type !== 'video-call') return type;

  const at = Number(notification.at);
  if (Number.isFinite(at) && at > 0 && now - at > CALL_RINGING_WINDOW_MS) {
    return 'missed-call';
  }
  return type;
}

function done(state) {
  return { ...state, step: 'done' };
}

// ---------------------------------------------------------------------
// Início
// ---------------------------------------------------------------------

/**
 * Primeiro passo a partir de uma notificação recém-chegada.
 *
 * @param {{ contact?: string, message?: string, type?: string, isAudio?: boolean,
 *           mediaState?: object }} notification
 * @returns {{ state: object, say: string, actions: object[] }}
 */
export function startNotificationFlow(notification = {}) {
  const contact = clean(notification.contact);
  const message = notification.message == null ? '' : clean(notification.message);
  const type = notification.type ?? 'message';
  const mediaState = notification.mediaState ?? {};

  const state = {
    step: 'done',
    contact,
    message,
    type,
    isAudio: isAudioNotification(notification),
    hasText: message.length > 0,
    mediaState,
    reply: '',
    callSource: notification.callSource ?? 'whatsapp',
    phoneNumber: notification.phoneNumber ?? '',
  };

  // Sem remetente não há conversa: devolve o controle sem falar nada.
  if (!contact) {
    return { state: done(state), say: '', actions: [{ type: 'resume-media' }] };
  }

  /*
   * Chamada de número que não está na agenda: o nativo já recusou/encerrou.
   * Aqui só se ANUNCIA o bloqueio — não se pergunta "quer atender?", porque não
   * há mais chamada para atender. Quem confirma o bloqueio real é o serviço.
   */
  if (type === 'blocked-call') {
    return {
      state: done(state),
      say: `Chamada de ${contact} bloqueada. Número desconhecido.`,
      actions: [{ type: 'resume-media' }],
    };
  }

  if (type === 'voice-call' || type === 'video-call') {
    const kind = type === 'video-call' ? 'Chamada de vídeo' : 'Chamada de voz';
    return {
      state: { ...state, step: 'ask-attend' },
      // Diz as duas opções: o usuário não precisa adivinhar que "não" recusa.
      say: `${kind} de ${contact}. Quer atender? Diga sim para atender ou não para recusar.`,
      actions: [{ type: 'listen' }],
    };
  }

  if (type === 'missed-call') {
    // Chamada perdida é aviso, não chamada: perguntar "quer atender?" seria uma
    // ação impossível. A oferta honesta é ligar de volta.
    return {
      state: { ...state, step: 'ask-call-back' },
      say: `Chamada perdida de ${contact}. Quer que eu ligue de volta?`,
      actions: [{ type: 'listen' }],
    };
  }

  if (state.isAudio) {
    // Áudio é para OUVIR: o Nexus abre a conversa e toca na hora, sem obrigar
    // o usuário a confirmar. Ao terminar, ele pergunta se quer responder.
    return {
      state: { ...state, step: 'playing-audio' },
      say: `Chegou um áudio de ${contact}. Vou tocar para você ouvir.`,
      actions: [{ type: 'open-chat' }, { type: 'play-audio' }],
    };
  }

  if (!state.hasText) {
    // Notificação sem texto: não dá para "ler". Oferece abrir a conversa.
    return {
      state: { ...state, step: 'ask-read' },
      say: `Chegou uma mensagem de ${contact}, mas sem texto — pode ser foto ou outro arquivo. Quer que eu abra a conversa?`,
      actions: [{ type: 'listen' }],
    };
  }

  return {
    state: { ...state, step: 'ask-read' },
    say: `Chegou mensagem de ${contact}. Quer que eu leia?`,
    actions: [{ type: 'listen' }],
  };
}

// ---------------------------------------------------------------------
// Próximos passos
// ---------------------------------------------------------------------

/**
 * Avança o fluxo com o que aconteceu.
 *
 * @param {object} state Estado devolvido por [startNotificationFlow] ou por esta
 *   própria função.
 * @param {{ type: 'answer', affirmative: boolean, message?: string }
 *        | { type: 'audio-finished' }
 *        | { type: 'captured', text: string }} event
 * @returns {{ state: object, say: string, actions: object[] }}
 */
export function advanceNotificationFlow(state, event = {}) {
  if (!state || state.step === 'done') {
    return { state: state ? done(state) : state, say: '', actions: [] };
  }

  if (event.type === 'audio-finished') {
    return {
      state: { ...state, step: 'ask-reply' },
      say: `Quer responder para ${state.contact}?`,
      actions: [{ type: 'listen' }],
    };
  }

  /*
   * "Ligar" e "chamada de vídeo" durante a conversa são PEDIDOS DE CHAMADA, não
   * texto de resposta. Quem decide isso é `parseCallRequest` (frase curta, sem
   * negação); aqui só vira a ação, e o resultado real quem fala é a interface.
   */
  if (event.type === 'call' && acceptsCallRequest(state.step)) {
    const actions = state.step === 'confirm-send' ? [{ type: 'clear-reply' }] : [];
    return {
      state: done(state),
      say: '',
      actions: [...actions, { type: 'call-contact', video: event.video === true }],
    };
  }

  if (event.type === 'captured') {
    return handleCaptured(state, event.text);
  }

  const affirmative = event.affirmative === true;

  switch (state.step) {
    case 'ask-attend':
      if (affirmative) {
        // Quem fala o resultado é a interface: tocar no "atender" é melhor
        // esforço (a tela de chamada pode não expor o botão) e só ela sabe se
        // deu certo. A mídia NÃO volta: o usuário está entrando numa chamada.
        return { state: done(state), say: '', actions: [{ type: 'answer-call' }] };
      }
      // Mesma regra para recusar: nada de dizer "recusada" sem ter recusado.
      return { state: done(state), say: '', actions: [{ type: 'decline-call' }] };

    case 'ask-call-back':
      if (affirmative) {
        // Quem fala o resultado é a interface: a ligação de volta é real, mas
        // depende da agenda e do WhatsApp, e só o aparelho sabe se deu certo.
        return { state: done(state), say: '', actions: [{ type: 'call-back' }] };
      }
      return { state: done(state), say: 'Tudo bem.', actions: [{ type: 'resume-media' }] };

    case 'ask-read':
      if (!affirmative) {
        return { state: done(state), say: 'Tudo bem.', actions: [{ type: 'resume-media' }] };
      }
      // Sem texto: a única leitura possível é abrir a conversa.
      //
      // A mensagem lida NA TELHA vale mais que a da notificação: a notificação
      // do WhatsApp chega truncada (e às vezes sem texto, por causa da
      // privacidade) — quem lê de verdade é o balão que está aberto.
      const read = clean(event.message ?? '');
      const message = read.length > 0 ? read : state.message;
      const hasText = state.hasText || message.length > 0;
      if (!hasText) {
        return {
          state: done(state),
          say: `Abrindo a conversa com ${state.contact}.`,
          actions: [{ type: 'open-chat' }, { type: 'resume-media' }],
        };
      }
      return {
        state: { ...state, step: 'ask-reply' },
        say: `Mensagem de ${state.contact}: "${quote(message)}". Deseja responder, ligar ou fazer chamada de vídeo?`,
        // Abre a conversa ANTES de perguntar: o usuário pediu para o Nexus
        // entrar no WhatsApp e ler a mensagem do contato que mandou, não só
        // recitar o texto por cima da tela inicial.
        actions: [{ type: 'open-chat' }, { type: 'listen' }],
      };

    case 'ask-audio':
      if (!affirmative) {
        return { state: done(state), say: 'Tudo bem.', actions: [{ type: 'resume-media' }] };
      }
      // Quem fala o resultado é a interface, depois de saber se o áudio tocou
      // mesmo: aqui não dá para prometer "tocando" sem ter tocado.
      //
      // A conversa ABRE ANTES: o áudio mora dentro do chat, e sem abrir a
      // conversa o Nexus não tinha nem o botão de reprodução na tela — o
      // pedido terminava em "não consegui tocar o áudio sozinho".
      return {
        state: { ...state, step: 'playing-audio' },
        say: '',
        actions: [{ type: 'open-chat' }, { type: 'play-audio' }],
      };

    case 'ask-reply':
      if (affirmative) {
        return {
          state: { ...state, step: 'listening' },
          say: `Pode falar que eu escrevo para ${state.contact}.`,
          actions: [{ type: 'open-chat' }, { type: 'listen' }],
        };
      }
      return {
        state: done(state),
        say: 'Tudo bem. Fico de olho nas próximas mensagens.',
        actions: [{ type: 'resume-media' }],
      };

    case 'confirm-send':
      if (affirmative) {
        // Quem diz "enviado" é a interface, com o resultado real do envio.
        return { state: done(state), say: '', actions: [{ type: 'send-reply' }, { type: 'resume-media' }] };
      }
      return {
        state: done(state),
        // Quem confirma "apaguei" é a interface, com o resultado real do apagar.
        say: '',
        actions: [{ type: 'clear-reply' }, { type: 'resume-media' }],
      };

    default:
      return { state, say: '', actions: [] };
  }
}

/** Texto capturado do microfone para a resposta. */
function handleCaptured(state, rawText) {
  const text = clean(rawText);

  if (!text) {
    return {
      state: { ...state, step: 'listening' },
      say: 'Não entendi. Pode repetir?',
      actions: [{ type: 'listen' }],
    };
  }

  /*
   * Na etapa de escrever a resposta, "ligar" e "chamada de vídeo" continuam
   * sendo PEDIDOS DE CHAMADA: escrever "ligar" no chat seria um falso positivo
   * (e a mensagem errada iria para o contato).
   */
  const call = parseCallRequest(text);
  if (call) {
    return {
      state: done(state),
      say: '',
      actions: [{ type: 'call-contact', video: call.video }],
    };
  }

  return {
    state: { ...done(state), reply: text },
    // O usuário falou a resposta: o Nexus escreve e ENVIA na sequência. Quem
    // confirma o resultado real é a interface ("Mensagem respondida para X.").
    say: `Enviando sua resposta para ${state.contact}.`,
    actions: [{ type: 'write-reply', text }, { type: 'send-reply' }],
  };
}

/**
 * Passos em que um pedido de chamada faz sentido.
 *
 * `confirm-send` também entra: o usuário pode desistir da resposta e ligar. A
 * interface apaga o rascunho antes de discar (ação `clear-reply`).
 */
function acceptsCallRequest(step) {
  return step === 'ask-read' || step === 'ask-reply' || step === 'listening' || step === 'confirm-send';
}

/** Rótulo curto para o aviso na tela (não é o que o Nexus fala). */
export function notificationFlowLabel(state) {
  switch (state?.step) {
    case 'ask-attend':
      return 'Chamada recebida';
    case 'ask-call-back':
      return 'Chamada perdida';
    case 'ask-read':
      return 'Mensagem recebida';
    case 'ask-audio':
      return 'Áudio recebido';
    case 'playing-audio':
      return 'Tocando áudio';
    case 'ask-reply':
      return 'Responder mensagem';
    case 'listening':
      return 'Ouvindo resposta';
    case 'confirm-send':
      return 'Confirmar envio';
    default:
      return 'Em espera';
  }
}
