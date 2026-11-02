export const VOICE_MODE: {
  off: 'off';
  inApp: 'inApp';
  floating: 'floating';
};

export interface VoiceSessionSnapshot {
  appState: string;
  microphoneGranted: boolean;
  overlayGranted: boolean;
  capturing?: boolean;
  speaking?: boolean;
  permissionRequestInFlight?: boolean;
}

export interface VoiceSessionPlan {
  showMascot: boolean;
  stopListening: boolean;
  reason: string;
}

export interface VoiceStateView {
  mode: string;
  phase: string;
  capturing: boolean;
  listening: boolean;
}

export function planVoiceSession(snapshot: VoiceSessionSnapshot): VoiceSessionPlan;

export function describeVoiceState(
  payload: { mode?: string; phase?: string; capturing?: boolean } | null | undefined,
): VoiceStateView;

export function describeCaptureEnd(reason: string): string;
