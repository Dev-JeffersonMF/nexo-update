import { isNativeAvailable, nexusNative, type ProfileInfo } from './nexusNative';

/**
 * Perfil do usuário (nome + avatar) com uma camada de segurança.
 *
 * No build Android o perfil vive nas preferências do app. No modo Expo (sem o
 * módulo nativo) guardamos em memória, então o onboarding ainda funciona dentro
 * da sessão — só não sobrevive a um fechamento do app.
 */

let memoryProfile: ProfileInfo = { name: '', configured: false, avatar: 'nexus' };

/** Lê o perfil guardado. Nunca lança: devolve um perfil vazio em caso de falha. */
export async function loadProfile(): Promise<ProfileInfo> {
  if (!isNativeAvailable()) return memoryProfile;

  try {
    const profile = await nexusNative.getProfile();
    if (profile?.name) memoryProfile = profile;
    return profile ?? memoryProfile;
  } catch {
    return memoryProfile;
  }
}

/** Salva o nome do usuário. */
export async function saveProfileName(name: string): Promise<ProfileInfo> {
  const clean = name.trim();

  if (!isNativeAvailable()) {
    memoryProfile = { name: clean, configured: clean.length > 0, avatar: memoryProfile.avatar ?? 'nexus' };
    return memoryProfile;
  }

  try {
    const profile = await nexusNative.saveProfile(clean);
    if (profile?.name) memoryProfile = profile;
    return profile ?? { name: clean, configured: clean.length > 0, avatar: memoryProfile.avatar ?? 'nexus' };
  } catch {
    memoryProfile = { name: clean, configured: clean.length > 0, avatar: memoryProfile.avatar ?? 'nexus' };
    return memoryProfile;
  }
}

/** Salva o avatar selecionado ('nexus' ou 'tratis'). */
export async function saveProfileAvatar(avatar: 'nexus' | 'tratis'): Promise<ProfileInfo> {
  if (!isNativeAvailable()) {
    memoryProfile = { ...memoryProfile, avatar };
    return memoryProfile;
  }

  try {
    const profile = await nexusNative.saveProfileAvatar(avatar);
    if (profile?.name) memoryProfile = profile;
    return profile ?? { ...memoryProfile, avatar };
  } catch {
    memoryProfile = { ...memoryProfile, avatar };
    return memoryProfile;
  }
}
