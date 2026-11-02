import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * A LISTA DE TRANSMISSÃO do WhatsApp, por voz.
 *
 * O pedido é do usuário: "mande uma mensagem para minha lista de transmissão".
 * A lista já existe no WhatsApp; o Nexus pergunta o texto, escreve na lista e
 * confirma.
 *
 * E o VOLUME por voz, na escala de 0 a 5.
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

test('a lista de transmissão segue o caminho: pergunta, escreve e confirma', () => {
  // 1. O pedido abre a conversa: o Nexus pergunta o texto.
  assert.match(app, /case 'whatsapp-broadcast': \{[\s\S]*?askAndListen\('Qual mensagem\?'\)/);
  // 2. A próxima fala É a mensagem (não um comando).
  assert.match(
    app,
    /if \(pendingBroadcastRef\.current\) \{[\s\S]*?sendBroadcastMessage\(message, wanted\)/,
  );
  // 3. Com mais de uma lista, o Nexus pergunta qual é antes de enviar.
  assert.match(app, /askAndListen\(`Para qual lista\? Tenho: \$\{names\.join\(', '\)\}\.`\)/);
  // 4. As falas do fluxo são as pedidas.
  assert.match(app, /'Escrevendo e enviando para sua lista de transmissão\.'/);
  assert.match(app, /'Mensagem enviada com sucesso\.'/);
  // 5. Depois do envio, o Nexus aprende o caminho e volta para a home no modo mascote.
  assert.match(app, /recordLearnedPath\('whatsapp-broadcast'/);
  assert.match(app, /void returnToStandbyRef\.current\(\);/);
});

test('a automação nativa abre o caminho de listas de transmissão do WhatsApp', () => {
  assert.match(
    accessibility,
    /fun sendToBroadcastList\(message: String, listName: String\?, callback: \(Boolean\) -> Unit\)/,
  );
  assert.match(
    accessibility,
    /private fun broadcastFlow\(message: String, listName: String\?, callback: \(Boolean\) -> Unit\)/,
  );
  // O caminho é o do app: menu (três pontinhos) › Listas de transmissão › lista.
  assert.match(accessibility, /private fun openBroadcastLists\(onReady: \(List<String>\) -> Unit/);
  assert.match(accessibility, /private fun findTopMenuButton\(\)/);
  assert.match(accessibility, /findTextRowContaining\("transmiss"\)/);
  // A lista é lida do texto visível (não só de nós clicáveis) e aberta por toque.
  assert.match(accessibility, /private fun broadcastListNames\(\): List<String>/);
  assert.match(accessibility, /private fun findBroadcastListRow\(name: String\)/);
  assert.match(accessibility, /private fun isBroadcastHome\(\): Boolean/);
  // E o envio usa o mesmo caminho de sempre: escrever e tocar em enviar.
  assert.match(
    accessibility,
    /broadcastFlow[\s\S]*?writeInOpenChatInternal\(message\)[\s\S]*?sendInOpenChatInternal/,
  );
  assert.match(
    nativeModule,
    /fun sendWhatsAppBroadcast\(message: String, listName: String\?, promise: Promise\)/,
  );
  // E há o comando que devolve os nomes (para o Nexus perguntar qual lista).
  assert.match(nativeModule, /fun listBroadcastLists\(promise: Promise\)/);
});

test('o volume do som tem escala de 0 a 5 no nativo', () => {
  assert.match(nativeModule, /private const val VOLUME_STEPS = 5/);
  assert.match(nativeModule, /fun changeVolume\(delta: Int, promise: Promise\)/);
  assert.match(nativeModule, /fun setVolumeLevel\(level: Int, promise: Promise\)/);
  assert.match(nativeModule, /fun getVolumeLevel\(promise: Promise\)/);
});

test('o Nexus pausa a mídia no instante em que começa a falar', () => {
  // Sem isto, a fala do Nexus sai por cima da rádio e ninguém entende.
  assert.match(app, /pauseMediaRef\.current\(\);/);
  assert.match(
    app,
    /useEffect\(\(\) => \{\s*pauseMediaRef\.current = \(\) => \{\s*void pausePlayingMedia\(\);/,
  );
});
