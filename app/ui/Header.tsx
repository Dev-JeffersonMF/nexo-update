import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SlidersHorizontal, Square } from 'lucide-react-native';

import { Mascot } from './Mascot';
import { getCharacterMeta, type CharacterId } from './mascotAssets';
import { colors, font, radius, spacing } from './theme';

type Props = {
  character: CharacterId;
  statusText: string;
  listening: boolean;
  speaking: boolean;
  thinking: boolean;
  online: boolean;
  onOpenSettings: () => void;
  onStopSpeech: () => void;
};

/**
 * Cabeçalho da conversa.
 *
 * O mascote fica sempre visível à esquerda (é ele que dá a vida da tela) e o
 * status muda de ritmo junto com o estado real da assistente. À direita ficam
 * apenas as duas ações que importam: calar a voz e abrir os ajustes.
 */
export function Header({
  character,
  statusText,
  listening,
  speaking,
  thinking,
  online,
  onOpenSettings,
  onStopSpeech,
}: Props) {
  const meta = getCharacterMeta(character);

  return (
    <View style={styles.wrap}>
      <View style={styles.mascotWrap}>
        <Mascot
          character={character}
          size={58}
          listening={listening}
          speaking={speaking}
          thinking={thinking}
          accessibilityLabel={`${meta.name} ${listening ? 'ouvindo' : speaking ? 'falando' : 'pronta'}`}
        />
      </View>

      <View style={styles.info}>
        <View style={styles.nameRow}>
          <Text style={[styles.name, { color: meta.accent }]}>{meta.name}</Text>
          <View
            style={[
              styles.stateBadge,
              { borderColor: `${meta.accent}55`, backgroundColor: `${meta.accent}18` },
            ]}
          >
            <View
              style={[
                styles.stateDot,
                {
                  backgroundColor: listening ? colors.pink : speaking ? meta.accent : colors.textFaint,
                },
              ]}
            />
            <Text style={styles.stateText}>
              {listening ? 'ouvindo' : speaking ? 'falando' : thinking ? 'pensando' : 'pronta'}
            </Text>
          </View>
        </View>

        <Text style={styles.status} numberOfLines={1}>
          {statusText}
        </Text>
        <Text style={styles.presence}>
          {online ? 'local + internet' : 'modo local'} · pt-BR
        </Text>
      </View>

      {speaking ? (
        <Pressable
          onPress={onStopSpeech}
          accessibilityRole="button"
          accessibilityLabel="Parar a fala"
          style={({ pressed }) => [
            styles.iconButton,
            { borderColor: `${meta.accent}55` },
            pressed && { opacity: 0.7 },
          ]}
        >
          <Square size={14} color={meta.accent} fill={meta.accent} />
        </Pressable>
      ) : null}

      <Pressable
        onPress={onOpenSettings}
        accessibilityRole="button"
        accessibilityLabel="Abrir ajustes da assistente"
        hitSlop={8}
        style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.7 }]}
      >
        <SlidersHorizontal size={19} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm + 2,
  },
  mascotWrap: {
    width: 58,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  name: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  stateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  stateDot: { width: 5, height: 5, borderRadius: 3 },
  stateText: { color: colors.textMuted, fontSize: 9, fontWeight: '800', letterSpacing: 0.4 },
  status: { color: colors.textSoft, fontSize: font.small, marginTop: 1 },
  presence: { color: colors.textFaint, fontSize: 10, marginTop: 2, letterSpacing: 0.3 },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
