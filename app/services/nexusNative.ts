import { NativeModules, Platform, NativeEventEmitter } from 'react-native';

/**
 * Camada única de comunicação JS → nativo.
 *
 * Toda chamada é blindada: se o build Android não tiver o módulo nativo (ou o
 * método não existir), devolvemos um valor seguro em vez de derrubar o app.
 * Isso evita o antigo comportamento de "pedir build Android para tudo".
 */

const nativeModule: any = NativeModules?.NexusNativeModule ?? null;

if (!nativeModule && Platform.OS === 'android') {
  console.warn('[Nexus] Módulo nativo ausente. Instale o APK gerado pelo build Android.');
}

export const isNativeAvailable = (): boolean =>
  !!nativeModule && Platform.OS === 'android';

const eventEmitter =
  nativeModule && Platform.OS === 'android'
    ? new NativeEventEmitter(nativeModule)
    : null;

async function invoke<T>(method: string, args: unknown[], fallback: T): Promise<T> {
  const fn = nativeModule?.[method];
  if (typeof fn !== 'function') return fallback;
  try {
    const result = await fn(...args);
    return (result ?? fallback) as T;
  } catch (error) {
    console.warn(`[Nexus] Falha ao chamar ${method}:`, error);
    return fallback;
  }
}

export interface InstalledApp {
  packageName: string;
  appName: string;
  versionName: string;
  versionCode: number;
  isSystemApp: boolean;
  capabilities: {
    supportsWhatsAppMessaging: boolean;
    supportsWhatsAppCalls: boolean;
    supportsYouTubePlayback: boolean;
    supportsMediaControls: boolean;
    supportsRadioStreaming: boolean;
    supportsVoiceAssistant: boolean;
  };
}

export interface WeatherInfo {
  temperature: number;
  condition: string;
  humidity: number;
  windSpeed: number;
  cityName: string;
  /** `true` quando é a previsão de amanhã (e não o tempo de agora). */
  forecast?: boolean;
  /** Chance de chuva em % (só na previsão). */
  rainChance?: number;
}

export interface ContactResult {
  name: string;
  phoneNumber: string;
}

/** Perfil do usuário guardado no aparelho. */
export interface ProfileInfo {
  name: string;
  /** `true` quando o nome já foi informado (onboarding concluído). */
  configured: boolean;
  /** Avatar selecionado: 'nexus' (padrão) ou 'tratis' (FemVerity). */
  avatar?: 'nexus' | 'tratis';
}

/** Anotação guardada pelo Nexus. */
export interface NoteEntry {
  id: string;
  title: string;
  text: string;
  /** Instante de criação (epoch em milissegundos). */
  createdAt: number;
}

/** Lembrete/despertador guardado pelo Nexus. */
export interface ReminderEntry {
  id: string;
  title: string;
  description: string;
  /** Instante do próximo disparo (epoch em milissegundos). */
  triggerAtMillis: number;
  enabled: boolean;
  /** `true` quando repete todo dia no mesmo horário. */
  repeatDaily: boolean;
  createdAt: number;
  /** "lembrete" ou "alarme" — decide a tela que abre quando toca. */
  kind?: string;
  /** Só na resposta de `saveReminder`: o Android aceitou um alarme exato? */
  exact?: boolean;
}

/** Campos que podem ser alterados num lembrete existente. */
export interface ReminderPatch {
  title?: string;
  description?: string;
  triggerAtMillis?: number;
  enabled?: boolean;
  repeatDaily?: boolean;
}

export interface CommandResult {
  success: boolean;
  error?: string;
  contactName?: string;
  appName?: string;
  video?: boolean;
}

/** Resultado de um pedido de rádio (as emissoras tocam dentro do app). */
export interface RadioResult {
  success: boolean;
  /** Nome da emissora resolvida (ex.: "Itatiaia"). */
  stationName?: string;
  /** Cidade da emissora (todas de Minas Gerais). */
  city?: string;
  /** Motivo real da falha — usado para o Nexus avisar em vez de mentir. */
  error?: string;
  stopped?: boolean;
  paused?: boolean;
  /**
   * Aplicativo em que o controle de mídia agiu, quando não foi a rádio do Nexus
   * (ex.: "OiTube"). Vem preenchido nos controles de música de outro app.
   */
  appName?: string;
  /** Ação aplicada na música do outro app: `pause`, `play`, `next` ou `prev`. */
  mediaAction?: string;
}

/**
 * Volume do som na escala do Nexus.
 *
 * 0 = desligado, 1 a 3 = subindo, 4 = médio, 5 = máximo.
 */
export interface VolumeResult {
  success: boolean;
  /** Nível atual (0 a 5). */
  level: number;
  /** Teto da escala (sempre 5). */
  max: number;
  /** Motivo real da falha. */
  error?: string;
}

/** Resultado da pesquisa na internet feita pelo próprio Nexus. */
export interface WebSearchResult {
  /** A resposta, pronta para ser falada. */
  answer: string;
  /** O título do que foi encontrado. */
  title?: string;
  /** De onde veio ("Wikipédia", "Web"). */
  source?: string;
  /** O endereço, para o usuário conferir. */
  url?: string;
}

/** Resultado de "tocar música": informa se o vídeo realmente começou. */
export interface MusicResult extends CommandResult {
  /** `true` quando o Nexus mandou o player tocar o vídeo encontrado. */
  played?: boolean;
  /** Título encontrado na busca, quando disponível. */
  title?: string;
  videoId?: string;
}

/** Estado real do microfone, informado pelo motor nativo. */
export interface VoiceState {
  mode: 'off' | 'inApp' | 'floating' | string;
  phase: string;
  capturing: boolean;
}

/** Momento em que o microfone abriu e fechou para um pedido dentro do app. */
export interface VoiceCaptureEnd {
  reason: 'command' | 'silence' | 'timeout' | 'error' | 'unsupported' | string;
}

/**
 * Uma voz em português que o aparelho tem.
 *
 * `network` diz se ela precisa de internet: as locais respondem na hora e
 * funcionam offline — são as que o Nexus prefere.
 */
export interface DeviceVoice {
  /** Identificador da voz (o nome que o motor usa). */
  id: string;
  /** Idioma/país da voz (ex.: `pt_BR`). */
  locale: string;
  /** Qualidade da síntese: 0 normal, 1 alta, 2 muito alta. */
  quality: number;
  /** `true` quando a voz precisa de internet para falar. */
  network: boolean;
}

export type NexusEvent =
  | 'onCommandRecognized'
  | 'onVoiceStateChanged'
  | 'onCaptureEnded'
  | 'onRadioPlaying'
  | 'onRadioError'
  | 'onAssistantForeground'
  | 'onAssistantBackground'
  | 'onMascotTapped'
  | 'onNotificationReceived'
  | 'onReminderFired'
  | 'onAccessibilityStateChanged'
  | 'onWakeWordDetected'
  | 'onCallActionTaken';

/** Mensagem nova anunciada pelo serviço de notificações. */
export interface NotificationMessage {
  app: string;
  contact: string;
  message: string;
  /**
   * `missed-call` existe porque uma chamada perdida NÃO é uma chamada para
   * atender: o Nexus oferece ligar de volta, nunca "quer atender?".
   */
  type?: 'message' | 'voice-call' | 'video-call' | 'missed-call' | 'blocked-call';
  /** Só vem `true` quando o texto da notificação diz que é áudio. */
  isAudio?: boolean;
  /** Quando chegou (ms). Só existe nas notificações guardadas pelo nativo. */
  at?: number;
  /**
   * Origem da chamada: `whatsapp` ou `phone` (chip/SIM do aparelho).
   * Decide se o Nexus toca em "atender" pelo WhatsApp ou pelo TelecomManager.
   */
  callSource?: 'whatsapp' | 'phone';
  /** Número da chamada telefônica, quando disponível. */
  phoneNumber?: string;
}

class NexusNativeService {
  // ---------------------------------------------------------------------
  // Voz
  //
  // Duas portas separadas, nunca ligadas juntas:
  //  - `startDirectCapture`: o botão de microfone DENTRO do app. Uma captura do
  //    pedido, sem palavra de ativação;
  //  - `startFloatingListening`: só avisa que o mascote está na tela. Ele NÃO
  //    ouve sozinho — quem abre o microfone fora do app é o TOQUE nele.
  // ---------------------------------------------------------------------

  /**
   * Avisa o nativo de que o mascote está na tela.
   *
   * NÃO abre o microfone: não existe mais escuta passiva da palavra de ativação
   * (ela mantinha sessões de reconhecimento se abrindo em ciclo). O microfone do
   * mascote abre no toque dele.
   *
   * Só deve ser chamada quando o app está fora da frente, com microfone e
   * "Sobrepor outros apps" liberados (ver `voiceSessionPolicy`).
   */
  async startFloatingListening(): Promise<boolean> {
    return invoke<boolean>('startFloatingListening', [], false);
  }

  /** O botão de microfone: um toque = um comando, sem palavra de ativação. */
  async startDirectCapture(bias: string[] = []): Promise<boolean> {
    return invoke<boolean>('startDirectCapture', [bias], false);
  }

  /** Fecha o microfone em qualquer uma das modalidades. */
  async stopListening(): Promise<void> {
    await invoke('stopListening', [], null);
  }

  /**
   * Avisa o nativo que o Nexus está falando (ou parou).
   *
   * Chamado antes de cada resposta falada: o microfone fecha enquanto o assistente
   * fala, para o motor de voz não ouvir a própria resposta e não cortar a pergunta.
   */
  async setAssistantSpeaking(speaking: boolean): Promise<void> {
    await invoke('setAssistantSpeaking', [speaking], null);
  }

  /** Modalidade e fase atuais do microfone (fonte da verdade para a tela). */
  async getVoiceState(): Promise<VoiceState | null> {
    const fn = nativeModule?.getVoiceState;
    if (typeof fn !== 'function') return null;
    try {
      return (await fn()) ?? null;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------
  // A voz do Nexus
  //
  // A voz é a do PRÓPRIO APARELHO (pt-BR). O nativo é quem escolhe a melhor
  // voz disponível (a local e neural, quando existir) e ajusta o timbre;
  // o `expo-speech` fica como caminho genérico, para quando o nativo não
  // está disponível.
  // ---------------------------------------------------------------------

  /**
   * Fala o texto com a voz do aparelho.
   *
   * Devolve `true` quando a fala chegou ao fim. Sem módulo nativo (build sem
   * o código nativo) devolve `false`: o texto continua na tela.
   */
  async speakVoice(text: string): Promise<boolean> {
    return invoke<boolean>('speakVoice', [text], false);
  }

  /** Interrompe a fala. */
  async stopVoice(): Promise<void> {
    await invoke('stopVoice', [], null);
  }

  /**
   * As vozes em português que o aparelho tem.
   *
   * A primeira da lista é a que o Nexus usa. Serve para o app mostrar as
   * opções e para o diagnóstico (quando a voz não soa como o esperado).
   */
  async listVoices(): Promise<DeviceVoice[]> {
    const fn = nativeModule?.listVoices;
    if (typeof fn !== 'function') return [];
    try {
      const voices = (await fn()) ?? [];
      return Array.isArray(voices) ? (voices as DeviceVoice[]) : [];
    } catch {
      return [];
    }
  }

  /**
   * A pesquisa do Nexus: ele mesmo, na internet, sem abrir o navegador.
   *
   * Devolve a resposta pronta para ser falada. Quando nenhuma fonte responde,
   * vem `null` — o app avisa que não conseguiu, em vez de inventar.
   */
  async searchWeb(query: string): Promise<WebSearchResult | null> {
    const fn = nativeModule?.searchWeb;
    if (typeof fn !== 'function') return null;
    try {
      const result = await fn(query);
      if (!result || typeof result.answer !== 'string' || !result.answer.trim()) return null;
      return result as WebSearchResult;
    } catch {
      return null;
    }
  }

  /**
   * Instala a voz em português do Brasil no Android.
   *
   * O pacote de voz é o que estiver instalado no aparelho. Quando só existe a
   * voz "standard" — a que soa robótica —, é aqui que o usuário baixa a neural
   * (Cacilda, Katita, Maria, Yara). Depois de baixada, ela aparece como voz
   * local e o Nexus passa a usá-la sozinho.
   */
  async installVoiceData(): Promise<boolean> {
    return invoke<boolean>('installVoiceData', [], false);
  }

  // ---------------------------------------------------------------------
  // Mascote flutuante / janela
  // ---------------------------------------------------------------------
  /** Minimiza o assistente e mostra o mascote sobre os outros apps. */
  async summonMascot(): Promise<boolean> {
    return invoke<boolean>('summonMascot', [], false);
  }

  /**
   * Mostra o mascote sem mexer na janela do assistente.
   *
   * Usado quando o app já está em segundo plano (o usuário abriu outro app).
   */
  async showMascot(): Promise<boolean> {
    return invoke<boolean>('showMascot', [], false);
  }

  async hideMascot(): Promise<void> {
    await invoke('hideMascot', [], null);
  }

  async isMascotVisible(): Promise<boolean> {
    return invoke<boolean>('isMascotVisible', [], false);
  }

  async minimizeApp(): Promise<boolean> {
    return invoke<boolean>('minimizeApp', [], false);
  }

  async openAssistant(): Promise<boolean> {
    return invoke<boolean>('openAssistant', [], false);
  }

  // ---------------------------------------------------------------------
  // Detecção de apps
  // ---------------------------------------------------------------------
  async getInstalledApps(): Promise<InstalledApp[]> {
    return invoke<InstalledApp[]>('getInstalledApps', [], []);
  }

  async isPackageInstalled(packageName: string): Promise<boolean> {
    return invoke<boolean>('isPackageInstalled', [packageName], false);
  }

  async launchApp(packageName: string): Promise<boolean> {
    return invoke<boolean>('launchApp', [packageName], false);
  }

  async launchAppByName(name: string): Promise<CommandResult> {
    return invoke<CommandResult>('launchAppByName', [name], {
      success: false,
      error: 'Módulo nativo indisponível',
    });
  }

  // ---------------------------------------------------------------------
  // WhatsApp / chamadas
  // ---------------------------------------------------------------------
  async sendWhatsAppMessage(contactName: string, message: string): Promise<CommandResult> {
    return invoke<CommandResult>('sendWhatsAppMessage', [contactName, message], {
      success: false,
      error: 'Módulo nativo indisponível',
    });
  }

  /**
   * Apaga a ÚLTIMA mensagem enviada na conversa do contato (ou na conversa
   * aberta, quando o contato não é dito).
   *
   * O fluxo do apagar é sempre "apagar para todos" — nunca "só para mim".
   */
  async deleteLastSentMessage(contactName?: string): Promise<CommandResult> {
    return invoke<CommandResult>('deleteLastSentMessage', [contactName ?? ''], {
      success: false,
      error: 'Módulo nativo indisponível',
    });
  }

  async makeWhatsAppCall(contactName: string, isVideo: boolean): Promise<CommandResult> {
    return invoke<CommandResult>('makeWhatsAppCall', [contactName, isVideo], {
      success: false,
      error: 'Módulo nativo indisponível',
    });
  }

  async makeWhatsAppVideoCall(contactName: string): Promise<CommandResult> {
    return this.makeWhatsAppCall(contactName, true);
  }

  async makeLocalCall(contactNameOrNumber: string): Promise<CommandResult> {
    return invoke<CommandResult>('makeLocalCall', [contactNameOrNumber], {
      success: false,
      error: 'Módulo nativo indisponível',
    });
  }

  async openWhatsAppChat(phoneNumber: string): Promise<boolean> {
    return invoke<boolean>('openWhatsAppChat', [phoneNumber], false);
  }

  async searchContacts(query: string): Promise<ContactResult[]> {
    return invoke<ContactResult[]>('searchContacts', [query], []);
  }

  // WhatsApp: injeção de texto e chamadas via acessibilidade
  /**
   * Escreve e envia no chat do WhatsApp que já está aberto.
   *
   * Devolve o resultado real: `true` só quando o campo de mensagem esvaziou,
   * que é o sinal de que a mensagem saiu.
   */
  async sendWhatsAppMessageToOpenChat(message: string): Promise<boolean> {
    return invoke<boolean>('sendWhatsAppMessageToOpenChat', [message], false);
  }

  /** @deprecated use {@link sendWhatsAppMessageToOpenChat}; faz o mesmo fluxo. */
  async injectWhatsAppMessage(message: string): Promise<boolean> {
    return invoke<boolean>('injectWhatsAppMessage', [message], false);
  }

  // Resposta falada: escrever → confirmar → enviar/apagar.
  /**
   * Escreve a resposta no chat aberto SEM enviar.
   *
   * O texto fica no campo esperando o "sim" do usuário — é o que permite apagar
   * a resposta quando ele desiste.
   */
  async writeWhatsAppReply(text: string): Promise<boolean> {
    return invoke<boolean>('writeWhatsAppReply', [text], false);
  }

  /** Apaga o texto escrito no campo (o usuário disse "não"). */
  async clearWhatsAppReply(): Promise<boolean> {
    return invoke<boolean>('clearWhatsAppReply', [], false);
  }

  /** Envia o texto já escrito; `true` só quando o campo esvaziou. */
  async sendWhatsAppReply(): Promise<boolean> {
    return invoke<boolean>('sendWhatsAppReply', [], false);
  }

  /**
   * O texto da ÚLTIMA mensagem do chat do WhatsApp aberto.
   *
   * É a mensagem de verdade: a notificação chega truncada (e às vezes sem
   * texto, por causa da privacidade do aplicativo).
   */
  async readLastChatMessage(): Promise<string | null> {
    return invoke<string | null>('readLastChatMessage', [], null);
  }

  /**
   * Toca o áudio mais recente da conversa aberta (melhor esforço).
   *
   * `false` significa "não achei o controle de reprodução" — quem chamou deve
   * avisar o usuário, nunca dizer que tocou.
   */
  async playLastNotificationAudio(): Promise<boolean> {
    return invoke<boolean>('playLastNotificationAudio', [], false);
  }

  /**
   * Atende a chamada do WhatsApp que está na tela (melhor esforço).
   *
   * `false` = o botão de atender não estava acessível; quem chamou pede para o
   * usuário atender na mão, nunca anuncia uma chamada atendida.
   */
  async answerWhatsAppCall(): Promise<boolean> {
    return invoke<boolean>('answerWhatsAppCall', [], false);
  }

  /** Recusa a chamada na tela (mesma regra de honestidade). */
  async declineWhatsAppCall(): Promise<boolean> {
    return invoke<boolean>('declineWhatsAppCall', [], false);
  }

  /** Atende a chamada telefônica (chip/SIM) que está tocando no aparelho. */
  async answerPhoneCall(): Promise<boolean> {
    return invoke<boolean>('answerPhoneCall', [], false);
  }

  /** Recusa/desliga a chamada telefônica (chip/SIM) que está tocando. */
  async declinePhoneCall(): Promise<boolean> {
    return invoke<boolean>('declinePhoneCall', [], false);
  }

  /**
   * Há uma chamada de voz/vídeo ativa agora?
   *
   * Usa o modo de áudio do Android (`MODE_IN_CALL`/`MODE_IN_COMMUNICATION`),
   * que o WhatsApp ativa durante a ligação. Sem módulo nativo, responde `false`
   * e o fluxo normal continua.
   */
  async isInCall(): Promise<boolean> {
    return invoke<boolean>('isInCall', [], false);
  }

  async clickWhatsAppSend(): Promise<boolean> {
    return invoke<boolean>('clickWhatsAppSend', [], false);
  }

  async triggerWhatsAppCall(isVideo: boolean): Promise<boolean> {
    return invoke<boolean>('triggerWhatsAppCall', [isVideo], false);
  }

  async leaveForegroundMediaApp(): Promise<boolean> {
    return invoke<boolean>('leaveForegroundMediaApp', [], false);
  }

  // Mídia: pausa/retomada para notificações e chamadas
  async pauseMediaForNotification(): Promise<{
    radioWasPlaying: boolean;
    musicWasPlaying: boolean;
    musicAppName?: string;
  }> {
    return invoke<{
      radioWasPlaying: boolean;
      musicWasPlaying: boolean;
      musicAppName?: string;
    }>('pauseMediaForNotification', [], {
      radioWasPlaying: false,
      musicWasPlaying: false,
    });
  }

  async resumeMediaAfterNotification(
    wasRadioPlaying: boolean,
    wasMusicPlaying: boolean,
    musicAppName?: string,
  ): Promise<boolean> {
    return invoke<boolean>(
      'resumeMediaAfterNotification',
      [wasRadioPlaying, wasMusicPlaying, musicAppName],
      false,
    );
  }

  // ---------------------------------------------------------------------
  // Mídia / rádio
  //
  // A rádio toca DENTRO do app, pelo ExoPlayer do próprio Nexus: sem navegador
  // e sem sair da tela. Pedir outra emissora troca a atual pela nova.
  // ---------------------------------------------------------------------
  async playRadio(stationName: string): Promise<RadioResult> {
    return invoke<RadioResult>('playRadio', [stationName], {
      success: false,
      error: 'Módulo nativo indisponível',
    });
  }

  /** "Toca outra rádio": para a atual e liga a próxima do catálogo mineiro. */
  async playNextRadio(): Promise<RadioResult> {
    return invoke<RadioResult>('playNextRadio', [], {
      success: false,
      error: 'Módulo nativo indisponível',
    });
  }

  async playPreviousRadio(): Promise<RadioResult> {
    return invoke<RadioResult>('playPreviousRadio', [], {
      success: false,
      error: 'Módulo nativo indisponível',
    });
  }

  async stopRadio(): Promise<RadioResult> {
    return invoke<RadioResult>('stopRadio', [], { success: true, stopped: true });
  }

  async pauseRadio(): Promise<RadioResult> {
    return invoke<RadioResult>('pauseRadio', [], { success: false, error: 'Módulo nativo indisponível' });
  }

  async resumeRadio(): Promise<RadioResult> {
    return invoke<RadioResult>('resumeRadio', [], { success: false, error: 'Módulo nativo indisponível' });
  }

  // ---------------------------------------------------------------------
  // Volume do som (escala de 0 a 5)
  //
  // 0 = desligado, 1 a 3 = subindo, 4 = médio, 5 = máximo. A escala é do
  // Nexus: o aparelho tem degraus próprios e o usuário precisa de um número
  // que dê para pedir ("volume 3", "aumenta o som").
  // ---------------------------------------------------------------------
  async getVolumeLevel(): Promise<VolumeResult> {
    return invoke<VolumeResult>('getVolumeLevel', [], {
      success: false,
      level: 0,
      max: 5,
      error: 'Módulo nativo indisponível',
    });
  }

  /** Sobe (+1) ou desce (-1) UM degrau. */
  async changeVolume(delta: number): Promise<VolumeResult> {
    return invoke<VolumeResult>('changeVolume', [delta], {
      success: false,
      level: 0,
      max: 5,
      error: 'Módulo nativo indisponível',
    });
  }

  /** Coloca o volume num nível exato (0 a 5). */
  async setVolumeLevel(level: number): Promise<VolumeResult> {
    return invoke<VolumeResult>('setVolumeLevel', [level], {
      success: false,
      level: 0,
      max: 5,
      error: 'Módulo nativo indisponível',
    });
  }

  /**
   * Envia uma mensagem para a LISTA DE TRANSMISSÃO do WhatsApp.
   *
   * A lista já existe no WhatsApp: o nativo abre o app, acha a lista na
   * conversa, escreve e envia.
   */
  async sendWhatsAppBroadcast(message: string, listName?: string): Promise<CommandResult> {
    return invoke<CommandResult>('sendWhatsAppBroadcast', [message, listName ?? ''], {
      success: false,
      error: 'Módulo nativo indisponível',
    });
  }

  /**
   * Os nomes das listas de transmissão do WhatsApp.
   *
   * É o que permite perguntar "para qual lista?" quando existe mais de uma.
   */
  async listBroadcastLists(): Promise<{ success: boolean; lists: string[]; error?: string }> {
    return invoke<{ success: boolean; lists: string[]; error?: string }>(
      'listBroadcastLists',
      [],
      { success: false, lists: [], error: 'Módulo nativo indisponível' },
    );
  }

  // ---------------------------------------------------------------------
  // Resposta de notificação SEM abrir o WhatsApp
  //
  // A notificação de mensagem do WhatsApp traz a ação "Responder"
  // (RemoteInput). O Nexus dispara essa ação com o texto pronto: a mensagem
  // sai sem NENHUMA tela do WhatsApp — e funciona com a tela apagada e
  // bloqueada, coisa que o Auto-Bot (que precisa do WhatsApp desenhado na
  // frente) não consegue fazer sobre a trava de tela.
  // ---------------------------------------------------------------------

  /** Envia a resposta pela ação da notificação (sem abrir o WhatsApp). */
  async sendWhatsAppNotificationReply(contact: string, message: string): Promise<boolean> {
    return invoke<boolean>('sendWhatsAppNotificationReply', [contact, message], false);
  }

  /** `true` quando existe notificação com a ação "Responder" agora. */
  async canReplyWithoutOpeningWhatsApp(): Promise<boolean> {
    return invoke<boolean>('canReplyWithoutOpeningWhatsApp', [], false);
  }

  /**
   * Abre o microfone para a RESPOSTA de uma notificação.
   *
   * Diferente da captura comum, esta continua de pé com a tela apagada e
   * bloqueada: o Nexus acabou de perguntar "quer que eu leia?" e o usuário
   * responde de ouvido.
   */
  async startNotificationAnswerCapture(bias: string[] = []): Promise<boolean> {
    return invoke<boolean>('startNotificationAnswerCapture', [bias], false);
  }

  async isRadioPlaying(): Promise<boolean> {
    return invoke<boolean>('isRadioPlaying', [], false);
  }

  /** Emissora carregada agora no player do Nexus (`null` se nenhuma). */
  async getCurrentStation(): Promise<string | null> {
    const fn = nativeModule?.getCurrentStation;
    if (typeof fn !== 'function') return null;
    try {
      return (await fn()) ?? null;
    } catch {
      return null;
    }
  }

  async getAvailableStations(): Promise<string[]> {
    return invoke<string[]>('getAvailableStations', [], []);
  }

  /**
   * "Toca X no YouTube": pesquisa e TOCA o resultado no app do YouTube.
   *
   * Diferente de antes, não devolve só "abri a busca": o nativo descobre o
   * vídeo e manda o player reproduzir.
   */
  async playYouTube(query: string): Promise<MusicResult> {
    return invoke<MusicResult>('playYouTube', [query], { success: false });
  }

  /** "Toca X no OiTube": mesma coisa, no OiTube (grátis). */
  async playOiTube(query: string): Promise<MusicResult> {
    return invoke<MusicResult>('playOiTube', [query], { success: false });
  }

  /**
   * Toca uma música pelo nome da canção, do cantor ou do gênero.
   *
   * O nativo procura primeiro no OiTube, depois no YouTube — sem abrir
   * navegador quando um dos dois está instalado — e manda tocar o resultado.
   */
  async playMusic(query: string): Promise<MusicResult> {
    return invoke<MusicResult>('playMusic', [query], { success: false });
  }

  /** Controles de mídia: obedecem à rádio do Nexus ou ao player na tela. */
  async mediaControl(
    action: 'play' | 'pause' | 'next' | 'prev' | 'stop',
  ): Promise<RadioResult & CommandResult> {
    return invoke<RadioResult & CommandResult>('mediaControl', [action], {
      success: false,
      error: 'Módulo nativo indisponível',
    });
  }

  // ---------------------------------------------------------------------
  // Clima
  // ---------------------------------------------------------------------
  async getWeather(city?: string, day?: 'today' | 'tomorrow'): Promise<WeatherInfo | null> {
    return invoke<WeatherInfo | null>('getWeather', [city ?? null, day ?? 'today'], null);
  }

  // ---------------------------------------------------------------------
  // Perfil do usuário
  // ---------------------------------------------------------------------
  /** Nome guardado no aparelho (usado nas saudações e no despertador). */
  async getProfile(): Promise<ProfileInfo> {
    return invoke<ProfileInfo>('getProfile', [], { name: '', configured: false });
  }

  /** Salva o nome do usuário e devolve o que ficou guardado. */
  async saveProfile(name: string): Promise<ProfileInfo> {
    return invoke<ProfileInfo>('saveProfile', [name], { name: '', configured: false });
  }

  /** Salva o avatar selecionado ('nexus' ou 'tratis'). */
  async saveProfileAvatar(avatar: 'nexus' | 'tratis'): Promise<ProfileInfo> {
    return invoke<ProfileInfo>('saveProfileAvatar', [avatar], { name: '', configured: false, avatar: 'nexus' });
  }

  // ---------------------------------------------------------------------
  // Auto-Update
  // ---------------------------------------------------------------------
  /**
   * Baixa e instala um APK de atualização (GitHub Releases) via PackageInstaller.
   *
   * Devolve `{ success: true }` quando a instalação foi commitada; o promise é
   * rejeitado com `INSTALL_ERROR`/`DOWNLOAD_ERROR` quando falhou.
   */
  async downloadAndInstallApk(downloadUrl: string): Promise<{ success: boolean }> {
    return invoke<{ success: boolean }>('downloadAndInstallApk', [downloadUrl], { success: false });
  }

  // ---------------------------------------------------------------------
  // Anotações
  // ---------------------------------------------------------------------
  /** Guarda uma anotação. O título, quando vazio, sai das primeiras palavras. */
  async saveNote(text: string, title = ''): Promise<NoteEntry | null> {
    return invoke<NoteEntry | null>('saveNote', [text, title], null);
  }

  /** Todas as anotações, da mais recente para a mais antiga. */
  async listNotes(): Promise<NoteEntry[]> {
    return invoke<NoteEntry[]>('listNotes', [], []);
  }

  async deleteNote(id: string): Promise<boolean> {
    return invoke<boolean>('deleteNote', [id], false);
  }

  /** Apaga tudo. Devolve quantas anotações existiam. */
  async clearNotes(): Promise<number> {
    return invoke<number>('clearNotes', [], 0);
  }

  // ---------------------------------------------------------------------
  // Lembretes e despertador
  // ---------------------------------------------------------------------
  async saveReminder(reminder: {
    title: string;
    description: string;
    triggerAtMillis: number;
    repeatDaily?: boolean;
    /** "lembrete" ou "alarme" — decide a tela que abre quando toca. */
    kind?: string;
  }): Promise<ReminderEntry | null> {
    return invoke<ReminderEntry | null>(
      'saveReminder',
      [
        reminder.title,
        reminder.description,
        reminder.triggerAtMillis,
        reminder.repeatDaily === true,
        reminder.kind ?? 'lembrete',
      ],
      null,
    );
  }

  async listReminders(): Promise<ReminderEntry[]> {
    return invoke<ReminderEntry[]>('listReminders', [], []);
  }

  async updateReminder(id: string, patch: ReminderPatch): Promise<ReminderEntry | null> {
    return invoke<ReminderEntry | null>('updateReminder', [id, patch], null);
  }

  /**
   * ADIA o lembrete em [minutes] minutos, como o botão "Daqui a pouco".
   *
   * O diário mantém o horário de sempre (só o toque de agora é adiado); o de
   * uma vez só passa a valer no novo horário.
   */
  async snoozeReminder(id: string, minutes: number): Promise<ReminderEntry | null> {
    return invoke<ReminderEntry | null>('snoozeReminder', [id, Math.max(1, Math.round(minutes))], null);
  }

  async deleteReminder(id: string): Promise<boolean> {
    return invoke<boolean>('deleteReminder', [id], false);
  }

  async setReminderEnabled(id: string, enabled: boolean): Promise<boolean> {
    return invoke<boolean>('setReminderEnabled', [id, enabled], false);
  }

  async getNextReminder(): Promise<ReminderEntry | null> {
    return invoke<ReminderEntry | null>('getNextReminder', [], null);
  }

  /** Reagenda tudo (depois de o usuário liberar a permissão de alarme exato). */
  async rescheduleReminders(): Promise<boolean> {
    return invoke<boolean>('rescheduleReminders', [], false);
  }

  // ---------------------------------------------------------------------
  // Permissões
  // ---------------------------------------------------------------------
  async requestAccessibilityPermission(): Promise<boolean> {
    return invoke<boolean>('requestAccessibilityPermission', [], false);
  }

  async requestOverlayPermission(): Promise<boolean> {
    return invoke<boolean>('requestOverlayPermission', [], false);
  }

  async requestNotificationAccess(): Promise<boolean> {
    return invoke<boolean>('requestNotificationAccess', [], false);
  }

  async isNotificationAccessGranted(): Promise<boolean> {
    return invoke<boolean>('isNotificationAccessGranted', [], false);
  }

  /** Abre a última conversa anunciada ("abrir a mensagem"). */
  async openLastNotification(): Promise<boolean> {
    return invoke<boolean>('openLastNotification', [], false);
  }

  /**
   * Notificações do WhatsApp que chegaram e ainda não foram contadas.
   *
   * O aviso ao vivo pode falhar quando o React está destruído em segundo
   * plano; o nativo guarda as últimas para o app contar ao abrir.
   */
  async getRecentNotifications(): Promise<NotificationMessage[]> {
    return invoke<NotificationMessage[]>('getRecentNotifications', [], []);
  }

  /** Marca como contadas as notificações guardadas. */
  async clearRecentNotifications(): Promise<void> {
    await invoke<null>('clearRecentNotifications', [], null);
  }

  /** Histórico do chat (JSON) salvo no aparelho. */
  async loadChatHistory(): Promise<string> {
    return invoke<string>('loadChatHistory', [], '');
  }

  async saveChatHistory(json: string): Promise<void> {
    await invoke<null>('saveChatHistory', [json], null);
  }

  async clearChatHistory(): Promise<void> {
    await invoke<null>('clearChatHistory', [], null);
  }

  /**
   * Estado da rede neural de aprendizado (JSON), guardado no aparelho.
   *
   * É o que faz o Nexus "lembrar" o que aprendeu com o uso depois de fechar
   * o app: a matriz (pesos + ligações de palavras) e a biblioteca de conversa
   * aprendida na internet.
   */
  async loadNeuralState(): Promise<string> {
    return invoke<string>('loadNeuralState', [], '');
  }

  async saveNeuralState(json: string): Promise<void> {
    await invoke<null>('saveNeuralState', [json], null);
  }

  // ---------------------------------------------------------------------
  // Contatos ignorados
  // ---------------------------------------------------------------------
  /** Carrega a lista de contatos ignorados como JSON (ou `null` quando vazia). */
  async loadIgnoredContacts(): Promise<string | null> {
    return invoke<string | null>('loadIgnoredContacts', [], null);
  }

  /** Salva a lista de contatos ignorados (JSON). */
  async saveIgnoredContacts(json: string): Promise<boolean> {
    return invoke<boolean>('saveIgnoredContacts', [json], false);
  }

  /** Abre a conversa do contato certo (intent da notificação ou busca). */
  async openNotificationConversation(contact: string): Promise<boolean> {
    return invoke<boolean>('openNotificationConversation', [contact], false);
  }

  /** Volta para a tela inicial do aparelho. */
  async goHome(): Promise<boolean> {
    return invoke<boolean>('goHome', [], false);
  }

  async isAccessibilityEnabled(): Promise<boolean> {
    return invoke<boolean>('isAccessibilityEnabled', [], false);
  }

  /**
   * O estado do Auto-Bot (acessibilidade).
   *
   * `enabled` = está ligado agora. `wasEnabled` = o usuário já deixou ligado
   * antes (o Android desliga o serviço a cada instalação do APK, e é essa
   * lembrança que permite avisar "estava ligado e a instalação desligou").
   */
  async getAutoBotState(): Promise<{ enabled: boolean; wasEnabled: boolean }> {
    return invoke<{ enabled: boolean; wasEnabled: boolean }>(
      'getAutoBotState',
      [],
      { enabled: false, wasEnabled: false },
    );
  }

  /** Grava a lembrança de que o Auto-Bot está ligado. */
  async setAutoBotEnabled(enabled: boolean): Promise<boolean> {
    return invoke<boolean>('setAutoBotEnabled', [enabled], false);
  }

  async getPermissionState(): Promise<Record<string, boolean> | null> {
    const fn = nativeModule?.getPermissionState;
    if (typeof fn !== 'function') return null;
    try {
      return (await fn()) ?? null;
    } catch {
      return null;
    }
  }

  async openAppSettings(): Promise<boolean> {
    return invoke<boolean>('openAppSettings', [], false);
  }

  // ---------------------------------------------------------------------
  // Serviço em primeiro plano
  // ---------------------------------------------------------------------
  async startForegroundService(): Promise<void> {
    await invoke('startForegroundService', [], null);
  }

  async stopForegroundService(): Promise<void> {
    await invoke('stopForegroundService', [], null);
  }

  /**
   * Liga a escuta da palavra "nexo" no serviço em primeiro plano.
   *
   * Só funciona com a permissão de microfone liberada. O serviço mantém o
   * microfone com a tela apagada/bloqueada e é o que permite acordar o Nexus
   * pelo nome sem tocar no mascote.
   */
  async startWakeWordListening(): Promise<boolean> {
    return invoke<boolean>('startWakeWordListening', [], false);
  }

  /** Desliga a escuta da palavra "nexo" e o serviço em primeiro plano. */
  async stopWakeWordListening(): Promise<void> {
    await invoke('stopWakeWordListening', [], null);
  }

  // ---------------------------------------------------------------------
  // Eventos
  // ---------------------------------------------------------------------
  addEventListener(event: NexusEvent, callback: (payload: any) => void): () => void {
    if (!eventEmitter) return () => {};
    const subscription = eventEmitter.addListener(event, callback);
    return () => subscription.remove();
  }

  onCommandRecognized(callback: (command: string) => void): () => void {
    return this.addEventListener('onCommandRecognized', (event: any) => {
      const command = event?.command;
      if (typeof command === 'string') callback(command);
    });
  }

  /**
   * Estado real do microfone, vindo do motor nativo.
   *
   * É a fonte da verdade: se o microfone fechou sozinho (silêncio, erro ou fim
   * da captura), a tela precisa saber para não continuar dizendo "ouvindo".
   */
  onVoiceStateChanged(callback: (state: VoiceState) => void): () => void {
    return this.addEventListener('onVoiceStateChanged', (event: any) => {
      const mode = typeof event?.mode === 'string' ? event.mode : 'off';
      const phase = typeof event?.phase === 'string' ? event.phase : 'idle';
      const capturing = event?.capturing === true;
      callback({ mode, phase, capturing });
    });
  }

  /**
   * O Auto-Bot de acessibilidade conectou (ou desconectou).
   *
   * A tela de permissoes le um retrato do estado. Se ela leu antes de o
   * servico conectar, ficava pedindo uma permissao que o usuario ja tinha
   * liberado - o aviso deixa a tela se corrigir sozinha.
   */
  onAccessibilityStateChanged(callback: (connected: boolean) => void): () => void {
    return this.addEventListener('onAccessibilityStateChanged', (event: any) => {
      callback(event?.connected === true);
    });
  }

  /** Fim de uma captura feita pelo botão dentro do app, com o motivo. */
  onCaptureEnded(callback: (end: VoiceCaptureEnd) => void): () => void {
    return this.addEventListener('onCaptureEnded', (event: any) => {
      const reason = typeof event?.reason === 'string' ? event.reason : 'error';
      callback({ reason });
    });
  }

  /** O stream da rádio realmente começou a tocar. */
  onRadioPlaying(callback: (station: string) => void): () => void {
    return this.addEventListener('onRadioPlaying', (event: any) => {
      const station = event?.station;
      if (typeof station === 'string' && station) callback(station);
    });
  }

  /**
   * O stream da rádio falhou depois de abrir.
   *
   * Existe para o Nexus avisar ("não consegui tocar a Itatiaia agora") em vez de
   * deixar o usuário achando que está tocando.
   */
  onRadioError(callback: (station: string, message: string) => void): () => void {
    return this.addEventListener('onRadioError', (event: any) => {
      const station = typeof event?.station === 'string' ? event.station : '';
      const message = typeof event?.error === 'string' ? event.error : '';
      callback(station, message);
    });
  }

  onAssistantForeground(callback: () => void): () => void {
    return this.addEventListener('onAssistantForeground', () => callback());
  }

  onAssistantBackground(callback: () => void): () => void {
    return this.addEventListener('onAssistantBackground', () => callback());
  }

  onMascotTapped(callback: () => void): () => void {
    return this.addEventListener('onMascotTapped', () => callback());
  }

  /**
   * Mensagem nova no WhatsApp (ou WhatsApp Business).
   *
   * Só chega com a permissão especial "Acesso a notificações" liberada — sem
   * ela o Android nem conecta o serviço de leitura.
   */
  onNotificationReceived(callback: (payload: NotificationMessage) => void): () => void {
    return this.addEventListener('onNotificationReceived', (event: any) => {
      const app = typeof event?.app === 'string' ? event.app : 'WhatsApp';
      const contact = typeof event?.contact === 'string' ? event.contact : '';
      const message = typeof event?.message === 'string' ? event.message : '';
      if (!contact && !message) return;
      const type =
        event?.type === 'voice-call' ||
        event?.type === 'video-call' ||
        event?.type === 'missed-call'
          ? event.type
          : 'message';
      callback({
        app,
        contact,
        message,
        type,
        isAudio: event?.isAudio === true,
        callSource: event?.callSource ?? 'whatsapp',
        phoneNumber: typeof event?.phoneNumber === 'string' ? event.phoneNumber : '',
      });
    });
  }

  /**
   * Um lembrete disparou.
   *
   * O aviso do Android e a fala já foram feitos pelo lado nativo; aqui o texto
   * entra na conversa para ficar registrado.
   */
  onReminderFired(
    callback: (payload: { id: string; title: string; text: string }) => void,
  ): () => void {
    return this.addEventListener('onReminderFired', (event: any) => {
      callback({
        id: typeof event?.id === 'string' ? event.id : '',
        title: typeof event?.title === 'string' ? event.title : '',
        text: typeof event?.text === 'string' ? event.text : '',
      });
    });
  }

  /**
   * A palavra-chave "nexo" foi detectada pelo serviço de despertar por fala.
   *
   * O app deve abrir, dar boas-vindas e perguntar o que o usuário quer fazer.
   */
  onWakeWordDetected(callback: () => void): () => void {
    return this.addEventListener('onWakeWordDetected', () => callback());
  }

  /**
   * O usuário tocou em um dos dois telefones da notificação de chamada do Nexus
   * (verde = atender, vermelho = recusar). O resultado chega aqui para o Nexus
   * encerrar a pergunta "quer atender?" e falar o que de fato aconteceu.
   */
  onCallActionTaken(callback: (payload: { action: 'answer' | 'decline'; source: 'whatsapp' | 'phone'; success: boolean }) => void): () => void {
    return this.addEventListener('onCallActionTaken', (event: any) => {
      callback({
        action: event?.action,
        source: event?.source,
        success: event?.success === true,
      });
    });
  }
}

export const nexusNative = new NexusNativeService();
