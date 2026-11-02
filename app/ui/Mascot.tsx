import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
  type ImageSourcePropType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {
  getCharacterAssets,
  getCharacterMeta,
  type CharacterId,
} from './mascotAssets';

/**
 * O mascote da Nexo, vivo.
 *
 * A arte é estática; a vida vem daqui. Cada estado tem um ritmo próprio:
 *
 *  - `idle`      respira e flutua devagar;
 *  - `listening` flutua mais rápido e acende os anéis de pulso;
 *  - `thinking`  balança de leve, como quem pondera;
 *  - `speaking`  mexe a boca (Nexo) ou dá um pulinho ritmado (Tratis).
 *
 * Tudo com `Animated` nativo e `useNativeDriver: true` (só opacidade e
 * transform), que é o que mantém liso em aparelho modesto. Se o sistema pedir
 * menos movimento, a arte fica estática e continua bonita.
 */

export type MascotMood = 'idle' | 'listening' | 'thinking' | 'speaking';

type Props = {
  size?: number;
  character?: CharacterId;
  /** Estado explícito; se ausente, é derivado das flags. */
  mood?: MascotMood;
  speaking?: boolean;
  listening?: boolean;
  thinking?: boolean;
  /** Sobrepõe a arte (usado por telas antigas). */
  source?: ImageSourcePropType;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

const MOTION: Record<MascotMood, { float: number; glow: number; duration: number }> = {
  idle: { float: 4, glow: 0.2, duration: 2600 },
  listening: { float: 7, glow: 0.55, duration: 1200 },
  thinking: { float: 3, glow: 0.32, duration: 1900 },
  speaking: { float: 4, glow: 0.45, duration: 620 },
};

export function Mascot({
  size = 78,
  character = 'nexo',
  mood,
  speaking = false,
  listening = false,
  thinking = false,
  source,
  style,
  accessibilityLabel,
}: Props) {
  const assets = useMemo(() => getCharacterAssets(character), [character]);
  const meta = useMemo(() => getCharacterMeta(character), [character]);
  const activeMood: MascotMood =
    mood ?? (speaking ? 'speaking' : listening ? 'listening' : thinking ? 'thinking' : 'idle');
  const rhythm = MOTION[activeMood] ?? MOTION.idle;
  const hasFrames = !!assets.listeningFrames?.length;
  const hasTalkingFrames = !!assets.talkingFrames?.length;

  const float = useRef(new Animated.Value(0));
  const mouth = useRef(new Animated.Value(0));
  const pulse = useRef(new Animated.Value(0));
  const breathe = useRef(new Animated.Value(0));
  const [frameIndex, setFrameIndex] = useState(0);
  const [talkIndex, setTalkIndex] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);

  // Respeita "remover animações" do sistema.
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  // Flutuação contínua.
  useEffect(() => {
    if (reduceMotion) {
      float.current.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(float.current, {
          toValue: 1,
          duration: rhythm.duration,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(float.current, {
          toValue: 0,
          duration: rhythm.duration,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [float, reduceMotion, rhythm.duration]);

  // Respiração do halo.
  useEffect(() => {
    if (reduceMotion) {
      breathe.current.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe.current, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(breathe.current, {
          toValue: 0,
          duration: 1800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breathe, reduceMotion]);

  // Boca / embalo de fala: ritmo irregular de propósito.
  useEffect(() => {
    if (!speaking || reduceMotion) {
      mouth.current.stopAnimation();
      mouth.current.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(mouth.current, { toValue: 1, duration: 105, useNativeDriver: true }),
        Animated.timing(mouth.current, { toValue: 0.1, duration: 120, useNativeDriver: true }),
        Animated.timing(mouth.current, { toValue: 0.9, duration: 90, useNativeDriver: true }),
        Animated.timing(mouth.current, { toValue: 0.22, duration: 115, useNativeDriver: true }),
        Animated.timing(mouth.current, { toValue: 0.75, duration: 85, useNativeDriver: true }),
        Animated.timing(mouth.current, { toValue: 0, duration: 135, useNativeDriver: true }),
        Animated.delay(110),
      ]),
    );
    const mouthAnim = mouth.current;
    loop.start();
    return () => {
      loop.stop();
      mouthAnim.setValue(0);
    };
  }, [mouth, reduceMotion, speaking]);

  // Anéis de pulso (ouvindo/pensando).
  useEffect(() => {
    if (reduceMotion || (!listening && !thinking)) {
      pulse.current.stopAnimation();
      pulse.current.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse.current, {
          toValue: 1,
          duration: listening ? 1150 : 1750,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse.current, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [listening, thinking, pulse, reduceMotion]);

  // Quadros de "ouvindo" da arte pixel-art.
  useEffect(() => {
    if (reduceMotion || !listening || !hasFrames) {
      return undefined;
    }
    const frameCount = assets.listeningFrames!.length;
    let next = 0;
    const interval = setInterval(() => {
      next = (next + 1) % frameCount;
      setFrameIndex(next);
    }, 190);
    return () => clearInterval(interval);
  }, [assets.listeningFrames, hasFrames, listening, reduceMotion]);

  // Quadros de fala da arte pixel-art (boca abre/fecha).
  useEffect(() => {
    if (reduceMotion || !speaking || !hasTalkingFrames) {
      return undefined;
    }
    const count = assets.talkingFrames!.length;
    let next = 0;
    const interval = setInterval(() => {
      next = (next + 1) % count;
      setTalkIndex(next);
    }, 165);
    return () => clearInterval(interval);
  }, [assets.talkingFrames, hasTalkingFrames, reduceMotion, speaking]);

  // Interpolações (refs só leem .current, não disparam re-render).
  // eslint-disable-next-line react-hooks/refs
  const translateY = float.current.interpolate({
    inputRange: [0, 1],
    outputRange: [rhythm.float / 2, -rhythm.float],
  });
  // eslint-disable-next-line react-hooks/refs
  const pulseScale = pulse.current.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.35] });
  // eslint-disable-next-line react-hooks/refs
  const pulseOpacity = pulse.current.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0] });
  // eslint-disable-next-line react-hooks/refs
  const haloScale = breathe.current.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.08] });
  // eslint-disable-next-line react-hooks/refs
  const haloOpacity = breathe.current.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.8] });
  // eslint-disable-next-line react-hooks/refs
  const talkScale = mouth.current.interpolate({ inputRange: [0, 1], outputRange: [1, 1.045] });

  const baseImage = useMemo(() => {
    if (source) return source;
    if (listening && hasFrames) {
      const frames = assets.listeningFrames!;
      return frames[frameIndex % frames.length];
    }
    if (speaking && hasTalkingFrames) {
      const frames = assets.talkingFrames!;
      return frames[talkIndex % frames.length];
    }
    if (speaking) return assets.mouthClosed;
    return assets.idle;
  }, [assets, frameIndex, hasFrames, hasTalkingFrames, listening, source, speaking, talkIndex]);

  const showMouthLayer = speaking && !source && !hasTalkingFrames && character === 'nexo';

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}
    >
      {/* Halo de respiração */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.halo,
          {
            width: size * 0.98,
            height: size * 0.98,
            borderRadius: size / 2,
            backgroundColor: meta.halo,
            opacity: haloOpacity,
            transform: [{ scale: haloScale }],
          },
        ]}
      />

      {/* Anel de pulso (ouvindo/pensando) */}
      {(listening || thinking) && !reduceMotion ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.ring,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              borderColor: meta.accent,
              opacity: pulseOpacity,
              transform: [{ scale: pulseScale }],
            },
          ]}
        />
      ) : null}

      <Animated.View style={{ transform: [{ translateY }, { scale: talkScale }] }}>
        <Animated.Image
          source={baseImage}
          resizeMode="contain"
          style={{ width: size, height: size }}
        />
        {showMouthLayer ? (
          <Animated.Image
            source={assets.mouthOpen}
            resizeMode="contain"
            // eslint-disable-next-line react-hooks/refs
            style={[styles.overlay, { width: size, height: size, opacity: mouth.current }]}
          />
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  halo: {
    position: 'absolute',
  },
  ring: {
    position: 'absolute',
    borderWidth: 1.5,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
});

/**
 * Avatar pequeno para as bolhas de conversa.
 *
 * É só o mascote em tamanho de rosto: mantém a mesma arte e os mesmos ritmos
 * da tela principal, sem os anéis de pulso (que ficariam grandes demais).
 */
export function MascotAvatar({
  character = 'nexo',
  size = 30,
  speaking = false,
  listening = false,
}: {
  character?: CharacterId;
  size?: number;
  speaking?: boolean;
  listening?: boolean;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: getCharacterMeta(character).halo,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <Mascot
        character={character}
        size={size * 1.15}
        speaking={speaking}
        listening={listening}
      />
    </View>
  );
}
