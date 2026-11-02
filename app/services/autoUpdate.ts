// Auto-Update System for NexusAssistente
// Verifica atualizações no GitHub Releases e instala automaticamente

import { Platform, Alert, Linking } from 'react-native';
import { nexusNative, isNativeAvailable } from './nexusNative';

const GITHUB_REPO_OWNER = 'seu-usuario';
const GITHUB_REPO_NAME = 'NexusAssistente-Releases';
const CURRENT_VERSION = '1.2.0'; // Atualizar manualmente ou via build script

export interface UpdateInfo {
  available: boolean;
  version: string;
  releaseNotes: string;
  downloadUrl: string;
  forceUpdate: boolean;
}

export class AutoUpdateService {
  private static instance: AutoUpdateService;
  private checkInterval: ReturnType<typeof setInterval> | null = null;

  static getInstance(): AutoUpdateService {
    if (!AutoUpdateService.instance) {
      AutoUpdateService.instance = new AutoUpdateService();
    }
    return AutoUpdateService.instance;
  }

  // Verifica se há atualização disponível no GitHub
  async checkForUpdates(): Promise<UpdateInfo | null> {
    if (Platform.OS !== 'android') return null;
    if (!isNativeAvailable()) return null;

    try {
      const response = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases/latest`,
        {
          headers: {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'NexusAssistente-AutoUpdate',
          },
        }
      );

      if (!response.ok) {
        console.warn('[AutoUpdate] Falha ao verificar atualizações:', response.status);
        return null;
      }

      const release = await response.json();
      const latestVersion = release.tag_name.replace('v', '');
      const currentVersion = CURRENT_VERSION;

      if (this.isNewerVersion(latestVersion, currentVersion)) {
        const apkAsset = release.assets.find((asset: any) => 
          asset.name.endsWith('.apk') && asset.name.includes('release')
        );

        return {
          available: true,
          version: latestVersion,
          releaseNotes: release.body || 'Novas melhorias e correções.',
          downloadUrl: apkAsset?.browser_download_url || release.html_url,
          forceUpdate: false, // Definir true se for update crítico
        };
      }

      return { available: false, version: currentVersion, releaseNotes: '', downloadUrl: '', forceUpdate: false };
    } catch (error) {
      console.warn('[AutoUpdate] Erro ao verificar atualizações:', error);
      return null;
    }
  }

  private isNewerVersion(latest: string, current: string): boolean {
    const latestParts = latest.split('.').map(Number);
    const currentParts = current.split('.').map(Number);
    
    for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
      const l = latestParts[i] || 0;
      const c = currentParts[i] || 0;
      if (l > c) return true;
      if (l < c) return false;
    }
    return false;
  }

  // Baixa e instala o APK usando o módulo nativo
  async downloadAndInstall(updateInfo: UpdateInfo): Promise<boolean> {
    if (!isNativeAvailable()) return false;

    try {
      // Usa o módulo nativo para baixar e instalar
      const result = await nexusNative.downloadAndInstallApk(updateInfo.downloadUrl);
      return result.success === true;
    } catch (error) {
      console.warn('[AutoUpdate] Erro ao instalar atualização:', error);
      
      // Fallback: abrir no navegador
      await Linking.openURL(updateInfo.downloadUrl);
      return false;
    }
  }

  // Mostra dialog para o usuário
  async promptUpdate(updateInfo: UpdateInfo): Promise<void> {
    return new Promise((resolve) => {
      Alert.alert(
        'Atualização Disponível',
        `Versão ${updateInfo.version} disponível!\n\n${updateInfo.releaseNotes}`,
        [
          {
            text: updateInfo.forceUpdate ? 'Atualizar Agora' : 'Depois',
            onPress: () => resolve(),
            style: updateInfo.forceUpdate ? 'destructive' : 'cancel',
          },
          {
            text: 'Atualizar Agora',
            onPress: async () => {
              const success = await this.downloadAndInstall(updateInfo);
              if (!success) {
                Alert.alert('Erro', 'Não foi possível instalar automaticamente. Abrindo no navegador...');
              }
              resolve();
            },
          },
        ],
        { cancelable: !updateInfo.forceUpdate }
      );
    });
  }

  // Inicia verificação periódica (ex: a cada 24h)
  startPeriodicCheck(intervalHours: number = 24): void {
    if (this.checkInterval) return;

    // Verifica imediatamente
    this.performCheck();

    // Agenda verificações periódicas
    this.checkInterval = setInterval(() => {
      this.performCheck();
    }, intervalHours * 60 * 60 * 1000);
  }

  private async performCheck(): Promise<void> {
    const updateInfo = await this.checkForUpdates();
    if (updateInfo?.available) {
      await this.promptUpdate(updateInfo);
    }
  }

  stopPeriodicCheck(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }
}

// Hook para usar no App.tsx
export function useAutoUpdate() {
  const autoUpdate = AutoUpdateService.getInstance();

  return {
    checkNow: () => autoUpdate.checkForUpdates().then(info => info && autoUpdate.promptUpdate(info)),
    startPeriodic: (hours?: number) => autoUpdate.startPeriodicCheck(hours),
    stopPeriodic: () => autoUpdate.stopPeriodicCheck(),
  };
}

export default AutoUpdateService;