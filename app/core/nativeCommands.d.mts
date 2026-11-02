export type NativeCommandPlan =
  | { action: 'radio-play'; station: string }
  | { action: 'radio-next' }
  | { action: 'radio-pause' }
  | { action: 'radio-resume' }
  | { action: 'radio-stop' }
  | { action: 'youtube'; query: string }
  | { action: 'oitube'; query: string }
  | { action: 'music'; query: string }
  | { action: 'whatsapp-call'; contact: string; video: boolean | null }
  | { action: 'whatsapp-start-call'; contact?: string; video: boolean | null }
  | { action: 'whatsapp-message'; contact: string; message: string }
  | { action: 'whatsapp-start-message'; contact?: string; message?: string }
  | { action: 'whatsapp-confirm-send' }
  | { action: 'whatsapp-cancel-send' }
  | { action: 'whatsapp-delete-last-message'; contact: string }
  | { action: 'whatsapp-broadcast'; listName?: string }
  | { action: 'open-last-message' }
  | { action: 'local-call'; contact: string; lookup?: boolean }
  | { action: 'weather'; city: string; day?: 'today' | 'tomorrow' }
  | { action: 'media'; control: 'play' | 'pause' | 'next' | 'prev' | 'stop' }
  | { action: 'volume-up' }
  | { action: 'volume-down' }
  | { action: 'volume-set'; level: number }
  | { action: 'volume-level' }
  | { action: 'launch-app'; query: string }
  | { action: 'horoscopo'; signo: string };

export function normalizeCommand(input: string): string;
export function planNativeCommand(input: string): NativeCommandPlan | undefined;

/** Volume do som pedido por voz (escala de 0 a 5). */
export function parseVolumeCommand(input: string): NativeCommandPlan | undefined;

/** Resposta à pergunta "chamada de voz ou de vídeo?": true = vídeo, false = voz, null = não entendeu. */
export function parseCallKindAnswer(input: string): boolean | null;

/** Resposta falada à pergunta "qual música ou cantor?" — já com a plataforma separada. */
export function planMusicAnswer(input: string): {
  query: string;
  platform?: 'youtube' | 'oitube';
};

/**
 * Interpreta a resposta falada a uma pergunta de ligacao ("de video?").
 *
 * Devolve `undefined` quando a frase nao e uma resposta de chamada - ai o
 * app segue o fluxo normal em vez de tratar como confirmacao.
 */
export function parseCallRequest(input: string): { video: boolean } | undefined;
