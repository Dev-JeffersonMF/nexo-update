import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, Text } from 'react-native';
import { Info } from 'lucide-react-native';

import { colors, font, radius, spacing } from './theme';

type Props = {
  message: string;
};

/**
 * Aviso fixo acima da barra de escrita.
 *
 * Fica FORA da conversa: com o chat cheio, um aviso dentro do scroll sumiria.
 * Entra deslizando de baixo e sai da mesma forma quando a mensagem é limpa.
 */
export function NoticeBanner({ message }: Props) {
  const [slide] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.timing(slide, {
      toValue: message ? 1 : 0,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [message, slide]);

  if (!message) return null;

  return (
    <Animated.View
      accessibilityRole="alert"
      style={[
        styles.wrap,
        {
          opacity: slide,
          transform: [
            { translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) },
          ],
        },
      ]}
    >
      <Info size={13} color={colors.warning} />
      <Text style={styles.text}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255, 196, 107, 0.09)',
    borderWidth: 1,
    borderColor: 'rgba(255, 196, 107, 0.26)',
  },
  text: {
    color: colors.textSoft,
    fontSize: font.small,
    lineHeight: 18,
    flex: 1,
  },
});
