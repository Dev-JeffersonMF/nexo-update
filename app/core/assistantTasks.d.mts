export type AssistantTaskPlan =
  | { action: 'note-save'; text: string; title: string }
  | { action: 'note-list' }
  | { action: 'note-read'; index: number }
  | { action: 'note-delete'; all?: boolean; index?: number | null }
  | {
      action: 'reminder-create';
      title: string;
      description: string;
      /** `0` quando o usuário não disse o horário (o Nexus pergunta). */
      triggerAtMillis: number;
      repeatDaily: boolean;
      spokenTime?: string;
      /** O dia que o usuário já disse ("27/10") — `null` enquanto falta. */
      dayText?: string | null;
      /** A hora que o usuário já disse ("meio dia e meia") — `null` enquanto falta. */
      hourText?: string | null;
      /** O TIPO: decide a TELA que abre quando toca. */
      kind?: 'lembrete' | 'alarme';
      /** Alarme de trabalho: fala a frase motivacional do dia. */
      isWorkAlarm?: boolean;
    }
  | { action: 'reminder-list' }
  | { action: 'reminder-delete'; all?: boolean; index?: number | null }
  | { action: 'reminder-disable'; all?: boolean; index?: number | null }
  | { action: 'reminder-enable'; all?: boolean; index?: number | null }
  /**
   * A PAUSA: adia o toque por 5 minutos e o lembrete volta a tocar.
   *
   * Não é desligar: o lembrete continua ligado e pode ser pausado de novo,
   * até o usuário mandar parar.
   */
  | { action: 'reminder-pause'; all?: boolean; index?: number | null }
  | {
      action: 'reminder-edit';
      index: number;
      description?: string;
      triggerAtMillis?: number;
      repeatDaily?: boolean;
      spokenTime?: string;
    };

export function planAssistantTask(input: string, now?: number): AssistantTaskPlan | undefined;

/**
 * A fala de um lembrete/alarme quando ele toca.
 *
 * O alarme de trabalho ganha a frase motivacional; os outros falam a saudação
 * com o nome e o relógio REAL de agora (o toque pode atrasar).
 */
export function formatAlarmReminderSpeech(
  userName: string,
  description: string,
  isWorkAlarm?: boolean,
): string;

/** Junta o dia e a hora em um instante único. */
export function composeReminderTime(
  dayText: string,
  hourText: string,
  now?: number,
): { triggerAtMillis: number; spokenTime: string } | null;

/**
 * Separa a frase nas três peças de um lembrete: o QUE, o DIA e a HORA.
 *
 * Usado pela conversa por etapas para aproveitar tudo o que o usuário disse
 * em uma resposta só ("ir ao psicólogo amanhã às 9").
 */
export function extractReminderPieces(
  rawText: string,
  now?: number,
): { description: string; dayText: string | null; hourText: string | null };

export function parseWhen(
  rawText: string,
  now?: number,
): {
  triggerAtMillis: number;
  repeatDaily: boolean;
  start: number;
  end: number;
  repeatStart: number | null;
  repeatEnd: number | null;
} | null;

/** 1..N, ou `-1` para "a última". */
export function parseIndex(text: string): number | null;

export function describeTrigger(millis: number, now?: number): string;

export function formatDateTime(millis: number): string;

export function deriveTitle(text: string, fallback?: string): string;

export function speakReminderList(
  reminders: {
    title: string;
    description: string;
    triggerAtMillis: number;
    enabled: boolean;
    repeatDaily?: boolean;
  }[],
  now?: number,
): string;
