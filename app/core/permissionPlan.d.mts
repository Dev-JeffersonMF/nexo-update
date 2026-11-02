export type PermissionKey =
  | 'microphone'
  | 'contacts'
  | 'phone'
  | 'location'
  | 'notifications'
  | 'notificationAccess'
  | 'accessibility'
  | 'overlay';

export type PermissionKind = 'runtime' | 'settings';

export interface PermissionStep {
  key: PermissionKey;
  label: string;
  description: string;
  kind: PermissionKind;
  /** Presente apenas em passos `runtime`. */
  runtimePermissions?: readonly string[];
  /** Presente apenas em passos `settings`: ação Android a ser aberta. */
  settingsAction?: string;
  /** Sem esta permissão o app funciona apenas em modo limitado. */
  essential: boolean;
}

export interface PermissionSummary {
  granted: number;
  total: number;
  essentialOk: boolean;
  missingEssential: PermissionKey[];
}

export const ANDROID_PACKAGE: string;
export const PERMISSION_STEPS: readonly PermissionStep[];
export function getPermissionStep(key: string): PermissionStep | undefined;
export function summarizePermissions(
  snapshot?: Partial<Record<PermissionKey, boolean | undefined>>,
): PermissionSummary;
