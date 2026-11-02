/**
 * Serviço de contatos ignorados.
 *
 * O Nexus pode ignorar contatos específicos: não fala, não notifica e não
 * abre o fluxo de notificação para eles. As mensagens ignoradas durante o
 * período de ignorância NUNCA serão lidas retroativamente, mesmo se o
 * contato for removido da lista depois.
 *
 * A lista é salva nas preferências do app e sincronizada com o nativo.
 */

import { nexusNative, isNativeAvailable } from './nexusNative';

const STORAGE_KEY = 'ignored_contacts_v1';

/** Contato na lista de ignorados. */
export interface IgnoredContact {
  /** Nome normalizado (minúsculas, sem acento) para comparação. */
  normalizedName: string;
  /** Nome original para exibição. */
  displayName: string;
  /** Telefone (opcional, para disambiguação). */
  phoneNumber?: string;
  /** Timestamp de quando foi adicionado à lista. */
  ignoredAt: number;
}

let ignoredContactsCache: IgnoredContact[] | null = null;
let listeners: Set<() => void> = new Set();

function notifyListeners() {
  listeners.forEach((cb) => cb());
}

/** Carrega a lista do armazenamento local. */
async function loadIgnoredContacts(): Promise<IgnoredContact[]> {
  if (ignoredContactsCache) return ignoredContactsCache;

  try {
    if (isNativeAvailable()) {
      const json = await nexusNative.loadIgnoredContacts();
      if (json) {
        ignoredContactsCache = JSON.parse(json) ?? [];
        return ignoredContactsCache ?? [];
      }
    }
  } catch {
    // Ignora erro, tenta fallback local
  }

  // Fallback: AsyncStorage via JS (se houver)
  ignoredContactsCache = [];
  return ignoredContactsCache;
}

/** Salva a lista no armazenamento nativo. */
async function saveIgnoredContacts(contacts: IgnoredContact[]): Promise<void> {
  ignoredContactsCache = contacts;
  try {
    if (isNativeAvailable()) {
      await nexusNative.saveIgnoredContacts(JSON.stringify(contacts));
    }
  } catch {
    // Fallback silencioso
  }
  notifyListeners();
}

/** Adiciona um contato à lista de ignorados. */
export async function addIgnoredContact(
  displayName: string,
  phoneNumber?: string
): Promise<boolean> {
  const contacts = await loadIgnoredContacts();
  const normalizedName = normalizeName(displayName);

  // Verifica se já existe (mesmo nome normalizado)
  if (contacts.some((c) => c.normalizedName === normalizedName)) {
    return false;
  }

  const newContact: IgnoredContact = {
    normalizedName,
    displayName,
    phoneNumber: phoneNumber ? normalizePhone(phoneNumber) : undefined,
    ignoredAt: Date.now(),
  };

  await saveIgnoredContacts([...contacts, newContact]);
  return true;
}

/** Remove um contato da lista de ignorados. */
export async function removeIgnoredContact(displayName: string): Promise<boolean> {
  const contacts = await loadIgnoredContacts();
  const normalizedName = normalizeName(displayName);
  const filtered = contacts.filter((c) => c.normalizedName !== normalizedName);

  if (filtered.length === contacts.length) return false;

  await saveIgnoredContacts(filtered);
  return true;
}

/** Retorna a lista atual de contatos ignorados. */
export async function getIgnoredContacts(): Promise<IgnoredContact[]> {
  return loadIgnoredContacts();
}

/** Verifica se um contato está na lista de ignorados. */
export async function isContactIgnored(
  contactName: string,
  phoneNumber?: string
): Promise<boolean> {
  const contacts = await loadIgnoredContacts();
  const normalizedName = normalizeName(contactName);
  const normalizedPhone = phoneNumber ? normalizePhone(phoneNumber) : undefined;

  return contacts.some((c) => {
    if (c.normalizedName === normalizedName) return true;
    if (normalizedPhone && c.phoneNumber && c.phoneNumber === normalizedPhone) return true;
    return false;
  });
}

/** Subscreve a mudanças na lista. Retorna função de unsubscribe. */
export function subscribeIgnoredContacts(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/** Normaliza nome para comparação (minúsculas, sem acento, sem pontuação). */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normaliza telefone para comparação (apenas dígitos). */
function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

/** Limpa o cache (útil para testes ou reload forçado). */
export function clearIgnoredContactsCache(): void {
  ignoredContactsCache = null;
}