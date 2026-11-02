/**
 * 3D Animated Icons System for Nexus Assistant
 * Consistent icon animations with depth effects and micro-interactions
 */
import { useRef, useEffect, useCallback, useMemo, type ComponentType, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  type StyleProp,
  type TransformsStyle,
  type ViewStyle,
} from 'react-native';
import Svg, {
  Circle,
  Path,
  G,
  Defs,
  LinearGradient,
  Stop,
  RadialGradient,
} from 'react-native-svg';
import { enhancedColors, shadows, animationSpeeds, microInteractions } from './EnhancedThemeColors';

// Base icon size
const ICON_SIZE = 28;

// ============================================================
// CORE ANIMATED ICON COMPONENT
// ============================================================

export interface AnimatedIconProps {
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
  animated?: boolean;
  pulseSpeed?: number;
  rotateSpeed?: number;
  onPress?: () => void;
  active?: boolean;
  playing?: boolean;
  hasNewMessage?: boolean;
}

/**
 * Base Animated Icon with 3D perspective and glow
 */
function BaseAnimatedIcon({
  children,
  size = ICON_SIZE,
  style,
  animated = true,
  onPress,
}: AnimatedIconProps & { children: ReactNode }) {
  const scale = useMemo(() => new Animated.Value(1), []);
  const rotate = useMemo(() => new Animated.Value(0), []);
  const glow = useMemo(() => new Animated.Value(0.3), []);

  const handlePressIn = useCallback(() => {
    Animated.spring(scale, {
      toValue: 0.9,
      friction: 6,
      tension: 100,
      useNativeDriver: true,
    }).start();
  }, [scale]);

  const handlePressOut = useCallback(() => {
    Animated.spring(scale, {
      toValue: 1,
      friction: 6,
      tension: 100,
      useNativeDriver: true,
    }).start();
    onPress?.();
  }, [onPress, scale]);

  // Glow pulse animation
  useEffect(() => {
    if (!animated) return;

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
        Animated.timing(glow, {
          toValue: 0.3,
          duration: 1500,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [animated, glow]);

  const glowOpacity = glow.interpolate({
    inputRange: [0, 1],
    outputRange: [0.15, 0.5],
  });

  return (
    <Animated.View
      style={[
        style,
        {
          width: size,
          height: size,
          transform: [{ scale }],
        },
      ]}
      onTouchStart={handlePressIn}
      onTouchEnd={handlePressOut}
      onResponderGrant={handlePressIn}
      onResponderRelease={handlePressOut}
    >
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Defs>
          <RadialGradient
            id="iconGlow"
            cx="50%"
            cy="50%"
            r="60%"
            fx="50%"
            fy="50%"
          >
            <Stop offset="0%" stopColor={enhancedColors.cyan.base} stopOpacity={glowOpacity as unknown as number} />
            <Stop offset="100%" stopColor="transparent" stopOpacity={0} />
          </RadialGradient>
        </Defs>

        {/* Glow layer */}
        <Circle
          cx={12}
          cy={12}
          r={11}
          fill="url(#iconGlow)"
        />

        {/* Main icon content */}
        {children}
      </Svg>
    </Animated.View>
  );
}

// ============================================================
// SPECIFIC ICON COMPONENTS
// ============================================================

/**
 * 3D Microphone Icon with animated sound waves
 */
export function MicrophoneIcon({
  size = ICON_SIZE,
  color = enhancedColors.cyan.base,
  style,
  animated = true,
  active = false,
  onPress,
}: AnimatedIconProps & { active?: boolean }) {
  const wavePhase = useMemo(() => new Animated.Value(0), []);
  const activePhase = useMemo(() => new Animated.Value(active ? 1 : 0), []);

  // Sound waves animation when active
  useEffect(() => {
    if (!animated) return;

    Animated.timing(activePhase, {
      toValue: active ? 1 : 0,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [active, activePhase, animated]);

  useEffect(() => {
    if (!animated || !active) return;

    const loop = Animated.loop(
      Animated.timing(wavePhase, {
        toValue: 1,
        duration: 800,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [active, wavePhase, animated]);

  const wave1 = wavePhase.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 1],
  });

  const wave2 = wavePhase.interpolate({
    inputRange: [0, 1],
    outputRange: [0.5, 1],
  });

  return (
    <BaseAnimatedIcon
      size={size}
      style={style}
      animated={animated}
      onPress={onPress}
    >
      {/* Sound waves - animated when active */}
      {animated && active && (
        <>
          <Path
            d="M4 12c0-2.5 2-4.5 4.5-5V4"
            stroke={color}
            strokeWidth={1.5}
            strokeLinecap="round"
            opacity={activePhase.interpolate({ inputRange: [0, 1], outputRange: [0, wave1 as unknown as number] }) as unknown as number}
          />
          <Path
            d="M20 12c0-3.5 3-6 6-7"
            stroke={color}
            strokeWidth={1.5}
            strokeLinecap="round"
            opacity={activePhase.interpolate({ inputRange: [0, 1], outputRange: [0, wave2 as unknown as number] }) as unknown as number}
          />
        </>
      )}

      {/* Microphone body */}
      <Path
        d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <Path
        d="M19 10v2a7 7 0 0 1-14 0v-2"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <Path
        d="M12 19v4"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Path
        d="M8 23h8"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </BaseAnimatedIcon>
  );
}

/**
 * 3D Send/Message Icon
 */
export function SendIcon({
  size = ICON_SIZE,
  color = enhancedColors.cyan.base,
  style,
  animated = true,
  onPress,
}: AnimatedIconProps) {
  const arrowPhase = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    if (!animated) return;

    const loop = Animated.sequence([
      Animated.timing(arrowPhase, {
        toValue: 1,
        duration: 600,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.delay(300),
      Animated.timing(arrowPhase, {
        toValue: 0,
        duration: 0,
        useNativeDriver: true,
      }),
    ]);

    const loopForever = Animated.loop(loop);
    loopForever.start();
    return () => loopForever.stop();
  }, [animated, arrowPhase]);

  const arrowTranslate = arrowPhase.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 8],
  });

  return (
    <BaseAnimatedIcon
      size={size}
      style={style}
      animated={animated}
      onPress={onPress}
    >
      <G>
        {/* Arrow path */}
        <Path
          d="M22 2L11 13"
          stroke={color}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path
          d="M22 2l-7 20-4-9-9-4 20-7z"
          stroke={color}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        {/* Animated accent line */}
        <Path
          d="M15 16l5 5"
          stroke={enhancedColors.cyan.light}
          strokeWidth={2}
          strokeLinecap="round"
          transform={[{ translateX: arrowTranslate }, { translateY: arrowTranslate }]}
          opacity={arrowPhase.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) as unknown as number}
        />
      </G>
    </BaseAnimatedIcon>
  );
}

/**
 * 3D Volume/Speaker Icon
 */
export function VolumeIcon({
  size = ICON_SIZE,
  color = enhancedColors.cyan.base,
  style,
  animated = true,
  level = 1, // 0, 1, 2, 3
  onPress,
}: AnimatedIconProps & { level?: number }) {
  const barsPhase = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    if (!animated) return;

    const loop = Animated.loop(
      Animated.timing(barsPhase, {
        toValue: 1,
        duration: 1200,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [animated, barsPhase]);

  const barHeights = [
    barsPhase.interpolate({
      inputRange: [0, 1],
      outputRange: [4, 14],
    }),
    barsPhase.interpolate({
      inputRange: [0, 1],
      outputRange: [6, 16],
    }),
    barsPhase.interpolate({
      inputRange: [0, 1],
      outputRange: [8, 18],
    }),
  ];

  return (
    <BaseAnimatedIcon
      size={size}
      style={style}
      animated={animated}
      onPress={onPress}
    >
      {/* Speaker cone */}
      <Path
        d="M11 5L6 9H2v6h4l5 4V5z"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />

      {/* Volume bars - animated when level > 0 */}
      {level > 0 && level <= 3 && animated && (
        <>
          <Path
            d="M15 15v-6"
            stroke={color}
            strokeWidth={2.5}
            strokeLinecap="round"
            opacity={level >= 1 ? 1 : 0.3}
            transform={[{ scaleY: barHeights[0].interpolate({ inputRange: [4, 14], outputRange: [0.4, 1] }) }]}
          />
        </>
      )}
      {level > 1 && level <= 3 && animated && (
        <Path
          d="M18 17v-10"
          stroke={color}
          strokeWidth={2.5}
          strokeLinecap="round"
          opacity={level >= 2 ? 1 : 0.3}
          transform={[{ scaleY: barHeights[1].interpolate({ inputRange: [6, 16], outputRange: [0.4, 1] }) }]}
        />
      )}
      {level > 2 && level <= 3 && animated && (
        <Path
          d="M21 19v-14"
          stroke={color}
          strokeWidth={2.5}
          strokeLinecap="round"
          opacity={level >= 3 ? 1 : 0.3}
          transform={[{ scaleY: barHeights[2].interpolate({ inputRange: [8, 18], outputRange: [0.4, 1] }) }]}
        />
      )}

      {/* Static bars when not animated */}
      {!animated && level > 0 && (
        <>
          {level >= 1 && (
            <Path d="M15 15v-6" stroke={color} strokeWidth={2.5} strokeLinecap="round" />
          )}
          {level >= 2 && (
            <Path d="M18 17v-10" stroke={color} strokeWidth={2.5} strokeLinecap="round" />
          )}
          {level >= 3 && (
            <Path d="M21 19v-14" stroke={color} strokeWidth={2.5} strokeLinecap="round" />
          )}
        </>
      )}

      {/* Mute indicator */}
      {level === 0 && (
        <Path
          d="M23 9l-10 10M13 19l10-10"
          stroke={enhancedColors.state.error}
          strokeWidth={2}
          strokeLinecap="round"
        />
      )}
    </BaseAnimatedIcon>
  );
}

/**
 * 3D Settings/Gear Icon
 */
export function SettingsIcon({
  size = ICON_SIZE,
  color = enhancedColors.cyan.base,
  style,
  animated = true,
  onPress,
}: AnimatedIconProps) {
  const rotatePhase = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    if (!animated) return;

    const loop = Animated.loop(
      Animated.timing(rotatePhase, {
        toValue: 1,
        duration: 8000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [animated, rotatePhase]);

  const rotate = rotatePhase.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <BaseAnimatedIcon
      size={size}
      style={style}
      animated={animated}
      onPress={onPress}
    >
      <G transform={[{ rotate }] as unknown as TransformsStyle['transform']}>
        {/* Gear teeth */}
        <Path
          d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
        />
        {/* Center circle */}
        <Circle
          cx={12}
          cy={12}
          r={3}
          stroke={color}
          strokeWidth={2}
          fill="none"
        />
        {/* Inner gear */}
        <Path
          d="M12 7v2M12 15v2M9 12h2M15 12h2"
          stroke={enhancedColors.cyan.light}
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      </G>
    </BaseAnimatedIcon>
  );
}

/**
 * 3D Home Icon
 */
export function HomeIcon({
  size = ICON_SIZE,
  color = enhancedColors.cyan.base,
  style,
  animated = true,
  onPress,
}: AnimatedIconProps) {
  const housePhase = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    if (!animated) return;

    const loop = Animated.sequence([
      Animated.timing(housePhase, {
        toValue: 1,
        duration: 2000,
        easing: Easing.out(Easing.elastic(0.8)),
        useNativeDriver: true,
      }),
      Animated.delay(3000),
      Animated.timing(housePhase, {
        toValue: 0,
        duration: 800,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);

    const loopForever = Animated.loop(loop);
    loopForever.start();
    return () => loopForever.stop();
  }, [animated, housePhase]);

  const roofScale = housePhase.interpolate({
    inputRange: [0, 0.3, 1],
    outputRange: [1, 1.1, 1],
  });

  return (
    <BaseAnimatedIcon
      size={size}
      style={style}
      animated={animated}
      onPress={onPress}
    >
      <G transform={[{ scale: roofScale }, { translateY: housePhase.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, -2, 0] }) }] as unknown as TransformsStyle['transform']}>
        {/* Roof */}
        <Path
          d="M3 9l9-7 9 7"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </G>
      {/* House body */}
      <Path
        d="M9 22V12M5 12h14"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Path
        d="M9 22H5a2 2 0 0 1-2-2V12a2 2 0 0 1 2-2h4"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        fill="none"
      />
      <Path
        d="M19 22h-4a2 2 0 0 1-2-2V12a2 2 0 0 1 2-2h4"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        fill="none"
      />
    </BaseAnimatedIcon>
  );
}

/**
 * 3D Bell/Notification Icon
 */
export function BellIcon({
  size = ICON_SIZE,
  color = enhancedColors.cyan.base,
  style,
  animated = true,
  hasNotification = false,
  onPress,
}: AnimatedIconProps & { hasNotification?: boolean }) {
  const ringPhase = useMemo(() => new Animated.Value(0), []);
  const dotPhase = useMemo(() => new Animated.Value(0), []);

  // Ring animation
  useEffect(() => {
    if (!animated || !hasNotification) return;

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(ringPhase, {
          toValue: 1,
          duration: 150,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(ringPhase, {
          toValue: -1,
          duration: 150,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(ringPhase, {
          toValue: 0,
          duration: 100,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.delay(1000),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [hasNotification, ringPhase, animated]);

  // Notification dot pulse
  useEffect(() => {
    if (!animated || !hasNotification) return;

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(dotPhase, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(dotPhase, {
          toValue: 0,
          duration: 800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [hasNotification, dotPhase, animated]);

  const ringRotate = ringPhase.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: ['-15deg', '0deg', '15deg'],
  });

  const dotScale = dotPhase.interpolate({
    inputRange: [0, 1],
    outputRange: [0.8, 1.2],
  });
  const dotOpacity = dotPhase.interpolate({
    inputRange: [0, 1],
    outputRange: [0.6, 1],
  });

  return (
    <BaseAnimatedIcon
      size={size}
      style={style}
      animated={animated}
      onPress={onPress}
    >
      <G transform={[{ rotate: ringRotate }] as unknown as TransformsStyle['transform']}>
        {/* Bell body */}
        <Path
          d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        {/* Clapper */}
        <Path
          d="M13.73 21a2 2 0 0 1-3.46 0"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
        />
      </G>

      {/* Notification badge */}
      {hasNotification && (
        <Circle
          cx={19}
          cy={5}
          r={4}
          fill={enhancedColors.state.error}
          transform={[{ scale: dotScale }]}
          opacity={dotOpacity as unknown as number}
        />
      )}
    </BaseAnimatedIcon>
  );
}

/**
 * 3D Radio/Music Icon
 */
export function RadioIcon({
  size = ICON_SIZE,
  color = enhancedColors.cyan.base,
  style,
  animated = true,
  playing = false,
  onPress,
}: AnimatedIconProps & { playing?: boolean }) {
  const signalPhase = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    if (!animated || !playing) return;

    const loop = Animated.loop(
      Animated.timing(signalPhase, {
        toValue: 1,
        duration: 1000,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [playing, signalPhase, animated]);

  const signal1 = signalPhase.interpolate({
    inputRange: [0, 1],
    outputRange: [0.2, 1],
  });

  const signal2 = signalPhase.interpolate({
    inputRange: [0, 1],
    outputRange: [0.5, 1],
  });

  const signal3 = signalPhase.interpolate({
    inputRange: [0, 1],
    outputRange: [0.8, 1],
  });

  return (
    <BaseAnimatedIcon
      size={size}
      style={style}
      animated={animated}
      onPress={onPress}
    >
      {/* Signal waves */}
      {playing && animated && (
        <>
          <Path
            d="M4 12c0-2.5 2-4.5 4.5-5V4"
            stroke={color}
            strokeWidth={1.5}
            strokeLinecap="round"
            opacity={signal1 as unknown as number}
          />
          <Path
            d="M8 12c0-3.5 3-6 6-7"
            stroke={color}
            strokeWidth={1.5}
            strokeLinecap="round"
            opacity={signal2 as unknown as number}
          />
          <Path
            d="M12 12c0-4.5 4-8 8-9"
            stroke={color}
            strokeWidth={1.5}
            strokeLinecap="round"
            opacity={signal3 as unknown as number}
          />
        </>
      )}

      {/* Radio base */}
      <Path
        d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v7"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Speaker */}
      <Circle
        cx={12}
        cy={12}
        r={3}
        stroke={color}
        strokeWidth={2}
        fill="none"
      />
      <Path
        d="M12 9v6M9 12h6"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </BaseAnimatedIcon>
  );
}

/**
 * 3D Weather Icon
 */
export function WeatherIcon({
  size = ICON_SIZE,
  color = enhancedColors.cyan.base,
  style,
  animated = true,
  condition = 'sunny', // sunny, cloudy, rainy, stormy
  onPress,
}: AnimatedIconProps & { condition?: 'sunny' | 'cloudy' | 'rainy' | 'stormy' }) {
  const phase = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    if (!animated) return;

    const duration = condition === 'stormy' ? 800 : 3000;
    const loop = Animated.loop(
      Animated.timing(phase, {
        toValue: 1,
        duration,
        easing: condition === 'stormy' ? Easing.inOut(Easing.sin) : Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [condition, phase, animated]);

  return (
    <BaseAnimatedIcon
      size={size}
      style={style}
      animated={animated}
      onPress={onPress}
    >
      {/* Sun rays */}
      {condition === 'sunny' && (
        <G transform={[{ rotate: phase.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] as unknown as TransformsStyle['transform']}>
          {[...Array(8)].map((_, i) => (
            <Path
              key={i}
              d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
              stroke={color}
              strokeWidth={1.5}
              strokeLinecap="round"
            />
          ))}
        </G>
      )}

      {/* Cloud */}
      {(condition === 'cloudy' || condition === 'rainy' || condition === 'stormy') && (
        <Path
          d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      )}

      {/* Rain drops */}
      {(condition === 'rainy' || condition === 'stormy') && animated && (
        <>
          {[1, 2, 3].map((i) => (
            <Path
              key={i}
              d={`M${10 + i * 3} 19v${condition === 'stormy' ? 8 : 6}`}
              stroke={enhancedColors.cyan.light}
              strokeWidth={2}
              strokeLinecap="round"
              opacity={phase.interpolate({
                inputRange: [(i - 1) * 0.3, i * 0.3],
                outputRange: [0, 1],
              }) as unknown as number}
              transform={[
                {
                  translateY: phase.interpolate({
                    inputRange: [(i - 1) * 0.3, i * 0.3, (i + 1) * 0.3],
                    outputRange: [0, 8, 0],
                  })
                }
              ] as unknown as TransformsStyle['transform']}
            />
          ))}
        </>
      )}

      {/* Sun behind cloud */}
      {condition === 'cloudy' && (
        <Circle
          cx={18}
          cy={6}
          r={4}
          stroke={color}
          strokeWidth={2}
          fill="none"
        />
      )}

      {/* Lightning */}
      {condition === 'stormy' && animated && (
        <Path
          d="M13 12l-1 4 1-1 1 4-2-4 1-1"
          stroke={enhancedColors.neon.gold}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          opacity={phase.interpolate({
            inputRange: [0, 0.2, 0.3, 1],
            outputRange: [0, 1, 0, 0],
          }) as unknown as number}
        />
      )}
    </BaseAnimatedIcon>
  );
}

/**
 * 3D Calendar/Date Icon
 */
export function CalendarIcon({
  size = ICON_SIZE,
  color = enhancedColors.cyan.base,
  style,
  animated = true,
  onPress,
}: AnimatedIconProps) {
  const pagePhase = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    if (!animated) return;

    const loop = Animated.sequence([
      Animated.timing(pagePhase, {
        toValue: 1,
        duration: 1500,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.delay(2000),
      Animated.timing(pagePhase, {
        toValue: 0,
        duration: 800,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.delay(1000),
    ]);

    const loopForever = Animated.loop(loop);
    loopForever.start();
    return () => loopForever.stop();
  }, [animated, pagePhase]);

  const pageTranslate = pagePhase.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -8],
  });

  return (
    <BaseAnimatedIcon
      size={size}
      style={style}
      animated={animated}
      onPress={onPress}
    >
      {/* Calendar base */}
      <Path
        d="M8 2v4M16 2v4M3 10h18M3 10v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V10"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Animated page flip */}
      <Path
        d="M8 14h8M8 18h5"
        stroke={enhancedColors.cyan.light}
        strokeWidth={1.5}
        strokeLinecap="round"
        transform={[{ translateY: pageTranslate }] as unknown as TransformsStyle['transform']}
        opacity={pagePhase.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) as unknown as number}
      />
    </BaseAnimatedIcon>
  );
}

/**
 * 3D Clock/Time Icon
 */
export function ClockIcon({
  size = ICON_SIZE,
  color = enhancedColors.cyan.base,
  style,
  animated = true,
  onPress,
}: AnimatedIconProps) {
  const timePhase = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    if (!animated) return;

    const loop = Animated.loop(
      Animated.timing(timePhase, {
        toValue: 1,
        duration: 60000, // 1 minute for full rotation
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [animated, timePhase]);

  // Hour and minute hands
  const hourRotate = timePhase.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const minuteRotate = timePhase.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '4320deg'], // 12x speed
  });

  return (
    <BaseAnimatedIcon
      size={size}
      style={style}
      animated={animated}
      onPress={onPress}
    >
      {/* Clock face */}
      <Circle
        cx={12}
        cy={12}
        r={10}
        stroke={color}
        strokeWidth={2}
        fill="none"
      />

      {/* Hour hand */}
      <Path
        d="M12 12v-4"
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
        transform={[{ rotate: hourRotate }] as unknown as TransformsStyle['transform']}
      />

      {/* Minute hand */}
      <Path
        d="M12 12v-6"
        stroke={enhancedColors.cyan.light}
        strokeWidth={1.5}
        strokeLinecap="round"
        transform={[{ rotate: minuteRotate }] as unknown as TransformsStyle['transform']}
      />

      {/* Center dot */}
      <Circle
        cx={12}
        cy={12}
        r={2}
        fill={color}
      />
    </BaseAnimatedIcon>
  );
}

/**
 * 3D Search Icon
 */
export function SearchIcon({
  size = ICON_SIZE,
  color = enhancedColors.cyan.base,
  style,
  animated = true,
  onPress,
}: AnimatedIconProps) {
  const pulsePhase = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    if (!animated) return;

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulsePhase, {
          toValue: 1,
          duration: 2000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(pulsePhase, {
          toValue: 0,
          duration: 2000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [animated, pulsePhase]);

  const ringScale = pulsePhase.interpolate({
    inputRange: [0, 1],
    outputRange: [0.9, 1.1],
  });

  return (
    <BaseAnimatedIcon
      size={size}
      style={style}
      animated={animated}
      onPress={onPress}
    >
      {/* Search circle */}
      <G transform={[{ scale: ringScale }] as unknown as TransformsStyle['transform']}>
        <Circle
          cx={11}
          cy={11}
          r={7}
          stroke={color}
          strokeWidth={2}
          fill="none"
        />
      </G>

      {/* Handle */}
      <Path
        d="M21 21l-4.35-4.35"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />

      {/* Focus indicator */}
      <Circle
        cx={11}
        cy={11}
        r={8}
        stroke={enhancedColors.cyan.light}
        strokeWidth={1}
        fill="none"
        opacity={pulsePhase.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0] }) as unknown as number}
      />
    </BaseAnimatedIcon>
  );
}

/**
 * 3D Plus/Add Icon
 */
export function PlusIcon({
  size = ICON_SIZE,
  color = enhancedColors.cyan.base,
  style,
  animated = true,
  onPress,
}: AnimatedIconProps) {
  const rotatePhase = useMemo(() => new Animated.Value(0), []);
  const scalePhase = useMemo(() => new Animated.Value(1), []);

  useEffect(() => {
    if (!animated) return;

    const loop = Animated.sequence([
      Animated.parallel([
        Animated.timing(rotatePhase, {
          toValue: 1,
          duration: 1000,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(scalePhase, {
          toValue: 1.15,
          duration: 500,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(scalePhase, {
          toValue: 1,
          duration: 500,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(2000),
    ]);

    const loopForever = Animated.loop(loop);
    loopForever.start();
    return () => loopForever.stop();
  }, [animated, rotatePhase, scalePhase]);

  const rotate = rotatePhase.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '90deg'],
  });

  return (
    <BaseAnimatedIcon
      size={size}
      style={style}
      animated={animated}
      onPress={onPress}
    >
      <G transform={[{ scale: scalePhase }, { rotate }] as unknown as TransformsStyle['transform']}>
        <Path
          d="M12 5v14M5 12h14"
          stroke={color}
          strokeWidth={2.5}
          strokeLinecap="round"
        />
      </G>
    </BaseAnimatedIcon>
  );
}

/**
 * 3D Trash/Delete Icon
 */
export function TrashIcon({
  size = ICON_SIZE,
  color = enhancedColors.state.error,
  style,
  animated = true,
  onPress,
}: AnimatedIconProps) {
  const lidPhase = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    if (!animated) return;

    const loop = Animated.sequence([
      Animated.timing(lidPhase, {
        toValue: 1,
        duration: 800,
        easing: Easing.out(Easing.back(1.5)),
        useNativeDriver: true,
      }),
      Animated.delay(1000),
      Animated.timing(lidPhase, {
        toValue: 0,
        duration: 500,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.delay(2000),
    ]);

    const loopForever = Animated.loop(loop);
    loopForever.start();
    return () => loopForever.stop();
  }, [animated, lidPhase]);

  const lidRotate = lidPhase.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '-45deg'],
  });

  const lidTranslateY = lidPhase.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -6],
  });

  return (
    <BaseAnimatedIcon
      size={size}
      style={style}
      animated={animated}
      onPress={onPress}
    >
      {/* Trash can body */}
      <Path
        d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />

      {/* Lid */}
      <G
        transform={[
          { translateY: lidTranslateY },
          { rotate: lidRotate },
        ] as unknown as TransformsStyle['transform']}
      >
        <Path
          d="M10 4v-2M14 4v-2"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
        />
        <Path
          d="M7 4h10"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
        />
      </G>
    </BaseAnimatedIcon>
  );
}

/**
 * 3D Menu Icon (Hamburger)
 */
export function MenuIcon({
  size = ICON_SIZE,
  color = enhancedColors.cyan.base,
  style,
  animated = true,
  active = false,
  onPress,
}: AnimatedIconProps & { active?: boolean }) {
  const phase = useMemo(() => new Animated.Value(active ? 1 : 0), [active]);

  useEffect(() => {
    if (!animated) return;

    Animated.timing(phase, {
      toValue: active ? 1 : 0,
      duration: 400,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [active, phase, animated]);

  const topRotate = phase.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '45deg'],
  });

  const bottomRotate = phase.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '-45deg'],
  });

  const middleScale = phase.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0],
  });

  return (
    <BaseAnimatedIcon
      size={size}
      style={style}
      animated={animated}
      onPress={onPress}
    >
      <Path
        d="M3 6h18"
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
        transform={[{ rotate: topRotate }] as unknown as TransformsStyle['transform']}
      />
      <Path
        d="M3 12h18"
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
        transform={[{ scaleX: middleScale }]}
        opacity={middleScale as unknown as number}
      />
      <Path
        d="M3 18h18"
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
        transform={[{ rotate: bottomRotate }] as unknown as TransformsStyle['transform']}
      />
    </BaseAnimatedIcon>
  );
}

/**
 * 3D Shield/Security Icon
 */
export function ShieldIcon({
  size = ICON_SIZE,
  color = enhancedColors.cyan.base,
  style,
  animated = true,
  onPress,
}: AnimatedIconProps) {
  const pulsePhase = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    if (!animated) return;

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulsePhase, {
          toValue: 1,
          duration: 2000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(pulsePhase, {
          toValue: 0,
          duration: 2000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [animated, pulsePhase]);

  const shieldScale = pulsePhase.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.08],
  });

  const checkScale = pulsePhase.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0, 1.2, 1],
  });

  return (
    <BaseAnimatedIcon
      size={size}
      style={style}
      animated={animated}
      onPress={onPress}
    >
      <G transform={[{ scale: shieldScale }] as unknown as TransformsStyle['transform']}>
        {/* Shield outline */}
        <Path
          d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />

        {/* Check mark */}
        <Path
          d="M9 12l2 2 4-4"
          stroke={enhancedColors.state.success}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          transform={[{ scale: checkScale }] as unknown as TransformsStyle['transform']}
        />
      </G>
    </BaseAnimatedIcon>
  );
}

/**
 * 3D Play/Pause Toggle Icon
 */
export function PlayPauseIcon({
  size = ICON_SIZE,
  color = enhancedColors.cyan.base,
  style,
  animated = true,
  playing = false,
  onPress,
}: AnimatedIconProps & { playing?: boolean }) {
  const phase = useMemo(() => new Animated.Value(playing ? 1 : 0), [playing]);

  useEffect(() => {
    if (!animated) return;

    Animated.timing(phase, {
      toValue: playing ? 1 : 0,
      duration: 400,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [playing, phase, animated]);

  const bar1Scale = phase.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0],
  });

  const bar2Scale = phase.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0],
  });

  const playScale = phase.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  return (
    <BaseAnimatedIcon
      size={size}
      style={style}
      animated={animated}
      onPress={onPress}
    >
      {/* Pause bars */}
      <Path
        d="M8 5v14"
        stroke={color}
        strokeWidth={3}
        strokeLinecap="round"
        transform={[{ scaleX: bar1Scale }] as unknown as TransformsStyle['transform']}
        opacity={bar1Scale as unknown as number}
      />
      <Path
        d="M16 5v14"
        stroke={color}
        strokeWidth={3}
        strokeLinecap="round"
        transform={[{ scaleX: bar2Scale }] as unknown as TransformsStyle['transform']}
        opacity={bar2Scale as unknown as number}
      />

      {/* Play triangle */}
      <Path
        d="M8 5l11 7-11 7z"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={color}
        transform={[{ scale: playScale }] as unknown as TransformsStyle['transform']}
        opacity={playScale as unknown as number}
      />
    </BaseAnimatedIcon>
  );
}

/**
 * 3D Moon/Sleep Icon
 */
export function MoonIcon({
  size = ICON_SIZE,
  color = enhancedColors.cyan.base,
  style,
  animated = true,
  onPress,
}: AnimatedIconProps) {
  const floatPhase = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    if (!animated) return;

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(floatPhase, {
          toValue: 1,
          duration: 4000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(floatPhase, {
          toValue: 0,
          duration: 4000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [animated, floatPhase]);

  const float = floatPhase.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -4],
  });

  return (
    <BaseAnimatedIcon
      size={size}
      style={style}
      animated={animated}
      onPress={onPress}
    >
      <G transform={[{ translateY: float }]}>
        {/* Moon crescent */}
        <Path
          d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />

        {/* Stars */}
        <Path
          d="M15 6l1 2 3 0-2 1.5 0.5 3-2.5-1.5-2.5 1.5 0.5-3-2-1.5 3 0"
          stroke={enhancedColors.neon.gold}
          strokeWidth={1}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill={enhancedColors.neon.gold}
          opacity={0.8}
        />
      </G>
    </BaseAnimatedIcon>
  );
}

/**
 * 3D Sun Icon
 */
export function SunIcon({
  size = ICON_SIZE,
  color = enhancedColors.neon.gold,
  style,
  animated = true,
  onPress,
}: AnimatedIconProps) {
  const rotatePhase = useMemo(() => new Animated.Value(0), []);
  const pulsePhase = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    if (!animated) return;

    const loop = Animated.loop(
      Animated.timing(rotatePhase, {
        toValue: 1,
        duration: 20000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [animated, rotatePhase]);

  useEffect(() => {
    if (!animated) return;

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulsePhase, {
          toValue: 1,
          duration: 2000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(pulsePhase, {
          toValue: 0,
          duration: 2000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [animated, pulsePhase]);

  const rotate = rotatePhase.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const coreScale = pulsePhase.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.1],
  });

  return (
    <BaseAnimatedIcon
      size={size}
      style={style}
      animated={animated}
      onPress={onPress}
    >
      <G transform={[{ rotate }] as unknown as TransformsStyle['transform']}>
        {/* Sun rays */}
        {[...Array(12)].map((_, i) => (
          <Path
            key={i}
            d="M12 2v2M12 20v2M2 12h2M20 12h2"
            stroke={color}
            strokeWidth={1.5}
            strokeLinecap="round"
            transform={[{ rotate: `${i * 30}deg` }] as unknown as TransformsStyle['transform']}
            opacity={pulsePhase.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) as unknown as number}
          />
        ))}
      </G>

      {/* Sun core */}
      <Circle
        cx={12}
        cy={12}
        r={5}
        fill={color}
        opacity={0.9}
        transform={[{ scale: coreScale }] as unknown as TransformsStyle['transform']}
      />

      {/* Inner glow */}
      <Circle
        cx={12}
        cy={12}
        r={6}
        stroke={color}
        strokeWidth={1}
        fill="none"
        opacity={pulsePhase.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.6] }) as unknown as number}
      />
    </BaseAnimatedIcon>
  );
}

/**
 * 3D Person/Profile Icon
 */
export function PersonIcon({
  size = ICON_SIZE,
  color = enhancedColors.cyan.base,
  style,
  animated = true,
  onPress,
}: AnimatedIconProps) {
  const bouncePhase = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    if (!animated) return;

    const loop = Animated.sequence([
      Animated.timing(bouncePhase, {
        toValue: 1,
        duration: 1500,
        easing: Easing.out(Easing.elastic(0.8)),
        useNativeDriver: true,
      }),
      Animated.delay(3000),
      Animated.timing(bouncePhase, {
        toValue: 0,
        duration: 800,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);

    const loopForever = Animated.loop(loop);
    loopForever.start();
    return () => loopForever.stop();
  }, [animated, bouncePhase]);

  const headScale = bouncePhase.interpolate({
    inputRange: [0, 0.3, 1],
    outputRange: [1, 1.1, 1],
  });

  const headTranslateY = bouncePhase.interpolate({
    inputRange: [0, 0.3, 1],
    outputRange: [0, -3, 0],
  });

  return (
    <BaseAnimatedIcon
      size={size}
      style={style}
      animated={animated}
      onPress={onPress}
    >
      {/* Body */}
      <Path
        d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />

      {/* Head */}
      <G transform={[
        { translateY: headTranslateY },
        { scale: headScale },
      ] as unknown as TransformsStyle['transform']}>
        <Circle
          cx={12}
          cy={8}
          r={4}
          stroke={color}
          strokeWidth={2}
          fill="none"
        />
      </G>
    </BaseAnimatedIcon>
  );
}

/**
 * 3D Chat/Message Bubble Icon
 */
export function ChatIcon({
  size = ICON_SIZE,
  color = enhancedColors.cyan.base,
  style,
  animated = true,
  hasNewMessage = false,
  onPress,
}: AnimatedIconProps & { hasNewMessage?: boolean }) {
  const bubblePhase = useMemo(() => new Animated.Value(0), []);
  const dotPhase = useMemo(() => new Animated.Value(0), []);

  // Bubble animation
  useEffect(() => {
    if (!animated) return;

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bubblePhase, {
          toValue: 1,
          duration: 2000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(bubblePhase, {
          toValue: 0,
          duration: 2000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [animated, bubblePhase]);

  // New message indicator
  useEffect(() => {
    if (!animated || !hasNewMessage) return;

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(dotPhase, {
          toValue: 1,
          duration: 500,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(dotPhase, {
          toValue: 0,
          duration: 500,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [hasNewMessage, dotPhase, animated]);

  const bubbleScale = bubblePhase.interpolate({
    inputRange: [0, 1],
    outputRange: [0.95, 1.03],
  });

  return (
    <BaseAnimatedIcon
      size={size}
      style={style}
      animated={animated}
      onPress={onPress}
    >
      {/* Speech bubble */}
      <G transform={[{ scale: bubbleScale }] as unknown as TransformsStyle['transform']}>
        <Path
          d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </G>

      {/* Three dots inside bubble */}
      <G>
        {[1, 2, 3].map((i) => (
          <Circle
            key={i}
            cx={8 + i * 3}
            cy={14}
            r={1.5}
            fill={color}
            opacity={bubblePhase.interpolate({
              inputRange: [(i - 1) * 0.3, i * 0.3],
              outputRange: [0.3, 1],
            }) as unknown as number}
            transform={[
              {
                scale: bubblePhase.interpolate({
                  inputRange: [(i - 1) * 0.3, i * 0.3, (i + 1) * 0.3],
                  outputRange: [0.5, 1, 0.5],
                })
              }
            ]}
          />
        ))}
      </G>

      {/* New message indicator */}
      {hasNewMessage && (
        <Circle
          cx={20}
          cy={6}
          r={3.5}
          fill={enhancedColors.state.success}
          transform={[{ scale: dotPhase.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.2] }) }]}
          opacity={dotPhase.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) as unknown as number}
        />
      )}
    </BaseAnimatedIcon>
  );
}

// ============================================================
// ICON GROUP / COMPOSITE COMPONENTS
// ============================================================

/**
 * Bottom navigation bar with animated icons
 */
export function AnimatedBottomNav({
  activeIndex = 0,
  onPress,
  style,
}: {
  activeIndex: number;
  onPress: (index: number) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const icons = [
    { Icon: HomeIcon, label: 'InÃ­cio' },
    { Icon: ChatIcon, label: 'Chat' },
    { Icon: RadioIcon, label: 'MÃ­dia' },
    { Icon: SettingsIcon, label: 'Config' },
  ];

  return (
    <Animated.View
      style={[
        styles.bottomNav,
        style,
      ]}
    >
      {icons.map(({ Icon, label }, index) => (
        <Animated.View key={index} style={styles.navItem}>
          <Icon
            size={26}
            color={activeIndex === index ? enhancedColors.cyan.base : enhancedColors.text.muted}
            animated={true}
            active={activeIndex === index}
            onPress={() => onPress(index)}
          />
          <Animated.Text
            style={[
              styles.navLabel,
              {
                opacity: activeIndex === index ? 1 : 0.6,
                color: activeIndex === index ? enhancedColors.cyan.base : enhancedColors.text.muted,
              },
            ]}
          >
            {label}
          </Animated.Text>
        </Animated.View>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bottomNav: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: enhancedColors.glass.strong,
    borderTopWidth: 1,
    borderTopColor: enhancedColors.glassBorder,
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    ...shadows.strong,
  },
  navItem: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  navLabel: {
    fontSize: 10,
    fontWeight: '500',
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
