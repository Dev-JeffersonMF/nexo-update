import { Linking, PermissionsAndroid, Platform } from 'react-native';
import {
  ANDROID_PACKAGE,
  PERMISSION_STEPS,
  summarizePermissions,
  type PermissionKey,
  type PermissionStep,
  type PermissionSummary,
} from '../core/permissionPlan.mjs';
import { isNativeAvailable, nexusNative } from './nexusNative';

/** Tipo aceito por `PermissionsAndroid`, extraído da própria API do React Native. */
type AndroidPermission = Parameters<typeof PermissionsAndroid.check>[0];

export type PermissionSnapshot = Partial<Record<PermissionKey, boolean>>;

export interface StepRequestResult {
  granted: boolean;
  /**
   * `true` quando o Android não vai mais exibir o diálogo (o usuário marcou
   * "não perguntar novamente"). Nesse caso só os ajustes do app resolvem.
   */
  blocked: boolean;
  /** `true` quando conseguimos abrir a tela de ajustes da permissão especial. */
  openedSettings: boolean;
}

const IS_ANDROID = Platform.OS === 'android';

function runtimePermissionsOf(step: PermissionStep): readonly string[] {
  return step.runtimePermissions ?? [];
}

async function checkRuntimeStep(step: PermissionStep): Promise<boolean> {
  const permissions = runtimePermissionsOf(step);
  if (permissions.length === 0) return true;
  if (!IS_ANDROID) return false;

  try {
    for (const permission of permissions) {
      const granted = await PermissionsAndroid.check(permission as AndroidPermission);
      if (!granted) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function readNativeSpecialPermissions(): Promise<PermissionSnapshot | null> {
  if (!isNativeAvailable()) return null;

  const state = await nexusNative.getPermissionState();
  if (!state) return null;

  const snapshot: PermissionSnapshot = {};
  for (const step of PERMISSION_STEPS) {
    const value = state[step.key];
    if (typeof value === 'boolean') snapshot[step.key] = value;
  }
  return snapshot;
}

/**
 * Lê o estado atual de todas as permissões do plano.
 * Runtime: consultado direto no Android. Especiais: consultado no módulo nativo
 * (quando o build nativo já expõe `getPermissionState`).
 */
export async function getPermissionSnapshot(): Promise<PermissionSnapshot> {
  const snapshot: PermissionSnapshot = {};

  for (const step of PERMISSION_STEPS) {
    if (step.kind === 'runtime') {
      snapshot[step.key] = await checkRuntimeStep(step);
    }
  }

  const native = await readNativeSpecialPermissions();
  if (native) {
    for (const step of PERMISSION_STEPS) {
      if (step.kind === 'settings' && typeof native[step.key] === 'boolean') {
        snapshot[step.key] = native[step.key];
      }
    }
  }

  return snapshot;
}

/**
 * Abre a tela de ajustes de uma permissão especial (acessibilidade / sobrepor).
 */
export async function openPermissionSettings(step: PermissionStep): Promise<boolean> {
  if (step.kind !== 'settings') return false;

  // O módulo nativo já abre a tela correta do app quando disponível.
  if (isNativeAvailable() && step.key === 'overlay') {
    try {
      await nexusNative.requestOverlayPermission();
      return true;
    } catch {
      // segue para o fallback via Linking
    }
  }

  if (isNativeAvailable() && step.key === 'accessibility') {
    try {
      await nexusNative.requestAccessibilityPermission();
      return true;
    } catch {
      // segue para o fallback via Linking
    }
  }

  if (isNativeAvailable() && step.key === 'notificationAccess') {
    try {
      await nexusNative.requestNotificationAccess();
      return true;
    } catch {
      // segue para o fallback via Linking
    }
  }

  try {
    await Linking.sendIntent(step.settingsAction ?? '', [
      { key: 'android.intent.extra.PACKAGE_NAME', value: ANDROID_PACKAGE },
    ]);
    return true;
  } catch {
    // último recurso: tela de detalhes do app
    return openAppSettings();
  }
}

/** Abre os ajustes do app (onde o usuário libera o que ficou bloqueado). */
export async function openAppSettings(): Promise<boolean> {
  if (isNativeAvailable()) {
    const opened = await nexusNative.openAppSettings();
    if (opened) return true;
  }

  try {
    await Linking.openSettings();
    return true;
  } catch {
    return false;
  }
}

/**
 * Pede uma permissão do plano.
 * - runtime: mostra o diálogo nativo do Android;
 * - settings: abre a tela de ajustes correspondente.
 */
export async function requestPermissionStep(step: PermissionStep): Promise<StepRequestResult> {
  if (step.kind === 'settings') {
    const openedSettings = await openPermissionSettings(step);
    return { granted: false, blocked: false, openedSettings };
  }

  const permissions = runtimePermissionsOf(step);
  if (permissions.length === 0) {
    return { granted: true, blocked: false, openedSettings: false };
  }
  if (!IS_ANDROID) {
    return { granted: false, blocked: false, openedSettings: false };
  }

  try {
    const results = await PermissionsAndroid.requestMultiple(
      permissions.map((permission) => permission as AndroidPermission),
    );

    const statuses = permissions.map((permission) => results[permission as AndroidPermission]);
    const granted = statuses.every((status) => status === PermissionsAndroid.RESULTS.GRANTED);
    const blocked =
      !granted && statuses.some((status) => status === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN);

    return { granted, blocked, openedSettings: false };
  } catch {
    return { granted: false, blocked: false, openedSettings: false };
  }
}

/** Resumo pronto para a interface (quantas liberadas, se o essencial já foi). */
export function summarize(snapshot: PermissionSnapshot): PermissionSummary {
  return summarizePermissions(snapshot);
}

/** Passos que dependem de diálogo nativo, na ordem em que serão pedidos. */
export const RUNTIME_STEPS = PERMISSION_STEPS.filter((step) => step.kind === 'runtime');
