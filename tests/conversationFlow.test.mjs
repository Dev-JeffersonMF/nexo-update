import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * A conversa do Nexus com o usuário.
 *
 * Duas coisas que a interface precisa garantir:
 *
 *  1. O CLIMA pergunta a cidade antes de consultar ("de qual cidade?") — e a
 *     resposta do usuário é a cidade, não um comando novo.
 *  2. A MENSAGEM do WhatsApp é lida na TELA (o balão), não na notificação
 *     (que chega truncada) — e é o que o Nexus lê em voz alta.
 */

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(path.join(projectRoot, 'App.tsx'), 'utf8');
const accessibility = readFileSync(
  path.join(
    projectRoot,
    'native-android',
    'java',
    'com',
    'jefferson',
    'nexusassistente',
    'service',
    'NexusAccessibilityService.kt',
  ),
  'utf8',
);
const nativeModule = readFileSync(
  path.join(
    projectRoot,
    'native-android',
    'java',
    'com',
    'jefferson',
    'nexusassistente',
    'native',
    'NexusNativeModule.kt',
  ),
  'utf8',
);

test('o clima pergunta a cidade e usa a resposta do usuário', () => {
  // Sem a cidade, o Nexus pergunta (e não adivinha um lugar).
  assert.match(app, /pendingWeatherRef\.current = \{ day: plan\.day \?\? 'today' \};/);
  assert.match(app, /askAndListen\('De qual cidade você quer o clima\?'\)/);
  // E a resposta do usuário é a cidade consultada.
  assert.match(
    app,
    /if \(pendingWeatherRef\.current\) \{[\s\S]*?await answerWeather\(city, day\);/,
  );
});

test('a mensagem do WhatsApp é lida no balão da tela', () => {
  // O id vem do aparelho real (WhatsApp instalado): `message_text`.
  assert.match(accessibility, /id\.endsWith\("message_text"\)/);
  assert.match(accessibility, /fun readLastChatMessage\(callback: \(String\?\) -> Unit\)/);
  assert.match(nativeModule, /fun readLastChatMessage\(promise: Promise\)/);
  // E a interface usa a leitura antes de falar a mensagem.
  assert.match(app, /await nexusNative\.readLastChatMessage\(\)/);
});

test('a reprodução do áudio espera a mensagem terminar', () => {
  // A bolinha verde anda com a faixa do áudio: o Nexus espera o fim antes de
  // oferecer a resposta.
  assert.match(accessibility, /waitForVoiceNoteEnd/);
  assert.match(accessibility, /fun playLastVoiceNoteInternal/);
});
