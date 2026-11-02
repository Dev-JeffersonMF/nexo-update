/**
 * Transforma uma notificação de mensagem no texto que o Nexus fala.
 *
 * Fica separado do React Native de propósito: é lógica pura e pode ser
 * testada com `npm test` sem emulador.
 */

/** Limite de caracteres da mensagem citada em voz alta. */
export const MAX_QUOTED_LENGTH = 180;

/** @param {unknown} value */
function clean(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/**
 * Frase completa para o Nexus falar quando chega uma mensagem.
 *
 * @param {{app?: string, contact?: string, message?: string}} [notification]
 * @returns {string} frase pronta para ser falada; vazia quando não há conteúdo.
 */
export function describeNotification(notification = {}) {
  const app = clean(notification.app) || 'WhatsApp';
  const contact = clean(notification.contact);
  const rawMessage = clean(notification.message);

  const message =
    rawMessage.length > MAX_QUOTED_LENGTH
      ? `${rawMessage.slice(0, MAX_QUOTED_LENGTH - 1).trimEnd()}…`
      : rawMessage;

  if (!contact && !message) return '';

  if (contact && message) {
    return `Mensagem de ${contact} no ${app}: "${message}". Diga "abrir a mensagem" para ler.`;
  }

  if (contact) {
    return `Chegou uma mensagem de ${contact} no ${app}. Diga "abrir a mensagem" para ler.`;
  }

  return `Chegou uma mensagem no ${app}: "${message}". Diga "abrir a mensagem" para ler.`;
}

/**
 * Versão curta, em uma linha, para o aviso na tela.
 *
 * @param {{app?: string, contact?: string, message?: string}} [notification]
 * @returns {string} aviso curto; vazio quando não há conteúdo.
 */
export function summarizeNotification(notification = {}) {
  const app = clean(notification.app) || 'WhatsApp';
  const contact = clean(notification.contact);
  const message = clean(notification.message);

  if (!contact && !message) return '';
  if (contact && message) return `💬 ${app} — ${contact}: ${message}`;
  if (contact) return `💬 ${app} — nova mensagem de ${contact}`;
  return `💬 ${app} — ${message}`;
}
