import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AppState,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Speech from 'expo-speech';
import { LinearGradient } from 'expo-linear-gradient';
import { ShieldAlert, Trash2, Volume2, VolumeX } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { resolveLocalCommand } from './app/core/intentRouter.mjs';
import { answerFromLocalKnowledge } from './app/core/localKnowledge.mjs';
import { PAUSE_MINUTES } from './app/core/portugueseDict.mjs';
import {
  parseCallKindAnswer,
  parseCallRequest,
  planMusicAnswer,
  planNativeCommand,
  type NativeCommandPlan,
} from './app/core/nativeCommands.mjs';
import { answerSmallTalk } from './app/core/smallTalk.mjs';
import {
  answerByTopic,
  answerConversation,
  answerFromLearned,
  isConversational,
  learnConversationPair,
} from './app/core/conversationBrain.mjs';
import {
  learnFromCorrection,
  registerNegative,
  train,
  predict,
  MIN_CONFIDENCE,
} from './app/core/neuralLearner.mjs';
import { recallLearnedIntent } from './app/core/neuralIntent.mjs';
import {
  loadNeuralMemory,
  scheduleNeuralSave,
  flushNeuralSave,
  rememberChatPair,
  rememberPath,
  type NeuralMemory,
} from './app/services/neuralMemory';
import {
  formatLotteryGames,
  formatMegaSenaResult,
  parseLotteryRequest,
} from './app/core/lottery.mjs';
import {
  describeCaptureEnd,
  describeVoiceState,
  planVoiceSession,
} from './app/core/voiceSessionPolicy.mjs';
import { formatPhoneBR, isPlaceQuery, looksLikePhoneNumber } from './app/core/phoneLookup.mjs';
import { lookupPhoneNumber } from './app/services/phoneLookup';
import { fetchLatestMegaSena } from './app/services/megaSena';
import {
  describeNotification,
  summarizeNotification,
} from './app/core/notificationMessage.mjs';
import {
  advanceNotificationFlow,
  resolveNotificationType,
  startNotificationFlow,
  type NotificationAction,
  type NotificationFlowResult,
  type NotificationFlowState,
} from './app/core/notificationFlow.mjs';
import {
  composeReminderTime,
  deriveTitle,
  describeTrigger,
  extractReminderPieces,
  formatAlarmReminderSpeech,
  formatDateTime,
  parseWhen,
  planAssistantTask,
  speakReminderList,
  type AssistantTaskPlan,
} from './app/core/assistantTasks.mjs';
import {
  pickDailyPhrase,
  planDailyExtra,
  summarizeHeadlines,
} from './app/core/dailyExtras.mjs';
import { fetchHeadlines } from './app/services/newsFeed';
import { PERMISSION_STEPS } from './app/core/permissionPlan.mjs';
import { estimateBubbleWidthDp } from './app/core/textMetrics.mjs';
import { getPermissionSnapshot, requestPermissionStep } from './app/services/nexusPermissions';
import { OnboardingFlow } from './app/ui/OnboardingFlow';
import { PermissionsScreen } from './app/ui/PermissionsScreen';
import { SettingsScreen } from './app/ui/SettingsScreen';
import { SplashScreen } from './app/ui/SplashScreen';
import { FadeSlideIn, TypingDots } from './app/ui/motion';
import { MascotAvatar } from './app/ui/Mascot';
import { getCharacterMeta, type CharacterId } from './app/ui/mascotAssets';
import { Header } from './app/ui/Header';
import { Composer } from './app/ui/Composer';
import { ChatHero } from './app/ui/ChatHero';
import { NoticeBanner } from './app/ui/NoticeBanner';
import { pickMascotPhrase } from './app/core/mascotPhrases.mjs';
import { colors, fontSize, gradients, radius, spacing } from './app/ui/theme';
import { loadProfile, saveProfileAvatar } from './app/services/nexusProfile';
import {
  nexusNative,
  isNativeAvailable,
  type MusicResult,
  type NotificationMessage,
  type RadioResult,
  type VolumeResult,
} from './app/services/nexusNative';

/**
 * Uma mensagem da conversa.
 *
 * `shareWithSearch` marca as que vieram de uma PERGUNTA ABERTA (e não de um
 * comando): é o que permite RESEARCHAR sem levar o nome de um contato ou o
 * texto de uma mensagem para a internet.
 */
type Message = {
  role: 'user' | 'assistant';
  text: string;
  id: string;
  shareWithSearch?: boolean;
};

/**
 * Primeira fala do Nexus, já cumprimentando pelo horário e pelo nome.
 *
 * O nome vem do onboarding; quando ele não existe, a saudação fica genérica.
 */
function welcomeMessage(name: string): Message {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  const who = name ? `, ${name}` : '';
  return {
    id: 'welcome',
    role: 'assistant',
    text: `${greeting}${who}! ${pickMascotPhrase('greeting')}`,
  };
}

const MASCOT_IDLE = require('./assets/mascote-ocioso.png');

/**
 * Altura que o teclado ocupa na parte de baixo da tela.
 *
 * No Android 15 o app roda em modo "edge-to-edge" (obrigatório para apps que
 * miram SDK 35+), então o sistema não redimensiona mais a janela quando o
 * teclado abre — o antigo `adjustResize` virou no-op e o teclado passava a
 * cobrir a barra de escrita. Aqui medimos a sobreposição de verdade: comparamos
 * a altura atual da janela com a posição do teclado na tela, o que dá certo
 * tanto em aparelhos que redimensionam a janela quanto nos que não redimensionam.
 */
function useKeyboardInset(): number {
  const { height: windowHeight } = useWindowDimensions();
  const [inset, setInset] = useState(0);
  const keyboardTopRef = useRef<number | null>(null);

  const recompute = useCallback(() => {
    const keyboardTop = keyboardTopRef.current;
    if (keyboardTop == null) {
      setInset(0);
      return;
    }
    // O que sobra entre o fim da janela do app e o topo do teclado é
    // exatamente o que o teclado está cobrindo. Se o sistema já redimensionou
    // a janela, a diferença fica negativa (ou zero) e não há nada a corrigir.
    setInset(Math.max(0, Math.round(windowHeight - keyboardTop)));
  }, [windowHeight]);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', (event) => {
      keyboardTopRef.current = event.endCoordinates.screenY;
      recompute();
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      keyboardTopRef.current = null;
      setInset(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [recompute]);

  useEffect(() => {
    recompute();
  }, [recompute]);

  return inset;
}

const SAFE_LINK_HOSTS = new Set([
  'www.google.com',
  'www.youtube.com',
  'www.wikipedia.org',
  'wa.me',
]);

function isSafeExternalLink(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && SAFE_LINK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Ocorreu um erro inesperado.';
}

/**
 * Palavras de "sim" e de "não" numa resposta falada curta.
 *
 * Usadas quando o Nexus acabou de perguntar algo e espera a resposta ("Quer que
 * eu ligue?"). Não são um roteador: só valem para frases curtas, para não
 * engolir um comando novo que o usuário resolva dar no meio.
 *
 * Cobertura ampla PT-BR informal: "sim", "pode ler", "leia", "fale", "prossiga na leitura",
 * "não quero", "fechar", "não leia", "não quero", etc.
 */
const AFFIRMATIVE_TOKENS =
  /\b(sim|isso|claro|pode|pode ler|leia|fale|prossiga na leitura|prossiga leitura|ok|okay|quero|beleza|vamos|bora|manda|aceito|aceita|aceitar|atende|atenda|atender|liga|ligar|disca|discar|confirmo|confirmar|confirma|vamos|bora|manda|pode|pode ler|leia|fale|prossiga|prossegue|continua|continue|pode falar|fale a vontade)\b/;
const NEGATIVE_TOKENS =
  /\b(nao|não quero|nao quero|fechar|nao leia|não leia|não quero|nao leia|cancela|cancelar|deixa|esquece|esquecer|negativo|para|recusa|recusar|recuse|rejeita|rejeitar|rejeito|desiste|desistir|para de ler|para de falar|chega|basta|não|nao)\b/;

/**
 * "Leia" e "abrir" como resposta à pergunta "Quer que eu leia?".
 *
 * Fora dessa pergunta, "abre o WhatsApp" é um pedido novo, não uma confirmação
 * — por isso estas palavras não entram em [AFFIRMATIVE_TOKENS].
 * Expandido para incluir variações informais: "pode ler", "fale", "prossiga".
 */
const READ_CONFIRM_TOKENS = /\b(leia|ler|le|abrir|abra|abre|pode ler|fale|prossiga|prossegue|continua|continue)\b/;

/**
 * Viés do reconhecedor para respostas curtas.
 *
 * Um "sim" sozinho às vezes voltava como NO_MATCH (o modelo não tinha contexto
 * nenhum). Só é usado quando o Nexus acabou de fazer uma pergunta; a dicção de
 * uma mensagem inteira continua sem viés.
 * Expandido para cobertura total de sim/não informal.
 */
const SHORT_ANSWER_BIAS = [
  'sim',
  'não',
  'pode',
  'pode ler',
  'leia',
  'ler',
  'abrir',
  'abre',
  'quero',
  'confirmo',
  'cancelar',
  'deixa',
  'responder',
  'enviar',
  'parar',
  'tocar',
  'fale',
  'prossiga',
  'prossegue',
  'continua',
  'continue',
  'pode falar',
  'fale a vontade',
  'beleza',
  'vamos',
  'bora',
  'manda',
  'aceito',
  'aceita',
  'aceitar',
  'atende',
  'atenda',
  'atender',
  'liga',
  'ligar',
  'disca',
  'discar',
  'confirmo',
  'confirmar',
  'confirma',
  'pode ler',
  'leia',
  'fale',
  'prossiga',
  'prossegue',
  'continua',
  'continue',
  'pode falar',
  'não',
  'nao',
  'não quero',
  'nao quero',
  'fechar',
  'nao leia',
  'não leia',
  'cancela',
  'cancelar',
  'deixa',
  'esquece',
  'esquecer',
  'negativo',
  'para',
  'recusa',
  'recusar',
  'recuse',
  'rejeita',
  'rejeitar',
  'rejeito',
  'desiste',
  'desistir',
  'para de ler',
  'para de falar',
  'chega',
  'basta',
];

/**
 * Desistência explícita da resposta de uma notificação.
 *
 * Só estas palavras cancelam: um áudio de 3 palavras terminado em "sim" (o
 * usuário ditando a resposta) NÃO pode ser confundido com "não respondo".
 */
const CANCEL_REPLY_TOKENS = /\b(cancela|cancelar|deixa|esquece|esquecer|desiste|desistir)\b/;

/** Texto sem acento, sem pontuação e em minúsculas — para comparar respostas. */
function foldAnswer(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `true` quando a frase é uma resposta curta de sim/não (até 3 palavras). */
function isShortAnswer(text: string): boolean {
  const folded = foldAnswer(text);
  if (!folded || folded.split(' ').length > 3) return false;
  return AFFIRMATIVE_TOKENS.test(folded) || NEGATIVE_TOKENS.test(folded);
}

/** `true` quando a resposta curta é um "sim". */
function isAffirmativeAnswer(text: string): boolean {
  const folded = foldAnswer(text);
  return AFFIRMATIVE_TOKENS.test(folded) && !NEGATIVE_TOKENS.test(folded);
}

/** "Leia", "ler" ou "abrir" na pergunta específica "Quer que eu leia?". */
function isReadConfirmation(text: string): boolean {
  const folded = foldAnswer(text);
  if (!folded || folded.split(' ').length > 3) return false;
  return READ_CONFIRM_TOKENS.test(folded) && !NEGATIVE_TOKENS.test(folded);
}

/**
 * Pergunta curta para repetir quando o reconhecedor não entendeu a resposta.
 *
 * Vale uma vez por etapa: a segunda falha é avisada com honestidade, sem ficar
 * repetindo a pergunta para sempre.
 */
function notificationRetryPrompt(step: string): string {
  switch (step) {
    case 'ask-read':
      return 'Não entendi. Quer que eu leia a mensagem? Diga sim ou não.';
    case 'ask-reply':
      return 'Não entendi. Quer responder, ligar ou fazer chamada de vídeo?';
    case 'confirm-send':
      return 'Não entendi. Posso enviar a resposta? Diga sim ou não.';
    case 'ask-attend':
      return 'Não entendi. Quer atender a chamada? Diga sim ou não.';
    case 'ask-audio':
      return 'Não entendi. Quer ouvir o áudio? Diga sim ou não.';
    case 'ask-call-back':
      return 'Não entendi. Quer que eu ligue de volta? Diga sim ou não.';
    default:
      return 'Não entendi. Diga sim ou não.';
  }
}

/**
 * Escolhe o item da lista citado pelo usuário.
 *
 * O índice vem do parser em 1..N ("a anotação 2"), ou `-1` para "a última", ou
 * `null` quando ele não disse qual — e aí vale a mais recente.
 */
function pickByIndex<T>(entries: T[], index: number | null | undefined): T | null {
  if (entries.length === 0) return null;
  if (index === null || index === undefined) return entries[0];
  if (index === -1) return entries[entries.length - 1];
  return entries[index - 1] ?? null;
}

/**
 * Barreira de erro global: se qualquer tela lançar durante a renderização
 * (por exemplo um módulo nativo ausente), o app mostra um aviso recuperável
 * em vez de fechar sozinho.
 */
class AppErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; message: string }> {
  state = { hasError: false, message: '' };

  static getDerivedStateFromError(error: unknown) {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : 'Erro inesperado no Nexus.',
    };
  }

  private reset = () => {
    this.setState({ hasError: false, message: '' });
  };

  render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={styles.screen}>
          <StatusBar style="light" />
          <View style={styles.crashContainer}>
            <Image source={MASCOT_IDLE} style={styles.crashMascot} resizeMode="contain" />
            <Text style={styles.crashTitle}>Algo deu errado</Text>
            <Text selectable style={styles.crashText}>{this.state.message}</Text>
            <Pressable accessibilityRole="button" onPress={this.reset} style={styles.crashButton}>
              <Text style={styles.crashButtonText}>Tentar novamente</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}

/**
 * Raiz do app. Não declara hooks de tela: apenas decide entre o onboarding de
 * permissões e a tela de conversa, cada uma com seus próprios hooks.
 */
export default function App() {
  return (
    <AppErrorBoundary>
      <AppRoot />
    </AppErrorBoundary>
  );
}

/**
 * Raiz do app: decide entre carregando → onboarding (nome + permissões) → conversa.
 *
 * O nome do usuário vem do aparelho. Enquanto ele não existe, o app mostra as
 * boas-vindas; depois disso, nunca mais pergunta de novo.
 */
function AppRoot() {
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState('');
  const [onboardingDone, setOnboardingDone] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const profile = await loadProfile();
      if (!active) return;
      setUserName(profile.name);
      setOnboardingDone(profile.configured);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  if (loading) return <SplashScreen />;

  if (!onboardingDone) {
    return (
      <OnboardingFlow
        initialName={userName}
        onFinish={(name) => {
          setUserName(name);
          setOnboardingDone(true);
        }}
      />
    );
  }

  return <NexusAssistant userName={userName} />;
}

/**
 * Quantas mensagens a conversa guarda.
 *
 * A tela não precisa de histórico infinito: as mensagens mais antigas são
 * apagadas da lista (e do que fica salvo no aparelho) para a conversa não
 * pesar nem ocupar o bloco de interação. O que o Nexus precisa saber do
 * histórico ele já tem nas notas, nos lembretes e na própria conversa.
 */
const MAX_MESSAGES = 60;

/**
 * Folga entre calar o TTS e abrir o microfone.
 *
 * A parada do TTS responde assim que o comando é aceito, mas o motor ainda pode
 * estar soltando o foco de áudio. Abrir o reconhecedor nesse instante faz o
 * Android responder "ocupado" e a escuta não começa.
 */
const SPEECH_STOP_SETTLE_MS = 220;

/** Mantém só as últimas [MAX_MESSAGES] mensagens. */
function trimMessages(list: Message[]): Message[] {
  return list.length > MAX_MESSAGES ? list.slice(list.length - MAX_MESSAGES) : list;
}

/**
 * Uma linha da conversa.
 *
 * Componente separado por dois motivos: deixa o mapa de mensagens legível e faz
 * cada balão entrar com uma animação própria — como a chave é o id da mensagem,
 * só as NOVAS animam; as antigas ficam paradas.
 *
 * A largura do balão é MEDIDA (não em `%`): no Android a porcentagem é
 * resolvida com um arredondamento diferente do desenho e a última linha do
 * texto era cortada. Com o número exato, medição e desenho usam a mesma conta.
 */
function MessageRow({
  message,
  character,
  speaking,
  listening,
}: {
  message: Message;
  character: CharacterId;
  speaking: boolean;
  listening: boolean;
}) {
  const isUser = message.role === 'user';
  const meta = getCharacterMeta(character);
  const { width: windowWidth } = useWindowDimensions();

  const bubbleWidth = useMemo(
    () =>
      estimateBubbleWidthDp(message.text, {
        fontSizeDp: fontSize.body,
        maxWidthDp: (windowWidth - spacing.lg * 2 - (isUser ? 0 : 42)) * 0.86,
        paddingDp: spacing.lg * 2,
      }),
    [isUser, message.text, windowWidth],
  );

  /** A largura útil do balão (a de fora menos o padding e as duas bordas). */
  const textWidth = useMemo(
    () => Math.max(48, bubbleWidth - spacing.lg * 2 - 2),
    [bubbleWidth],
  );

  /**
   * Altura mínima REAL do texto, medida pelo próprio Android.
   *
   * O `Text` do Android às vezes calcula a altura para 2 linhas e desenha 3:
   * a última linha fica fora da View e some. Aqui o `onTextLayout` entrega a
   * posição da última linha DESENHADA e a altura mínima passa a cobrir todas
   * elas.
   */
  const [textMinHeight, setTextMinHeight] = useState(0);

  const textElement = (
    <Text
      style={[
        styles.messageText,
        { width: textWidth },
        textMinHeight > 0 && { minHeight: textMinHeight },
        isUser && styles.userMessageText,
      ]}
      onTextLayout={(event) => {
        const lines = event.nativeEvent.lines;
        if (!lines || lines.length === 0) return;
        const last = lines[lines.length - 1];
        const needed = Math.ceil(last.y + last.height + 4);
        if (needed > textMinHeight) setTextMinHeight(needed);
      }}
    >
      {message.text}
    </Text>
  );

  return (
    <FadeSlideIn
      offset={10}
      duration={320}
      style={[styles.messageRow, isUser && styles.userMessageRow]}
    >
      {!isUser ? (
        <MascotAvatar
          character={character}
          size={30}
          speaking={speaking}
          listening={listening}
        />
      ) : null}

      <View style={[styles.messageColumn, isUser && styles.userMessageColumn]}>
        {!isUser ? (
          <Text style={[styles.messageAuthor, { color: meta.accent }]}>{meta.name}</Text>
        ) : null}

        {isUser ? (
          <LinearGradient
            colors={gradients.warm}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.bubble, styles.userBubble, { width: bubbleWidth }]}
          >
            {textElement}
          </LinearGradient>
        ) : (
          <View
            style={[
              styles.bubble,
              styles.assistantBubble,
              { width: bubbleWidth, borderColor: `${meta.accent}33` },
            ]}
          >
            {textElement}
          </View>
        )}
      </View>
    </FadeSlideIn>
  );
}

/** Tela principal de conversa do Nexus. */
function NexusAssistant({ userName }: { userName: string }) {
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedAvatar, setSelectedAvatar] = useState<'nexus' | 'tratis'>('nexus');
  const [messages, setMessages] = useState<Message[]>(() => [welcomeMessage(userName)]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  /**
   * Microfone aberto para o pedido AGORA.
   *
   * Vem do motor nativo, não do toque no botão: se o microfone fechar sozinho
   * (fim da fala, silêncio, erro), a tela precisa parar de dizer "ouvindo".
   */
  const [capturing, setCapturing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(true);
  const [notice, setNotice] = useState('');
  const [nativeReady, setNativeReady] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  /**
   * `true` quando a conversa está no fim (ou quase).
   *
   * É o que decide se a tela sobe sozinha quando chega mensagem: quem está
   * lendo o histórico não é puxado de volta.
   */
  const nearBottomRef = useRef(true);
  const busyRef = useRef(false);
  /** Comando que chegou enquanto o Nexus ainda respondia. */
  const pendingCommandRef = useRef('');
  /** `true` quando o Nexus acabou de perguntar qual música tocar. */
  const pendingMusicRef = useRef(false);
  /** `true` quando o Nexus acabou de perguntar qual rádio tocar. */
  const pendingRadioRef = useRef(false);
  /**
   * `true` quando o Nexus perguntou "qual mensagem?" para a lista de
   * transmissão do WhatsApp: a próxima fala é o TEXTO da mensagem.
   */
  const pendingBroadcastRef = useRef(false);
  /**
   * Nome da lista de transmissão, quando o usuário disse ("a lista da empresa").
   *
   * Sem nome, o Nexus procura a lista pelo nome padrão do WhatsApp.
   */
  const pendingBroadcastNameRef = useRef('');
  /**
   * A mensagem da lista de transmissão, quando o Nexus já perguntou o nome da
   * lista (com mais de uma lista, o nome vem depois da mensagem).
   */
  const pendingBroadcastMessageRef = useRef('');
  /**
   * A cidade do clima, quando o Nexus perguntou ("de qual cidade?").
   */
  const pendingWeatherRef = useRef<{ day: 'today' | 'tomorrow' } | null>(null);
  /** `true` quando o Nexus acabou de perguntar o contato para WhatsApp. */
  const pendingWhatsAppContactRef = useRef(false);
  /** Tipo de ação WhatsApp pendente: 'message' | 'voice-call' | 'video-call' | 'call-choice' */
  const pendingWhatsAppActionRef = useRef<
    'message' | 'voice-call' | 'video-call' | 'call-choice' | null
  >(null);
  /**
   * Contato cujo tipo de chamada (voz ou vídeo) está sendo perguntado.
   *
   * O contato já foi escolhido; falta só o tipo. No WhatsApp os dois botões
   * ficam lado a lado no topo da conversa, então ligar sem perguntar acerta o
   * errado na metade das vezes.
   */
  const pendingCallChoiceRef = useRef<string | null>(null);
  /**
   * `true` quando o Nexus acabou de perguntar para quem LIGAR (telefone).
   *
   * Estado próprio, separado do WhatsApp: antes a pergunta "para quem eu ligo?"
   * não guardava nada, então a resposta do usuário caía na pesquisa da internet
   * e a ligação nunca acontecia.
   */
  const pendingLocalCallRef = useRef(false);
  /**
   * Telefone achado na INTERNET esperando o "sim" do usuário.
   *
   * O Nexus nunca disca para um número que ele mesmo pesquisou: primeiro fala o
   * nome e o número, e só liga depois da confirmação. Enquanto este estado
   * existe, a próxima fala curta ("sim"/"não") é tratada como a resposta.
   */
  const pendingLookupCallRef = useRef<{ target: string; digits: string; formatted: string } | null>(
    null,
  );
  /** `true` quando o Nexus abriu o WhatsApp no contato e espera a mensagem. */
  const pendingWhatsAppMessageRef = useRef(false);
  /** Nome do contato aguardando a mensagem (vinculado entre as etapas do fluxo). */
  const pendingWhatsAppPendingContactRef = useRef<string>('');
  /**
   * Conversa de uma notificação do WhatsApp em andamento.
   *
   * Guarda o passo atual (ler? tocar? responder? confirmar?) em vez de um
   * "pendente sim/não": é o que permite o Nexus perguntar, ouvir a resposta,
   * escrever no chat e só enviar depois do "sim" — e apagar se o usuário negar.
   * Quem decide cada passo é `app/core/notificationFlow.mjs` (testado).
   */
  const pendingNotificationRef = useRef<NotificationFlowState | null>(null);
  /**
   * Quantas vezes a pergunta da notificação já foi repetida por falta de
   * entendimento nesta etapa (no máximo uma: depois disso o Nexus avisa).
   */
  const notificationAnswerRetryRef = useRef(0);
  /**
   * Última notificação conhecida (contato + texto), mesmo depois de o fluxo
   * terminar. É o que permite "leia a mensagem" sem pesquisar na internet.
   */
  const lastNotificationRef = useRef<NotificationMessage | null>(null);
  /**
   * Chaves já anunciadas nesta sessão.
   *
   * O aviso ao vivo e o resumo "enquanto eu estava fora" podem ver a MESMA
   * notificação (ela chega durante a abertura do app). Sem isto, o usuário
   * ouve a mesma mensagem duas vezes.
   */
  const announcedKeysRef = useRef<Set<string>>(new Set());
  /**
   * Mensagens que ainda serão tratadas, em ordem de chegada.
   *
   * Antes cada notificação abria uma conversa nova por cima da anterior: com
   * três mensagens seguidas o Nexus falava tudo junto e se perdia. Agora uma
   * conversa termina (ler → responder → enviar) e só então a próxima começa,
   * avisando de quem é.
   */
  const notificationQueueRef = useRef<NotificationMessage[]>([]);
  /** `true` enquanto uma conversa de notificação está em andamento. */
  const notificationFlowActiveRef = useRef(false);
  /** Fila pausada para o usuário terminar outro comando antes. */
  const notificationQueuePausedRef = useRef(false);
  /** Frase curta para anteceder a próxima mensagem da fila. */
  const notificationIntroRef = useRef('');
  /**
   * Lembrete esperando o usuário dizer o horário.
   *
   * "Me lembra de comprar pão" não tem hora: o Nexus pergunta "para quando?" e a
   * próxima fala é reprocessada como o horário. Serve para criar (`kind: create`)
   * e para MUDAR um lembrete existente sem hora nova (`kind: edit`).
   *
   * A conversa é por ETAPAS, na ordem em que o usuário pensa:
   *
   *   1. o QUE é ("que tipo de lembrete?") → "ir ao psicólogo"
   *   2. o DIA ("para que dia?")           → "27/10"
   *   3. a HORA ("para que horas?")         → "meio-dia e meia" (12:30)
   *
   * Cada resposta preenche uma peça; quando as três estão, o lembrete nasce
   * no dia e na hora exatos.
   */
  const pendingReminderRef = useRef<
    | {
        kind: 'create';
        title: string;
        description: string;
        /** O dia já dito ("27/10") — `null` enquanto falta. */
        day: string | null;
        /** A hora já dita ("meio dia e meia") — `null` enquanto falta. */
        hour: string | null;
        /** O TIPO: decide a tela que abre quando tocar. */
        type: 'lembrete' | 'alarme';
      }
    | { kind: 'edit'; id: string; title: string; description: string }
    | null
  >(null);
  /**
   * A MEMÓRIA DE APRENDIZADO do Nexus (rede neural + conversa aprendida).
   *
   * A rede é a MATRIZ DE LIGAÇÃO: aprende com cada comando que dá certo e
   * com cada correção do usuário ("tempo" passa a puxar "clima"). Ela nunca
   * executa nada — quem executa é o roteador determinístico, através da
   * tradução para pedido canônico (`recallLearnedIntent`).
   */
  const neuralRef = useRef<NeuralMemory | null>(null);
  /**
   * A última frase que NENHUM roteador entendeu (foi para a internet).
   *
   * Se o usuário repetir o pedido de outro jeito logo em seguida, as duas
   * frases se ligam: a que falhou aprende a intenção da que deu certo. É o
   * aprendizado por correção do dia a dia.
   */
  const lastUnresolvedRef = useRef<{ text: string; at: number } | null>(null);
  /**
   * A última resposta dada pela MEMÓRIA APRENDIDA (não pelo roteador).
   *
   * É o que permite o usuário corrigir a rede ("não é isso") e ela
   * desaprender a ligação na hora.
   */
  const lastNeuralRef = useRef<{ intent: string; text: string } | null>(null);
  /**
   * `true` quando o microfone precisa abrir MESMO com o app fora da frente.
   *
   * No fluxo de resposta o WhatsApp fica na tela (é lá que o texto é escrito), e
   * sem isso o microfone não abriria: a política de voz só abre fora do app pelo
   * toque no mascote.
   */
  const forceReplyCaptureRef = useRef(false);
  /**
   * A resposta que vai ser enviada pela AÇÃO da notificação (RemoteInput
   * "Responder"), sem abrir o WhatsApp.
   *
   * O fluxo dita o texto no `write-reply`; quando o caminho direto está
   * disponível, o texto é guardado AQUI e o envio acontece no `send-reply`
   * pela notificação — nenhuma tela do WhatsApp precisa aparecer, e o envio
   * funciona até com a tela apagada e bloqueada.
   */
  const pendingDirectReplyRef = useRef<{ contact: string; text: string } | null>(null);
  /**
   * `true` quando o Nexus acabou de perguntar algo e espera a RESPOSTA FALADA.
   *
   * Ex.: "Que tipo de música ou qual cantor você quer ouvir?". Quando a pergunta
   * termina de ser falada, o microfone reabre sozinho para o usuário só
   * responder — sem precisar tocar no botão de novo. É UMA abertura por pergunta:
   * se ninguém falar, o microfone fecha e não fica tentando outra vez.
   */
  const awaitingAnswerRef = useRef(false);
  const submitRef = useRef<(text: string) => void>(() => {});
  /** Mantém o append mais recente acessível aos listeners nativos. */
  const appendRef = useRef<(text: string, shareWithSearch?: boolean, speakIt?: boolean) => void>(
    () => {},
  );
  /** Identifica a fala atual do TTS, para não religar o microfone no meio dela. */
  const speechSeqRef = useRef(0);
  /**
   * Rastreia se o último comando veio do mascote flutuante.
   *
   * Quando o usuário toca no mascote, fala um comando, e o Nexus responde,
   * o microfone deve reabrir automaticamente para continuar a conversa
   * (modo "conversa contínua" do mascote).
   */
  const floatingMascotModeRef = useRef(false);
  /**
   * Token da fala em andamento.
   *
   * Parar a voz faz o callback nativo do `speakVoice` resolver `false`. Sem
   * este token, o `speakText` lia isso como "o motor nativo falhou" e chamava
   * o `expo-speech` — que **recomeçava** exatamente a fala que o usuário
   * acabou de interromper. Parar a voz invalida o token; só a fala ainda
   * válida pode terminar ou cair no caminho alternativo.
   */
  const speechTokenRef = useRef(0);

  /**
   * Portão da fala: quem precisa esperar o Nexus terminar de falar.
   *
   * É o que permite ANUNCIAR antes de a música/rádio começar ("Tocando a rádio
   * Itatiaia" e só depois o som entra). Sem o portão, o som chegava junto com
   * a fala e os dois se misturavam.
   */
  const speechGateRef = useRef<(() => void) | null>(null);

  /**
   * Pausa da mídia chamada na hora da fala.
   *
   * Fica num ref porque a pausa é montada depois do `appendAssistantMessage`:
   * assim o Nexus pode calar a rádio e a música no instante em que começa a
   * falar, sem a dependência circular de duas funções que se chamam.
   */
  const pauseMediaRef = useRef<() => void>(() => {});

  // ---------------------------------------------------------------------
  // Dono do microfone (ver app/core/voiceSessionPolicy.mjs)
  //
  // O AppState é o ÚNICO ponto de decisão: dentro do app o microfone só abre
  // no toque do botão; fora dele, com permissões liberadas, a escuta passiva
  // do mascote assume. Antes o próprio app ligava a escuta ao abrir, e o
  // microfone ficava abrindo e fechando sozinho.
  // ---------------------------------------------------------------------
  /** Estado do app visto pelo listener (fonte da decisão). */
  const appStateRef = useRef<string>(AppState.currentState ?? 'active');
  /** `true` enquanto uma captura do botão está em andamento. */
  const capturingRef = useRef(false);
  /** `true` enquanto o Nexus fala (o microfone fica fechado). */
  const speakingRef = useRef(false);
  /** `true` durante um pedido de permissão ou com a tela de permissões aberta. */
  const permissionFlowRef = useRef(false);
  /** Catálogo de emissoras mineiras, para o Nexus dizer quais ele toca. */
  const stationsRef = useRef<string[]>([]);
  /** Cancela a captura quando o Nexus começa a falar (definido mais abaixo). */
  const cancelCaptureRef = useRef<() => void>(() => {});
  /** Reavalia a política de voz (definido mais abaixo, usado por listeners). */
  const syncVoiceSessionRef = useRef<() => Promise<void>>(async () => {});

  /** Aplica a política do mascote: ele aparece fora do app, mas NÃO ouve sozinho. */
  const syncVoiceSession = useCallback(async () => {
    if (!isNativeAvailable()) return;

    try {
      const permissions = await getPermissionSnapshot();
      const plan = planVoiceSession({
        appState: appStateRef.current,
        microphoneGranted: permissions.microphone === true,
        overlayGranted: permissions.overlay === true,
        capturing: capturingRef.current,
        speaking: speakingRef.current,
        permissionRequestInFlight: permissionFlowRef.current,
      });

      // Não existe mais escuta armada: quem abre o microfone é o toque.

      if (plan.showMascot) {
        try {
          const shown = await nexusNative.showMascot();
          if (!shown) await nexusNative.summonMascot();
        } catch (e: any) {
          // Overlay negado: avisa o usuário de forma visível.
          if (e?.code === 'OVERLAY_PERMISSION_DENIED' || e?.message?.includes('Sobrepor outros apps')) {
            setNotice('⚠️ O mascote precisa de "Sobrepor outros apps" para aparecer. Ative nas configurações e volte.');
          }
          console.warn('[NEXOS] Mascote não exibido:', e);
        }
      }

      if (plan.stopListening) {
        // Fecha a porta do microfone. Fora do app quem abre é o toque no
        // mascote; dentro dele, o botão ⏺.
        await nexusNative.stopListening();
      }
    } catch (reason) {
      console.warn('[NEXOS] Falha ao ajustar o microfone:', reason);
    }
  }, []);

  useEffect(() => {
    syncVoiceSessionRef.current = syncVoiceSession;
  }, [syncVoiceSession]);

  useEffect(() => {
    permissionFlowRef.current = permissionsOpen;
  }, [permissionsOpen]);

  // Carrega o mascote salvo (nexo ou tratis).
  const refreshAvatar = useCallback(async () => {
    try {
      const profile = await loadProfile();
      setSelectedAvatar(profile.avatar === 'tratis' ? 'tratis' : 'nexus');
    } catch {
      // Sem perfil salvo: fica a Nexo.
    }
  }, []);

  useEffect(() => {
    void refreshAvatar();
  }, [refreshAvatar]);

  /** Ajustes fechados: recarrega o mascote na hora (a troca é salva automática). */
  const handleSettingsClosed = useCallback(() => {
    setSettingsOpen(false);
    void refreshAvatar();
  }, [refreshAvatar]);

  /** Limpa toda a conversa do chat. */
  const clearChat = useCallback(async () => {
    if (!isNativeAvailable()) {
      setMessages([]);
      return;
    }
    setMessages([]);
    try {
      await nexusNative.clearChatHistory();
    } catch {
      // Sem armazenamento nativo: a conversa segue só na memória.
    }
    setNotice('Conversa limpa.');
  }, []);

  /**
   * Interrompe a fala do Nexus.
   *
   * Toca as duas etapas da voz: a voz do aparelho (nativa) e o `expo-speech`.
   * Sem isso, uma fala que caiu para o `expo-speech` continuaria depois do
   * "parar".
   *
   * O token é invalidado ANTES de pedir a parada: o `stopVoice` nativo resolve
   * a promessa de `speakVoice` com `false`, e esse `false` não pode mais ser
   * interpretado como falha do motor (o que religava a fala pelo
   * `expo-speech`).
   */
  const stopSpeech = useCallback(async () => {
    speechTokenRef.current += 1;

    const stops: Promise<unknown>[] = [Speech.stop()];
    if (isNativeAvailable()) stops.push(nexusNative.stopVoice());

    // Parar nunca pode explodir na cara de quem só quer silêncio.
    await Promise.allSettled(stops);
  }, []);

  /**
   * Fala o texto com a voz do Nexus.
   *
   * A voz é a do **próprio aparelho**, em português do Brasil, e o nativo é quem
   * escolhe a melhor disponível (a local e neural, quando existir) — é o que
   * tira o sotaque de robô da voz padrão do Android. A fala sai assim:
   *
   *  1. a voz do aparelho pela ponte nativa (`speakVoice`) — o caminho normal;
   *  2. o `expo-speech` (o TTS do aparelho via Expo) — quando a primeira falha
   *     (build sem o código nativo, motor quebrado);
   *  3. o texto na tela — o Nexus nunca fica mudo nem some da conversa.
   *
   * Não existe motor neural, modelo embutido nem voz premium dentro do app.
   */
  const speakText = useCallback((text: string, onEnd: () => void) => {
    /*
     * Cada fala recebe um token. Uma fala nova — ou um "parar" — troca o token
     * e a fala anterior perde o direito de falar, de terminar e de cair no
     * caminho alternativo. É o que impede o texto interrompido de voltar a ser
     * falado pelo `expo-speech`.
     */
    const token = ++speechTokenRef.current;
    const isCurrent = () => speechTokenRef.current === token;

    // Só um fim por fala: os callbacks do TTS podem chegar juntos, e o fim não
    // pode ser contado duas vezes (o microfone voltaria a abrir no meio da
    // fala).
    let claimed = false;
    const finish = () => {
      if (claimed) return;
      claimed = true;
      if (!isCurrent()) return;
      onEnd();
    };

    /**
     * Segunda etapa: o `expo-speech`, o caminho genérico.
     */
    const speakWithExpo = () => {
      if (!isCurrent()) return;
      Speech.speak(text, {
        language: 'pt-BR',
        rate: 0.96,
        onStart: () => {
          if (isCurrent()) setSpeaking(true);
        },
        onDone: finish,
        onStopped: finish,
        onError: () => {
          if (!isCurrent()) return;
          finish();
          setNotice(
            'Não consegui reproduzir a resposta em voz neste aparelho. O texto continua disponível.',
          );
        },
      });
    };

    // A voz do aparelho: a nativa sabe escolher a melhor voz pt-BR.
    if (!isNativeAvailable()) {
      speakWithExpo();
      return;
    }

    setSpeaking(true);
    try {
      void nexusNative
        .speakVoice(text)
        .then((spoke) => {
          // A fala foi parada (ou trocada) enquanto o nativo respondia: não
          // religa nada.
          if (!isCurrent()) return;
          if (spoke) {
            finish();
            return;
          }
          // A voz do aparelho não respondeu: o `expo-speech` assume.
          speakWithExpo();
        })
        .catch(() => {
          if (!isCurrent()) return;
          speakWithExpo();
        });
    } catch {
      // Ponte nativa indisponível no meio do caminho: o texto não fica mudo.
      speakWithExpo();
    }
  }, []);

  const appendAssistantMessage = useCallback(
    (text: string, shareWithSearch = false, speakIt = true, addFollowUp = false) => {
      // Frases de acompanhamento para manter a conversa fluindo
      const followUpQuestions = [
        'O que você precisa?',
        'Como posso te ajudar?',
        'Posso ajudar em mais alguma coisa?',
        'Tem mais alguma coisa?',
        'Em que mais posso ser útil?',
      ];
      const finalText = addFollowUp
        ? `${text} ${followUpQuestions[Math.floor(Math.random() * followUpQuestions.length)]}`
        : text;

      setMessages((current) =>
        trimMessages([
          ...current,
          {
            id: `${Date.now()}-${Math.random()}`,
            role: 'assistant',
            text: finalText,
            shareWithSearch,
          },
        ]),
      );
      if (speakReplies && speakIt) {
        // Cada fala tem um número: quando outra começa, a anterior é
        // interrompida e não mexe mais no microfone.
        const seq = ++speechSeqRef.current;
        let claimed = false;
        const finish = () => {
          if (claimed) return;
          claimed = true;
          // Abre o portão: quem espera o Nexus terminar de falar continua.
          speechGateRef.current?.();
          if (speechSeqRef.current !== seq) return;
          setSpeaking(false);
          speakingRef.current = false;
          // Solta o microfone de volta ao motor de voz: ele fecha e só reabre
          // no próximo toque (botão do app ou mascote).
          if (isNativeAvailable()) void nexusNative.setAssistantSpeaking(false);
          // Folga curta antes de reavaliar: evita o motor captar o rabinho da
          // própria voz do Nexus.
          setTimeout(() => {
            void (async () => {
              // A política manda FECHAR o microfone enquanto o app está na
              // frente. Esperar essa decisão terminar antes de abrir evita que
              // o fechamento chegue depois e cancele a resposta recém-aberta
              // (o "não ouvi nada" logo depois da pergunta).
              await syncVoiceSessionRef.current();
              // Se foi uma PERGUNTA ("qual música?", "qual rádio?"), o
              // microfone reabre agora para o usuário só responder.
              listenForAnswerRef.current();
              // Se o comando veio do MASCOTE FLUTUANTE, reabre o microfone
              // para continuar a conversa (modo "conversa contínua").
              if (floatingMascotModeRef.current) {
                floatingMascotModeRef.current = false;
                try {
                  const permissions = await getPermissionSnapshot();
                  if (permissions.microphone === true) {
                    setNotice('Estou ouvindo pelo mascote: fale o seu pedido.');
                    // FIX: Passa SHORT_ANSWER_BIAS para melhor reconhecimento de sim/não/comandos curtos.
                    await nexusNative.startDirectCapture(SHORT_ANSWER_BIAS);
                  }
                } catch (reason) {
                  console.warn('[NEXOS] Falha ao reabrir microfone no modo mascote:', reason);
                }
              }
            })();
          }, 600);
        };

        // O Nexus não pode falar POR CIMA da música: a mídia é pausada no
        // instante da fala, para a resposta ser ouvida com clareza.
        pauseMediaRef.current();

        // O Nexus não pode ouvir a própria voz: microfone fechado enquanto ele
        // fala. Sem isso o motor transcrevia a própria pergunta ("qual música ou
        // cantor?") como se fosse um comando, e a resposta seguinte cortava a
        // pergunta antes de o usuário ouvi-la.
        speakingRef.current = true;
        if (isNativeAvailable()) void nexusNative.setAssistantSpeaking(true);
        cancelCaptureRef.current();

        speakText(text, finish);
      }
    },
    [speakReplies],
  );

  /**
   * Pergunta que espera resposta FALADA.
   *
   * Depois da pergunta, o microfone reabre sozinho: é o que permite responder
   * "amanhã" ou "3 pm" sem tocar em nada. Sem estas duas travas, a pergunta
   * ficava muda, esperando um toque que o usuário nem sabia que era preciso.
   */
  const askAndListen = useCallback(
    (text: string) => {
      awaitingAnswerRef.current = true;
      forceReplyCaptureRef.current = true;
      appendAssistantMessage(text);
    },
    [appendAssistantMessage],
  );

  /**
   * Fecha o microfone de uma captura em andamento (usado antes de o Nexus
   * falar). Nada é retomado depois: dentro do app, quem abre o microfone é o
   * botão.
   */
  useEffect(() => {
    cancelCaptureRef.current = () => {
      if (!isNativeAvailable() || !capturingRef.current) return;
      void nexusNative.stopListening();
    };
  }, []);

  /**
   * Abre o microfone para a RESPOSTA falada quando o Nexus acabou de perguntar.
   *
   * Uma abertura por pergunta: se a captura terminar sem fala, o microfone fecha
   * e não reabre sozinho — era esse vaivém que incomodava o usuário.
   */
  const listenForAnswerRef = useRef<(attempt?: number) => void>(() => {});

  useEffect(() => {
    listenForAnswerRef.current = (attempt = 0) => {
      if (!awaitingAnswerRef.current) return;
      if (!isNativeAvailable()) return;
      // Fora do app quem ouve é o mascote, e lá o usuário toca nele para falar.
      // A exceção é a resposta de uma notificação: o WhatsApp está na tela (é lá
      // que o texto vai ser escrito) e mesmo assim o microfone precisa abrir —
      // por isso a trava `forceReplyCaptureRef`.
      const forced = forceReplyCaptureRef.current;
      if (appStateRef.current !== 'active' && !forced) return;

      if (speakingRef.current) {
        // O TTS ainda está soltando o microfone. Não desiste: antes a pergunta
        // ficava sem resposta para sempre quando este instante chegava errado.
        if (attempt < 6) {
          setTimeout(() => listenForAnswerRef.current(attempt + 1), 500);
        }
        return;
      }

      if (capturingRef.current) {
        // Sobrou uma captura aberta: fecha e tenta de novo, em vez de deixar a
        // pergunta pendurada sem microfone.
        if (isNativeAvailable()) void nexusNative.stopListening();
        capturingRef.current = false;
        if (attempt < 3) {
          setTimeout(() => listenForAnswerRef.current(attempt + 1), 400);
        }
        return;
      }

      // A pergunta só é dada por atendida AQUI, quando o microfone vai abrir de
      // verdade. Limpar a trava antes (como era) fazia qualquer falha de
      // timing matar a resposta em definitivo.
      awaitingAnswerRef.current = false;
      forceReplyCaptureRef.current = false;

      void (async () => {
        try {
          const permissions = await getPermissionSnapshot();
          if (permissions.microphone !== true) {
            setNotice('Microfone bloqueado: responda pelo botão do Nexus.');
            return;
          }
          setNotice('Pode falar: estou ouvindo a resposta.');
          // Resposta curta ("sim", "não", "leia") ganha viés do reconhecedor.
          // A dicção da mensagem (passo "listening") continua sem viés para não
          // trocar as palavras do texto que vai para o chat.
          const step = pendingNotificationRef.current?.step;
          const bias = step && step !== 'listening' ? SHORT_ANSWER_BIAS : [];
          // A resposta de uma NOTIFICAÇÃO precisa ser ouvida também com a
          // tela apagada/bloqueada: o Nexus perguntou ("quer que eu leia?") e
          // o usuário responde de ouvido. Na captura comum, a trava de tela
          // fechava o microfone na hora — e o "sim" nunca chegava.
          if (pendingNotificationRef.current) {
            await nexusNative.startNotificationAnswerCapture(bias);
          } else {
            await nexusNative.startDirectCapture(bias);
          }
        } catch (reason) {
          console.warn('[NEXOS] Falha ao abrir o microfone para a resposta:', reason);
          setNotice('Não consegui abrir o microfone. Use o botão para falar.');
        }
      })();
    };
  }, []);

  // Mantém a referência usada pelos eventos nativos sempre atualizada.
  useEffect(() => {
    appendRef.current = appendAssistantMessage;
  }, [appendAssistantMessage]);

  /**
   * Frase única para qualquer resposta de rádio.
   *
   * A rádio toca DENTRO do Nexus, então o texto pode confirmar a emissora e a
   * cidade — e, quando o stream falha, dizer o motivo real em vez de fingir.
   */
  const describeRadio = useCallback((result: RadioResult | undefined, fallback: string): string => {
    if (!result) return 'Não consegui falar com o módulo de rádio do Nexus.';
    if (result.success) {
      if (result.stopped) return 'Rádio desligada.';
      if (result.paused) {
        return result.stationName ? `Rádio pausada (${result.stationName}).` : 'Rádio pausada.';
      }
      return result.stationName
        ? `Tocando ${result.stationName}${result.city ? ` (${result.city})` : ''} aqui no Nexus.`
        : fallback;
    }
    return result.error ?? 'Não consegui tocar essa rádio agora.';
  }, []);

  /**
   * Frase única dos controles de mídia: "pausa", "continua", "pula", "volta",
   * "para".
   *
   * O mesmo comando pode ter agido na rádio do Nexus (toca dentro do app) ou na
   * música que está tocando no OiTube/YouTube. Quem sabe onde foi é o nativo, que
   * devolve o aplicativo junto com o resultado; quando não há aplicativo, sobra a
   * resposta de rádio. O texto nunca confirma uma pausa que não aconteceu.
   */
  const describeMedia = useCallback(
    (result: RadioResult | undefined, control: string): string => {
      if (!result) return 'Não consegui falar com o módulo de mídia do Nexus.';
      if (!result.success) {
        return result.error ?? 'Não consegui ajustar a música que está tocando.';
      }
      const where = result.appName ? ` no ${result.appName}` : '';
      switch (result.mediaAction) {
        case 'pause':
          return `Música pausada${where}.`;
        case 'stop':
          return `Música parada${where}.`;
        case 'play':
          return `Música de volta${where}.`;
        case 'next':
          return `Pulei para a próxima${where}.`;
        case 'prev':
          return `Voltei para a faixa anterior${where}.`;
        default:
          break;
      }
      const labels: Record<string, string> = {
        play: 'Música de volta.',
        pause: 'Música pausada.',
        stop: 'Música parada.',
        next: 'Pulei para a próxima.',
        prev: 'Voltei para a faixa anterior.',
      };
      return describeRadio(result, labels[control] ?? 'Mídia ajustada.');
    },
    [describeRadio],
  );

  /**
   * Frase única para "tocar música".
   *
   * Deixa claro o que aconteceu de verdade: se o vídeo começou a tocar, diz
   * onde; se o Nexus só conseguiu abrir a busca, também diz.
   */
  const describeMusic = useCallback((result: MusicResult | undefined, query: string): string => {
    if (!result) return 'Não consegui falar com o módulo de música do Nexus.';
    if (!result.success) {
      return result.error ?? `Não consegui tocar "${query}" agora.`;
    }

    const app = result.appName ?? 'OiTube';
    const title = result.title || query;

    if (result.played) {
      return `Tocando "${title}" no ${app}.`;
    }
    return `Abri o ${app} na busca por "${title}" — não consegui identificar o vídeo exato para tocar sozinho.`;
  }, []);

  /**
   * Espera o Nexus terminar de falar.
   *
   * Tem rede de segurança: se a fala não terminar (o usuário interrompeu, o
   * aparelho engasgou), a espera acaba sozinha — a mídia não fica presa.
   */
  const waitSpeech = useCallback(
    (maxMs = 12000) =>
      new Promise<void>((resolve) => {
        let done = false;
        const open = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(open, maxMs);
        speechGateRef.current = open;
      }),
    [],
  );

  /**
   * Pausa a mídia que estiver tocando.
   *
   * O Nexus fala por cima da rádio e da música: sem esta pausa, a fala se
   * mistura com o som e ninguém entende nada. Vale para os dois: a rádio que
   * toca dentro do Nexus e a música de outro aplicativo.
   */
  const pausePlayingMedia = useCallback(async (): Promise<boolean> => {
    if (!isNativeAvailable()) return false;
    let paused = false;

    try {
      const radio = await nexusNative.pauseRadio();
      if (radio?.success && radio.paused && radio.stationName) paused = true;
    } catch {
      // Sem rádio carregada: segue para a música.
    }

    try {
      const music = await nexusNative.mediaControl('pause');
      if (music?.success && music.appName) paused = true;
    } catch {
      // Sem app de música: a mídia já está quieta.
    }

    return paused;
  }, []);

  // A pausa da mídia na hora da fala: montada aqui, chamada pelo
  // `appendAssistantMessage` (que vem antes no arquivo).
  useEffect(() => {
    pauseMediaRef.current = () => {
      void pausePlayingMedia();
    };
  }, [pausePlayingMedia]);

  /**
   * Fala o aviso e SÓ ENTÃO liga a mídia.
   *
   * É a diferença entre "Tocando a rádio Itatiaia" ser ouvido com clareza e o
   * Nexus falar por cima da rádio que já começou. A mídia é pausada antes do
   * aviso e só volta (ou começa) quando a fala acaba.
   */
  const announceThen = useCallback(
    async (text: string, action: () => Promise<void>): Promise<void> => {
      // 1) Silencia o que estiver tocando: a fala precisa de silêncio.
      await pausePlayingMedia();

      // 2) Fala o aviso.
      appendAssistantMessage(text);
      if (speakReplies) await waitSpeech();

      // 3) Agora sim: a música/rádio entra.
      await action();
    },
    [appendAssistantMessage, pausePlayingMedia, speakReplies, waitSpeech],
  );

  /**
   * Nome curto da emissora: o que o Nexus FALA antes de ligar a rádio.
   *
   * "Itatiaia" em vez de "Rádio Itatiaia 89.5 FM — Belo Horizonte": o aviso é
   * curto e a cidade fica para depois, se o usuário perguntar.
   */
  const stationLabel = useCallback((requested: string): string => {
    const wanted = foldAnswer(requested).trim();
    if (!wanted) return requested;
    const stations = stationsRef.current;
    const found = stations.find((name) => {
      const folded = foldAnswer(name).trim();
      return folded === wanted || folded.startsWith(wanted) || wanted.startsWith(folded);
    });
    return found ?? requested;
  }, []);

  /**
   * Frase única para o volume do som (escala de 0 a 5).
   *
   * O número é o que o usuário precisa ouvir: "volume 3 de 5". A palavra do
   * estado diz como soa agora — desligado, subindo, médio ou no máximo.
   */
  const describeVolume = useCallback(
    (result: VolumeResult | undefined, action: string): string => {
      if (!result?.success) return result?.error ?? 'Não consegui mudar o volume.';
      const level = result.level;
      const max = result.max || 5;
      const state =
        level === 0
          ? 'desligado'
          : level >= max
            ? 'no máximo'
            : level === 4
              ? 'em volume médio'
              : 'subindo';
      if (action === 'volume-up') return `Aumentei o som: volume ${level} de ${max} (${state}).`;
      if (action === 'volume-down') return `Diminui o som: volume ${level} de ${max} (${state}).`;
      if (action === 'volume-level') return `O volume está em ${level} de ${max} (${state}).`;
      return `Volume ${level} de ${max} (${state}).`;
    },
    [],
  );

  // ---------------------------------------------------------------------
  // Aprendizado: a matriz neural liga as falas do usuário às intenções.
  //
  // Tudo aqui é silencioso de propósito: aprender nunca pode atrasar a
  // resposta nem derrubar o app. Sem armazenamento? A rede segue na memória.
  // ---------------------------------------------------------------------

  /** Carrega a memória de aprendizado guardada no aparelho (uma vez por sessão). */
  useEffect(() => {
    let active = true;
    void loadNeuralMemory().then((memory) => {
      if (active) neuralRef.current = memory;
    });
    return () => {
      active = false;
      const memory = neuralRef.current;
      if (memory) flushNeuralSave(memory);
    };
  }, []);

  /**
   * Registra um ACERTO: a frase e a intenção que ela teve de verdade.
   *
   * Se a frase anterior não tinha sido entendida e o usuário REPETIU o pedido
   * de outro jeito (parecido), as duas se ligam: a que falhou aprende a mesma
   * intenção — é assim que "tempo" passa a valer "clima" sem ninguém ensinar
   * na mão.
   */
  const learnIntent = useCallback((text: string, intent: string) => {
    const memory = neuralRef.current;
    if (!memory || !text || !intent) return;

    const last = lastUnresolvedRef.current;
    if (last && Date.now() - last.at < 180_000 && last.text.trim() !== text.trim()) {
      learnFromCorrection(memory.net, last.text, text, intent);
    }
    lastUnresolvedRef.current = null;

    train(memory.net, text, intent, 1);
    scheduleNeuralSave(memory);
  }, []);

  /** Guarda a frase que nenhum roteador entendeu (candidata à correção). */
  const rememberUnresolved = useCallback((text: string) => {
    lastUnresolvedRef.current = { text: text.trim(), at: Date.now() };
  }, []);

  /**
   * `true` para o feedback curto do usuário corrigindo a última resposta.
   *
   * Só depois de uma resposta da MEMÓRIA APRENDIDA (não dos roteadores):
   * quem corrige o roteador está falando de outra coisa.
   */
  const isNegativeFeedback = useCallback((text: string) => {
    const folded = foldAnswer(text);
    const words = folded.split(' ').filter(Boolean);
    if (words.length > 6) return false;
    return /\b(nao e isso|nao era isso|errado|entendeu errado|entendi errado|voce entendeu mal|nao quis isso|para com isso|desaprende isso)\b/u.test(
      folded,
    );
  }, []);

  /**
   * Fala o clima de uma cidade (ou a previsão de amanhã dela).
   *
   * A consulta é de verdade (Open-Meteo): o Nexus nunca inventa o tempo.
   */
  const answerWeather = useCallback(
    async (city: string, day: 'today' | 'tomorrow') => {
      const weather = await nexusNative.getWeather(city, day);
      if (!weather) {
        // Fallback: pesquisa na web pelo clima
        const searchQuery = day === 'tomorrow' 
          ? `previsão do tempo amanhã ${city}` 
          : `clima agora ${city}`;
        const found = await nexusNative.searchWeb(searchQuery);
        if (found) {
          appendAssistantMessage(found.answer);
          return;
        }
        appendAssistantMessage(
          `Não consegui consultar o clima de ${city} agora. Tente de novo em instantes.`,
        );
        return;
      }
      if (weather.forecast === true) {
        appendAssistantMessage(
          `Amanhã em ${weather.cityName}: ${weather.condition}, máxima de ${Math.round(
            weather.temperature,
          )} graus.`,
        );
        return;
      }
      appendAssistantMessage(
        `Agora em ${weather.cityName}: ${Math.round(weather.temperature)} graus, ${weather.condition}.`,
      );
    },
    [appendAssistantMessage],
  );

  /**
   * Guarda na memória neural o caminho de tela que deu certo.
   *
   * A frase → intenção já é aprendida por `learnIntent`; aqui fica o "como
   * fazer" (os passos do auto bot), com contador de sucessos, persistido no
   * aparelho junto com a rede.
   */
  const recordLearnedPath = useCallback((intent: string, steps: string[]) => {
    const memory = neuralRef.current;
    if (!memory) return;
    rememberPath(memory, intent, steps);
    scheduleNeuralSave(memory);
  }, []);

  /**
   * Envia a mensagem para a lista de transmissão escolhida.
   *
   * O WhatsApp ficou na frente: depois do envio o Nexus volta para a tela
   * inicial no modo mascote, esperando o próximo pedido.
   */
  const sendBroadcastMessage = useCallback(
    async (message: string, listName: string) => {
      const result = await nexusNative.sendWhatsAppBroadcast(message, listName);
      appendAssistantMessage(
        result?.success
          ? 'Mensagem enviada com sucesso.'
          : result?.error ?? 'Não consegui enviar para a lista de transmissão.',
      );
      if (result?.success) {
        recordLearnedPath('whatsapp-broadcast', [
          'abrir o WhatsApp',
          'tocar no menu de três pontinhos',
          'tocar em Listas de transmissão',
          'tocar na lista abaixo de Suas transmissões',
          'escrever a mensagem no campo Mensagem',
          'tocar em Enviar',
          'avisar que a mensagem foi enviada',
          'voltar para a tela do Nexus',
        ]);
        // Termina DENTRO do Nexus, pronto para o próximo comando. Se o app não
        // puder vir para a frente, o standby normal (home + mascote) assume.
        void (async () => {
          try {
            await nexusNative.openAssistant();
            await new Promise((resolve) => setTimeout(resolve, 350));
          } catch {
            // Sem o módulo nativo: o standby abaixo resolve.
          }
          void returnToStandbyRef.current();
        })();
      }
    },
    [appendAssistantMessage, recordLearnedPath],
  );

  /**
   * Liga pelo discador do telefone (operadora), em três caminhos:
   *
   *  1. o alvo já é um número ("31 3712-0401") → disca direto;
   *  2. o alvo é um contato da agenda → disca pelo contato;
   *  3. o alvo é um LUGAR (UPA, táxi, farmácia, laboratório...) → procura o
   *     telefone na internet, FALA o número encontrado e só disca depois que o
   *     usuário confirma.
   *
   * Nada aqui é WhatsApp: essa é a ligação normal do aparelho.
   */
  const placeLocalCall = useCallback(
    async (target: string, allowLookup = false): Promise<void> => {
      const value = target.trim();
      if (!value) return;

      // 1) Número falado/escrito.
      if (looksLikePhoneNumber(value)) {
        const digits = value.replace(/\D/g, '');
        const result = await nexusNative.makeLocalCall(digits);
        appendAssistantMessage(
          result?.success
            ? `Ligando para ${formatPhoneBR(digits)}.`
            : result?.error ?? 'Não foi possível ligar.',
        );
        return;
      }

      // 2) Contato salvo no aparelho.
      const contacts = await nexusNative.searchContacts(value);
      if (contacts.length > 0) {
        const result = await nexusNative.makeLocalCall(contacts[0].name);
        appendAssistantMessage(
          result?.success
            ? `Ligando para ${result.contactName ?? contacts[0].name}.`
            : result?.error ?? 'Não foi possível ligar.',
        );
        return;
      }

      // 3) Lugar: procura o telefone na internet e pede confirmação.
      if (!allowLookup) {
        appendAssistantMessage(
          `Não achei "${value}" na sua agenda. Se for um lugar (UPA, táxi, farmácia), diga o nome completo que eu procuro o telefone na internet.`,
        );
        return;
      }

      setNotice(`Procurando o telefone de ${value} na internet...`);
      const found = await lookupPhoneNumber(value);
      setNotice('');

      if (!found) {
        appendAssistantMessage(
          `Não encontrei o telefone de ${value} na internet. Confira o nome e tente de novo.`,
        );
        return;
      }

      pendingLookupCallRef.current = {
        target: value,
        digits: found.digits,
        formatted: found.formatted,
      };
      awaitingAnswerRef.current = true;
      appendAssistantMessage(
        `Encontrei ${value}, telefone ${found.formatted}. Quer que eu ligue?`,
      );
    },
    [appendAssistantMessage],
  );

  /**
   * Executa as ações do fluxo de notificação, na ordem.
   *
   * As ações são decididas por `app/core/notificationFlow.mjs`; aqui só acontece
   * o que toca o aparelho. Quem fala o RESULTADO (enviou, não enviou, tocou ou
   * não) é esta função, com o retorno real das chamadas nativas — por isso o
   * fluxo nunca promete algo que não aconteceu.
   */
  const runNotificationActions = useCallback(
    async (actions: NotificationAction[], flow?: NotificationFlowState | null) => {
      // Vira `true` quando uma ação ESSENCIAL da resposta falha (escrever, enviar
      // ou apagar no chat). Nesse caso o fluxo para: o Nexus já disse o que
      // aconteceu de verdade, e continuar perguntando "posso enviar?" seria pedir
      // confirmação de uma resposta que nem chegou no campo do WhatsApp.
      let criticalFailed = false;

      for (const action of actions) {
        // Depois de uma falha essencial (escrever no chat), não adianta enviar:
        // o envio mandaria o rascunho errado ou nada.
        if (criticalFailed) break;
        switch (action.type) {
          case 'open-chat': {
            if (!isNativeAvailable()) break;
            // Caminho DIRETO (responder pela notificação): abrir o WhatsApp é
            // desnecessário — a leitura já veio da notificação e a resposta
            // vai pela ação "Responder". É o que mantém o aparelho com a tela
            // apagada/bloqueada durante toda a conversa.
            try {
              if (await nexusNative.canReplyWithoutOpeningWhatsApp()) {
                console.log('[NEXOS] Conversa pela notificação: WhatsApp não será aberto');
                break;
              }
            } catch {
              // Sem resposta do nativo: segue o caminho de tela.
            }
            // Abre o chat do contato CERTO: o intent da notificação quando ele
            // é deste contato; senão procura pelo nome dentro do WhatsApp.
            const opened = await nexusNative.openNotificationConversation(
              flow?.contact ?? lastNotificationRef.current?.contact ?? '',
            );
            if (!opened) {
              appendAssistantMessage('Não consegui abrir a conversa. Abra o WhatsApp no contato.');
            }
            break;
          }
          case 'play-audio': {
            if (!isNativeAvailable()) break;
            // Só devolve `true` quando o toque na reprodução aconteceu de fato:
            // sem controle encontrado, o Nexus avisa em vez de dizer que tocou.
            const played = await nexusNative.playLastNotificationAudio();
            if (!played) {
              appendAssistantMessage(
                'Não consegui tocar o áudio sozinho. Abra a conversa para ouvir.',
              );
            } else {
              appendAssistantMessage('Áudio tocado.');
            }
            break;
          }
          case 'write-reply': {
            if (!isNativeAvailable()) {
              criticalFailed = true;
              break;
            }
            const replyContact = flow?.contact || lastNotificationRef.current?.contact || '';
            // A ação "Responder" da notificação envia o texto DIRETO — não
            // precisa escrever no chat (nem abri-lo). Guarda o texto e deixa
            // o 'send-reply' disparar a ação. Se o caminho direto não
            // existir, o texto é escrito no chat como sempre.
            if (replyContact) {
              try {
                if (await nexusNative.canReplyWithoutOpeningWhatsApp()) {
                  pendingDirectReplyRef.current = { contact: replyContact, text: action.text };
                  console.log('[NEXOS] Resposta guardada para envio pela notificação');
                  break;
                }
              } catch {
                // Sem resposta do nativo: escreve no chat.
              }
            }
            const written = await nexusNative.writeWhatsAppReply(action.text);
            if (!written) {
              appendAssistantMessage(
                'Escrevi a resposta, mas não consegui colocar no chat. Fale de novo, por favor.',
              );
              criticalFailed = true;
            }
            break;
          }
          case 'send-reply': {
            if (!isNativeAvailable()) {
              criticalFailed = true;
              break;
            }
            const repliedTo = flow?.contact || lastNotificationRef.current?.contact || '';
            // 1) O envio pela AÇÃO da notificação: sem abrir o WhatsApp,
            //    funciona com a tela apagada e bloqueada.
            const direct = pendingDirectReplyRef.current;
            if (direct && direct.contact) {
              pendingDirectReplyRef.current = null;
              const sentDirect = await nexusNative.sendWhatsAppNotificationReply(
                direct.contact,
                direct.text,
              );
              if (sentDirect) {
                appendAssistantMessage(
                  repliedTo
                    ? `Mensagem enviada com sucesso para ${repliedTo}.`
                    : 'Mensagem enviada com sucesso.',
                );
                recordLearnedPath('whatsapp-notification-reply', [
                  'anunciar quem mandou a mensagem',
                  'ler a mensagem da notificação',
                  'ouvir a resposta falada do usuário',
                  'enviar pela ação Responder da notificação',
                  'avisar que a mensagem foi enviada',
                ]);
                break;
              }
              // O caminho direto falhou (a notificação pode ter sumido):
              // cai para o Auto-Bot abaixo — abre a conversa, escreve e envia.
              appendAssistantMessage('Vou enviar abrindo a conversa. Um instante.', false, false);
              try {
                await nexusNative.openNotificationConversation(direct.contact);
                const rewritten = await nexusNative.writeWhatsAppReply(direct.text);
                if (!rewritten) {
                  appendAssistantMessage(
                    'Não consegui enviar a resposta. A tela está bloqueada? Desbloqueie e mande de novo.',
                  );
                  criticalFailed = true;
                  break;
                }
              } catch {
                appendAssistantMessage(
                  'Não consegui enviar a resposta. A tela está bloqueada? Desbloqueie e mande de novo.',
                );
                criticalFailed = true;
                break;
              }
            }
            const sent = await nexusNative.sendWhatsAppReply();
            appendAssistantMessage(
              sent
                ? repliedTo
                  ? `Mensagem respondida para ${repliedTo}.`
                  : 'Mensagem respondida.'
                : 'Não consegui enviar. A resposta ficou escrita no chat.',
            );
            if (!sent) {
              criticalFailed = true;
            } else {
              recordLearnedPath('whatsapp-voice-reply', [
                'abrir a conversa de quem mandou a áudio',
                'tocar no áudio para o usuário ouvir',
                'perguntar se o usuário quer responder',
                'ouvir a resposta falada',
                'escrever no campo do WhatsApp',
                'tocar em Enviar',
                'avisar que a mensagem foi respondida',
                'voltar para a home do Android',
              ]);
            }
            break;
          }
          case 'clear-reply': {
            // Uma resposta guardada para o envio direto também sai: sem dono,
            // ela não pode ser enviada depois por engano.
            pendingDirectReplyRef.current = null;
            if (!isNativeAvailable()) {
              criticalFailed = true;
              break;
            }
            const cleared = await nexusNative.clearWhatsAppReply();
            if (cleared) {
              // Quem confirma o que aconteceu é quem executou — o fluxo não fala
              // "apaguei" por conta própria.
              appendAssistantMessage('Apaguei a resposta.');
            } else {
              appendAssistantMessage('Não consegui apagar o que escrevi. Apague no chat, por favor.');
              criticalFailed = true;
            }
            break;
          }
          case 'answer-call': {
            if (!isNativeAvailable()) break;
            const source = flow?.callSource ?? 'whatsapp';
            // O caminho de atender depende de quem está ligando: WhatsApp ou
            // telefone do chip (o Nexus resolve o nome salvo e mostra os dois
            // telefones: verde atende, vermelho recusa).
            const answered =
              source === 'phone'
                ? await nexusNative.answerPhoneCall()
                : await nexusNative.answerWhatsAppCall();
            if (answered) {
              // A chamada está ativa: o Nexus não fala por cima dela.
              callScreenHoldRef.current = true;
              void stopSpeech();
              void nexusNative.stopListening();
            }
            appendAssistantMessage(
              answered
                ? 'Chamada atendida.'
                : 'Não consegui tocar em atender. Atenda na tela do WhatsApp.',
              false,
              !answered,
            );
            break;
          }
          case 'decline-call': {
            if (!isNativeAvailable()) break;
            const source = flow?.callSource ?? 'whatsapp';
            const declined =
              source === 'phone'
                ? await nexusNative.declinePhoneCall()
                : await nexusNative.declineWhatsAppCall();
            appendAssistantMessage(
              declined
                ? 'Chamada recusada.'
                : 'Não consegui recusar. Toque em recusar na tela do WhatsApp.',
            );
            break;
          }
          case 'call-back': {
            if (!isNativeAvailable()) break;
            // Ligar de volta é a ação REAL de uma chamada perdida. Usa o mesmo
            // caminho verificado da chamada por voz (confere a agenda, abre a
            // conversa e confirma que a tela de chamada assumiu).
            const target = flow?.contact ?? '';
            const result = await nexusNative.makeWhatsAppCall(target, false);
            const started = result?.success === true;
            if (started) {
              // Chamada de volta ativa: silêncio e microfone fechado.
              callScreenHoldRef.current = true;
              void stopSpeech();
              void nexusNative.stopListening();
            }
            appendAssistantMessage(
              started
                ? `Ligando de volta para ${result.contactName ?? target}.`
                : result?.error ?? `Não consegui ligar para ${target}.`,
              false,
              !started,
            );
            break;
          }
          case 'call-contact': {
            if (!isNativeAvailable()) break;
            /*
             * O usuário escolheu ligar (ou chamar no vídeo) para quem acabou de
             * mandar a mensagem. Usa o mesmo caminho verificado do "ligar de
             * volta": confere a agenda, abre a conversa e confirma que a tela de
             * chamada assumiu. Quem fala o resultado é esta função.
             */
            const target = flow?.contact ?? '';
            const result = await nexusNative.makeWhatsAppCall(target, action.video === true);
            const started = result?.success === true;
            if (started) {
              callScreenHoldRef.current = true;
              void stopSpeech();
              void nexusNative.stopListening();
            }
            appendAssistantMessage(
              started
                ? action.video
                  ? `Chamada de vídeo para ${result.contactName ?? target}.`
                  : `Ligando para ${result.contactName ?? target}.`
                : result?.error ?? `Não consegui ligar para ${target}.`,
              false,
              !started,
            );
            break;
          }
          case 'resume-media': {
            if (!isNativeAvailable()) break;
            // Ainda tem mensagem na fila: a mídia continua pausada e só volta
            // quando o usuário terminar todas.
            if (notificationQueueRef.current.length > 0) break;
            await nexusNative.resumeMediaAfterNotification(
              flow?.mediaState?.radioWasPlaying === true,
              flow?.mediaState?.musicWasPlaying === true,
              flow?.mediaState?.musicAppName,
            );
            break;
          }
          case 'listen': {
            // A pergunta ainda vai ser falada: a trava faz o microfone abrir
            // quando a fala terminar (ver `listenForAnswerRef`). O "forçado"
            // cobre o caso em que o WhatsApp está na tela à frente do Nexus.
            awaitingAnswerRef.current = true;
            forceReplyCaptureRef.current = true;
            break;
          }
          default:
            break;
        }
      }

      return !criticalFailed;
    },
    [appendAssistantMessage, recordLearnedPath],
  );

  /** Mídia pausada quando a primeira mensagem chegou (para devolver no fim). */
  const notificationMediaStateRef = useRef<{
    radioWasPlaying?: boolean;
    musicWasPlaying?: boolean;
    musicAppName?: string;
  } | null>(null);

  /**
   * Segura a tela da chamada por um ciclo, mesmo antes de o Android marcar o
   * modo de áudio. Sem isso, o "atender" resolvia e o returnToStandby levava o
   * usuário para a home no instante em que a chamada estava conectando.
   */
  const callScreenHoldRef = useRef(false);

  /**
   * Voltar para a tela inicial (mascote esperando), accessible de onde o
   * envio da lista de transmissão acontece — antes de o `returnToStandby`
   * existir como função.
   */
  const returnToStandbyRef = useRef<() => void>(() => {});

  /** Volta para a tela inicial e deixa o mascote esperando. */
  const returnToStandby = useCallback(async () => {
    if (!isNativeAvailable()) return;
    console.log('[NEXOS] returnToStandby, appState:', appStateRef.current);

    // Uma chamada recém-atendida/ligada ainda pode estar conectando quando o
    // fluxo termina: segura a tela dela uma vez, sem esperar o modo de áudio.
    const holdCallScreen = callScreenHoldRef.current;
    callScreenHoldRef.current = false;

    // Durante uma chamada, a tela do WhatsApp manda: sair para a home ou
    // devolver a música por cima do áudio da chamada estragaria a conversa.
    let inCall = false;
    try {
      inCall = await nexusNative.isInCall();
    } catch {
      // Sem o módulo nativo, segue o fluxo normal.
    }
    if (holdCallScreen || inCall) {
      console.log('[NEXOS] returnToStandby ignorado: chamada em andamento');
      notificationMediaStateRef.current = null;
      void syncVoiceSessionRef.current();
      return;
    }

    const media = notificationMediaStateRef.current;
    notificationMediaStateRef.current = null;
    if (media) {
      try {
        await nexusNative.resumeMediaAfterNotification(
          media.radioWasPlaying === true,
          media.musicWasPlaying === true,
          media.musicAppName,
        );
      } catch {
        // Sem mídia para retomar.
      }
    }
    // O Nexus volta para a home e deixa o mascote esperando — mas só se o
    // usuário NÃO estiver usando o app agora. Quem está com o app na frente
    // continua com o app na frente (tirar a tela da pessoa seria pior).
    if (appStateRef.current === 'active') {
      void syncVoiceSessionRef.current();
      return;
    }
    let wentHome = false;
    try {
      wentHome = await nexusNative.goHome();
    } catch {
      // Sem acessibilidade não há como ir para a home.
    }
    if (!wentHome) {
      // Plano B sem acessibilidade: traz o próprio Nexus de volta para a
      // frente. Melhor do que deixar o usuário preso no WhatsApp.
      try {
        await nexusNative.openAssistant();
      } catch {
        // Sem como reabrir: o usuário volta no toque.
      }
      return;
    }
    try {
      const shown = await nexusNative.showMascot();
      if (!shown) await nexusNative.summonMascot();
      // O app saiu da frente: a palavra "nexo" passa a valer também com a
      // tela apagada/bloqueada. O microfone é do serviço em primeiro plano.
      await nexusNative.startWakeWordListening();
    } catch {
      // Overlay negado ou microfone sem permissão: segue sem mascote/escuta.
    }
  }, []);

  // O "voltar para a home no modo mascote" fica acessível para quem precisa
  // chamar antes de a função existir (o envio da lista de transmissão).
  returnToStandbyRef.current = () => {
    void returnToStandby();
  };

  const startNextNotificationRef = useRef<() => void>(() => {});

  /**
   * Encerra a conversa atual e começa a próxima (ou volta ao repouso).
   *
   * É aqui que o usuário ouve "Tem outra mensagem de Fulano" em vez de o Nexus
   * tentar abrir todas as conversas ao mesmo tempo.
   */
  const finishNotificationFlow = useCallback(() => {
    notificationFlowActiveRef.current = false;
    pendingNotificationRef.current = null;
    pendingDirectReplyRef.current = null;
    notificationAnswerRetryRef.current = 0;

    const next = notificationQueueRef.current[0];
    if (next) {
      notificationIntroRef.current = `Tem outra mensagem de ${next.contact}. `;
      startNextNotificationRef.current();
      return;
    }
    notificationIntroRef.current = '';
    void returnToStandby();
  }, [returnToStandby]);

  /** Abre a próxima conversa da fila, uma de cada vez. */
  const applyNotificationFlowRef = useRef<(result: NotificationFlowResult) => Promise<void>>(
    async () => {},
  );
  const startNextNotification = useCallback(() => {
    if (notificationFlowActiveRef.current) return;
    // Fila pausada pelo usuário: não começa a próxima notificação.
    if (notificationQueuePausedRef.current) return;
    const next = notificationQueueRef.current.shift();
    if (!next) {
      void returnToStandby();
      return;
    }

    notificationFlowActiveRef.current = true;
    notificationAnswerRetryRef.current = 0;
    lastNotificationRef.current = next;

    // Chamada AO VIVO continua sendo chamada para atender. Só uma notificação
    // guardada há muito tempo (o WhatsApp já desistiu) vira "ligar de volta".
    const type = resolveNotificationType(next);

    const started = startNotificationFlow({
      contact: next.contact,
      message: type === 'message' ? next.message : '',
      type,
      isAudio: next.isAudio === true,
      mediaState: notificationMediaStateRef.current ?? {},
    });
    pendingNotificationRef.current = started.state.step === 'done' ? null : started.state;

    const intro = notificationIntroRef.current;
    notificationIntroRef.current = '';
    if (started.say) {
      appendAssistantMessage(`${intro}${started.say}`);
      setNotice(started.say);
    }
    if (started.actions.length > 0) void applyNotificationFlowRef.current(started);
    if (started.state.step === 'done') finishNotificationFlow();
  }, [appendAssistantMessage, finishNotificationFlow, returnToStandby, runNotificationActions]);

  useEffect(() => {
    startNextNotificationRef.current = startNextNotification;
  }, [startNextNotification]);

  /**
   * Enfileira notificações (ao vivo ou guardadas) e começa a primeira.
   *
   * A chave evita contar duas vezes a mesma mensagem quando o aviso ao vivo e o
   * resumo de abertura se cruzam.
   */
  const enqueueNotifications = useCallback((items: NotificationMessage[]) => {
    const queue = notificationQueueRef.current;
    let added = 0;
    for (const item of items) {
      if (!item?.contact) continue;
      const key = `${item.contact}|${item.message}|${Math.floor((item.at ?? Date.now()) / 60_000)}`;
      if (announcedKeysRef.current.has(key)) continue;
      if (announcedKeysRef.current.size > 50) announcedKeysRef.current.clear();
      announcedKeysRef.current.add(key);
      queue.push(item);
      added += 1;
    }
    if (added === 0) return;

    if (added > 1 && !notificationFlowActiveRef.current) {
      notificationIntroRef.current = `Chegaram ${added} mensagens enquanto eu estava fora. `;
    }
    if (notificationFlowActiveRef.current) return;
    startNextNotificationRef.current();
  }, []);

  /**
   * Aplica um passo do fluxo de notificação: executa as ações, fala a pergunta e
   * guarda o próximo passo.
   *
   * Tocar o áudio é o único passo que bloqueia: a pergunta "quer responder?" só
   * faz sentido depois que o áudio termina (quem espera é o lado nativo, olhando
   * a própria tela do WhatsApp — nada de dormir por tempo fixo).
   */
  const applyNotificationFlow = useCallback(
    async (result: NotificationFlowResult) => {
      const progressed = await runNotificationActions(result.actions, result.state);

      if (!progressed) {
        // Uma ação essencial da resposta falhou e o Nexus JÁ avisou o que houve
        // de verdade. A conversa termina aqui, sem falar a próxima pergunta.
        finishNotificationFlow();
        return;
      }

      let state = result.state;
      let say = result.say;

      if (result.actions.some((action) => action.type === 'play-audio')) {
        const next = advanceNotificationFlow(state, { type: 'audio-finished' });
        state = next.state;
        await runNotificationActions(next.actions, state);
        say = next.say;
      }

      if (say) appendAssistantMessage(say);
      notificationAnswerRetryRef.current = 0;
      pendingNotificationRef.current = state.step === 'done' ? null : state;
      if (state.step === 'done') finishNotificationFlow();
    },
    [appendAssistantMessage, finishNotificationFlow, runNotificationActions],
  );

  useEffect(() => {
    applyNotificationFlowRef.current = applyNotificationFlow;
  }, [applyNotificationFlow]);

  /**
   * Executa um pedido de anotação ou lembrete.
   *
   * Guarda tudo no aparelho (SharedPreferences, ver NoteStore/ReminderStore). O
   * lembrete sem horário NÃO é salvo no chute: o Nexus pergunta "para quando?" e
   * só cria depois da resposta.
   */
  const saveReminderPlan = useCallback(
    async (plan: {
      title: string;
      description: string;
      triggerAtMillis: number;
      repeatDaily: boolean;
      spokenTime?: string;
      kind?: 'lembrete' | 'alarme';
    }): Promise<boolean> => {
      const kind = plan.kind ?? 'lembrete';
      const saved = await nexusNative.saveReminder({
        title: plan.title,
        description: plan.description,
        triggerAtMillis: plan.triggerAtMillis,
        repeatDaily: plan.repeatDaily,
        kind,
      });
      if (!saved) {
        appendAssistantMessage(
          kind === 'alarme' ? 'Não consegui criar o alarme.' : 'Não consegui criar o lembrete.',
        );
        return true;
      }
      const when = plan.spokenTime ?? describeTrigger(saved.triggerAtMillis);
      const repeat = saved.repeatDaily ? ' Todos os dias.' : '';
      // `exact: false` = o Android não deixou usar alarme exato: o aviso pode
      // atrasar. É melhor avisar do que prometer uma hora que não será cumprida.
      const warning = saved.exact === false
        ? ' O Android não autorizou alarme exato, então o aviso pode atrasar alguns minutos.'
        : '';
      const what = saved.description || saved.title;
      if (kind === 'alarme') {
        appendAssistantMessage(`Alarme "${what}" criado.${repeat}${warning}`);
        return true;
      }
      appendAssistantMessage(`Lembrete "${what}" criado com sucesso!${repeat}${warning}`);
      return true;
    },
    [appendAssistantMessage],
  );

  const executeAssistantTask = useCallback(
    async (plan: AssistantTaskPlan): Promise<boolean> => {
      if (!isNativeAvailable()) {
        appendAssistantMessage(
          'Anotações e lembretes precisam do build Android nativo instalado.',
        );
        return true;
      }

      switch (plan.action) {
        case 'note-save': {
          const saved = await nexusNative.saveNote(plan.text, plan.title);
          appendAssistantMessage(
            saved
              ? `Anotei: "${saved.title}". ${formatDateTime(saved.createdAt)}.`
              : 'Não consegui guardar a anotação.',
          );
          return true;
        }

        case 'note-list': {
          const notes = await nexusNative.listNotes();
          if (notes.length === 0) {
            appendAssistantMessage('Você ainda não tem anotações.');
            return true;
          }
          const spoken = notes
            .slice(0, 10)
            .map((note, position) => `${position + 1}. ${note.title}`)
            .join('. ');
          appendAssistantMessage(
            notes.length > 10
              ? `Suas ${notes.length} anotações. As dez mais recentes: ${spoken}.`
              : `Suas anotações: ${spoken}.`,
          );
          return true;
        }

        case 'note-read': {
          const notes = await nexusNative.listNotes();
          const note = pickByIndex(notes, plan.index);
          appendAssistantMessage(
            note
              ? `Anotação "${note.title}", de ${formatDateTime(note.createdAt)}: ${note.text}`
              : 'Não encontrei essa anotação.',
          );
          return true;
        }

        case 'note-delete': {
          if (plan.all) {
            const removed = await nexusNative.clearNotes();
            appendAssistantMessage(
              removed > 0
                ? `Apaguei ${removed} ${removed === 1 ? 'anotação' : 'anotações'}.`
                : 'Não havia anotações para apagar.',
            );
            return true;
          }
          const notes = await nexusNative.listNotes();
          const note = pickByIndex(notes, plan.index);
          if (!note) {
            appendAssistantMessage('Não encontrei essa anotação.');
            return true;
          }
          const removed = await nexusNative.deleteNote(note.id);
          appendAssistantMessage(
            removed ? `Apaguei a anotação "${note.title}".` : 'Não consegui apagar a anotação.',
          );
          return true;
        }

        case 'reminder-create': {
          if (!plan.triggerAtMillis) {
            /*
             * Uma conversa nova tem prioridade: a pergunta da notificação
             * ("quer que eu leia?") fica para trás.
             *
             * Sem isto, o fluxo da notificação roubava a resposta do DIA e da
             * HORA do lembrete — a resposta curta ("amanhã") era lida como um
             * "não" e o lembrete morria no meio do caminho.
             */
            const pendingFlow = pendingNotificationRef.current;
            if (pendingFlow && pendingFlow.step !== 'done') {
              pendingNotificationRef.current = null;
              notificationFlowActiveRef.current = false;
              await runNotificationActions([{ type: 'resume-media' }], pendingFlow);
            }

            /*
             * Faltam peças: o Nexus pergunta uma de cada vez.
             *
             * A ordem é a de cada pedido: o ALARME pergunta o NOME ("trabalho"),
             * depois a HORA e por fim o DIA — é o diálogo do despertador que o
             * usuário pediu. O LEMBRETE segue pensando primeiro no dia (o que é
             * → o dia → a hora).
             *
             * O que o usuário JÁ disse fica guardado, para não perguntar duas
             * vezes a mesma coisa.
             */
            const pending = {
              kind: 'create' as const,
              title: plan.title,
              description: plan.description,
              day: plan.dayText ?? null,
              hour: plan.hourText ?? null,
              type: plan.kind ?? 'lembrete',
            };
            pendingReminderRef.current = pending;
            // O microfone abre depois da pergunta: a resposta é falada.
            awaitingAnswerRef.current = true;
            forceReplyCaptureRef.current = true;

            if (!pending.description) {
              appendAssistantMessage(
                pending.type === 'alarme' ? 'Qual o nome do alarme?' : 'Que tipo de lembrete?',
              );
            } else if (pending.type === 'alarme') {
              appendAssistantMessage(
                pending.hour
                  ? 'Para qual dia você quer o alarme?'
                  : 'Para que hora quer o alarme?',
              );
            } else {
              appendAssistantMessage(
                pending.day ? 'Para que horas?' : 'Para que dia quer esse lembrete?',
              );
            }
            return true;
          }
          // Após criar o alarme/lembrete, gera a frase de confirmação usando o nome do usuário
          const speechText = formatAlarmReminderSpeech(userName ?? '', plan.description ?? plan.title, plan.isWorkAlarm);
          appendAssistantMessage(speechText);
          return saveReminderPlan(plan);
        }

        case 'reminder-edit': {
          const reminders = await nexusNative.listReminders();
          const reminder = pickByIndex(reminders, plan.index);
          if (!reminder) {
            appendAssistantMessage('Não encontrei esse lembrete.');
            return true;
          }
          if (!plan.triggerAtMillis) {
            // "muda o lembrete 2": qual horário novo? O Nexus pergunta.
            pendingReminderRef.current = {
              kind: 'edit',
              id: reminder.id,
              title: plan.description ?? reminder.title,
              description: plan.description ?? reminder.description,
            };
            awaitingAnswerRef.current = true;
            appendAssistantMessage(
              `Para que horas eu mudo o lembrete "${reminder.title}"?`,
            );
            return true;
          }
          const updated = await nexusNative.updateReminder(reminder.id, {
            ...(plan.description ? { description: plan.description, title: plan.description } : {}),
            triggerAtMillis: plan.triggerAtMillis,
            repeatDaily: plan.repeatDaily,
          });
          appendAssistantMessage(
            updated
              ? `Lembrete "${updated.title}" mudado para ${plan.spokenTime ?? describeTrigger(updated.triggerAtMillis)}.`
              : 'Não consegui mudar o lembrete.',
          );
          return true;
        }

        case 'reminder-list': {
          const reminders = await nexusNative.listReminders();
          appendAssistantMessage(speakReminderList(reminders));
          return true;
        }

        case 'reminder-delete': {
          if (plan.all) {
            const reminders = await nexusNative.listReminders();
            if (reminders.length === 0) {
              appendAssistantMessage('Você não tem lembretes.');
              return true;
            }
            const results = await Promise.all(
              reminders.map((item) => nexusNative.deleteReminder(item.id)),
            );
            const removed = results.filter(Boolean).length;
            if (removed === 0) {
              appendAssistantMessage('Não consegui apagar os lembretes.');
              return true;
            }
            appendAssistantMessage(
              removed < reminders.length
                ? `Apaguei ${removed} de ${reminders.length} lembretes. Os outros não saíram.`
                : `Apaguei ${removed} ${removed === 1 ? 'lembrete' : 'lembretes'}.`,
            );
            return true;
          }
          const reminders = await nexusNative.listReminders();
          const reminder = pickByIndex(reminders, plan.index);
          if (!reminder) {
            appendAssistantMessage('Não encontrei esse lembrete.');
            return true;
          }
          const removed = await nexusNative.deleteReminder(reminder.id);
          appendAssistantMessage(
            removed ? `Apaguei o lembrete "${reminder.title}".` : 'Não consegui apagar o lembrete.',
          );
          return true;
        }

        case 'reminder-pause': {
          /*
           * A PAUSA adia o toque por 5 minutos e o lembrete volta a tocar.
           *
           * A diferença para "desligar": o lembrete continua ligado, só adiado
           * — e pode ser pausado de novo, até o usuário mandar PARAR.
           */
          const reminders = await nexusNative.listReminders();
          const targets = plan.all ? reminders : [pickByIndex(reminders, plan.index)];
          const chosen = targets.filter((item): item is NonNullable<typeof item> => item !== null);
          if (chosen.length === 0) {
            appendAssistantMessage('Não encontrei esse lembrete.');
            return true;
          }

          const when = Date.now() + PAUSE_MINUTES * 60_000;
          const results = await Promise.all(
            chosen.map((item) => nexusNative.snoozeReminder(item.id, PAUSE_MINUTES)),
          );
          const done = chosen.filter((_, position) => results[position] !== null);
          if (done.length === 0) {
            appendAssistantMessage('Não consegui pausar o lembrete.');
            return true;
          }
          const names = done.map((item) => `"${item.title}"`).join(', ');
          appendAssistantMessage(
            `Pausado por ${PAUSE_MINUTES} minutos. ${names} toca de novo ${describeTrigger(when)}.`,
          );
          return true;
        }

        case 'reminder-disable':
        case 'reminder-enable': {
          const enable = plan.action === 'reminder-enable';
          const reminders = await nexusNative.listReminders();
          const targets = plan.all ? reminders : [pickByIndex(reminders, plan.index)];
          const chosen = targets.filter((item): item is NonNullable<typeof item> => item !== null);
          if (chosen.length === 0) {
            appendAssistantMessage('Não encontrei esse lembrete.');
            return true;
          }
          const results = await Promise.all(
            chosen.map((item) => nexusNative.setReminderEnabled(item.id, enable)),
          );
          // Só fala do que mudou de verdade: o retorno de cada chamada decide.
          const done = chosen.filter((_, position) => results[position] === true);
          if (done.length === 0) {
            appendAssistantMessage(
              enable ? 'Não consegui ativar o lembrete.' : 'Não consegui desativar o lembrete.',
            );
            return true;
          }
          const names = done.map((item) => `"${item.title}"`).join(', ');
          appendAssistantMessage(
            enable
              ? `Lembrete ${names} ativado.`
              : `Lembrete ${names} desativado. Não vou avisar até você ativar de novo.`,
          );
          if (done.length < chosen.length) {
            appendAssistantMessage(
              `Não consegui ${enable ? 'ativar' : 'desativar'} ${chosen.length - done.length} dos lembretes.`,
            );
          }
          return true;
        }

        default:
          return false;
      }
    },
    [appendAssistantMessage, runNotificationActions],
  );

  /**
   * Executa um comando nativo (WhatsApp, chamadas, rádio, mídia...).
   * Devolve `true` quando o comando foi tratado aqui, para não cair na pesquisa.
   */
  const executeNativePlan = useCallback(
    async (plan: NativeCommandPlan): Promise<boolean> => {
      if (!isNativeAvailable()) {
        appendAssistantMessage(
          'Essa função precisa do aplicativo com o build Android nativo instalado (o módulo nativo não está presente).',
        );
        setNotice('Módulo nativo ausente. Gere/instale o APK do build Android.');
        return true;
      }

      switch (plan.action) {
        case 'radio-play': {
          if (!plan.station) {
            // Só pediu "uma rádio": a próxima fala do usuário é a resposta.
            pendingRadioRef.current = true;
            // E o microfone reabre quando a pergunta terminar de ser falada.
            awaitingAnswerRef.current = true;
            const stations = stationsRef.current;
            appendAssistantMessage(
              stations.length > 0
                ? `Qual rádio de Minas você quer ouvir? Hoje eu toco: ${stations.join(', ')}.`
                : 'Qual rádio de Minas você quer ouvir?',
            );
            return true;
          }
          pendingRadioRef.current = false;
          const station = stationLabel(plan.station);
          // O aviso vem ANTES do som: a rádio só começa quando a fala acaba.
          await announceThen(`Tocando a rádio ${station}.`, async () => {
            const result = await nexusNative.playRadio(plan.station);
            // A rádio já foi anunciada: aqui só resta o que deu errado.
            if (!result?.success) {
              appendAssistantMessage(describeRadio(result, 'Não consegui tocar essa rádio agora.'));
            }
          });
          return true;
        }
        case 'radio-next': {
          await announceThen('Trocando de rádio.', async () => {
            const result = await nexusNative.playNextRadio();
            if (!result?.success) {
              appendAssistantMessage(describeRadio(result, 'Não consegui trocar de rádio.'));
            }
          });
          return true;
        }
        case 'radio-pause': {
          // Pausar É o silêncio: o comando acontece primeiro e a confirmação
          // vem depois, sem nada tocando por cima.
          const result = await nexusNative.pauseRadio();
          appendAssistantMessage(describeRadio(result, 'Rádio pausada.'));
          return true;
        }
        case 'radio-resume': {
          // O aviso vem antes de a rádio voltar: assim ninguém perde a frase.
          await announceThen('Voltando ao ar.', async () => {
            const result = await nexusNative.resumeRadio();
            if (!result?.success) {
              appendAssistantMessage(describeRadio(result, 'Não consegui retomar a rádio.'));
            }
          });
          return true;
        }
        case 'radio-stop': {
          const result = await nexusNative.stopRadio();
          appendAssistantMessage(describeRadio(result, 'Rádio desligada.'));
          return true;
        }
        case 'youtube': {
          if (!plan.query) {
            awaitingAnswerRef.current = true;
            appendAssistantMessage('O que você quer tocar no YouTube?');
            return true;
          }
          await announceThen(`Tocando ${plan.query} no YouTube.`, async () => {
            const result = await nexusNative.playYouTube(plan.query);
            if (!result?.success || !result.played) {
              appendAssistantMessage(describeMusic(result, plan.query));
            }
          });
          return true;
        }
        case 'oitube': {
          if (!plan.query) {
            awaitingAnswerRef.current = true;
            appendAssistantMessage('O que você quer tocar no OiTube?');
            return true;
          }
          await announceThen(`Tocando ${plan.query} no OiTube.`, async () => {
            const result = await nexusNative.playOiTube(plan.query);
            if (!result?.success || !result.played) {
              appendAssistantMessage(describeMusic(result, plan.query));
            }
          });
          return true;
        }
        case 'music': {
          const query = plan.query.trim();
          if (!query) {
            // Só pediu "uma música": a próxima fala do usuário é a resposta.
            pendingMusicRef.current = true;
            awaitingAnswerRef.current = true;
            appendAssistantMessage('Que tipo de música ou qual cantor você quer ouvir?');
            return true;
          }
          pendingMusicRef.current = false;
          await announceThen(`Tocando ${query}.`, async () => {
            const result = await nexusNative.playMusic(query);
            if (!result?.success || !result.played) {
              appendAssistantMessage(describeMusic(result, query));
            }
          });
          return true;
        }
        case 'volume-up':
        case 'volume-down': {
          // Um degrau por comando: o som sobe ou desce POUCO A POUCO.
          const result = await nexusNative.changeVolume(plan.action === 'volume-up' ? 1 : -1);
          appendAssistantMessage(describeVolume(result, plan.action));
          return true;
        }
        case 'volume-set': {
          const result = await nexusNative.setVolumeLevel(plan.level);
          appendAssistantMessage(describeVolume(result, plan.action));
          return true;
        }
        case 'volume-level': {
          const result = await nexusNative.getVolumeLevel();
          appendAssistantMessage(describeVolume(result, plan.action));
          return true;
        }
        case 'whatsapp-broadcast': {
          /*
           * Lista de transmissão: o WhatsApp já tem a lista criada, então o
           * Nexus só precisa do TEXTO da mensagem.
           *
           * A próxima fala do usuário é o texto — por isso a pergunta abre o
           * microfone e a resposta não volta como comando.
           */
          pendingBroadcastRef.current = true;
          pendingBroadcastNameRef.current = plan.listName ?? '';
          askAndListen('Qual mensagem?');
          return true;
        }
        case 'whatsapp-call': {
          if (!plan.contact) {
            // Iniciar fluxo: pedir contato
            pendingWhatsAppContactRef.current = true;
            pendingWhatsAppActionRef.current =
              plan.video === true
                ? 'video-call'
                : plan.video === false
                  ? 'voice-call'
                  : 'call-choice';
            awaitingAnswerRef.current = true;
            appendAssistantMessage(
              plan.video === true
                ? 'Para quem é a chamada de vídeo?'
                : plan.video === false
                  ? 'Para quem é a chamada de voz?'
                  : 'Para quem é a chamada no WhatsApp?',
            );
            return true;
          }
          if (plan.video === null) {
            // Contato já escolhido e o tipo não foi dito: pergunta antes de
            // ligar. A pergunta leva o nome do contato para deixar claro que
            // ele já está selecionado.
            pendingCallChoiceRef.current = plan.contact;
            awaitingAnswerRef.current = true;
            appendAssistantMessage(`Chamada de voz ou de vídeo para ${plan.contact}?`);
            return true;
          }
          const result = await nexusNative.makeWhatsAppCall(plan.contact, plan.video);
          const started = result?.success === true;
          const calledTo = result?.contactName?.trim() || plan.contact?.trim() || '';
          if (started) {
            // A chamada já assumiu o áudio: o Nexus fica em silêncio e com o
            // microfone fechado para não falar por cima do usuário.
            void stopSpeech();
            void nexusNative.stopListening();
            recordLearnedPath('whatsapp-call', [
              'abrir o WhatsApp',
              'buscar o contato pelo nome',
              'abrir a conversa',
              plan.video ? 'tocar em Ligação de vídeo' : 'tocar em Ligação de voz',
              'confirmar que a chamada abriu',
            ]);
          }
          appendAssistantMessage(
            started
              ? `${plan.video ? 'Chamada de vídeo' : 'Chamada de voz'} iniciada com ${calledTo} no WhatsApp.`
              : result?.error ?? `Não consegui ligar para ${plan.contact} pelo WhatsApp.`,
            false,
            !started,
          );
          return true;
        }
        case 'whatsapp-start-call': {
          // Usuário pediu chamada mas não disse o contato
          pendingWhatsAppContactRef.current = true;
          pendingWhatsAppActionRef.current =
            plan.video === true
              ? 'video-call'
              : plan.video === false
                ? 'voice-call'
                : 'call-choice';
          awaitingAnswerRef.current = true;
          appendAssistantMessage(
            plan.video === true
              ? 'Para quem é a chamada de vídeo?'
              : plan.video === false
                ? 'Para quem é a chamada de voz?'
                : 'Para quem é a chamada no WhatsApp?',
          );
          return true;
        }
        case 'whatsapp-delete-last-message': {
          /*
           * Apagar a ÚLTIMA mensagem ENVIADA — sempre "apagar para todos".
           *
           * O contato é opcional: com ele, o Nexus abre a conversa da pessoa;
           * sem ele, apaga na conversa que está na frente. Cada falha chega
           * com o motivo real da automação (a conversa não abriu, a lixeira
           * não apareceu...) — o Nexus avisa em vez de fingir que apagou.
           */
          const target = plan.contact?.trim() ?? '';
          const result = await nexusNative.deleteLastSentMessage(target || undefined);
          const deletedTo = result?.contactName?.trim() || target;
          appendAssistantMessage(
            result?.success
              ? deletedTo
                ? `Apaguei a última mensagem enviada para ${deletedTo}.`
                : 'Apaguei a última mensagem enviada nesta conversa.'
              : result?.error ?? 'Não consegui apagar a mensagem.',
          );
          if (result?.success) {
            recordLearnedPath('whatsapp-delete-last-message', [
              'abrir o WhatsApp',
              target ? 'buscar o contato pelo nome' : 'usar a conversa que já está aberta',
              'pressionar e segurar a última mensagem enviada',
              'tocar no ícone de lixeira no topo da tela',
              'selecionar "Apagar para todos"',
              'confirmar que a mensagem foi apagada',
              'informar "Mensagem apagada para [contato]"',
              'voltar para a tela do Nexus',
            ]);
            void returnToStandby();
          }
          return true;
        }
        case 'whatsapp-message': {
          if (!plan.contact || !plan.message) {
            // Faltando info - iniciar fluxo conversacional
            if (!plan.contact) {
              pendingWhatsAppContactRef.current = true;
              pendingWhatsAppActionRef.current = 'message';
              awaitingAnswerRef.current = true;
              appendAssistantMessage('Para quem você quer enviar a mensagem?');
            } else {
              // Tem contato mas não tem mensagem.
              //
              // O contato PRECISA ficar guardado: é ele que volta na hora de
              // enviar. Antes ele se perdia aqui e, quando o usuário dizia a
              // mensagem, o envio saía com contato vazio e nada acontecia —
              // nem no WhatsApp, nem na tela.
              pendingWhatsAppContactRef.current = false;
              pendingWhatsAppPendingContactRef.current = plan.contact;
              pendingWhatsAppMessageRef.current = true;
              awaitingAnswerRef.current = true;
              appendAssistantMessage('Qual a mensagem?');
            }
            return true;
          }
          const result = await nexusNative.sendWhatsAppMessage(plan.contact, plan.message);
          const sentTo = result?.contactName?.trim() || plan.contact?.trim() || '';
          console.log('[NEXOS] envio WhatsApp:', JSON.stringify(result), 'plano:', JSON.stringify(plan));
          appendAssistantMessage(
            result?.success
              ? sentTo
                ? `Mensagem enviada para ${sentTo}.`
                : 'Mensagem enviada.'
              : result?.error ?? 'Contato não encontrado.',
          );
          // O WhatsApp fica na frente depois do envio. Terminado o trabalho,
          // o Nexus volta ao repouso (home + mascote) para o usuário já poder
          // dar o próximo comando sem precisar sair do WhatsApp na mão.
          if (result?.success) {
            recordLearnedPath('whatsapp-message', [
              'abrir o WhatsApp',
              'buscar o contato pelo nome',
              'abrir a conversa',
              'escrever a mensagem no campo',
              'tocar em Enviar',
              'voltar para a home do Android',
            ]);
            void returnToStandby();
          }
          return true;
        }
        case 'whatsapp-start-message': {
          // Usuário pediu mensagem mas não disse tudo
          if (!plan.contact) {
            pendingWhatsAppContactRef.current = true;
            pendingWhatsAppActionRef.current = 'message';
            awaitingAnswerRef.current = true;
            appendAssistantMessage('Para quem você quer enviar a mensagem?');
          } else {
            // Tem contato mas não tem mensagem: mesma regra do caso acima —
            // guarda o contato para o envio não sair vazio.
            pendingWhatsAppContactRef.current = false;
            pendingWhatsAppPendingContactRef.current = plan.contact;
            pendingWhatsAppMessageRef.current = true;
            awaitingAnswerRef.current = true;
            appendAssistantMessage('Qual a mensagem?');
          }
          return true;
        }
        case 'whatsapp-confirm-send': {
          if (isNativeAvailable()) {
            const sent = await nexusNative.clickWhatsAppSend();
            appendAssistantMessage(
              sent
                ? 'Mensagem enviada.'
                : 'Não achei o botão de enviar. Abra a conversa com a mensagem escrita e diga "enviar" de novo.',
            );
            if (sent) void returnToStandby();
          }
          return true;
        }
        case 'whatsapp-cancel-send': {
          if (isNativeAvailable()) {
            await nexusNative.leaveForegroundMediaApp();
            appendAssistantMessage('Mensagem cancelada.');
          }
          return true;
        }
        case 'local-call': {
          if (!plan.contact) {
            // Guarda a pergunta: a próxima fala é o contato/número. Sem isso a
            // resposta caía na pesquisa da internet e a ligação nunca acontecia.
            pendingLocalCallRef.current = true;
            awaitingAnswerRef.current = true;
            appendAssistantMessage('Para qual contato ou número eu ligo?');
            return true;
          }
          await placeLocalCall(plan.contact, plan.lookup === true);
          return true;
        }
        case 'weather': {
          /*
           * Sem a cidade, o Nexus PERGUNTA: "de qual cidade?"
           *
           * Consultar o clima do lugar errado é pior do que perguntar — o
           * aparelho tem a localização, mas ela pode estar em outro estado.
           */
          if (!plan.city) {
            pendingWeatherRef.current = { day: plan.day ?? 'today' };
            askAndListen('De qual cidade você quer o clima?');
            return true;
          }
          await answerWeather(plan.city, plan.day ?? 'today');
          return true;
        }
        case 'media': {
          const control = plan.control;
          // Pausar e PARAR são o próprio silêncio: o comando acontece primeiro
          // e a confirmação vem depois, sem nada tocando por cima.
          if (control === 'pause' || control === 'stop') {
            const result = await nexusNative.mediaControl(control);
            appendAssistantMessage(describeMedia(result, control));
            return true;
          }

          // Voltar, pular e retomar: o aviso vem ANTES, com a mídia pausada,
          // para o Nexus ser ouvido com clareza.
          const announcement =
            control === 'next'
              ? 'Pulei para a próxima.'
              : control === 'prev'
                ? 'Voltei para a faixa anterior.'
                : 'Música de volta.';
          await announceThen(announcement, async () => {
            const result = await nexusNative.mediaControl(control);
            if (control === 'next' || control === 'prev') {
              // Pular com a música pausada precisa do "play" no fim, senão a
              // faixa troca e o som não volta.
              if (result?.success) await nexusNative.mediaControl('play');
            }
            if (!result?.success) {
              appendAssistantMessage(describeMedia(result, control));
            }
          });
          return true;
        }
        case 'open-last-message': {
          // O texto vem do aviso ao vivo ou do que o nativo guardou. Antes,
          // "leia a mensagem" só abria a conversa e não lia nada — e, sem
          // notificação em memória, caía na pesquisa da internet.
          let known: NotificationMessage | null = lastNotificationRef.current;
          if (!known) {
            const recent = await nexusNative.getRecentNotifications();
            known = recent.length > 0 ? recent[recent.length - 1] : null;
          }
          const opened = await nexusNative.openLastNotification();
          if (!known) {
            appendAssistantMessage(
              opened
                ? 'Abri a conversa mais recente, mas ainda não tenho o texto da mensagem.'
                : 'Ainda não recebi nenhuma mensagem do WhatsApp. Quando chegar uma, eu aviso.',
            );
            return true;
          }
          lastNotificationRef.current = known;
          void nexusNative.clearRecentNotifications();

          const who = known.contact || 'um contato';
          const text = (known.message ?? '').trim();
          const prefix = opened ? 'Abrindo a conversa. ' : '';

          if (known.isAudio === true) {
            appendAssistantMessage(`${prefix}É um áudio de ${who}. Vou tocar.`);
            await runNotificationActions([{ type: 'play-audio' }], null);
          } else if (text) {
            appendAssistantMessage(`${prefix}Mensagem de ${who}: "${text}".`);
          } else {
            appendAssistantMessage(
              `${prefix}A mensagem de ${who} não tem texto — pode ser foto, vídeo ou arquivo.`,
            );
          }
          return true;
        }
        case 'launch-app': {
          const result = await nexusNative.launchAppByName(plan.query);
          appendAssistantMessage(
            result?.success ? `Abrindo ${result.appName ?? plan.query}.` : `Não encontrei o app "${plan.query}".`,
          );
          return true;
        }
        case 'horoscopo': {
          const { consultarHoroscopo } = await import('./app/services/horoscope');
          const resultado = consultarHoroscopo(plan.signo);
          appendAssistantMessage(
            `Horóscopo de hoje para ${resultado.signo}: ${resultado.texto}.`,
          );
          return true;
        }
        default:
          return false;
      }
    },
    [
      announceThen,
      appendAssistantMessage,
      describeMedia,
      describeMusic,
      describeRadio,
      describeVolume,
      placeLocalCall,
      recordLearnedPath,
      returnToStandby,
      stationLabel,
    ],
  );

  const processNativeCommand = useCallback(
    async (command: string) => {
      const text = command.trim();
      if (!text) return;

      if (busyRef.current) {
        // Nada de descartar o que o usuário falou: guarda e responde em
        // seguida, assim o comando nunca "some".
        pendingCommandRef.current = text;
        setNotice('Recebi seu comando. Respondo assim que terminar o anterior.');
        return;
      }

      busyRef.current = true;
      setBusy(true);
      setNotice('');
      // Chegou um comando novo: se o Nexus estava esperando uma resposta falada,
      // ela (ou outra fala) já veio — não há mais motivo para abrir o microfone.
      awaitingAnswerRef.current = false;

      try {
        if (speaking) {
          await stopSpeech();
          setSpeaking(false);
          speakingRef.current = false;
          speechSeqRef.current += 1;
          // Libera o microfone do motor de voz: o TTS parou.
          void nexusNative.setAssistantSpeaking(false);
        }

        setMessages((current) =>
          trimMessages([
            ...current,
            {
              id: `${Date.now()}-user`,
              role: 'user',
              text,
              shareWithSearch: true,
            },
          ]),
        );

        // Confirmação de ligação para um número pesquisado na internet.
        //
        // Precisa vir ANTES do roteador: "sim" sozinho também é o gatilho de
        // confirmar envio no WhatsApp, e aqui ele vale como resposta à pergunta
        // "quer que eu ligue?".
        const pendingLookup = pendingLookupCallRef.current;
        if (pendingLookup && isShortAnswer(text)) {
          pendingLookupCallRef.current = null;
          if (isAffirmativeAnswer(text)) {
            const result = await nexusNative.makeLocalCall(pendingLookup.digits);
            appendAssistantMessage(
              result?.success
                ? `Ligando para ${pendingLookup.formatted}.`
                : result?.error ?? 'Não foi possível ligar.',
            );
          } else {
            appendAssistantMessage('Ligação cancelada.');
          }
          return;
        }

        // A CIDADE do clima: o Nexus perguntou e a resposta é o lugar.
        if (pendingWeatherRef.current) {
          const day = pendingWeatherRef.current.day;
          pendingWeatherRef.current = null;
          const city = text.trim();
          if (!city) {
            askAndListen('De qual cidade você quer o clima?');
            return;
          }
          await answerWeather(city, day);
          return;
        }

        // A mensagem da LISTA DE TRANSMISSÃO do WhatsApp.
        //
        // Vem antes de tudo: a pergunta mais recente é "qual mensagem?", e a
        // fala do usuário é o texto — não um comando, não uma resposta para a
        // notificação.
        if (pendingBroadcastRef.current) {
          pendingBroadcastRef.current = false;
          const pendingBroadcastName = pendingBroadcastNameRef.current;
          pendingBroadcastNameRef.current = '';
          const pendingMessage = pendingBroadcastMessageRef.current;
          pendingBroadcastMessageRef.current = '';

          // Segunda volta: o usuário já disse a MENSAGEM e agora está dizendo o
          // NOME da lista ("tem duas, qual?").
          if (pendingMessage) {
            const listName = text.trim();
            if (!listName) {
              appendAssistantMessage('Não entendi o nome da lista. Fale de novo.');
              return;
            }
            await sendBroadcastMessage(pendingMessage, listName);
            return;
          }

          const message = text.trim();
          if (!message) {
            appendAssistantMessage('Não entendi a mensagem. Fale de novo.');
            return;
          }
          appendAssistantMessage('Escrevendo e enviando para sua lista de transmissão.');

          // Com mais de uma lista, o Nexus pergunta qual é antes de enviar.
          const wanted = pendingBroadcastName;
          if (wanted) {
            await sendBroadcastMessage(message, wanted);
            return;
          }

          const lists = await nexusNative.listBroadcastLists();
          const names = lists?.success ? (lists.lists ?? []) : [];
          if (names.length === 0) {
            // A leitura da tela pode falhar (o WhatsApp demora a montar a
            // lista). O envio navega o caminho de novo e usa a primeira lista
            // abaixo de "Suas transmissões" — o pedido do usuário não morre.
            await sendBroadcastMessage(message, pendingBroadcastName);
            return;
          }
          if (names.length === 1) {
            await sendBroadcastMessage(message, names[0]);
            return;
          }

          // Mais de uma lista: a mensagem fica guardada e o Nexus pergunta.
          pendingBroadcastRef.current = true;
          pendingBroadcastMessageRef.current = message;
          askAndListen(`Para qual lista? Tenho: ${names.join(', ')}.`);
          return;
        }

        // Conversa de uma notificação do WhatsApp em andamento.
        //
        // Vem ANTES de tudo: enquanto o Nexus pergunta "leio? respondo? envio?",
        // a resposta curta ("sim"/"não") pertence a ESSA conversa — e não pode ser
        // confundida com o "confirmar envio" do roteador de comandos.
        const flow = pendingNotificationRef.current;

        /*
         * O LEMBRETE por etapas tem prioridade sobre a notificação.
         *
         * A pergunta mais recente é a do lembrete ("para que dia?", "para que
         * horas?"), e a resposta curta do usuário ("amanhã") é dela. Sem esta
         * ordem, o fluxo da notificação comia a resposta como se fosse um "não"
         * e o lembrete morria no meio do caminho.
         */
        const pendingReminder = pendingReminderRef.current;
        if (pendingReminder && flow && flow.step !== 'done') {
          pendingNotificationRef.current = null;
          notificationFlowActiveRef.current = false;
          await runNotificationActions([{ type: 'resume-media' }], flow);
        } else if (flow && flow.step !== 'done') {
          if (flow.step === 'listening') {
            // A fala do usuário É o texto da resposta que vai para o chat.
            const folded = foldAnswer(text);
            const wantsCancel =
              folded.split(' ').length <= 3 && CANCEL_REPLY_TOKENS.test(folded);
            if (wantsCancel) {
              pendingNotificationRef.current = null;
              appendAssistantMessage('Tudo bem, deixo para lá.');
              await runNotificationActions([{ type: 'resume-media' }], flow);
              finishNotificationFlow();
              return;
            }
            await applyNotificationFlow(
              advanceNotificationFlow(flow, { type: 'captured', text }),
            );
            return;
          }

          // "Ligar" / "chamada de vídeo" depois de ouvir a mensagem são PEDIDOS
          // DE CHAMADA (para quem mandou), não resposta escrita. Só vale nas
          // etapas em que o fluxo ofereceu as três opções: no "quer atender?"
          // de uma chamada, "ligar" continua sendo um "sim".
          const callRequest =
            flow.step === 'ask-read' ||
            flow.step === 'ask-reply' ||
            flow.step === 'confirm-send'
              ? parseCallRequest(text)
              : undefined;
          if (callRequest) {
            await applyNotificationFlow(
              advanceNotificationFlow(flow, {
                type: 'call',
                video: callRequest.video,
              }),
            );
            return;
          }

          // "Leia", "ler" e "abrir" só valem como "sim" aqui: nesta etapa a
          // pergunta é justamente se o Nexus pode ler a mensagem.
          const readRequested = flow.step === 'ask-read' && isReadConfirmation(text);

          if (isShortAnswer(text) || readRequested) {
            const affirmative = isAffirmativeAnswer(text) || readRequested;

            /*
             * A mensagem lida NA TELHA é a de verdade.
             *
             * A notificação do WhatsApp chega truncada (e às vezes sem texto,
             * por causa da privacidade): o balão aberto é quem tem a mensagem
             * inteira. Então o Nexus abre a conversa, lê e só então responde.
             */
            let read = '';
            if (affirmative && flow.step === 'ask-read') {
              try {
                await nexusNative.openLastNotification();
                read = (await nexusNative.readLastChatMessage()) ?? '';
              } catch {
                // Sem leitura: o Nexus fala o que tem (o texto da notificação).
              }
            }

            await applyNotificationFlow(
              advanceNotificationFlow(flow, {
                type: 'answer',
                affirmative,
                message: read || undefined,
              }),
            );
            return;
          }

          // A fala não é uma resposta: o usuário mudou de assunto. A conversa da
          // notificação termina aqui (devolvendo a mídia) e o comando segue o
          // caminho normal, sem ficar pendurado esperando "sim".
          pendingNotificationRef.current = null;
          notificationFlowActiveRef.current = false;
          // Se ainda há mensagens na fila, elas esperam este comando terminar:
          // falar "tem outra mensagem" por cima da resposta seria confuso.
          notificationQueuePausedRef.current = notificationQueueRef.current.length > 0;
          await runNotificationActions([{ type: 'resume-media' }], flow);
        }

        // Um lembrete que ficou esperando a conversa por etapas.
        //
        // A ordem é a mesma em que a gente pensa: primeiro O QUE é, depois o
        // DIA, depois a HORA. Cada resposta preenche uma peça; o lembrete só
        // nasce quando as três estão — e nasce no dia e na hora exatos.
        if (pendingReminder) {
          const folded = foldAnswer(text);
          if (folded.split(' ').length <= 3 && CANCEL_REPLY_TOKENS.test(folded)) {
            pendingReminderRef.current = null;
            appendAssistantMessage('Tudo bem, cancelei o lembrete.');
            return;
          }

          if (pendingReminder.kind === 'edit') {
            const when = parseWhen(text);
            if (!when) {
              askAndListen(
                'Não entendi o horário. Diga por exemplo: "às 7 da manhã" ou "27/10 às 15 horas".',
              );
              return;
            }
            pendingReminderRef.current = null;
            const updated = await nexusNative.updateReminder(pendingReminder.id, {
              description: pendingReminder.description,
              title: pendingReminder.title,
              triggerAtMillis: when.triggerAtMillis,
              repeatDaily: when.repeatDaily,
            });
            appendAssistantMessage(
              updated
                ? `Lembrete "${updated.title}" mudado para ${describeTrigger(updated.triggerAtMillis)}.`
                : 'Não consegui mudar o lembrete.',
            );
            return;
          }

          /*
           * Preenche o que a resposta trouxe e pergunta o que falta, na ordem
           * em que a gente pensa: O QUE é → o DIA → a HORA.
           *
           * A resposta pode trazer mais de uma peça ("ir ao psicólogo amanhã
           * às 9"): tudo o que vier é aproveitado, e só o que faltar é
           * perguntado.
           */
          const pieces = extractReminderPieces(text);

          /*
           * O DIA e a HORA são independentes do assunto: aproveitados primeiro,
           * para uma resposta como "amanhã" (na pergunta do quê) não se perder.
           */
          if (!pendingReminder.day && pieces.dayText) pendingReminder.day = pieces.dayText;
          if (!pendingReminder.hour && pieces.hourText) pendingReminder.hour = pieces.hourText;

          if (!pendingReminder.description) {
            if (!pieces.description) {
              askAndListen(
                pendingReminder.type === 'alarme'
                  ? 'Qual o nome do alarme?'
                  : 'Que tipo de lembrete?',
              );
              return;
            }
            pendingReminder.description = pieces.description;
            pendingReminder.title = deriveTitle(
              pieces.description,
              pendingReminder.type === 'alarme' ? 'Despertador' : 'Lembrete',
            );
          }

          /*
           * A ordem das perguntas depende do que está nascendo:
           *
           * ALARME: a HORA vem antes do DIA — "para que hora quer o alarme?"
           * e só depois "para qual dia?". É o diálogo do despertador.
           *
           * LEMBRETE: o DIA vem antes da HORA, como sempre foi.
           */
          const isAlarmFlow = pendingReminder.type === 'alarme';
          if (!isAlarmFlow && !pendingReminder.day) {
            askAndListen('Para que dia quer esse lembrete?');
            return;
          }

          if (!pendingReminder.hour) {
            askAndListen(
              isAlarmFlow
                ? 'Para que hora quer o alarme?'
                : 'Para que horas?',
            );
            return;
          }

          if (!pendingReminder.day) {
            askAndListen(
              isAlarmFlow
                ? 'Para qual dia você quer o alarme?'
                : 'Para que dia quer esse lembrete?',
            );
            return;
          }

          const composed = composeReminderTime(pendingReminder.day, pendingReminder.hour);
          if (!composed) {
            // Não inventa horário: refaz a última pergunta em vez de criar no
            // dia errado.
            pendingReminder.hour = null;
            askAndListen('Não entendi a hora.');
            return;
          }

          /*
           * Um horário no PASSADO não vira "criado com sucesso": o alarme
           * tocaria na hora, sem o usuário ter pedido isso. Melhor avisar.
           */
          if (composed.triggerAtMillis <= Date.now()) {
            // O dia E a hora voltam a faltar: o usuário escolhe os dois de novo.
            pendingReminder.day = null;
            pendingReminder.hour = null;
            askAndListen(
              `Esse horário (${composed.spokenTime}) já passou. Para que dia quer esse lembrete?`,
            );
            return;
          }

          pendingReminderRef.current = null;
          await saveReminderPlan({
            title: pendingReminder.title,
            description: pendingReminder.description,
            triggerAtMillis: composed.triggerAtMillis,
            repeatDaily: false,
            spokenTime: composed.spokenTime,
            kind: pendingReminder.type,
          });
          return;
        }

        /*
         * Feedback da MEMÓRIA APRENDIDA: "não é isso" logo depois de uma
         * resposta da rede neural faz a ligação desaprender na hora.
         *
         * Vem depois dos fluxos pendentes (a resposta curta pertence à
         * conversa que está aberta) e antes dos roteadores de sempre.
         */
        const lastNeural = lastNeuralRef.current;
        if (lastNeural && isNegativeFeedback(text)) {
          lastNeuralRef.current = null;
          const memory = neuralRef.current;
          if (memory) {
            registerNegative(memory.net, lastNeural.text ?? '');
            scheduleNeuralSave(memory);
          }
          appendAssistantMessage(
            'Entendi o toque. Desaprendi essa ligação — me mostra do jeito certo que eu aprendo.',
          );
          return;
        }

        // ===== FLUXOS PENDENTES (prioridade máxima: a resposta do usuário pertence a eles) =====
        
        // Mensagem da LISTA DE TRANSMISSÃO do WhatsApp (segunda volta: nome da lista)
        if (pendingBroadcastRef.current) {
          pendingBroadcastRef.current = false;
          const pendingBroadcastName = pendingBroadcastNameRef.current;
          pendingBroadcastNameRef.current = '';
          const pendingMessage = pendingBroadcastMessageRef.current;
          pendingBroadcastMessageRef.current = '';

          if (pendingMessage) {
            const listName = text.trim();
            if (!listName) {
              appendAssistantMessage('Não entendi o nome da lista. Fale de novo.');
              return;
            }
            await sendBroadcastMessage(pendingMessage, listName);
            return;
          }

          const message = text.trim();
          if (!message) {
            appendAssistantMessage('Não entendi a mensagem. Fale de novo.');
            return;
          }
          appendAssistantMessage('Escrevendo e enviando para sua lista de transmissão.');

          const wanted = pendingBroadcastName;
          if (wanted) {
            await sendBroadcastMessage(message, wanted);
            return;
          }

          const lists = await nexusNative.listBroadcastLists();
          const names = lists?.success ? (lists.lists ?? []) : [];
          if (names.length === 0) {
            await sendBroadcastMessage(message, pendingBroadcastName);
            return;
          }
          if (names.length === 1) {
            await sendBroadcastMessage(message, names[0]);
            return;
          }

          pendingBroadcastRef.current = true;
          pendingBroadcastMessageRef.current = message;
          askAndListen(`Para qual lista? Tenho: ${names.join(', ')}.`);
          return;
        }

        // Mensagem do WhatsApp aguardando envio (o usuário respondeu "Qual a mensagem?")
        if (pendingWhatsAppMessageRef.current) {
          pendingWhatsAppMessageRef.current = false;
          const contact = pendingWhatsAppPendingContactRef.current;
          pendingWhatsAppPendingContactRef.current = '';
          if (!isNativeAvailable()) return;
          if (!contact) {
            pendingWhatsAppContactRef.current = true;
            pendingWhatsAppActionRef.current = 'message';
            awaitingAnswerRef.current = true;
            appendAssistantMessage('Perdi o contato dessa mensagem. Para quem você quer enviar?');
            return;
          }
          const sent = await nexusNative.sendWhatsAppMessageToOpenChat(text);
          if (sent) {
            appendAssistantMessage(`Mensagem enviada para ${contact}.`);
          } else {
            appendAssistantMessage(`Mensagem pronta para ${contact}, mas não consegui enviar. Diga "enviar" para tentar novamente.`);
          }
          return;
        }

        // Contato do WhatsApp aguardando (o usuário respondeu "Para quem?")
        if (pendingWhatsAppContactRef.current) {
          const action = pendingWhatsAppActionRef.current;
          pendingWhatsAppContactRef.current = false;
          pendingWhatsAppActionRef.current = null;
          if (action === 'message') {
            pendingWhatsAppPendingContactRef.current = text;
            pendingWhatsAppMessageRef.current = true;
            awaitingAnswerRef.current = true;
            appendAssistantMessage('Qual a mensagem?');
            return;
          } else if (action === 'voice-call' || action === 'video-call' || action === 'call-choice') {
            const handled = await executeNativePlan({
              action: 'whatsapp-call',
              contact: text,
              video: action === 'call-choice' ? null : action === 'video-call',
            });
            if (handled) return;
          }
        }

        // Chamada local aguardando contato (o usuário respondeu "Para quem eu ligo?")
        if (pendingLocalCallRef.current) {
          pendingLocalCallRef.current = false;
          await placeLocalCall(text, isPlaceQuery(text));
          return;
        }

        // Resposta à pergunta "chamada de voz ou de vídeo?"
        const pendingCallContact = pendingCallChoiceRef.current;
        if (pendingCallContact) {
          const kind = parseCallKindAnswer(text);
          if (kind === null) {
            const folded = foldAnswer(text);
            const words = folded.split(' ').filter(Boolean);
            if (/\b(nao|cancela|cancelar|deixa|esquece|esquecer|negativo)\b/u.test(folded) && words.length <= 3) {
              pendingCallChoiceRef.current = null;
              appendAssistantMessage('Chamada cancelada.');
              return;
            }
            if (words.length <= 3 && /\b(voz|video|chamada|ligacao|ligar|sim|pode|qualquer|isso)\b/u.test(folded)) {
              awaitingAnswerRef.current = true;
              appendAssistantMessage(`Chamada de voz ou de vídeo para ${pendingCallContact}?`);
              return;
            }
            pendingCallChoiceRef.current = null;
          } else {
            pendingCallChoiceRef.current = null;
            const handled = await executeNativePlan({
              action: 'whatsapp-call',
              contact: pendingCallContact,
              video: kind,
            });
            if (handled) return;
          }
        }

        // Rádio aguardando emissora (o usuário respondeu "Qual rádio?")
        if (pendingRadioRef.current) {
          pendingRadioRef.current = false;
          const handled = await executeNativePlan({ action: 'radio-play', station: text });
          if (handled) return;
        }

        // Música aguardando query (o usuário respondeu "Qual música ou cantor?")
        if (pendingMusicRef.current) {
          pendingMusicRef.current = false;
          const answer = planMusicAnswer(text);
          const answerPlan: NativeCommandPlan =
            answer.platform === 'youtube'
              ? { action: 'youtube', query: answer.query }
              : answer.platform === 'oitube'
                ? { action: 'oitube', query: answer.query }
                : { action: 'music', query: answer.query };
          const handled = await executeNativePlan(answerPlan);
          if (handled) return;
        }

        // Cidade do clima aguardando (o usuário respondeu "De qual cidade?")
        const pendingWeather = pendingWeatherRef.current as { day: 'today' | 'tomorrow' } | null;
        if (pendingWeather) {
          const day = pendingWeather.day;
          pendingWeatherRef.current = null;
          const city = text.trim();
          if (!city) {
            askAndListen('De qual cidade você quer o clima?');
            return;
          }
          await answerWeather(city, day);
          return;
        }

        const localResult = resolveLocalCommand(text, new Date(), { name: userName });
        const lr = localResult as any;

        if (lr?.kind === 'reply') {
          appendAssistantMessage(lr.text ?? '');
          return;
        }

        if (lr?.kind === 'open-link') {
          if (!isSafeExternalLink(lr.url ?? '')) {
            throw new Error('Esse endereço não está na lista segura de sites.');
          }
          await Linking.openURL(lr.url);
          appendAssistantMessage(lr.confirmation ?? '');
          return;
        }

        /*
         * Pesquisa pedida de propósito ("pesquise X"): quem responde é a busca
         * interna do Nexus, falada na conversa. Abrir o Google aqui tirava o
         * usuário do app no meio do pedido — o navegador só abre quando ele
         * pede um SITE pelo nome ("abra o YouTube").
         */
        if (lr?.kind === 'search') {
          await researchAndAnswer(lr.query ?? '');
          return;
        }

        // Pausa / retomada da fila de notificações (não precisa do nativo:
        // só controla a fila JS de leitura de mensagens).
        if (lr?.kind === 'pause-notifications') {
          notificationQueuePausedRef.current = true;
          void stopSpeech();
          appendAssistantMessage(
            'Pausado. As notificações ficam na fila e eu não leio a próxima até você dizer para retomar.',
          );
          return;
        }

        if (lr?.kind === 'resume-notifications') {
          notificationQueuePausedRef.current = false;
          const next = notificationQueueRef.current[0];
          if (next) {
            notificationIntroRef.current = `Tem outra mensagem de ${next.contact}. `;
            startNextNotificationRef.current();
          } else {
            appendAssistantMessage('Retomado. Não há notificações esperando na fila.');
          }
          return;
        }

        // Pausa / retomada da fila de notificações (não precisa do nativo:
        // só controla a fila JS de leitura de mensagens).
        if (lr?.kind === 'pause-notifications') {
          notificationQueuePausedRef.current = true;
          void stopSpeech();
          appendAssistantMessage(
            'Pausado. As notificações ficam na fila e eu não leio a próxima até você dizer para retomar.',
          );
          return;
        }

        if (lr?.kind === 'resume-notifications') {
          notificationQueuePausedRef.current = false;
          const next = notificationQueueRef.current[0];
          if (next) {
            notificationIntroRef.current = `Tem outra mensagem de ${next.contact}. `;
            startNextNotificationRef.current();
          } else {
            appendAssistantMessage('Retomado. Não há notificações esperando na fila.');
          }
          return;
        }

        // Conversa social ("como você está?", "dormiu bem?", "obrigado").
        // Vem antes do conhecimento e da pesquisa: não é pergunta de fato.
        const social = answerSmallTalk(text);
        if (social) {
          appendAssistantMessage(social);
          return;
        }

        /*
         * O cérebro de conversa: piada, tédio, apoio, motivação, papo.
         *
         * Responde offline, com falares brasileiros, e cada resposta ensina a
         * matriz neural (`chat-<tópico>`) — na próxima vez que o usuário
         * disser de outro jeito, é a rede que lembra o tópico.
         */
        const chat = answerConversation(text);
        if (chat) {
          appendAssistantMessage(chat.text);
          learnIntent(text, `chat-${chat.topic}`);
          return;
        }

        // Mega-Sena: pedido de JOGO responde na hora (sorteio local); pedido de
        // RESULTADO consulta a Caixa. "Resultado e mais dois jogos" faz as duas
        // coisas e fala as duas — uma não substitui a outra.
        const lotteryRequest = parseLotteryRequest(text);
        if (lotteryRequest) {
          const parts: string[] = [];
          let resultFailed = false;

          if (lotteryRequest.wantsResult) {
            const latest = await fetchLatestMegaSena();
            const spoken = latest ? formatMegaSenaResult(latest) : '';
            if (spoken) parts.push(spoken);
            else resultFailed = true;
          }

          if (lotteryRequest.wantsGames) {
            parts.push(formatLotteryGames(lotteryRequest.count));
          }

          if (resultFailed) {
            parts.unshift(
              'Não consegui consultar o último resultado da Mega-Sena agora. Tente de novo em instantes.',
            );
          }

          if (parts.length > 0) {
            appendAssistantMessage(parts.join(' '));
            return;
          }
        }

        // Anotações e lembretes/depois do roteador de conversa e antes do de
        // comandos nativos: "me lembra de ligar para a mãe às 3" tem um "ligar"
        // que, sozinho, pareceria pedido de chamada.
        const taskPlan = planAssistantTask(text);
        if (taskPlan) {
          const handled = await executeAssistantTask(taskPlan);
          if (handled) return;
        }

        // Comandos nativos (WhatsApp, chamadas, rádio, música, mídia, abrir apps)
        const plan = planNativeCommand(text);
        if (plan) {
          pendingMusicRef.current = false;
          pendingRadioRef.current = false;
          const handled = await executeNativePlan(plan);
          if (handled) {
            // Acertou: a matriz aprende a frase com a intenção que ela teve.
            learnIntent(text, plan.action);
            return;
          }
        }

        // Frase do dia e manchetes.
        //
        // Vêm DEPOIS de todo comando explícito: senão "abre o YouTube e vê as
        // notícias" viraria leitura em voz alta. A frase sai de uma lista fixa
        // (escolhida pelo dia) e as manchetes de um feed real; quando o feed não
        // responde, o Nexus diz que não conseguiu em vez de inventar.
        const daily = planDailyExtra(text);
        if (daily) {
          if (daily.action === 'phrase') {
            appendAssistantMessage(pickDailyPhrase());
            return;
          }
          const headlines = await fetchHeadlines(daily.topic);
          appendAssistantMessage(summarizeHeadlines(headlines, { topic: daily.topic }));
          return;
        }

        // O conhecimento de bolso: o que o Nexus sabe SEM internet.
        //
        // Vem antes da pesquisa de propósito: a curiosidade ("qual a maior
        // cidade do mundo") e o fato simples não podem depender de rede — e é
        // justamente quando a internet cai que o usuário mais precisa da
        // resposta. Se não souber, o app segue para a pesquisa.
        const known = answerFromLocalKnowledge(text);
        if (known) {
          appendAssistantMessage(known);
          return;
        }

        /*
         * A MEMÓRIA APRENDIDA: o último recurso local antes da internet.
         *
         * 1. Papo que a internet já respondeu e foi guardado — agora vale
         *    offline (a biblioteca de conversa cresce com o uso);
         * 2. A frase que a rede neural aprendeu com o dia a dia (e que os
         *    roteadores de cima não reconheceram): ela vira o pedido canônico
         *    e executa com as MESMAS confirmações e travas de sempre;
         * 3. A conversa que só a rede lembra o tópico.
         *
         * Nada aqui é chute: sem confiança suficiente, o pedido segue para a
         * pesquisa como sempre seguiu.
         */
        const memory = neuralRef.current;
        if (memory) {
          const learnedChat = answerFromLearned(text, memory.chat);
          if (learnedChat) {
            appendAssistantMessage(learnedChat);
            return;
          }

          const recalled = recallLearnedIntent(memory.net, text);
          if (recalled) {
            lastNeuralRef.current = { intent: recalled.intent, text };
            // O plano veio da ponte (`neuralIntent.mjs`, JS puro): para o
            // executor ele é um plano nativo como qualquer outro — e carrega
            // as MESMAS confirmações de sempre.
            const handled = await executeNativePlan(recalled.plan as NativeCommandPlan);
            if (handled) {
              learnIntent(text, recalled.intent);
              return;
            }
            lastNeuralRef.current = null;
          }

          const chatPrediction = predict(memory.net, text);
          if (
            typeof chatPrediction.intent === 'string' &&
            chatPrediction.intent.startsWith('chat-') &&
            chatPrediction.confidence >= MIN_CONFIDENCE
          ) {
            const chatText = answerByTopic(chatPrediction.intent.slice('chat-'.length));
            if (chatText) {
              appendAssistantMessage(chatText);
              learnIntent(text, chatPrediction.intent);
              return;
            }
          }
        }

        // Ninguém entendeu: a frase fica registrada como candidata à CORREÇÃO.
        // Se o usuário repetir o pedido de outro jeito que dê certo, a rede
        // liga as duas frases e passa a entender o primeiro jeito de falar.
        rememberUnresolved(text);

        // A pesquisa: o próprio Nexus vai na internet e responde, sem abrir o
        // navegador e sem sair da conversa.
        await researchAndAnswer(text);

        /**
         * Pesquisa interna: o próprio Nexus busca e resume, sem abrir navegador.
         *
         * Usada pela pesquisa pedida de propósito e pelo texto que não casou com
         * nenhum comando local. Quando a busca falha, a resposta diz o que
         * aconteceu — nunca inventa um resultado. Fica declarada aqui (função,
         * não `const`) porque é içada: quem chama está acima, mas a busca na web
         * continua DEPOIS do conhecimento de bolso.
         */
        async function researchAndAnswer(query: string) {
          const found = await nexusNative.searchWeb(query);
          if (!found) {
            setNotice(
              'Não consegui pesquisar agora. Os comandos locais (data, hora, clima, lembretes) continuam funcionando.',
            );
            appendAssistantMessage(
              'Não consegui encontrar isso agora. Tente de novo quando a internet estiver de pé — ou me peça alguma coisa que eu saiba sem internet.',
            );
            return;
          }
          /*
           * Papo respondido pela internet: o par pergunta→resposta entra na
           * biblioteca de conversa e passa a valer OFFLINE nas próximas
           * vezes. É a internet ACRESCENTANDO à biblioteca local — nunca
           * substituindo.
           */
          const learningMemory = neuralRef.current;
          if (learningMemory && isConversational(query)) {
            const pair = learnConversationPair(query, found.answer);
            if (pair) {
              rememberChatPair(learningMemory, pair);
              scheduleNeuralSave(learningMemory);
            }
          }
          appendAssistantMessage(found.answer);
          if (found.source) {
            setNotice(`${found.source}${found.title ? `: ${found.title}` : ''}`);
          }
        }
      } catch (reason) {
        setNotice(errorMessage(reason));
      } finally {
        busyRef.current = false;
        setBusy(false);

        // Retoma o comando que chegou enquanto o Nexus respondia.
        const pending = pendingCommandRef.current;
        if (pending) {
          pendingCommandRef.current = '';
          setTimeout(() => processRef.current(pending), 200);
        }

        // Retoma a fila de mensagens que esperou este comando terminar.
        if (notificationQueuePausedRef.current) {
          notificationQueuePausedRef.current = false;
          setTimeout(() => startNextNotificationRef.current(), 700);
        }
      }
    },
    [
      appendAssistantMessage,
      applyNotificationFlow,
      askAndListen,
      executeAssistantTask,
      executeNativePlan,
      finishNotificationFlow,
      isNegativeFeedback,
      learnIntent,
      messages,
      placeLocalCall,
      rememberUnresolved,
      runNotificationActions,
      saveReminderPlan,
      sendBroadcastMessage,
      speaking,
    ],
  );

  /** Permite reprocessar um comando sem depender do estado mais recente. */
  const processRef = useRef<(text: string) => void>(() => {});

  useEffect(() => {
    processRef.current = (text: string) => {
      void processNativeCommand(text);
    };
  }, [processNativeCommand]);

  const submitMessage = useCallback(
    async (rawText: string) => {
      await processNativeCommand(rawText);
    },
    [processNativeCommand],
  );

  // Mantém o último handler acessível aos listeners nativos sem reassinar a cada mensagem.
  useEffect(() => {
    submitRef.current = (text: string) => {
      void submitMessage(text);
    };
  }, [submitMessage]);

  const handleSend = () => {
    const message = draft.trim();
    if (!message || busy) return;
    setDraft('');
    void submitMessage(message);
  };

  /** Um exemplo do estado inicial entra como se tivesse sido digitado. */
  const handleExample = (text: string) => {
    if (busy) return;
    setDraft('');
    void submitMessage(text);
  };

  const handleVoiceToggle = async () => {
    if (!speakReplies) {
      setSpeakReplies(true);
      return;
    }
    try {
      await stopSpeech();
      setSpeaking(false);
      speakingRef.current = false;
      // O TTS parou: o microfone volta a ficar disponível para o motor de voz.
      if (isNativeAvailable()) void nexusNative.setAssistantSpeaking(false);
      setSpeakReplies(false);
    } catch (reason) {
      setNotice(`Não consegui parar a resposta em voz: ${errorMessage(reason)}`);
    }
  };

  /**
   * O botão de microfone da tela: UM toque = UM comando.
   *
   * Aqui dentro não existe palavra de ativação nem a regra dos 5 segundos — o
   * usuário já está falando com o Nexus. O motor ouve o pedido e fecha o
   * microfone no fim da fala, sem reabrir (era o vaivém de abre/fecha sozinho
   * que atrapalhava o uso dentro do app).
   */
  const handleMicrophone = async () => {
    setNotice('');

    if (!isNativeAvailable()) {
      setNotice(
        'O microfone do Nexus precisa do build Android nativo instalado. No modo Expo (limitado), escreva o comando aqui embaixo.',
      );
      return;
    }

    // Segundo toque: fecha o microfone sem esperar o fim da fala.
    if (capturingRef.current) {
      await nexusNative.stopListening();
      return;
    }

    /*
     * O toque no microfone SEMPRE cala o Nexus — inclusive enquanto ele ainda
     * está processando a resposta (`busy`). Antes, com o app ocupado, o toque
     * caía no `busy` e a voz seguia até o fim do texto.
     *
     * `stopSpeech` invalida a fala ANTES de parar o áudio; assim o callback
     * nativo com `false` não religa o `expo-speech`.
     */
    const wasSpeaking = speakingRef.current;
    await stopSpeech();
    setSpeaking(false);
    speakingRef.current = false;
    speechSeqRef.current += 1;
    void nexusNative.setAssistantSpeaking(false);

    if (busy) return;

    try {
      const micStep = PERMISSION_STEPS.find((step) => step.key === 'microphone');
      if (micStep) {
        // Enquanto o diálogo de permissão está na tela, a escuta do mascote
        // não pode assumir o microfone.
        permissionFlowRef.current = true;
        try {
          const result = await requestPermissionStep(micStep);
          if (!result.granted) {
            setNotice('Preciso do microfone liberado para ouvir seus comandos de voz.');
            return;
          }
        } finally {
          permissionFlowRef.current = permissionsOpen;
        }
      }

      // O TTS precisa soltar o foco de áudio antes de o reconhecedor abrir o
      // microfone; sem essa folga o Android pode responder "ocupado" e a
      // escuta não começa.
      if (wasSpeaking) {
        await new Promise<void>((resolve) => setTimeout(resolve, SPEECH_STOP_SETTLE_MS));
      }

      // Prioridade do microfone: a rádio e a música que estiverem tocando são
      // pausadas, para o pedido chegar limpo.
      await pausePlayingMedia();

      const started = await nexusNative.startDirectCapture(SHORT_ANSWER_BIAS);
      if (!started) {
        setNotice(
          'Não consegui abrir o microfone agora. Confira o Microfone nas permissões e toque de novo.',
        );
      }
    } catch (reason) {
      setNotice(
        `Não consegui iniciar o microfone: ${errorMessage(reason)} Abra as permissões e libere o Microfone.`,
      );
    }
  };

  const handlePermissionsClosed = useCallback(async () => {
    setPermissionsOpen(false);
    setNotice('');
    if (!isNativeAvailable()) return;

    try {
      // A notificação permanente "NEXUS em segundo plano" foi removida.
      // Parar o serviço antigo aqui garante que instalações atualizadas não
      // fiquem com a notificação presa.
      await nexusNative.stopForegroundService();
      // Fechar a tela de permissões NÃO liga escuta nenhuma: quem decide o
      // microfone é a política de voz (ver `voiceSessionPolicy.mjs`).
      void syncVoiceSessionRef.current();
    } catch {
      // Silencioso: o serviço é opcional e não deve atrapalhar as permissões.
    }
  }, []);

  useEffect(() => {
    // Inicializa o módulo nativo apenas se disponível (build Android)
    if (!isNativeAvailable()) return;

    let active = true;

    const checkNative = async () => {
      try {
        // Não iniciamos mais o serviço em primeiro plano permanente: a
        // notificação "NEXUS em segundo plano" foi removida. A chamada abaixo
        // apenas encerra uma instância antiga que ainda esteja viva.
        await nexusNative.stopForegroundService();
        const stations = await nexusNative.getAvailableStations();
        if (!active) return;
        stationsRef.current = stations;
        setNativeReady(true);

        /*
         * O Auto-Bot (acessibilidade) é o que automatiza o WhatsApp, as
         * chamadas e a mídia. O Android DESLIGA esse serviço a cada instalação
         * do APK — por isso o aviso aparece logo de cara: é o caminho de um
         * toque (o botão PERMISSÕES) e não uma caça ao setting.
         */
        try {
          const autoBot = await nexusNative.getAutoBotState();
          if (!active) return;
          if (autoBot.enabled) {
            // Guardado para a próxima vez: o usuário EU QUER o Auto-Bot ligado.
            void nexusNative.setAutoBotEnabled(true);
          } else if (autoBot.wasEnabled) {
            setNotice(
              'O Auto-Bot (acessibilidade) foi desligado pela instalação do app — abra PERMISSÕES para ligar de novo.',
            );
          } else {
            setNotice(
              'O Auto-Bot (acessibilidade) está desligado — abra PERMISSÕES para ligar de novo.',
            );
          }
        } catch {
          // Sem o módulo nativo não há Auto-Bot: nada a avisar.
        }
        // Nada de ligar o microfone ao abrir o app: dentro do assistente quem
        // abre o microfone é o botão. A escuta do mascote só assume quando o
        // app sai da frente (a política decide).
        void syncVoiceSessionRef.current();

        // Notificações que o nativo guardou porque o React estava desligado em
        // segundo plano. Entram na fila: o Nexus lê e responde uma de cada vez.
        try {
          const missed = await nexusNative.getRecentNotifications();
          if (active && missed.length > 0) {
            await nexusNative.clearRecentNotifications();
            enqueueNotifications(missed);
          }
        } catch (reason) {
          console.warn('[NEXOS] Falha ao recuperar notificações guardadas:', reason);
        }
      } catch (reason) {
        console.warn('Native init failed:', reason);
        if (active) {
          setNotice('Módulo nativo iniciado, mas o serviço em segundo plano não pôde ser ligado.');
        }
      }
    };

    void checkNative();

    // Pedido reconhecido pela voz (botão do app ou toque no mascote): o texto vira
    // comando aqui — é este o caminho que entrega a fala para execução.
    const unsubscribeCommand = nexusNative.onCommandRecognized((command: string) => {
      if (command) submitRef.current(command);
    });

    // Estado real do microfone: a tela nunca diz "ouvindo" por conta própria.
    const unsubscribeVoiceState = nexusNative.onVoiceStateChanged((state) => {
      const view = describeVoiceState(state);
      capturingRef.current = view.capturing;
      setCapturing(view.capturing);
    });

    /*
     * Palavra-chave "nexo" para despertar o assistente por fala.
     *
     * Quando o usuário fala "nexos" ou "nexo" (com a tela bloqueada ou o app em segundo
     * plano), o serviço nativo detecta e dispara este evento. O NEXOS:
     *  1. Abre o app / traz para a frente
     *  2. Fala boas-vindas e pergunta o que o usuário quer fazer
     *  3. Abre o microfone para capturar o comando
     */
    const unsubscribeWakeWord = nexusNative.onWakeWordDetected(() => {
      // A palavra já foi ouvida: libera o microfone do serviço para o comando.
      void nexusNative.stopWakeWordListening();
      // Traz o app para a frente se estiver minimizado (modo mascote).
      void nexusNative.openAssistant();

      // Boas-vindas e pergunta o que o usuário quer fazer.
      void (async () => {
        try {
          const profile = await nexusNative.getProfile();
          const name = profile?.name?.trim() || 'Jefferson';
          appendAssistantMessage(`Olá ${name}! O que você precisa?`);
        } catch {
          appendAssistantMessage('Olá! O que você precisa?');
        }

        // Aguarda um instante para a fala começar e depois abre o microfone.
        setTimeout(async () => {
          try {
            const permissions = await getPermissionSnapshot();
            if (permissions.microphone === true) {
              setNotice('Estou ouvindo: fale o seu comando.');
              await nexusNative.startDirectCapture(SHORT_ANSWER_BIAS);
            } else {
              setNotice('Microfone bloqueado: libere o Microfone nas permissões.');
            }
          } catch (reason) {
            console.warn('[NEXOS] Falha ao abrir microfone após wake word:', reason);
          }
        }, 1500);
      })();
    });

    /*
     * A voz do Nexus é a do aparelho. Se o aparelho só tem a voz "standard" — a
     * que soa robótica —, o app oferece baixar a neural em português. Quem
     * decide é o nativo (a lista vem dele, já ordenada: a melhor primeiro).
     */
    void nexusNative.listVoices().then((voices) => {
      if (voices.length === 0) return;
      const best = voices[0];
      const robotic = best.id.includes('language-standard') || best.network;
      setVoiceUpgradeAvailable(robotic);
    });

    // Fim do pedido falado dentro do app: explica quando nada foi entendido.
    const unsubscribeCaptureEnd = nexusNative.onCaptureEnded((end) => {
      // Resposta curta de uma notificação que o reconhecedor não decodificou:
      // repete a pergunta UMA vez, em vez de já desistir com "não ouvi nada".
      // A segunda falha é avisada com honestidade.
      const flow = pendingNotificationRef.current;
      if (
        end.reason === 'silence' &&
        flow &&
        flow.step !== 'done' &&
        flow.step !== 'listening' &&
        notificationAnswerRetryRef.current < 1
      ) {
        notificationAnswerRetryRef.current += 1;
        awaitingAnswerRef.current = true;
        forceReplyCaptureRef.current = true;
        appendRef.current(notificationRetryPrompt(flow.step));
        return;
      }

      const message = describeCaptureEnd(end.reason);
      if (message) setNotice(message);
    });

    // O stream da rádio caiu depois de abrir: o Nexus avisa em vez de fingir.
    const unsubscribeRadioError = nexusNative.onRadioError((station, message) => {
      const label = station || 'A rádio';
      setNotice(`${label}: ${message}`);
      appendRef.current(`Não consegui tocar ${label} agora (${message}).`);
    });

    const unsubscribeTapped = nexusNative.onMascotTapped(() => {
      // Interrupção de prioridade IMEDIATA: o toque no mascote SEMPRE cala o Nexus,
      // mesmo que ele esteja falando no modo janela ou mascote.
      // 1. Invalida qualquer fala pendente (token) para parar callbacks.
      speechSeqRef.current += 1;
      speakingRef.current = false;
      setSpeaking(false);

      // 2. Para a fala nativa e do expo-speech forçadamente.
      void stopSpeech();
      void nexusNative.stopVoice();
      void nexusNative.setAssistantSpeaking(false);

      // 3. Pausa a fila de notificações para não ser interrompido.
      notificationQueuePausedRef.current = true;

      // 4. Pausa rádio/música para o microfone abrir limpo.
      void pausePlayingMedia();

      // 5. Marca modo mascote flutuante para reabrir microfone após a resposta.
      floatingMascotModeRef.current = true;

      // 6. ABRE O MICROFONE imediatamente após calar o Nexus.
      // Passa viés de palavras curtas para melhor reconhecimento de sim/não/comandos.
      void (async () => {
        try {
          const permissions = await getPermissionSnapshot();
          if (permissions.microphone !== true) {
            setNotice('Microfone bloqueado: libere o Microfone nas permissões.');
            return;
          }
          setNotice('Estou ouvindo pelo mascote: fale o seu pedido.');
          const started = await nexusNative.startDirectCapture(SHORT_ANSWER_BIAS);
          if (!started) {
            setNotice('Não consegui abrir o microfone pelo mascote. Use o botão dentro do app.');
          }
        } catch (reason) {
          console.warn('[NEXOS] Falha ao abrir microfone pelo mascote:', reason);
          setNotice('Não consegui iniciar o microfone pelo mascote.');
        }
      })();
    });

    const unsubscribeForeground = nexusNative.onAssistantForeground(() => {
      // Garantia extra: nada flutuante fica sobre a tela do próprio assistente.
      void nexusNative.hideMascot();
      // Dentro do app o microfone é do botão, não da palavra "nexo".
      void nexusNative.stopWakeWordListening();
    });

    // Mensagem/chamada nova no WhatsApp.
    //
    // O Nexus pausa a mídia, diz QUEM mandou, pergunta se pode ler (ou tocar, se
    // for áudio), depois se o usuário quer responder — e a resposta falada é
    // escrita no chat, confirmada e só então enviada. Quem decide cada passo é
    // `app/core/notificationFlow.mjs`; aqui só acontece o que toca o aparelho.
    const unsubscribeNotification = nexusNative.onNotificationReceived((payload) => {
      const { contact, message, type = 'message', isAudio } = payload ?? {};
      if (!contact) return;

      // O aviso ao vivo chegou: guarda para "leia a mensagem" e entra na fila.
      // A fila é o que impede o Nexus de abrir três conversas ao mesmo tempo:
      // uma mensagem é lida e respondida antes da próxima começar.
      const live: NotificationMessage = {
        app: payload?.app ?? 'WhatsApp',
        contact,
        message: message ?? '',
        type,
        isAudio: isAudio === true,
        callSource: payload?.callSource ?? 'whatsapp',
        phoneNumber: typeof payload?.phoneNumber === 'string' ? payload.phoneNumber : '',
        at: Date.now(),
      };

      void nexusNative.clearRecentNotifications();

      void (async () => {
        try {
          // 1. Pausa TODA mídia (rádio + música) e guarda o estado para devolver.
          // Só na primeira mensagem da fila: pausar de novo a cada uma faria a
          // rádio "piscar" entre uma conversa e outra.
          if (!notificationMediaStateRef.current) {
            notificationMediaStateRef.current = await nexusNative.pauseMediaForNotification();
          }
        } catch (e) {
          console.warn('[NEXOS] Falha ao pausar a mídia para o aviso:', e);
        }
        enqueueNotifications([live]);
      })();
    });

    // Toque nos dois telefones da notificação de chamada (verde/vermelho).
    // Encerra a pergunta falada "quer atender?" e não deixa o fluxo duplicar.
    const unsubscribeCallAction = nexusNative.onCallActionTaken((payload) => {
      if (!payload?.success) return;
      notificationFlowActiveRef.current = false;
      pendingNotificationRef.current = null;
      if (payload.action === 'answer') {
        callScreenHoldRef.current = true;
        void stopSpeech();
        void nexusNative.stopListening();
        appendAssistantMessage('Chamada atendida.', false, false);
      } else {
        appendAssistantMessage('Chamada recusada.', false, false);
      }
    });

    // Lembrete disparou: o aviso já foi falado e notificado pelo Android (o
    // serviço nativo cuida disso). Aqui ele entra na conversa, sem falar de novo.
    // Não repetir no `notice`: a lista já rola até o fim sozinha, então o aviso
    // apareceria como a mesma frase duas vezes na tela.
    const unsubscribeReminder = nexusNative.onReminderFired((payload) => {
      if (!payload?.text) return;
      appendRef.current(payload.text, false, false);
    });

    return () => {
      active = false;
      unsubscribeCommand();
      unsubscribeVoiceState();
      unsubscribeCaptureEnd();
      unsubscribeRadioError();
      unsubscribeTapped();
      unsubscribeForeground();
      unsubscribeNotification();
      unsubscribeCallAction();
      unsubscribeReminder();
      unsubscribeWakeWord();
    };
  }, [appendAssistantMessage, runNotificationActions]);

  /**
   * Único ponto de decisão do microfone.
   *
   * O `AppState` muda quando o app vai para trás (minimizado) ou volta. É aqui
   * — e só aqui — que a escuta do mascote liga e desliga. Antes o próprio app
   * ligava a escuta ao abrir, e o microfone ficava abrindo e fechando sozinho.
   */
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      appStateRef.current = state;
      void syncVoiceSessionRef.current();
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    return () => {
      void stopSpeech();
      if (isNativeAvailable()) {
        // Sair da tela fecha o microfone: nada continua ouvindo sem dono.
        void nexusNative.setAssistantSpeaking(false);
        void nexusNative.stopListening();
      }
    };
  }, [enqueueNotifications]);

  /**
   * Histórico do chat: carrega o que ficou salvo no aparelho.
   *
   * A conversa vivia só na memória do React — quando o Android matava a tela em
   * segundo plano, o app voltava sem as falas antigas. Agora o texto sobrevive.
   */
  const chatHistoryReadyRef = useRef(false);
  const chatSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isNativeAvailable()) {
      chatHistoryReadyRef.current = true;
      return;
    }
    let active = true;
    void (async () => {
      try {
        const raw = await nexusNative.loadChatHistory();
        if (!active) return;
        const parsed = raw ? JSON.parse(raw) : null;
        if (Array.isArray(parsed) && parsed.length > 0) {
          const restored: Message[] = parsed
            .filter(
              (item): item is { role: 'user' | 'assistant'; text: string; id?: string } =>
                item &&
                typeof item.text === 'string' &&
                (item.role === 'user' || item.role === 'assistant'),
            )
            .map((item) => ({
              id:
                typeof item.id === 'string'
                  ? item.id
                  : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              role: item.role,
              text: item.text,
              shareWithSearch: false,
            }));
          // A conversa que volta do aparelho também tem limite: só as últimas
          // mensagens entram na tela.
          if (active && restored.length > 0) setMessages(trimMessages(restored));
        }
      } catch (reason) {
        console.warn('[NEXOS] Falha ao carregar o histórico do chat:', reason);
      } finally {
        if (active) chatHistoryReadyRef.current = true;
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  /** Salva o histórico (com atraso curto, para não escrever a cada tecla). */
  useEffect(() => {
    if (!isNativeAvailable() || !chatHistoryReadyRef.current) return;
    if (chatSaveTimerRef.current) clearTimeout(chatSaveTimerRef.current);
    chatSaveTimerRef.current = setTimeout(() => {
      const recent = messages.slice(-MAX_MESSAGES);
      void nexusNative.saveChatHistory(JSON.stringify(recent)).catch(() => {
        // Sem armazenamento: a conversa segue só na memória.
      });
    }, 600);
    return () => {
      if (chatSaveTimerRef.current) clearTimeout(chatSaveTimerRef.current);
    };
  }, [messages]);

  /**
   * A conversa sobe sozinha quando chega mensagem nova.
   *
   * Só quando o usuário já está no fim: se ele subiu para ler o histórico, a
   * tela NÃO puxa de volta (aí ele consegue ler com calma e descer quando
   * quiser).
   */
  useEffect(() => {
    if (!nearBottomRef.current) return;
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages, busy]);

  /**
   * Marca se a conversa está no fim (ou quase).
   *
   * Permite rolar para cima para ler as mensagens antigas sem que a tela puxe
   * o usuário de volta a cada mensagem nova.
   */
  const handleConversationScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      const distance = contentSize.height - (contentOffset.y + layoutMeasurement.height);
      nearBottomRef.current = distance < 160;
    },
    [],
  );


  const keyboardInsetPx = useKeyboardInset();
  const keyboardInset = Platform.OS === 'android' ? keyboardInsetPx : 0;

  const listening = capturing;

  /** Mascote escolhido nos ajustes (salvo no aparelho). */
  const character: CharacterId = selectedAvatar === 'tratis' ? 'tratis' : 'nexo';
  const characterMeta = getCharacterMeta(character);

  /**
   * Como o mascote está SE MOVENDO.
   *
   * Ouvindo, pensando e falando pedem ritmos diferentes: é o que dá a
   * sensação de que ele está com a gente e não só parado na tela.
   */
  const mascotMood: 'idle' | 'listening' | 'thinking' | 'speaking' = speaking
    ? 'speaking'
    : listening
      ? 'listening'
      : busy
        ? 'thinking'
        : 'idle';

  /**
   * A fala do mascote no estado atual.
   *
   * Muda junto com o estado e nunca repete a frase anterior: a coruja fica
   * viva em vez de virar um rótulo fixo na tela.
   */
  const [mascotPhrase, setMascotPhrase] = useState(() => pickMascotPhrase('idle'));
  useEffect(() => {
    setMascotPhrase((previous) => pickMascotPhrase(mascotMood, previous));
  }, [mascotMood]);

  /** A frase que a coruja está dizendo agora. */
  const mascotStatus = mascotPhrase;

  /**
   * `true` quando o aparelho só tem a voz "standard" em português — a que soa
   * robótica. Aí o app oferece baixar a voz neural.
   */
  const [voiceUpgradeAvailable, setVoiceUpgradeAvailable] = useState(false);

  /**
   * Abre a tela de vozes do Android (para baixar a neural em português).
   */
  const handleInstallVoice = useCallback(async () => {
    const opened = await nexusNative.installVoiceData();
    setNotice(
      opened
        ? 'Escolha a voz em português e baixe. Depois de baixar, o Nexus passa a usar ela sozinho.'
        : 'Não consegui abrir a tela de vozes do Android. Acesse Acessibilidade › Texto para fala.',
    );
  }, []);

  const assistantStatus = listening || speaking || busy
    ? mascotPhrase
    : messages.length === 1
      ? 'Toque no microfone para falar'
      : mascotPhrase;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <StatusBar style="light" />

      {/* Noite roxa: gradiente + dois halos de cor. */}
      <LinearGradient
        colors={[colors.bgTop, colors.bgMid, colors.bg]}
        locations={[0, 0.45, 1]}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.85, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View pointerEvents="none" style={[styles.blob, styles.blobTop]} />
      <View pointerEvents="none" style={[styles.blob, styles.blobBottom]} />

      <KeyboardAvoidingView
        style={
          keyboardInset > 0 ? [styles.fill, { paddingBottom: keyboardInset }] : styles.fill
        }
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
      >
        <Header
          character={character}
          statusText={assistantStatus}
          listening={listening}
          speaking={speaking}
          thinking={busy}
          online={isNativeAvailable()}
          onOpenSettings={() => setSettingsOpen(true)}
          onStopSpeech={() => void stopSpeech()}
        />

        {/* Fio de neon: separa o cabeçalho da conversa. */}
        <LinearGradient
          colors={gradients.hairline}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.hairline}
          pointerEvents="none"
        />

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.conversation}
          keyboardShouldPersistTaps="handled"
          onScroll={handleConversationScroll}
          scrollEventThrottle={80}
          showsVerticalScrollIndicator={false}
        >
          {messages.length <= 1 ? (
            <ChatHero
              character={character}
              online={isNativeAvailable()}
              onPick={handleExample}
            />
          ) : null}

          {messages.map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              character={character}
              speaking={speaking}
              listening={listening}
            />
          ))}

          {busy ? (
            <View style={styles.typingRow}>
              <MascotAvatar character={character} size={30} listening={listening} />
              <View style={styles.typingBubble}>
                <TypingDots color={characterMeta.accent} />
                <Text style={styles.typingText} numberOfLines={1}>
                  {mascotStatus}
                </Text>
              </View>
            </View>
          ) : null}
        </ScrollView>

        {/* O aviso fica FORA da conversa: com o chat cheio ele continua visível. */}
        <NoticeBanner message={notice} />

        {/* Toda esta área sobe junto com o teclado (ver useKeyboardInset). */}
        <View style={styles.composerArea}>
          <Composer
            value={draft}
            onChangeText={setDraft}
            onSend={handleSend}
            onToggleMic={() => void handleMicrophone()}
            listening={listening}
            busy={busy}
            micAvailable={isNativeAvailable()}
          />

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.toolsScroll}
            contentContainerStyle={styles.toolsRow}
            keyboardShouldPersistTaps="handled"
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Abrir permissões do Nexus"
              onPress={() => setPermissionsOpen(true)}
              style={({ pressed }) => [styles.toolChip, pressed && styles.toolChipPressed]}
            >
              <ShieldAlert size={13} color={colors.accent} />
              <Text style={styles.toolChipText}>permissões</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Limpar conversa"
              onPress={() => void clearChat()}
              style={({ pressed }) => [styles.toolChip, pressed && styles.toolChipPressed]}
            >
              <Trash2 size={13} color={colors.danger} />
              <Text style={styles.toolChipText}>limpar</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                speakReplies ? 'Desativar respostas faladas' : 'Ativar respostas faladas'
              }
              onPress={() => void handleVoiceToggle()}
              style={({ pressed }) => [styles.toolChip, pressed && styles.toolChipPressed]}
            >
              {speakReplies ? (
                <Volume2 size={13} color={colors.success} />
              ) : (
                <VolumeX size={13} color={colors.textFaint} />
              )}
              <Text style={styles.toolChipText}>{speakReplies ? 'voz on' : 'voz off'}</Text>
            </Pressable>

            {voiceUpgradeAvailable ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Baixar a voz neural em português do Brasil"
                onPress={() => void handleInstallVoice()}
                style={({ pressed }) => [
                  styles.toolChip,
                  styles.toolChipOn,
                  pressed && styles.toolChipPressed,
                ]}
              >
                <Text style={styles.toolChipEmoji}>🎙️</Text>
                <Text style={[styles.toolChipText, styles.toolChipTextOn]}>voz neural</Text>
              </Pressable>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Trocar o mascote"
              onPress={() => setSettingsOpen(true)}
              style={({ pressed }) => [styles.toolChip, pressed && styles.toolChipPressed]}
            >
              <Text style={styles.toolChipEmoji}>{character === 'tratis' ? '🎀' : '🦉'}</Text>
              <Text style={styles.toolChipText}>mascote</Text>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>

      {permissionsOpen && (
        <View style={styles.permissionsOverlay}>
          <PermissionsScreen
            userName={userName}
            onFinish={() => void handlePermissionsClosed()}
            onClose={() => void handlePermissionsClosed()}
          />
        </View>
      )}

      {settingsOpen && (
        <View style={styles.permissionsOverlay}>
          <SettingsScreen onBack={handleSettingsClosed} />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // ---------------------------------------------------------------------
  // Tela principal
  // ---------------------------------------------------------------------
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  fill: { flex: 1 },
  permissionsOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.background,
  },

  /** Halos de cor do fundo (não capturam toque). */
  blob: {
    position: 'absolute',
    borderRadius: 999,
    opacity: 0.5,
  },
  blobTop: {
    width: 320,
    height: 320,
    top: -150,
    right: -110,
    backgroundColor: 'rgba(124, 77, 255, 0.32)',
  },
  blobBottom: {
    width: 340,
    height: 340,
    bottom: -170,
    left: -130,
    backgroundColor: 'rgba(255, 122, 200, 0.16)',
  },

  /** Fio de neon abaixo do cabeçalho. */
  hairline: {
    height: 1.5,
    width: '100%',
    opacity: 0.7,
  },

  // Conversa
  conversation: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  userMessageRow: {
    justifyContent: 'flex-end',
  },
  messageColumn: {
    flexShrink: 1,
  },
  userMessageColumn: {
    alignItems: 'flex-end',
  },
  messageAuthor: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 4,
    marginLeft: 4,
    textTransform: 'uppercase',
  },
  bubble: {
    flexShrink: 1,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: 1,
  },
  assistantBubble: {
    backgroundColor: colors.glass,
    borderColor: colors.glassBorder,
    borderBottomLeftRadius: 6,
  },
  userBubble: {
    borderColor: 'rgba(255, 255, 255, 0.16)',
    borderBottomRightRadius: 6,
  },
  messageText: {
    color: colors.text,
    fontSize: fontSize.body,
    lineHeight: 22,
    // Android: sem o padding extra da fonte, a altura medida pelo
    // `onTextLayout` e a altura desenhada são a MESMA — é o que garante que a
    // última linha não fique a meio pixel da borda e suma.
    includeFontPadding: false,
  },
  userMessageText: {
    color: '#1A0713',
    fontWeight: '600',
  },

  // "Pensando…"
  typingRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  typingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: radius.lg,
    borderBottomLeftRadius: 6,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    maxWidth: '78%',
  },
  typingText: {
    color: colors.textMuted,
    fontSize: fontSize.small,
    flexShrink: 1,
  },

  // Área de escrita
  composerArea: {
    paddingBottom: Platform.OS === 'android' ? spacing.sm : spacing.md,
  },
  toolsScroll: {
    marginTop: spacing.xs,
  },
  toolsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
  },
  toolChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  toolChipPressed: {
    opacity: 0.65,
  },
  toolChipOn: {
    borderColor: colors.borderStrong,
    backgroundColor: colors.cyanSoft,
  },
  toolChipEmoji: {
    fontSize: 11,
  },
  toolChipText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  toolChipTextOn: {
    color: colors.accent,
  },

  // Barreira de erro
  crashContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  crashMascot: {
    width: 84,
    height: 84,
    marginBottom: spacing.lg,
  },
  crashTitle: {
    color: colors.danger,
    fontSize: fontSize.title + 2,
    fontWeight: '700',
    marginBottom: spacing.md,
  },
  crashText: {
    color: colors.text,
    fontSize: fontSize.small,
    lineHeight: 20,
    textAlign: 'center',
  },
  crashButton: {
    marginTop: spacing.xl,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 13,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
  },
  crashButtonText: {
    color: colors.onCyan,
    fontSize: fontSize.body,
    fontWeight: '700',
  },
});
