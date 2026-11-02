/**
 * Smooth transitions and micro-interactions for Nexus UI
 * Enhanced animations with 3D perspective and fluid motion
 */
import { useRef, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

/**
 * Enhanced fade/slide transition with spring physics
 */
export function SmoothFadeIn({
  children,
  delay = 0,
  offset = 20,
  duration = 500,
  style,
  onShow,
  onHide,
}: {
  children: ReactNode;
  delay?: number;
  offset?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
  onShow?: () => void;
  onHide?: () => void;
}) {
  const progress = useMemo(() => new Animated.Value(0), []);
  const scale = useMemo(() => new Animated.Value(0.92), []);

  useEffect(() => {
    const anim = Animated.parallel([
      Animated.timing(progress, {
        toValue: 1,
        duration,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1,
        friction: 8,
        tension: 50,
        useNativeDriver: true,
      }),
    ]);

    anim.start(({ finished }) => {
      if (finished && onShow) onShow();
    });

    return () => anim.stop();
  }, [delay, duration, onShow, progress, scale]);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [offset, 0],
  });

  const opacity = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  return (
    <Animated.View
      style={[
        style,
        {
          opacity,
          transform: [{ translateY }, { scale }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * 3D flip/cross-fade transition
 */
export function ThreeDFlip({
  children,
  visible = true,
  duration = 600,
  style,
}: {
  children: ReactNode;
  visible?: boolean;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const progress = useMemo(() => new Animated.Value(visible ? 1 : 0), [visible]);

  useEffect(() => {
    Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [duration, progress, visible]);

  const rotateY = progress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ['180deg', '90deg', '0deg'],
  });

  const opacity = progress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0, 0, 1],
  });

  return (
    <Animated.View
      style={[
        style,
        {
          opacity,
          transform: [{ perspective: 1000 }, { rotateY }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * Bouncing entrance with overshoot
 */
export function BounceIn({
  children,
  delay = 0,
  style,
  onShow,
}: {
  children: ReactNode;
  delay?: number;
  style?: StyleProp<ViewStyle>;
  onShow?: () => void;
}) {
  const scale = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    const anim = Animated.spring(scale, {
      toValue: 1,
      friction: 5,
      tension: 80,
      useNativeDriver: true,
    });

    anim.start(({ finished }) => {
      if (finished && onShow) onShow();
    });

    return () => anim.stop();
  }, [onShow, scale]);

  return (
    <Animated.View
      style={[
        style,
        {
          transform: [{ scale }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * Continuous floating animation
 */
export function FloatingContainer({
  children,
  amplitude = 8,
  duration = 3000,
  style,
}: {
  children: ReactNode;
  amplitude?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const floatAnim = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, {
          toValue: 1,
          duration: duration / 2,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(floatAnim, {
          toValue: 0,
          duration: duration / 2,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    loop.start();
    return () => loop.stop();
  }, [duration, floatAnim]);

  const translateY = floatAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -amplitude],
  });

  return (
    <Animated.View
      style={[
        style,
        {
          transform: [{ translateY }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * Parallax scroll effect
 */
export function ParallaxContainer({
  children,
  scrollY,
  factor = 0.5,
}: {
  children: ReactNode;
  scrollY: Animated.Value;
  factor?: number;
}) {
  const translateY = scrollY.interpolate({
    inputRange: [0, 100],
    outputRange: [0, -100 * factor],
    extrapolate: 'clamp',
  });

  return (
    <Animated.View
      style={{
        transform: [{ translateY }],
      }}
    >
      {children}
    </Animated.View>
  );
}

/**
 * Staggered entrance for lists
 */
export function StaggerContainer({
  children,
  staggerDelay = 80,
  style,
}: {
  children: ReactNode[];
  staggerDelay?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const childrenArray = Array.isArray(children) ? children : [children];

  return (
    <Animated.View style={style}>
      {childrenArray.map((child, index) => (
        <SmoothFadeIn
          key={index}
          delay={index * staggerDelay}
        >
          {child}
        </SmoothFadeIn>
      ))}
    </Animated.View>
  );
}

/**
 * Glow/pulse effect for buttons and highlights
 */
export function GlowingContainer({
  children,
  active = false,
  glowColor = '#3ED8EC',
  style,
}: {
  children: ReactNode;
  active?: boolean;
  glowColor?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const glowAnim = useMemo(() => new Animated.Value(active ? 1 : 0), [active]);

  useEffect(() => {
    if (!active) return;

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, {
          toValue: 0.8,
          duration: 1000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
        Animated.timing(glowAnim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
      ]),
    );

    loop.start();
    return () => loop.stop();
  }, [active, glowAnim]);

  const shadowOpacity = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.15, 0.45],
  });

  return (
    <Animated.View
      style={[
        style,
        {
          shadowColor: glowColor,
          shadowOpacity,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: 0 },
          elevation: 10,
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * Springy pressable effect
 */
export function SpringPressable({
  children,
  onPress,
  disabled = false,
  style,
}: {
  children: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const scale = useMemo(() => new Animated.Value(1), []);

  const handlePressIn = useCallback(() => {
    if (disabled) return;
    Animated.spring(scale, {
      toValue: 0.96,
      friction: 7,
      tension: 80,
      useNativeDriver: true,
    }).start();
  }, [disabled, scale]);

  const handlePressOut = useCallback(() => {
    if (disabled) return;
    Animated.spring(scale, {
      toValue: 1,
      friction: 7,
      tension: 80,
      useNativeDriver: true,
    }).start();
    onPress?.();
  }, [disabled, onPress, scale]);

  return (
    <Animated.View style={[style, { transform: [{ scale }] }]}>
      {/* Wrapper for touch handling */}
      <Animated.View
        style={{ transform: [{ scale }] }}
        // Touch handling would need a Pressable wrapper
        // This is a visual component only
      >
        {children}
      </Animated.View>
    </Animated.View>
  );
}