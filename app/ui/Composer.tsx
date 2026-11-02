import { useEffect, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowUp, Mic, Square } from 'lucide-react-native';

import { colors, font, glow, gradients, radius, spacing } from './theme';

type Props = {
  value: string;
  onChangeText: (value: string) => void;
  onSend: () => void;
  onToggleMic: () => void;
  listening: boolean;
  busy: boolean;
  partial?: string;
  micAvailable: boolean;
};

/**
 * Barra de escrita.
 *
 * O microfone é o botão principal (é assim que o Nexus é usado no dia a dia);
 * o enviar só aparece quando existe texto. Enquanto ouve, a transcrição
 * parcial aparece acima para a pessoa ver que está sendo entendida.
 */
export function Composer({
  value,
  onChangeText,
  onSend,
  onToggleMic,
  listening,
  busy,
  partial = '',
  micAvailable,
}: Props) {
  const [pulse] = useState(() => new Animated.Value(0));
  const canSend = value.trim().length > 0 && !busy;
  useEffect(() => {
    if (!listening) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1300,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [listening, pulse]);

  return (
    <View style={styles.wrap}>
      {listening ? (
        <View style={styles.partialRow}>
          <View style={styles.recordingDot} />
          <Text style={styles.partialText} numberOfLines={2}>
            {partial || 'tô ouvindo… fala que eu escuto.'}
          </Text>
        </View>
      ) : null}

      <View style={styles.bar}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={
            busy ? 'calma, tô resolvendo…' : 'escreve ou toca no microfone'
          }
          placeholderTextColor={colors.textFaint}
          style={styles.input}
          multiline
          maxLength={2000}
          editable={!busy || listening}
          returnKeyType="send"
          blurOnSubmit={false}
          onSubmitEditing={() => {
            if (canSend) onSend();
          }}
          accessibilityLabel="Mensagem para a assistente"
        />

        {canSend ? (
          <Pressable
            onPress={onSend}
            accessibilityRole="button"
            accessibilityLabel="Enviar mensagem"
            style={({ pressed }) => [styles.sendWrap, pressed && { opacity: 0.8 }]}
          >
            <LinearGradient
              colors={gradients.warm}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.sendButton}
            >
              <ArrowUp size={18} color="#1A0713" strokeWidth={2.6} />
            </LinearGradient>
          </Pressable>
        ) : null}

        <View style={styles.micWrap}>
          {listening ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.micPulse,
                {
                  opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
                  transform: [
                    { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.55] }) },
                  ],
                },
              ]}
            />
          ) : null}
          <Pressable
            onPress={onToggleMic}
            disabled={!micAvailable}
            accessibilityRole="button"
            accessibilityLabel={listening ? 'Parar de ouvir' : 'Falar com a assistente'}
            accessibilityState={{ disabled: !micAvailable }}
            style={({ pressed }) => [
              styles.micButton,
              listening && styles.micButtonActive,
              !micAvailable && styles.micButtonDisabled,
              pressed && { opacity: 0.85 },
            ]}
          >
            {listening ? (
              <Square size={16} color="#1A0713" fill="#1A0713" />
            ) : (
              <Mic size={20} color="#1A0713" strokeWidth={2.4} />
            )}
          </Pressable>
        </View>
      </View>

      <Text style={styles.hint}>
        {busy
          ? 'pensando…'
          : listening
            ? 'toque no quadrado pra parar'
            : micAvailable
              ? 'um toque no microfone = um comando'
              : 'microfone indisponível neste build'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
    paddingTop: spacing.xs,
  },
  partialRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
  },
  recordingDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.pink,
  },
  partialText: { color: colors.textMuted, fontSize: font.small, flex: 1 },
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    backgroundColor: colors.cardStrong,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: font.body,
    lineHeight: 20,
    maxHeight: 112,
    paddingTop: 6,
    paddingBottom: 6,
  },
  sendWrap: { paddingBottom: 2 },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micWrap: { alignItems: 'center', justifyContent: 'center' },
  micPulse: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 122, 200, 0.35)',
  },
  micButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    ...glow(colors.accent, 0.5),
  },
  micButtonActive: { backgroundColor: colors.pink },
  micButtonDisabled: {
    backgroundColor: colors.cardStrong,
    elevation: 0,
    shadowOpacity: 0,
  },
  hint: {
    color: colors.textFaint,
    fontSize: 10,
    textAlign: 'center',
    marginTop: 6,
  },
});
