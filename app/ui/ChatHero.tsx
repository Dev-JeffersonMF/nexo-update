import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Heart, Mic, Sparkles } from 'lucide-react-native';

import { Mascot } from './Mascot';
import { getCharacterMeta, type CharacterId } from './mascotAssets';
import { colors, font, gradients, radius, spacing } from './theme';

type Props = {
  character: CharacterId;
  online: boolean;
  onPick: (text: string) => void;
};

const EXAMPLES = [
  'que horas são?',
  'me lembra de beber água às 15h',
  'como está o clima em Matozinhos?',
  'toca uma música',
];

/**
 * Estado inicial da conversa.
 *
 * Em vez de uma tela vazia, a assistente se apresenta com a própria arte e
 * três exemplos do que ela realmente sabe fazer. Tocar num exemplo manda o
 * pedido como se tivesse sido digitado.
 */
export function ChatHero({ character, online, onPick }: Props) {
  const meta = getCharacterMeta(character);

  return (
    <View style={styles.wrap}>
      <Mascot character={character} size={116} />

      <View style={[styles.badge, { borderColor: `${meta.accent}44` }]}>
        {character === 'tratis' ? (
          <Heart size={12} color={meta.accent} />
        ) : (
          <Sparkles size={12} color={meta.accent} />
        )}
        <Text style={[styles.badgeText, { color: meta.accent }]}>
          {online ? 'conversa local + internet' : 'conversa local, sem internet'}
        </Text>
      </View>

      <Text style={styles.title}>
        oi, eu sou a <Text style={{ color: meta.accent }}>{meta.name}</Text>
      </Text>
      <Text style={styles.body}>
        moro aqui no seu celular. falo, escuto e resolvo as coisas do dia a dia.
        toca no microfone e fala comigo — ou escreve aí embaixo.
      </Text>

      <View style={styles.examples}>
        {EXAMPLES.map((example) => (
          <Pressable
            key={example}
            onPress={() => onPick(example)}
            accessibilityRole="button"
            accessibilityLabel={`Enviar exemplo: ${example}`}
            style={({ pressed }) => [styles.chip, pressed && { opacity: 0.7 }]}
          >
            <View style={[styles.chipDot, { backgroundColor: meta.accent }]} />
            <Text style={styles.chipText}>{example}</Text>
          </Pressable>
        ))}
      </View>

      <LinearGradient
        colors={gradients.hairline}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.hairline}
        pointerEvents="none"
      />

      <View style={styles.micHint}>
        <Mic size={12} color={colors.textFaint} />
        <Text style={styles.micHintText}>um toque no microfone = um comando</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.sm,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
    backgroundColor: colors.card,
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  badgeText: { fontSize: 11, fontWeight: '700' },
  title: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.6,
    textAlign: 'center',
  },
  body: {
    color: colors.textMuted,
    fontSize: font.body,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: spacing.sm,
    maxWidth: 320,
  },
  examples: { alignSelf: 'stretch', marginTop: spacing.xl, gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  chipDot: { width: 5, height: 5, borderRadius: 3 },
  chipText: { color: colors.textSoft, fontSize: font.small, flex: 1 },
  hairline: { height: 1, alignSelf: 'stretch', marginTop: spacing.xl, opacity: 0.5 },
  micHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.md,
  },
  micHintText: { color: colors.textFaint, fontSize: 11 },
});
