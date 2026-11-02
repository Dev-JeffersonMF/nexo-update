/**
 * Config plugin: mantém o código nativo do Nexus vivo depois de
 * `expo prebuild` / EAS Build.
 *
 * O diretório `android/` é gerado (e ignorado pelo git), então qualquer fonte
 * escrita ali some no próximo prebuild. A fonte da verdade passa a ser
 * `native-android/`, e este plugin copia/registra tudo durante o prebuild:
 *
 *  1. Copia os fontes Kotlin (`native-android/java/**`) para o projeto gerado.
 *  2. Copia recursos (mascote e config do serviço de acessibilidade).
 *  3. Adiciona as permissões e os serviços no AndroidManifest.xml.
 *  4. Adiciona as strings usadas pelo AndroidManifest.xml.
 *  5. Acrescenta as dependências Gradle do código nativo (ExoPlayer da rádio,
 *     GPS do clima e coroutines).
 *
 * Uso: registre em `app.json` → `expo.plugins` (ver abaixo).
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  withDangerousMod,
  withAndroidManifest,
  withStringsXml,
  withAppBuildGradle,
  AndroidConfig,
} = require('@expo/config-plugins');

const TEMPLATE_DIR = path.join(__dirname, '..', 'native-android');
const APP_PACKAGE = 'com.jefferson.nexusassistente';
const JAVA_PACKAGE_DIR = path.join('com', 'jefferson', 'nexusassistente');

/**
 * Bibliotecas usadas pelo código Kotlin do Nexus.
 *
 * Precisam entrar aqui, e não só em `android/app/build.gradle`: o diretório
 * `android/` é regenerado no prebuild, e sem esta lista o ExoPlayer (rádio
 * tocando dentro do app), o GPS do clima e as coroutines sumiriam do build.
 */
const GRADLE_DEPENDENCIES = [
  'androidx.media3:media3-exoplayer:1.4.1',
  'androidx.media3:media3-common:1.4.1',
  'androidx.media3:media3-datasource:1.4.1',
  'androidx.media3:media3-ui:1.4.1',
  'com.google.android.gms:play-services-location:21.2.0',
  'org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1',
  'org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.8.1',
  'androidx.lifecycle:lifecycle-runtime-ktx:2.8.3',
];


const EXTRA_PERMISSIONS = [
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.ANSWER_PHONE_CALLS',
  'android.permission.READ_CALL_LOG',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
  'android.permission.FOREGROUND_SERVICE_MICROPHONE',
  'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
  'android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION',
  'android.permission.MEDIA_CONTENT_CONTROL',
  'android.permission.MODIFY_AUDIO_SETTINGS',
  'android.permission.READ_MEDIA_AUDIO',
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.READ_MEDIA_IMAGES',
  /*
   * Sem esta permissão o Android 11+ esconde os outros aplicativos do Nexus:
   * `getInstalledPackages()` volta quase vazio e `getPackageInfo("...")` falha
   * para qualquer app fora das <queries>. Era por isso que o assistente dizia
   * que não havia nenhum app instalado, não achava OiTube/YouTube e caía no
   * navegador. É um aplicativo pessoal, instalado à mão, que precisa mesmo
   * listar os apps do aparelho para abrir e automatizar o que o usuário pedir.
   */
  'android.permission.QUERY_ALL_PACKAGES',
  /*
   * Necessária para "parar a música" fechar de fato o player de outro
   * aplicativo (OiTube/YouTube): o Nexus manda a parada e encerra os processos
   * em segundo plano dele. Permissão de nível normal, concedida na instalação.
   */
  'android.permission.KILL_BACKGROUND_PROCESSES',
  /*
   * Alarmes e lembretes.
   *
   * USE_EXACT_ALARM é para despertador/alarme (uso legítimo declarado pelo
   * Android); SCHEDULE_EXACT_ALARM fica como alternativa, mas no Android 12+ ela
   * é uma permissão ESPECIAL que o usuário concede nos ajustes — por isso o lado
   * nativo devolve `exact: false` e o Nexus avisa em vez de prometer a hora.
   * Sem RECEIVE_BOOT_COMPLETED os alarmes se perderiam ao reiniciar o aparelho.
   */
  'android.permission.USE_EXACT_ALARM',
  'android.permission.SCHEDULE_EXACT_ALARM',
  'android.permission.RECEIVE_BOOT_COMPLETED',
  /*
   * Notificação do lembrete (Android 13+ pede autorização em tempo de execução).
   */
  'android.permission.POST_NOTIFICATIONS',
  /*
   * A TELA do lembrete em cima da tela de bloqueio.
   *
   * É o caminho oficial do Android para abrir a tela de um alarme vindo de um
   * receptor: um `startActivity` em segundo plano é bloqueado desde o Android
   * 10, e a full-screen intent não é.
   */
  'android.permission.USE_FULL_SCREEN_INTENT',
  'android.permission.VIBRATE',
  'android.permission.WAKE_LOCK',
];

/**
 * Pacotes que o Nexus reconhece pelo nome (automação/música).
 *
 * Declarados explicitamente além do QUERY_ALL_PACKAGES: assim a detecção
 * continua funcionando mesmo que a permissão ampla seja removida (por exemplo
 * numa publicação na Play Store, que restringe QUERY_ALL_PACKAGES).
 */
const QUERIED_PACKAGES = [
  'com.whatsapp',
  'com.google.android.youtube',
  'com.skipads.oitube.official',
  'com.google.android.googlequicksearchbox',
  'com.google.android.apps.bard',
  'com.amazon.dee.app',
];


function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyDirectory(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyDirectory(source, target);
    else copyFile(source, target);
  }
}

/** Passo 1 e 2: copia Kotlin + recursos para o projeto Android gerado. */
function withNexusNativeSources(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const platformRoot = config.modRequest.platformProjectRoot;
      const mainDir = path.join(platformRoot, 'app', 'src', 'main');

      copyDirectory(
        path.join(TEMPLATE_DIR, 'java'),
        path.join(mainDir, 'java'),
      );

      for (const [from, to] of [
        ['res/drawable/nexus_mascote.png', 'res/drawable/nexus_mascote.png'],
        [
          'res/xml/accessibility_service_config.xml',
          'res/xml/accessibility_service_config.xml',
        ],
      ]) {
        const source = path.join(TEMPLATE_DIR, ...from.split('/'));
        if (fs.existsSync(source)) {
          copyFile(source, path.join(mainDir, ...to.split('/')));
        }
      }

      return config;
    },
  ]);
}

/** Passo 3: permissões + serviços no AndroidManifest.xml. */
function withNexusNativeManifest(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;

    // Permissões manufacturer-agnósticas necessárias ao bot.
    if (!Array.isArray(manifest.manifest['uses-permission'])) {
      manifest.manifest['uses-permission'] = [];
    }
    const permissions = manifest.manifest['uses-permission'];
    for (const name of EXTRA_PERMISSIONS) {
      if (!permissions.some((entry) => entry.$['android:name'] === name)) {
        permissions.push({ $: { 'android:name': name } });
      }
    }
    // Alinha o maxSdkVersion das permissões de storage legadas.
    for (const entry of permissions) {
      const name = entry.$['android:name'];
      if (
        name === 'android.permission.READ_EXTERNAL_STORAGE' ||
        name === 'android.permission.WRITE_EXTERNAL_STORAGE'
      ) {
        entry.$['android:maxSdkVersion'] = '32';
      }
    }

    /*
     * <queries> — visibilidade de aplicativos no Android 11+.
     *
     * Sem esta lista o Nexus só enxerga a si mesmo: `getInstalledPackages()`
     * volta quase vazio e `getPackageInfo("com.whatsapp")` falha, então o
     * assistente dizia que não havia nenhum app instalado e caía no navegador em
     * vez de abrir YouTube/OiTube. Fica no plugin para sobreviver ao prebuild.
     */
    const queries = (manifest.manifest.queries =
      manifest.manifest.queries || []);
    if (queries.length === 0) queries.push({});
    const queryRoot = queries[0];
    queryRoot.intent = queryRoot.intent || [];
    queryRoot.package = queryRoot.package || [];

    const intent = (action, extra = {}) => ({
      action: [{ $: { 'android:name': action } }],
      ...extra,
    });

    const queryIntents = [
      intent('android.intent.action.VIEW', {
        category: [{ $: { 'android:name': 'android.intent.category.BROWSABLE' } }],
        data: [{ $: { 'android:scheme': 'https' } }],
      }),
      intent('android.intent.action.VIEW', {
        data: [{ $: { 'android:scheme': 'tel' } }],
      }),
      intent('android.intent.action.CALL', {
        data: [{ $: { 'android:scheme': 'tel' } }],
      }),
      intent('android.intent.action.SENDTO', {
        data: [{ $: { 'android:scheme': 'smsto' } }],
      }),
      intent('android.intent.action.VIEW', {
        data: [{ $: { 'android:scheme': 'wa' } }],
      }),
      // Busca de apps instalados (o Nexus abre app por nome).
      intent('android.intent.action.MAIN', {
        category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }],
      }),
    ];

    for (const entry of queryIntents) {
      const json = JSON.stringify(entry);
      if (!queryRoot.intent.some((existing) => JSON.stringify(existing) === json)) {
        queryRoot.intent.push(entry);
      }
    }

    for (const name of QUERIED_PACKAGES) {
      if (!queryRoot.package.some((entry) => entry.$['android:name'] === name)) {
        queryRoot.package.push({ $: { 'android:name': name } });
      }
    }

    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(
      manifest,
    );
    application.service = application.service || [];
    application.activity = application.activity || [];

    const hasService = (serviceName) =>
      application.service.some(
        (service) => service.$['android:name'] === serviceName,
      );

    /*
     * As telas que abrem quando um lembrete ou um alarme toca.
     *
     * São duas telas separadas (o Nexus chama cada uma por nome): a de
     * LEMBRETE e a de ALARME. As duas abrem por cima de tudo — inclusive da
     * tela de bloqueio — porque o alarme toca com o aparelho na mesa de
     * cabeceira.
     */
    const hasActivity = (activityName) =>
      application.activity.some(
        (activity) => activity.$['android:name'] === activityName,
      );

    for (const activity of ['.alert.LembreteActivity', '.alert.AlarmeActivity']) {
      if (hasActivity(activity)) continue;
      application.activity.push({
        $: {
          'android:name': activity,
          'android:exported': 'false',
          'android:launchMode': 'singleTask',
          'android:showWhenLocked': 'true',
          'android:turnScreenOn': 'true',
          'android:excludeFromRecents': 'true',
          'android:theme': '@android:style/Theme.Black.NoTitleBar.Fullscreen',
        },
      });
    }

    // Serviço de acessibilidade (usado pelo modo auto-bot).
    if (!hasService(`${APP_PACKAGE}.service.NexusAccessibilityService`)) {
      application.service.push({
        $: {
          'android:name': '.service.NexusAccessibilityService',
          'android:permission':
            'android.permission.BIND_ACCESSIBILITY_SERVICE',
          'android:exported': 'true',
          'android:label': '@string/accessibility_service_name',
        },
        'intent-filter': [
          {
            action: [
              {
                $: {
                  'android:name':
                    'android.accessibilityservice.AccessibilityService',
                },
              },
            ],
          },
        ],
        'meta-data': [
          {
            $: {
              'android:name': 'android.accessibilityservice',
              'android:resource':
                '@xml/accessibility_service_config',
            },
          },
        ],
      });
    }

    // Serviço em primeiro plano da escuta de voz.
    if (!hasService(`${APP_PACKAGE}.service.NexusForegroundService`)) {
      application.service.push({
        $: {
          'android:name': '.service.NexusForegroundService',
          'android:exported': 'false',
          'android:foregroundServiceType': 'microphone|mediaPlayback',
        },
      });
    }

    // Mascote flutuante — só aparece sobre OUTROS apps.
    if (!hasService(`${APP_PACKAGE}.service.NexusOverlayService`)) {
      application.service.push({
        $: {
          'android:name': '.service.NexusOverlayService',
          'android:exported': 'false',
          'android:foregroundServiceType': 'specialUse',
        },
        property: [
          {
            $: {
              'android:name':
                'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE',
              'android:value':
                'Mascote flutuante exibido sobre outros apps durante automacoes autorizadas pelo usuario.',
            },
          },
        ],
      });
    }

    // Leitura das notificações (mensagens do WhatsApp). O Android só conecta
    // este serviço com a permissão especial "Acesso a notificações".
    if (!hasService(`${APP_PACKAGE}.service.NexusNotificationListenerService`)) {
      application.service.push({
        $: {
          'android:name': '.service.NexusNotificationListenerService',
          'android:exported': 'false',
          'android:label': '@string/notification_listener_name',
          'android:permission':
            'android.permission.BIND_NOTIFICATION_LISTENER_SERVICE',
        },
        'intent-filter': [
          {
            action: [
              {
                $: {
                  'android:name':
                    'android.service.notification.NotificationListenerService',
                },
              },
            ],
          },
        ],
      });
    }

    /*
     * Lembretes/despertador: o alarme acorda o app pelo receptor, e o boot
     * reagenda tudo (o Android apaga os alarmes ao desligar).
     *
     * Ficam no plugin, e não só no `android/`, porque esse diretório é
     * regenerado no prebuild e os receptores sumiriam do APK.
     */
    application.receiver = application.receiver || [];
    const hasReceiver = (receiverName) =>
      application.receiver.some(
        (receiver) => receiver.$['android:name'] === receiverName,
      );

    if (!hasReceiver(`${APP_PACKAGE}.reminder.ReminderReceiver`)) {
      application.receiver.push({
        $: {
          'android:name': '.reminder.ReminderReceiver',
          'android:exported': 'false',
        },
      });
    }

    /*
     * Botões verde/vermelho da notificação de chamada. O receptor só dispara
     * PendingIntents internos do próprio Nexus; não é exportado.
     */
    if (!hasReceiver(`${APP_PACKAGE}.service.NexusCallActionReceiver`)) {
      application.receiver.push({
        $: {
          'android:name': '.service.NexusCallActionReceiver',
          'android:exported': 'false',
        },
      });
    }

    if (!hasReceiver(`${APP_PACKAGE}.reminder.BootReceiver`)) {
      application.receiver.push({
        $: {
          'android:name': '.reminder.BootReceiver',
          // Recebe o aviso do sistema de que o aparelho ligou / o app subiu de
          // versão, e nada mais: sem exportar, nenhum app de fora pode acordar.
          'android:exported': 'true',
          'android:directBootAware': 'false',
        },
        'intent-filter': [
          {
            action: [
              { $: { 'android:name': 'android.intent.action.BOOT_COMPLETED' } },
              { $: { 'android:name': 'android.intent.action.MY_PACKAGE_REPLACED' } },
              { $: { 'android:name': 'android.intent.action.QUICKBOOT_POWERON' } },
            ],
          },
        ],
      });
    }

    return config;
  });
}

/** Passo 4: strings referenciadas pelo AndroidManifest.xml. */
function withNexusNativeStrings(config) {
  return withStringsXml(config, (config) => {
    const resources = config.modResults;
    const strings = resources.resources.string || (resources.resources.string = []);
    const set = (name, value, translatable = true) => {
      if (strings.some((entry) => entry.$.name === name)) return;
      strings.push({
        $: { name, ...(translatable ? {} : { translatable: 'false' }) },
        _: value,
      });
    };
    set('accessibility_service_name', 'NEXUS Auto-Bot');
    set('notification_listener_name', 'NEXUS — leitura de mensagens');
    set(
      'accessibility_service_description',
      'Permite que o NEXUS interaja com outros apps (WhatsApp, YouTube, etc.) para enviar mensagens, fazer chamadas e controlar mídia automaticamente.',
    );
    return config;
  });
}

/** Passo 5: dependências do Gradle usadas pelo código nativo do Nexus. */
function withNexusNativeGradle(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== 'groovy') {
      throw new Error(
        'Nexus: o build.gradle do app precisa estar em Groovy para receber as dependências nativas.',
      );
    }

    const marker = '// === Nexus: dependências do código nativo (não remover) ===';
    const copyMarker = '// === Nexus: copiar o código nativo de native-android/ (fonte de verdade) ===';
    let contents = config.modResults.contents;

    /*
     * Cada bloco tem o seu próprio marcador: assim um build.gradle já
     * existente (sem prebuild) recebe o que falta, em vez de o plugin
     * devolver cedo e deixar o build sem as dependências nativas.
     */
    if (!contents.includes(marker)) {
      const anchor = contents.match(/dependencies\s*\{/);
      if (!anchor) {
        throw new Error('Nexus: não encontrei o bloco "dependencies {" no build.gradle do app.');
      }

      const block = [
        '',
        `    ${marker}`,
        ...GRADLE_DEPENDENCIES.map((dependency) => `    implementation("${dependency}")`),
      ].join('\n');

      const insertAt = anchor.index + anchor[0].length;
      contents =
        contents.slice(0, insertAt) + block + contents.slice(insertAt);
    }

    /*
     * Tarefas que copiam o código nativo da FONTE DE VERDADE.
     *
     * `native-android/` é a fonte; `android/` é gerado. Sem esta cópia, quem
     * edita o Kotlin em `native-android/` pode compilar uma versão velha sem
     * nem perceber (foi o que aconteceu mais de uma vez).
     */
    if (!contents.includes(copyMarker)) {
      const copyTask = [
        '',
        `    ${copyMarker}`,
        '    tasks.register("copyNexusNativeSources", Copy) {',
        '        destinationDir = file("src/main/java")',
        '        from(file("../../native-android/java"))',
        '    }',
        '    tasks.matching { it.name == "preBuild" }.configureEach {',
        '        dependsOn "copyNexusNativeSources"',
        '    }',
        '',
      ].join('\n');
      contents = `${contents}\n${copyTask}`;
    }

    config.modResults.contents = contents;
    return config;
  });
}

module.exports = function withNexusNative(config) {
  config = withNexusNativeSources(config);
  config = withNexusNativeManifest(config);
  config = withNexusNativeStrings(config);
  config = withNexusNativeGradle(config);
  return config;
};

module.exports.JAVA_PACKAGE_DIR = JAVA_PACKAGE_DIR;
