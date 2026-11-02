import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Parar a fala com um toque.
 *
 * O sintoma: o Nexus começava a responder e não parava quando o usuário
 * tocava de novo no microfone (na tela) ou no mascote flutuante. No app o
 * botão ficava DESABILITADO enquanto o Nexus trabalhava — e o toque no
 * mascote abria o microfone por cima da própria resposta.
 */

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(path.join(projectRoot, 'App.tsx'), 'utf8');
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

test('o botão de microfone nunca fica desabilitado', () => {
  // Com o botão desabilitado, o toque não chegava nem para parar a fala.
  assert.doesNotMatch(
    app,
    /accessibilityLabel=\{[\s\S]{0,400}?Ouvir um comando de voz[\s\S]{0,400}?disabled=\{busy && !listening\}/,
  );
  assert.doesNotMatch(app, /disabled=\{busy && !listening\}/);
});

test('o toque no mascote cala a resposta antes de abrir o microfone', () => {
  // No nativo: a voz é parada ANTES da captura.
  assert.match(
    nativeModule,
    /private fun handleMascotTap\(\) \{[\s\S]*?deviceVoice\.stop\(\)[\s\S]*?voiceEngine\.startMascotCapture\(\)/,
  );
  // E no app: a mesma regra, com o estado de fala limpo.
  assert.match(
    app,
    /onMascotTapped\(\(\) => \{[\s\S]*?void stopSpeech\(\);[\s\S]*?void pausePlayingMedia\(\);/,
  );
});
