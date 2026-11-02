import { Image, StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, spacing } from './theme';
import { FadeSlideIn, Pulse } from './motion';

const MASCOT_IDLE = require('../../assets/mascote-ocioso.png');

/** Tela de carregamento: aparece enquanto o perfil guardado é lido. */
export function SplashScreen() {
  return (
    <View style={styles.screen}>
      <Pulse minScale={0.96} maxScale={1.04} duration={2200}>
        <Image source={MASCOT_IDLE} style={styles.mascot} resizeMode="contain" />
      </Pulse>
      <FadeSlideIn delay={260} offset={8}>
        <Text style={styles.brand}>NEXUS</Text>
      </FadeSlideIn>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mascot: {
    width: 108,
    height: 108,
  },
  brand: {
    color: colors.text,
    fontSize: fontSize.display,
    letterSpacing: 8,
    fontWeight: '800',
    marginTop: spacing.lg,
    marginLeft: 8,
  },
});
