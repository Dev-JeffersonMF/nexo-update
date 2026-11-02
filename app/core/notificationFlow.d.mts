export const MAX_QUOTED_LENGTH: number;
export const CALL_RINGING_WINDOW_MS: number;

export interface NotificationPayload {
  app?: string;
  contact?: string;
  message?: string;
  /**
   * `blocked-call` existe porque a chamada de número desconhecido já foi
   * RECUSADA pelo Nexus: só se anuncia o bloqueio, nada de "quer atender?".
   */
  type?: 'message' | 'voice-call' | 'video-call' | 'missed-call' | 'blocked-call';
  /** Marca vinda do lado nativo quando o app souber que é áudio. */
  isAudio?: boolean;
  /** Quando a notificação chegou (ms); só existe nas guardadas pelo nativo. */
  at?: number;
  /** Origem da chamada: `whatsapp` ou `phone`. */
  callSource?: 'whatsapp' | 'phone';
  /** Número da chamada telefônica, quando disponível. */
  phoneNumber?: string;
  mediaState?: {
    radioWasPlaying?: boolean;
    musicWasPlaying?: boolean;
    musicAppName?: string;
  };
}

export type NotificationAction =
  | { type: 'open-chat' }
  | { type: 'play-audio' }
  | { type: 'listen' }
  | { type: 'write-reply'; text: string }
  | { type: 'send-reply' }
  | { type: 'clear-reply' }
  | { type: 'answer-call' }
  | { type: 'decline-call' }
  | { type: 'call-back' }
  | { type: 'call-contact'; video: boolean }
  | { type: 'resume-media' };

export type NotificationStep =
  | 'ask-attend'
  | 'ask-call-back'
  | 'ask-read'
  | 'ask-audio'
  | 'playing-audio'
  | 'ask-reply'
  | 'listening'
  | 'confirm-send'
  | 'done';

export interface NotificationFlowState {
  step: NotificationStep;
  contact: string;
  message: string;
  type: string;
  isAudio: boolean;
  hasText: boolean;
  mediaState: NotificationPayload['mediaState'];
  reply: string;
  callSource: 'whatsapp' | 'phone';
  phoneNumber: string;
}

export interface NotificationFlowResult {
  state: NotificationFlowState;
  say: string;
  actions: NotificationAction[];
}

export type NotificationEvent =
  | { type: 'answer'; affirmative: boolean; message?: string }
  | { type: 'audio-finished' }
  | { type: 'captured'; text: string }
  | { type: 'call'; video: boolean };

export function isAudioNotification(notification?: NotificationPayload): boolean;

export function resolveNotificationType(
  notification?: NotificationPayload,
  now?: number,
): 'message' | 'voice-call' | 'video-call' | 'missed-call';

export function startNotificationFlow(notification?: NotificationPayload): NotificationFlowResult;

export function advanceNotificationFlow(
  state: NotificationFlowState,
  event?: NotificationEvent,
): NotificationFlowResult;

export function notificationFlowLabel(state: NotificationFlowState): string;
