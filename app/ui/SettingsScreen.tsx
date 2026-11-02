import { useEffect, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Check } from 'lucide-react-native';
import { loadProfile, saveProfileAvatar } from '../services/nexusProfile';
import { colors, font, radius, spacing } from './theme';
import { FadeSlideIn } from './motion';

const NEXUS_AVATAR = require('../../assets/mascote-ocioso.png');
const TRATIS_AVATAR = require('../../assets/tratis-icon.png');

type AvatarOption = 'nexus' | 'tratis';

const AVATAR_OPTIONS: { id: AvatarOption; name: string; description: string; preview: ImageSourcePropType }[] = [
  {
    id: 'nexus',
    name: 'Nexus',
    description: 'O mascote original do Nexus — coruja animada com expressões',
    preview: NEXUS_AVATAR,
  },
  {
    id: 'tratis',
    name: 'TRATIS (FemVerity)',
    description: 'A companheira FemVerity — personalidade yandere carinhosa e protetora',
    preview: TRATIS_AVATAR,
  },
];

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const [selectedAvatar, setSelectedAvatar] = useState<AvatarOption>('nexus');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const profile = await loadProfile();
      setSelectedAvatar(profile.avatar ?? 'nexus');
      setLoading(false);
    })();
  }, []);

  const handleAvatarSelect = async (avatar: AvatarOption) => {
    if (avatar === selectedAvatar) return;
    try {
      await saveProfileAvatar(avatar);
      setSelectedAvatar(avatar);
      Alert.alert('Salvo!', `Avatar "${avatar === 'nexus' ? 'Nexus' : 'TRATIS'}" selecionado.`);
    } catch {
      Alert.alert('Erro', 'Não foi possível salvar a preferência. Tente novamente.');
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingCenter}>
          <Text style={styles.loadingText}>Carregando configurações...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.backButton} accessibilityLabel="Voltar">
          <ChevronLeft size={28} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Aparência do Mascote</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>Escolha seu mascote</Text>
        <Text style={styles.sectionSubtitle}>
          Toque em uma opção para selecionar. A mudança é aplicada instantaneamente e salva automaticamente.
        </Text>

        {AVATAR_OPTIONS.map((option, index) => (
          <FadeSlideIn key={option.id} offset={20} duration={300} delay={index * 100}>
            <Pressable
              onPress={() => handleAvatarSelect(option.id)}
              style={[
                styles.avatarCard,
                selectedAvatar === option.id && styles.avatarCardSelected,
              ]}
              android_ripple={{ color: `${colors.accent}33` }}
            >
              <View style={styles.avatarPreview}>
                <Image
                  source={option.preview}
                  style={styles.avatarImage}
                  resizeMode="contain"
                />
                {selectedAvatar === option.id && (
                  <View style={styles.checkBadge}>
                    <Check size={24} color={colors.background} />
                  </View>
                )}
              </View>
              <View style={styles.avatarInfo}>
                <Text style={[
                  styles.avatarName,
                  selectedAvatar === option.id && styles.avatarNameSelected,
                ]}>
                  {option.name}
                </Text>
                <Text style={styles.avatarDescription}>{option.description}</Text>
              </View>
            </Pressable>
          </FadeSlideIn>
        ))}

        <View style={styles.divider} />

        <Text style={styles.sectionTitle}>Sobre os mascotes</Text>
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>🦉 Nexus (Padrão)</Text>
          <Text style={styles.infoText}>
            A coruja animada original do Nexus. Possui 4 estados de humor (ocioso, ouvindo, pensando, falando),
            animações de respiração, flutuação e brilho nas antenas. Entra em modo sono após um tempo parada.
          </Text>
          <Text style={{ ...styles.infoTitle, marginTop: spacing.md }}>🌙 TRATIS (FemVerity)</Text>
          <Text style={styles.infoText}>
            A companheira FemVerity do mod Minecraft. Personalidade inspirada em yandere: carinhosa, ciumenta
            e protetora. Evolui através de 4 estágios de relacionamento (tímido → afetuoso → ciumento → possessivo).
            Reage ao seu tratamento: gentileza aumenta afeição, insultos a reduzem.
          </Text>
        </View>

        <View style={styles.divider} />

        <Text style={styles.sectionTitle}>Dicas</Text>
        <View style={styles.tipsList}>
          {[
            'A seleção é salva automaticamente nas preferências do app',
            'Funciona mesmo após reiniciar o celular',
            'O mascote flutuante (fora do app) também usa a arte selecionada',
            'Para voltar ao Nexus, basta abrir Configurações e tocar nele',
          ].map((tip, i) => (
            <Text key={i} style={styles.tipItem}>• {tip}</Text>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: font.body,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.glassBorder,
    backgroundColor: colors.glassStrong,
  },
  backButton: {
    padding: spacing.sm,
  },
  title: {
    fontSize: font.xl,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.xl,
  },
  sectionTitle: {
    fontSize: font.lg,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  sectionSubtitle: {
    fontSize: font.small,
    color: colors.textMuted,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  avatarCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.glassStrong,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 2,
    borderColor: colors.glassBorder,
    gap: spacing.md,
  },
  avatarCardSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.cyanSoft,
  },
  avatarPreview: {
    position: 'relative',
    width: 72,
    height: 72,
    borderRadius: radius.md,
    backgroundColor: colors.backgroundElevated,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: 64,
    height: 64,
  },
  checkBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInfo: {
    flex: 1,
  },
  avatarName: {
    fontSize: font.lg,
    fontWeight: '700',
    color: colors.text,
  },
  avatarNameSelected: {
    color: colors.accent,
  },
  avatarDescription: {
    fontSize: font.small,
    color: colors.textMuted,
    marginTop: 2,
    lineHeight: 18,
  },
  divider: {
    height: 1,
    backgroundColor: colors.glassBorder,
    marginVertical: spacing.md,
  },
  infoCard: {
    backgroundColor: colors.glassStrong,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    gap: spacing.sm,
  },
  infoTitle: {
    fontSize: font.body,
    fontWeight: '700',
    color: colors.text,
  },
  infoText: {
    fontSize: font.small,
    color: colors.textSoft,
    lineHeight: 20,
  },
  tipsList: {
    gap: spacing.sm,
  },
  tipItem: {
    fontSize: font.small,
    color: colors.textSoft,
    lineHeight: 20,
  },
});