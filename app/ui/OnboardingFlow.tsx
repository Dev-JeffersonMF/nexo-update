import { useCallback, useState } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import { WelcomeScreen } from './WelcomeScreen';
import { PermissionsScreen } from './PermissionsScreen';
import { saveProfileName } from '../services/nexusProfile';

/**
 * Fluxo de primeira execução: boas-vindas (nome) → permissões → app.
 *
 * A troca de telas é um crossfade curto em vez de um corte seco, para o app não
 * parecer que "piscou". O nome é salvo assim que a primeira tela termina, então
 * fechar o app no meio das permissões não perde o que já foi respondido.
 */
export function OnboardingFlow({
  initialName = '',
  onFinish,
}: {
  initialName?: string;
  onFinish: (name: string) => void;
}) {
  const [step, setStep] = useState<'welcome' | 'permissions'>(
    initialName ? 'permissions' : 'welcome',
  );
  const [name, setName] = useState(initialName);
  const [fade] = useState(() => new Animated.Value(1));

  const crossFadeTo = useCallback(
    (next: 'welcome' | 'permissions') => {
      Animated.timing(fade, {
        toValue: 0,
        duration: 200,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start(() => {
        setStep(next);
        Animated.timing(fade, {
          toValue: 1,
          duration: 260,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }).start();
      });
    },
    [fade],
  );

  const handleName = useCallback(
    (value: string) => {
      setName(value);
      // Salva já: se o app fechar durante as permissões, o nome não se perde.
      void saveProfileName(value);
      crossFadeTo('permissions');
    },
    [crossFadeTo],
  );

  return (
    <Animated.View style={[styles.fill, { opacity: fade }]}>
      {step === 'welcome' ? (
        <WelcomeScreen initialName={name} onDone={handleName} />
      ) : (
        <PermissionsScreen userName={name} onFinish={() => onFinish(name)} />
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
