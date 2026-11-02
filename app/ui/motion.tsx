import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from './theme';

/**
 * Blocos de animação reutilizáveis.
 *
 * Tudo aqui usa o `Animated` nativo do React Native (sem dependência extra) e
 * roda com `useNativeDriver: true` quando mexe só em opacidade e transform —
 * é o que mantém as transições lisas mesmo em aparelho modesto.
 *
 * Os valores animados nascem em `useState` (e não em `useRef`) de propósito:
 * são lidos durante a renderização, e um `ref` não pode ser lido no render.
 */

/** Entrada suave: aparece subindo. Usada para blocos de tela. */
export function FadeSlideIn({
  children,
  delay = 0,
  offset = 16,
  duration = 420,
  style,
}: {
  children: ReactNode;
  delay?: number;
  offset?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [delay, duration, progress]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [offset, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** Entrada com "estalo": cresce de 92% para 100%. Usada em cartões e ícones. */
export function PopIn({
  children,
  delay = 0,
  duration = 460,
  style,
}: {
  children: ReactNode;
  delay?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration,
      delay,
      easing: Easing.out(Easing.back(1.4)),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [delay, duration, progress]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }),
          transform: [
            {
              scale: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [0.92, 1],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * Pulso contínuo (respiração).
 *
 * Usado no mascote enquanto ele escuta: dá a sensação de que está "vivo" sem
 * precisar trocar de imagem.
 */
export function Pulse({
  children,
  active = true,
  minScale = 0.96,
  maxScale = 1.04,
  duration = 1600,
  style,
}: {
  children: ReactNode;
  active?: boolean;
  minScale?: number;
  maxScale?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!active) {
      progress.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          toValue: 1,
          duration: duration / 2,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(progress, {
          toValue: 0,
          duration: duration / 2,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, duration, progress]);

  return (
    <Animated.View
      style={[
        style,
        {
          transform: [
            {
              scale: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [minScale, maxScale],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** Três pontinhos pulsando: "o Nexus está pensando". */
export function TypingDots({ color = colors.cyan }: { color?: string }) {
  const [dots] = useState(() => [
    new Animated.Value(0.3),
    new Animated.Value(0.3),
    new Animated.Value(0.3),
  ]);

  useEffect(() => {
    const loops = dots.map((dot, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * 160),
          Animated.timing(dot, {
            toValue: 1,
            duration: 380,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(dot, {
            toValue: 0.3,
            duration: 380,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.delay((2 - index) * 160),
        ]),
      ),
    );
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [dots]);

  return (
    <View style={styles.dotsRow}>
      {dots.map((dot, index) => (
        <Animated.View
          key={index}
          style={[styles.dot, { backgroundColor: color, opacity: dot }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginHorizontal: 2,
  },
});
