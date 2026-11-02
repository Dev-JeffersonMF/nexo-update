/** Limite de caracteres da mensagem citada em voz alta. */
export const MAX_QUOTED_LENGTH: number;

export interface NotificationPayload {
  app?: string;
  contact?: string;
  message?: string;
}

export function describeNotification(notification?: NotificationPayload): string;
export function summarizeNotification(notification?: NotificationPayload): string;
