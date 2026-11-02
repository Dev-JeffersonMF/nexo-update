import { useCallback, useEffect, useState } from 'react';
import {
  AppState,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  PERMISSION_STEPS,
  type PermissionKey,
  type PermissionStep,
} from '../core/permissionPlan.mjs';
import {
  getPermissionSnapshot,
  openAppSettings,
  requestPermissionStep,
  summarize,
  type PermissionSnapshot,
} from '../services/nexusPermissions';
import { nexusNative } from '../services/nexusNative';
import { colors, fontSize, radius, shadow, spacing } from './theme';
import { FadeSlideIn, PopIn } from './motion';

const MASCOT_IDLE = require('../../assets/mascote-ocioso.png');

type PermissionsProps = {
  /** Chamado quando o usuário decide seguir para o app. */
  onFinish: () => void;
  /** Presente apenas quando a tela é aberta de dentro do app (permite fechar). */
  onClose?: () => void;
  /** Nome do usuário, só para o cabeçalho ficar pessoal. */
  userName?: string;
};

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Ocorreu um erro inesperado.';
}

/**
 * Tela de permissões. Pede as permissões de runtime no diálogo do Android e
 * abre a tela de ajustes para as permissões especiais (acessibilidade/overlay).
 */
export function PermissionsScreen({ onFinish, onClose, userName }: PermissionsProps) {
  const [snapshot, setSnapshot] = useState<PermissionSnapshot>({});
  const [refreshing, setRefreshing] = useState(true);
  const [busyKey, setBusyKey] = useState<PermissionKey | null>(null);
  const [requestingAll, setRequestingAll] = useState(false);
  const [needsAppSettings, setNeedsAppSettings] = useState(false);
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    const next = await getPermissionSnapshot();
    setSnapshot(next);
    setRefreshing(false);
    return next;
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const next = await getPermissionSnapshot();
      if (active) {
        setSnapshot(next);
        setRefreshing(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Revalida sempre que o usuário volta da tela de ajustes do Android.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void refresh().then((next) => {
        // Quando tudo já está liberado, o aviso de "ative na tela que abrimos"
        // deixa de fazer sentido e é limpo.
        const nextSummary = summarize(next);
        if (nextSummary.granted === nextSummary.total) setNotice('');
      });
    });
    return () => subscription.remove();
  }, [refresh]);

  // O Auto-Bot de acessibilidade conecta DEPOIS do app abrir: o retrato das
  // permissões é lido no começo, e sem este aviso a tela continuaria
  // mostrando "PERMITIR" para uma automação que já está ligada. Era o
  // "falso desligada" que fazia o usuário re-liberar o que já tinha liberado.
  useEffect(() => {
    const unsubscribe = nexusNative.onAccessibilityStateChanged(() => {
      void refresh();
    });
    return () => unsubscribe();
  }, [refresh]);

  const summary = summarize(snapshot);
  const busy = busyKey !== null || requestingAll;
  const progress = summary.total > 0 ? summary.granted / summary.total : 0;

  const handleRequestStep = useCallback(
    async (step: PermissionStep) => {
      if (busyKey !== null || requestingAll) return;

      setBusyKey(step.key);
      setNotice('');

      try {
        const result = await requestPermissionStep(step);
        await refresh();

        if (result.openedSettings) {
          setNotice(`Ative "${step.label}" na tela que abrimos e volte para o Nexus.`);
        } else if (result.blocked) {
          setNeedsAppSettings(true);
          setNotice(
            `O Android não mostra mais o pedido de ${step.label}. Use "Abrir ajustes do app" e libere pela lista de permissões.`,
          );
        } else if (!result.granted) {
          setNotice(`A permissão de ${step.label} ficou bloqueada. O Nexus segue em modo limitado.`);
        }
      } catch (reason) {
        setNotice(errorMessage(reason));
      } finally {
        setBusyKey(null);
      }
    },
    [busyKey, refresh, requestingAll],
  );

  const handleRequestAll = useCallback(async () => {
    if (busyKey !== null || requestingAll) return;

    setRequestingAll(true);
    setNotice('');
    setNeedsAppSettings(false);

    try {
      let blockedStep: PermissionStep | undefined;

      for (const step of PERMISSION_STEPS) {
        if (step.kind !== 'runtime') continue;
        const result = await requestPermissionStep(step);
        if (result.blocked && !blockedStep) blockedStep = step;
      }

      const next = await refresh();
      const nextSummary = summarize(next);

      // As permissões especiais são ativadas uma tela por vez.
      const pendingSettings = PERMISSION_STEPS.filter(
        (step) => step.kind === 'settings' && next[step.key] !== true,
      );

      if (pendingSettings.length > 0) {
        await requestPermissionStep(pendingSettings[0]);
        setNotice(
          `Falta ativar "${pendingSettings[0].label}" na tela que abrimos. Toque em "Permitir" nessa permissão para as próximas.`,
        );
      } else if (blockedStep) {
        setNeedsAppSettings(true);
        setNotice(
          `O Android não mostra mais o pedido de ${blockedStep.label}. Use "Abrir ajustes do app" para liberar manualmente.`,
        );
      } else if (!nextSummary.essentialOk) {
        setNotice('Sem o microfone o Nexus não escuta comandos de voz e fica em modo limitado.');
      } else if (nextSummary.granted < nextSummary.total) {
        setNotice('Permissões principais liberadas. O Nexus já pode trabalhar.');
      } else {
        setNotice('Tudo liberado! O Nexus está pronto. 🚀');
      }
    } catch (reason) {
      setNotice(errorMessage(reason));
    } finally {
      setRequestingAll(false);
      await refresh();
    }
  }, [busyKey, refresh, requestingAll]);

  const greeting = userName ? `${userName}, libere meu acesso` : 'Libere meu acesso';

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <View style={styles.container}>
        <PopIn delay={40}>
          <Image source={MASCOT_IDLE} style={styles.mascot} resizeMode="contain" />
        </PopIn>

        <FadeSlideIn delay={140}>
          <Text style={styles.title}>{greeting}</Text>
        </FadeSlideIn>

        <FadeSlideIn delay={220}>
          <Text style={styles.subtitle}>
            Cada item abaixo é uma capacidade. Sem eles eu funciono, mas com menos poderes.
          </Text>
        </FadeSlideIn>

        <FadeSlideIn delay={300} style={styles.progressWrap}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
          <Text style={styles.progressLabel}>
            {refreshing
              ? 'Verificando permissões...'
              : `${summary.granted} de ${summary.total} liberadas`}
          </Text>
        </FadeSlideIn>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        >
          {PERMISSION_STEPS.map((step, index) => {
            const granted = snapshot[step.key] === true;
            const unknown = snapshot[step.key] === undefined;
            const stepBusy = busyKey === step.key || requestingAll;

            return (
              <FadeSlideIn key={step.key} delay={340 + index * 40} offset={10}>
                <View style={[styles.item, granted && styles.itemGranted]}>
                  <View style={[styles.checkbox, granted && styles.checkboxOn]}>
                    <Text style={granted ? styles.checkText : styles.uncheckText}>
                      {granted ? '✓' : unknown ? '?' : '○'}
                    </Text>
                  </View>

                  <View style={styles.itemText}>
                    <Text style={styles.itemLabel}>{step.label}</Text>
                    <Text style={styles.itemDescription}>{step.description}</Text>
                  </View>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Permitir ${step.label}`}
                    accessibilityState={{ disabled: granted || busy }}
                    disabled={granted || busy}
                    onPress={() => void handleRequestStep(step)}
                    style={({ pressed }) => [
                      styles.grantButton,
                      granted && styles.grantedButton,
                      stepBusy && styles.busyButton,
                      pressed && !granted && !busy && styles.grantPressed,
                    ]}
                  >
                    <Text style={[styles.grantText, granted && styles.grantedText]}>
                      {granted ? 'LIBERADO' : stepBusy ? '...' : 'PERMITIR'}
                    </Text>
                  </Pressable>
                </View>
              </FadeSlideIn>
            );
          })}

          {!!notice && (
            <View accessibilityRole="alert" style={styles.notice}>
              <Text style={styles.noticeText}>{notice}</Text>
            </View>
          )}
        </ScrollView>

        <FadeSlideIn delay={420} style={styles.actions}>
          {!summary.essentialOk && (
            <Pressable
              accessibilityRole="button"
              onPress={() => void handleRequestAll()}
              disabled={busy}
              style={({ pressed }) => [
                styles.primaryButton,
                busy && styles.buttonDisabled,
                pressed && !busy && styles.buttonPressed,
              ]}
            >
              <Text style={styles.primaryButtonText}>
                {requestingAll ? 'Permitindo...' : 'Permitir tudo agora'}
              </Text>
            </Pressable>
          )}

          <Pressable
            accessibilityRole="button"
            onPress={onFinish}
            style={({ pressed }) => [
              styles.primaryButton,
              summary.essentialOk && styles.readyButton,
              pressed && styles.buttonPressed,
            ]}
          >
            <Text style={styles.primaryButtonText}>
              {summary.essentialOk ? 'Começar a usar o Nexus' : 'Continuar em modo limitado'}
            </Text>
          </Pressable>

          {needsAppSettings && (
            <Pressable
              accessibilityRole="button"
              onPress={() => void openAppSettings()}
              style={styles.linkButton}
            >
              <Text style={styles.linkText}>Abrir ajustes do app</Text>
            </Pressable>
          )}

          {onClose && (
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.linkButton}>
              <Text style={styles.linkText}>Voltar para a conversa</Text>
            </Pressable>
          )}
        </FadeSlideIn>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  mascot: {
    width: 76,
    height: 76,
    alignSelf: 'center',
    marginTop: spacing.xs,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.title + 2,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  subtitle: {
    color: colors.muted,
    fontSize: fontSize.small,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.sm,
  },
  progressWrap: {
    marginBottom: spacing.md,
  },
  progressTrack: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    overflow: 'hidden',
  },
  progressFill: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.cyan,
  },
  progressLabel: {
    color: colors.muted,
    fontSize: fontSize.caption,
    textAlign: 'center',
    marginTop: spacing.sm,
    letterSpacing: 0.6,
  },
  scroll: {
    flex: 1,
  },
  list: {
    paddingBottom: spacing.lg,
    gap: spacing.sm + 2,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.panel,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
  },
  itemGranted: {
    borderColor: 'rgba(52, 211, 153, 0.35)',
  },
  checkbox: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.backgroundElevated,
  },
  checkboxOn: {
    borderColor: colors.success,
  },
  checkText: {
    color: colors.success,
    fontSize: 16,
    fontWeight: 'bold',
  },
  uncheckText: {
    color: colors.muted,
    fontSize: 16,
  },
  itemText: {
    flex: 1,
    marginLeft: spacing.md,
    marginRight: spacing.sm,
  },
  itemLabel: {
    color: colors.text,
    fontSize: fontSize.body,
    fontWeight: '700',
  },
  itemDescription: {
    color: colors.muted,
    fontSize: fontSize.caption + 1,
    marginTop: 2,
    lineHeight: 16,
  },
  grantButton: {
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.cyan,
  },
  grantedButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.success,
  },
  busyButton: {
    opacity: 0.5,
  },
  grantPressed: {
    opacity: 0.8,
  },
  grantText: {
    color: colors.onCyan,
    fontSize: 10,
    letterSpacing: 0.6,
    fontWeight: '800',
  },
  grantedText: {
    color: colors.success,
  },
  actions: {
    paddingTop: spacing.md,
    gap: spacing.sm + 2,
  },
  primaryButton: {
    backgroundColor: colors.cyan,
    borderRadius: radius.lg,
    paddingVertical: 14,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    ...shadow.glow,
  },
  readyButton: {
    backgroundColor: colors.success,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  primaryButtonText: {
    color: colors.onCyan,
    fontSize: fontSize.body,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  linkButton: {
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  linkText: {
    color: colors.muted,
    fontSize: fontSize.small,
    textDecorationLine: 'underline',
  },
  notice: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: 'rgba(255, 107, 122, 0.4)',
  },
  noticeText: {
    color: '#FFD4D8',
    fontSize: fontSize.small,
    lineHeight: 19,
  },
});
