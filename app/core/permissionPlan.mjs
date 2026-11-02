/**
 * Catálogo das permissões que o Nexus pede ao usuário.
 *
 * `kind: 'runtime'`  — pedido pelo diálogo nativo do Android (PermissionsAndroid).
 * `kind: 'settings'` — permissão especial: o Android não mostra diálogo, então
 *                      abrimos a tela de ajustes correspondente.
 *
 * Cada permissão de runtime precisa estar declarada em
 * `android/app/src/main/AndroidManifest.xml` (verificado em
 * `tests/permissionPlan.test.mjs`).
 */

/** Pacote Android do app, usado nos intents de ajustes. */
export const ANDROID_PACKAGE = 'com.jefferson.nexusassistente';

export const PERMISSION_STEPS = [
  {
    key: 'microphone',
    label: 'Microfone',
    description: 'Ouvir seus comandos de voz quando você abre o microfone',
    kind: 'runtime',
    runtimePermissions: ['android.permission.RECORD_AUDIO'],
    essential: true,
  },
  {
    key: 'contacts',
    label: 'Contatos',
    description: 'Encontrar seus contatos para enviar mensagens e chamar',
    kind: 'runtime',
    runtimePermissions: ['android.permission.READ_CONTACTS'],
    essential: false,
  },
  {
    key: 'phone',
    label: 'Telefone',
    description: 'Ler chamadas recebidas, atender/recusar por voz e ligar pelo discador',
    kind: 'runtime',
    runtimePermissions: [
      'android.permission.CALL_PHONE',
      'android.permission.READ_PHONE_STATE',
      'android.permission.ANSWER_PHONE_CALLS',
    ],
    essential: false,
  },
  {
    key: 'location',
    label: 'Localização',
    description: 'Informar o clima da sua região',
    kind: 'runtime',
    runtimePermissions: [
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_COARSE_LOCATION',
    ],
    essential: false,
  },
  {
    key: 'notifications',
    label: 'Notificações',
    description: 'Manter o Nexus ativo em segundo plano com o aviso permanente',
    kind: 'runtime',
    runtimePermissions: ['android.permission.POST_NOTIFICATIONS'],
    essential: false,
  },
  {
    key: 'notificationAccess',
    label: 'Leitura de mensagens',
    description: 'Avisar em voz alta quem mandou mensagem no WhatsApp e o que disse',
    kind: 'settings',
    settingsAction: 'android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS',
    essential: false,
  },
  {
    key: 'accessibility',
    label: 'Acessibilidade (Auto-Bot)',
    description: 'Automatizar WhatsApp, chamadas e mídia em outras telas',
    kind: 'settings',
    settingsAction: 'android.settings.ACCESSIBILITY_SETTINGS',
    essential: false,
  },
  {
    key: 'overlay',
    label: 'Sobrepor outros apps',
    description: 'Mostrar o mascote flutuante sobre outros aplicativos',
    kind: 'settings',
    settingsAction: 'android.settings.action.MANAGE_OVERLAY_PERMISSION',
    essential: false,
  },
];

/**
 * @param {string} key
 * @returns {(typeof PERMISSION_STEPS)[number] | undefined}
 */
export function getPermissionStep(key) {
  return PERMISSION_STEPS.find((step) => step.key === key);
}

/**
 * Resume o estado atual para a tela de permissões.
 *
 * @param {Record<string, boolean | undefined>} [snapshot]
 * @returns {{granted: number, total: number, essentialOk: boolean, missingEssential: string[]}}
 */
export function summarizePermissions(snapshot = {}) {
  const missingEssential = PERMISSION_STEPS.filter(
    (step) => step.essential && snapshot[step.key] !== true,
  ).map((step) => step.key);

  return {
    granted: PERMISSION_STEPS.filter((step) => snapshot[step.key] === true).length,
    total: PERMISSION_STEPS.length,
    essentialOk: missingEssential.length === 0,
    missingEssential,
  };
}
