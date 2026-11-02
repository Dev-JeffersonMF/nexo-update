import assert from 'node:assert/strict';
import test from 'node:test';

import {
  describeCaptureEnd,
  describeVoiceState,
  planVoiceSession,
} from '../app/core/voiceSessionPolicy.mjs';

const liberado = {
  appState: 'background',
  microphoneGranted: true,
  overlayGranted: true,
};

test('app na frente: mascote escondido e microfone fechado', () => {
  assert.deepEqual(planVoiceSession({ ...liberado, appState: 'active' }), {
    showMascot: false,
    stopListening: true,
    reason: 'assistant-in-foreground',
  });
});

// A regra central da mudança: fora do app o mascote fica na TELA, mas o
// microfone continua FECHADO. Quem abre é o toque nele.
test('app minimizado: mascote na tela e microfone FECHADO (sem escuta passiva)', () => {
  assert.deepEqual(planVoiceSession(liberado), {
    showMascot: true,
    stopListening: true,
    reason: 'mascot-idle',
  });
});

test('sem microfone liberado o mascote nem aparece', () => {
  assert.deepEqual(planVoiceSession({ ...liberado, microphoneGranted: false }), {
    showMascot: false,
    stopListening: true,
    reason: 'microphone-denied',
  });
});

test('sem "Sobrepor outros apps" não existe mascote escondido', () => {
  assert.deepEqual(planVoiceSession({ ...liberado, overlayGranted: false }), {
    showMascot: false,
    stopListening: true,
    reason: 'overlay-denied',
  });
});

test('pedido de permissão em aberto não abre o microfone (onboarding)', () => {
  assert.deepEqual(planVoiceSession({ ...liberado, permissionRequestInFlight: true }), {
    showMascot: false,
    stopListening: true,
    reason: 'permission-pending',
  });
});

test('enquanto o Nexus fala o microfone fica fechado e o mascote continua', () => {
  assert.deepEqual(planVoiceSession({ ...liberado, speaking: true }), {
    showMascot: true,
    stopListening: true,
    reason: 'assistant-speaking',
  });
  // Sem "Sobrepor outros apps" não há mascote para manter.
  assert.deepEqual(
    planVoiceSession({ ...liberado, speaking: true, overlayGranted: false }),
    {
      showMascot: false,
      stopListening: true,
      reason: 'assistant-speaking',
    },
  );
});

test('captura em andamento não é interrompida por mudança de estado', () => {
  // Pedido feito pelo mascote com o app fora da frente: o mascote continua na
  // tela e o microfone não é fechado no meio da fala.
  assert.deepEqual(planVoiceSession({ ...liberado, capturing: true }), {
    showMascot: true,
    stopListening: false,
    reason: 'capturing',
  });
  // Captura dentro do app: nada aparece por cima.
  assert.deepEqual(
    planVoiceSession({ ...liberado, capturing: true, appState: 'active', speaking: true }),
    {
      showMascot: false,
      stopListening: false,
      reason: 'capturing',
    },
  );
});

// Regressão: a palavra de ativação "Nexo" (sherpa-onnx) segurava o microfone
// continuamente e era religada sozinha, travando o SpeechRecognizer. Ela foi
// removida — nenhum estado da política pode pedir escuta passiva.
test('nenhum estado da política pede escuta passiva', () => {
  const planos = [
    planVoiceSession(liberado),
    planVoiceSession({ ...liberado, appState: 'active' }),
    planVoiceSession({ ...liberado, speaking: true }),
    planVoiceSession({ ...liberado, capturing: true }),
    planVoiceSession({ ...liberado, microphoneGranted: false }),
    planVoiceSession({ ...liberado, overlayGranted: false }),
  ];

  for (const plano of planos) {
    assert.equal('listenWakeWord' in plano, false);
  }
});

test('a tela só diz "ouvindo" quando o microfone está mesmo aberto', () => {
  assert.deepEqual(
    describeVoiceState({ mode: 'inApp', phase: 'direct', capturing: true }),
    { mode: 'inApp', phase: 'direct', capturing: true, listening: true },
  );
  assert.deepEqual(
    describeVoiceState({ mode: 'floating', phase: 'command', capturing: false }),
    { mode: 'floating', phase: 'command', capturing: false, listening: false },
  );
  // Sem evento do nativo, a tela não pode inventar escuta ligada.
  assert.deepEqual(describeVoiceState(undefined), {
    mode: 'off',
    phase: 'idle',
    capturing: false,
    listening: false,
  });
});

test('fim de captura sem fala explica o que houve', () => {
  assert.match(describeCaptureEnd('silence'), /Não ouvi nada/);
  assert.match(describeCaptureEnd('timeout'), /não ouvi o comando/i);
  assert.match(describeCaptureEnd('error'), /microfone/i);
  assert.match(describeCaptureEnd('unsupported'), /reconhecimento de voz/i);
  // Comando entregue: nada a avisar.
  assert.equal(describeCaptureEnd('command'), '');
});

test('barulho e falha de rede têm avisos próprios (e não o de "não falou")', () => {
  // Ruído: o Nexus ouviu uma frase que ninguém pediu. O aviso fala de barulho,
  // não de silêncio nem de microfone quebrado.
  assert.match(describeCaptureEnd('noise'), /barulho/i);
  assert.doesNotMatch(describeCaptureEnd('noise'), /Não ouvi nada/);
  // Rede: o reconhecimento do Google é online. O aviso aponta a internet.
  assert.match(describeCaptureEnd('network'), /internet/i);
  assert.doesNotMatch(describeCaptureEnd('network'), /microfone/i);
  // Motivo desconhecido não inventa fala na tela.
  assert.equal(describeCaptureEnd('qualquer-coisa'), '');
});
