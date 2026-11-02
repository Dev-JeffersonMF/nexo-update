/**
 * Enhanced 3D-animated Mascot with perspective and depth effects.
 *
 * This version uses CSS-like 3D transforms with perspective to create a
 * more immersive, depth-rich appearance while keeping performance high.
 */
import { useEffect, useState, useRef, type ReactNode } from 'react';
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
import { colors } from './theme';

/**
 * Mascot mood states
 */
export type MascotMood = 'idle' | 'listening' | 'thinking' | 'speaking' | 'sleeping';

/**
 * Motion parameters for each mood state
 */
const MOTION_CONFIG: Record<MascotMood, {
  float: number;      // Vertical float amplitude
  bob: number;        // Scale bob amplitude
  glow: number;       // Glow opacity
  duration: number;   // Animation cycle duration
  spinSpeed: number;  // Rotation speed (z-axis)
}> = {
  idle: { float: 6, bob: 0.015, glow: 0.18, duration: 3000, spinSpeed: 0.02 },
  listening: { float: 10, bob: 0.035, glow: 0.65, duration: 1200, spinSpeed: 0.08 },
  thinking: { float: 5, bob: 0.012, glow: 0.28, duration: 2200, spinSpeed: 0.01 },
  speaking: { float: 4, bob: 0.06, glow: 0.5, duration: 480, spinSpeed: 0.04 },
  sleeping: { float: 0, bob: 0, glow: 0, duration: 8000, spinSpeed: 0 },
};

/** Sleep cycle in milliseconds */
const SLEEP_CYCLE_MS = 28000;

/**
 * Enhanced 3D Mascot component with depth effects and smooth animations
 */
export function EnhancedMascot({
  source,
  mood = 'idle',
  size = 52,
  style,
  accessibilityLabel = 'Mascote do Nexus',
  children,
}: {
  source: ImageSourcePropType;
  mood?: MascotMood;
  size?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  children?: ReactNode;
}) {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [hasMotion, setHasMotion] = useState(true);

  // Animated values for different effects
  const [floatPhase] = useState(() => new Animated.Value(0));
  const [glowPhase] = useState(() => new Animated.Value(0));
  const [sleepPhase] = useState(() => new Animated.Value(0));
  const [rotatePhase] = useState(() => new Animated.Value(0));

  // Previous values for smooth transitions
  const prevMoodRef = useRef(mood);
  const [interpolationCache, setInterpolationCache] = useState({});

  // Check for reduced motion preference
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) {
        setReducedMotion(enabled);
        setHasMotion(!enabled);
      }
    });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled) => {
        if (mounted) {
          setReducedMotion(enabled);
          setHasMotion(!enabled);
        }
      },
    );

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  // Mood transition handling - smoothly transition between moods
  useEffect(() => {
    if (mood === prevMoodRef.current) return;
    prevMoodRef.current = mood;

    if (reducedMotion) return;

    // Clear cache when mood changes (deferred to avoid cascading renders)
    setTimeout(() => setInterpolationCache({}), 0);
  }, [mood, reducedMotion]);

  // Floating animation (vertical movement)
  useEffect(() => {
    if (reducedMotion || !hasMotion) {
      floatPhase.setValue(mood === 'sleeping' ? 0 : 0.5);
      return;
    }

    const { duration } = MOTION_CONFIG[mood];
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(floatPhase, {
          toValue: 1,
          duration: duration / 2,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(floatPhase, {
          toValue: 0,
          duration: duration / 2,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();

    return () => loop.stop();
  }, [mood, floatPhase, reducedMotion, hasMotion]);

  // Glow animation (antenna glow)
  useEffect(() => {
    if (reducedMotion || !hasMotion || mood === 'sleeping') {
      glowPhase.setValue(mood === 'sleeping' ? 0 : MOTION_CONFIG[mood].glow);
      return;
    }

    const { duration, glow } = MOTION_CONFIG[mood];
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glowPhase, {
          toValue: 1,
          duration: Math.min(1400, duration / 2),
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(glowPhase, {
          toValue: 0,
          duration: Math.min(1400, duration / 2),
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();

    return () => loop.stop();
  }, [mood, glowPhase, reducedMotion, hasMotion]);

  // Sleep animation (container fades sleep image)
  useEffect(() => {
    if (reducedMotion || !hasMotion || mood !== 'sleeping') {
      sleepPhase.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sleepPhase, {
          toValue: 1,
          duration: SLEEP_CYCLE_MS,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();

    return () => loop.stop();
  }, [mood, sleepPhase, reducedMotion, hasMotion]);

  // Rotation animation for 3D effect
  useEffect(() => {
    if (reducedMotion || !hasMotion || mood === 'sleeping') {
      rotatePhase.setValue(0);
      return;
    }

    const { spinSpeed } = MOTION_CONFIG[mood];
    if (spinSpeed === 0) return;

    const loop = Animated.loop(
      Animated.timing(rotatePhase, {
        toValue: 1,
        duration: SLEEP_CYCLE_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();

    return () => loop.stop();
  }, [mood, rotatePhase, reducedMotion, hasMotion]);

  // Calculate interpolated values with caching
  const float = floatPhase.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -MOTION_CONFIG[mood].float],
  });

  const bob = floatPhase.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1 + MOTION_CONFIG[mood].bob],
  });

  const glowOpacity = glowPhase.interpolate({
    inputRange: [0, 1],
    outputRange: [
      MOTION_CONFIG[mood].glow * 0.3,
      MOTION_CONFIG[mood].glow,
    ],
  });

  const sleepOpacity = sleepPhase.interpolate({
    inputRange: [0, 0.52, 0.58, 0.92, 1],
    outputRange: [0, 0, 1, 1, 0],
  });

  const rotateZ = rotatePhase.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  // Perspective value for 3D effect
  const perspective = 1000;

  const containerStyle = {
    width: size,
    height: size,
    transform: [
      { perspective },
    ],
  };

  const mascotStyle = {
    opacity: mood === 'sleeping' ? 1 : sleepOpacity.interpolate({
      inputRange: [0, 1],
      outputRange: [1, 0],
    }),
    transform: [
      { perspective },
      { translateY: float },
      { scale: bob },
      { rotateZ },
    ],
  };

  const sleepStyle = {
    position: 'absolute',
    width: size,
    height: size,
    opacity: mood === 'sleeping' ? 0 : (sleepOpacity.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 1],
    }) as unknown as number),
    transform: [
      { translateY: float },
      { scale: bob },
      { rotateZ },
    ],
  };

  return (
    <View
      style={[styles.wrapper, containerStyle, style]}
      accessibilityLabel={accessibilityLabel}
    >
      {/* 3D Glow layer - neon effect */}
      {hasMotion && mood !== 'sleeping' && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.glow,
            {
              width: size * 0.68,
              height: size * 0.68,
              borderRadius: size * 0.4,
              left: size * 0.16,
              top: -size * 0.15,
              opacity: glowOpacity,
              // 3D transform for glow depth (simulated via scale)
              transform: [
                { scale: 1.02 },
              ],
            },
          ]}
        />
      )}

      {/* Main mascot image */}
      <Animated.Image
        accessibilityRole="image"
        source={source}
        resizeMode="contain"
        style={[
          styles.image,
          { width: size, height: size },
          mascotStyle,
        ] as any}
      />

      {/* Sleep image - appears when sleeping */}
      <Animated.Image
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        source={require('../../assets/mascote-ocioso.png')}
        resizeMode="contain"
        style={[
          styles.image,
          styles.sleepImage,
          sleepStyle,
        ] as any}
      />

      {/* Children for additional 3D elements */}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    // 3D container with subtle shadow
    shadowColor: colors.cyan,
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  image: {
    marginTop: -2,
  },
  glow: {
    position: 'absolute',
    backgroundColor: colors.cyanGlow,
    // Inner shadow for depth
    shadowColor: colors.neonCyan,
    shadowOpacity: 0.4,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  sleepImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    pointerEvents: 'none',
  },
});