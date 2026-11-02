import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * A mídia e a fala do Nexus.
 *
 * O problema no aparelho: a rádio (ou a música) começava a tocar ANTES do
 * Nexus falar, e os dois sons se misturavam — ninguém entendia o aviso nem o
 * pedido. A regra agora é:
 *
 *  1. a mídia que estiver tocando é PAUSADA;
 *  2. o Nexus anuncia ("Tocando a rádio Itatiaia");
 *  3. só depois a mídia começa (ou volta).
 *
 * E o mascote tem PRIORIDADE: quando o usuário toca nele, a mídia é pausada
 * para o microfone ouvir o pedido limpo.
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

test('o aviso vem antes de a mídia começar', () => {
  assert.match(app, /const announceThen = useCallback\(/);
  // A ordem dentro do helper: pausa → fala → ação.
  assert.match(
    app,
    /await pausePlayingMedia\(\);[\s\S]*?appendAssistantMessage\(text\);[\s\S]*?await waitSpeech\(\);[\s\S]*?await action\(\);/,
  );
});

test('a rádio e a música são sempre anunciadas pelo nome', () => {
  assert.match(app, /await announceThen\(`Tocando a rádio \$\{station\}\.`/);
  assert.match(app, /await announceThen\(`Tocando \$\{query\}\.`/);
  assert.match(app, /await announceThen\(`Tocando \$\{plan\.query\} no YouTube\.`/);
  assert.match(app, /await announceThen\(`Tocando \$\{plan\.query\} no OiTube\.`/);
  assert.match(app, /await announceThen\('Voltando ao ar\.'/);
  assert.match(app, /await announceThen\('Trocando de rádio\.'/);
});

test('a mídia é pausada antes do aviso do Nexus', () => {
  assert.match(app, /const pausePlayingMedia = useCallback\(/);
  // A rádio do Nexus e a música de outro app: as duas são silenciadas.
  assert.match(app, /await nexusNative\.pauseRadio\(\);/);
  assert.match(app, /await nexusNative\.mediaControl\('pause'\);/);
});

test('o mascote pausa a mídia para ter prioridade no microfone', () => {
  assert.match(app, /onMascotTapped\(\(\) => \{[\s\S]*?void pausePlayingMedia\(\);/);
  // O botão de microfone do app segue a mesma regra.
  assert.match(app, /await pausePlayingMedia\(\);[\s\S]*?startDirectCapture\(\)/);
  // E no nativo: a pausa acontece ANTES de abrir o microfone, sem depender
  // do app JavaScript estar acordado.
  assert.match(
    nativeModule,
    /private fun handleMascotTap\(\) \{[\s\S]*?pauseMediaForMascot\(\)[\s\S]*?voiceEngine\.startMascotCapture\(\)/,
  );
  assert.match(nativeModule, /private fun pauseMediaForMascot\(\)/);
});

test('a pausa nativa silencia a rádio E a música de outro app', () => {
  // Antes, a rádio carregada encerrava o caminho e a música continuava.
  assert.match(
    nativeModule,
    /val radioResult = if \(radioManager\.currentStationName\(\) != null\) \{[\s\S]*?\} else \{\s*null\s*\}/,
  );
  assert.match(nativeModule, /radioResult\?\.let \{ radioResultMap\(it\) \}/);
});

test('a confirmação do lembrete termina com "criado com sucesso"', () => {
  assert.match(app, /Criado com sucesso!/);
});
