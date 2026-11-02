import { useRef, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, fontSize, radius, shadow, spacing } from './theme';
import { FadeSlideIn, PopIn, Pulse } from './motion';

const MASCOT_IDLE = require('../../assets/mascote-ocioso.png');

/**
 * Primeira tela do app: o Nexus se apresenta e pergunta como deve chamar o
 * usuário. O nome é o que o despertador fala e o que as saudações usam.
 */
export function WelcomeScreen({
  initialName = '',
  onDone,
}: {
  initialName?: string;
  onDone: (name: string) => void;
}) {
  const [name, setName] = useState(initialName);
  const inputRef = useRef<TextInput>(null);

  const trimmed = name.trim();
  const ready = trimmed.length > 0;

  const submit = () => {
    if (!ready) {
      inputRef.current?.focus();
      return;
    }
    onDone(trimmed);
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.auraWrap} pointerEvents="none">
        <View style={styles.auraOuter} />
        <View style={styles.auraInner} />
      </View>

      <View style={styles.content}>
        <PopIn delay={80} duration={560}>
          <Pulse minScale={0.97} maxScale={1.03} duration={2800}>
            <Image source={MASCOT_IDLE} style={styles.mascot} resizeMode="contain" />
          </Pulse>
        </PopIn>

        <FadeSlideIn delay={220} offset={12}>
          <Text style={styles.brand}>NEXOS</Text>
        </FadeSlideIn>

        <FadeSlideIn delay={320} offset={12}>
          <Text style={styles.subtitle}>Assistente pessoal autônomo</Text>
        </FadeSlideIn>

        <FadeSlideIn delay={460} offset={16} style={styles.cardWrap}>
          <View style={styles.card}>
            <Text style={styles.question}>Como você quer ser chamado?</Text>
            <Text style={styles.hint}>
              Uso seu nome nas saudações e quando o despertador tocar.
            </Text>

            <TextInput
              ref={inputRef}
              value={name}
              onChangeText={setName}
              onSubmitEditing={submit}
              placeholder="Seu nome"
              placeholderTextColor={colors.muted}
              returnKeyType="done"
              autoCapitalize="words"
              autoCorrect={false}
              maxLength={60}
              accessibilityLabel="Seu nome"
              style={styles.input}
            />

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Começar a usar o Nexus"
              accessibilityState={{ disabled: !ready }}
              onPress={submit}
              style={({ pressed }) => [
                styles.button,
                !ready && styles.buttonDisabled,
                pressed && ready && styles.buttonPressed,
              ]}
            >
              <Text style={styles.buttonText}>Começar</Text>
            </Pressable>
          </View>
        </FadeSlideIn>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  auraWrap: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  auraOuter: {
    position: 'absolute',
    width: 380,
    height: 380,
    borderRadius: 190,
    backgroundColor: colors.cyanSoft,
    opacity: 0.35,
  },
  auraInner: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: colors.cyanSoft,
    opacity: 0.5,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  mascot: {
    width: 132,
    height: 132,
  },
  brand: {
    color: colors.text,
    fontSize: fontSize.hero,
    letterSpacing: 10,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: spacing.lg,
    marginLeft: 10,
  },
  subtitle: {
    color: colors.cyan,
    fontSize: fontSize.small,
    letterSpacing: 1.2,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  cardWrap: {
    alignSelf: 'stretch',
    marginTop: spacing.xxl,
  },
  card: {
    backgroundColor: colors.panel,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
    ...shadow.card,
  },
  question: {
    color: colors.text,
    fontSize: fontSize.title,
    fontWeight: '700',
    textAlign: 'center',
  },
  hint: {
    color: colors.muted,
    fontSize: fontSize.small,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  input: {
    marginTop: spacing.lg,
    backgroundColor: colors.backgroundElevated,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
    color: colors.text,
    fontSize: fontSize.body + 1,
    textAlign: 'center',
  },
  button: {
    marginTop: spacing.lg,
    backgroundColor: colors.cyan,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    ...shadow.glow,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonDisabled: {
    backgroundColor: colors.card,
    shadowOpacity: 0,
    elevation: 0,
  },
  buttonText: {
    color: colors.onCyan,
    fontSize: fontSize.body,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
});
