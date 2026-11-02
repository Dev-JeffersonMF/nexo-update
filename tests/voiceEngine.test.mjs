import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * A voz do Nexus.
 *
 * O Nexus fala com a voz do PRÓPRIO APARELHO (pt-BR). Não há motor neural,
 * modelo embutido, biblioteca de voz extra nem "modo premium" dentro do app:
 * o motor de voz é o do sistema (o mesmo de "Acessibilidade › Texto para fala").
 *
 * Estes testes travam três coisas:
 *
 *  1. o Kokoro (e qualquer outra voz neural) não volta;
 *  2. a voz escolhida é a melhor em português do Brasil que o aparelho tem
 *     (a local e neural, quando existir) — é o que tira o sotaque de robô;
 *  3. o app nunca fica mudo: expo-speech é a rede de segurança do nativo.
 */

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nativeRoot = path.join(projectRoot, 'native-android', 'java');

function kotlinFiles(directory) {
  const found = [];
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) found.push(...kotlinFiles(full));
    else if (entry.endsWith('.kt')) found.push(full);
  }
  return found;
}

const sources = kotlinFiles(nativeRoot).map((file) => ({
  file: path.relative(nativeRoot, file),
  content: readFileSync(file, 'utf8'),
}));

const app = readFileSync(path.join(projectRoot, 'App.tsx'), 'utf8');
const bridge = readFileSync(path.join(projectRoot, 'app', 'services', 'nexusNative.ts'), 'utf8');
const plugin = readFileSync(path.join(projectRoot, 'plugins', 'nexus-native.js'), 'utf8');
const appJson = readFileSync(path.join(projectRoot, 'app.json'), 'utf8');

test('nenhuma voz neural, modelo embutido ou servidor de voz no app', () => {
  // O Kokoro saiu: nem motor Kotlin, nem AAR, nem modelo nos assets.
  assert.equal(
    sources.some(({ file }) => file.endsWith('NexusKokoroTts.kt')),
    false,
    'NexusKokoroTts.kt não pode voltar',
  );

  const proibidos = [
    /kokoro/i,
    /sherpa/i,
    /onnxruntime/i,
    /OfflineTts/i,
    /qwen3?-tts/i,
    /comfyui/i,
  ];

  for (const { file, content } of sources) {
    for (const padrao of proibidos) {
      assert.doesNotMatch(content, padrao, `${file} ainda fala de voz neural (${padrao})`);
    }
  }

  // Nem no plugin (que copia os arquivos para o APK) nem na configuração.
  for (const padrao of proibidos) {
    assert.doesNotMatch(plugin, padrao, `o plugin ainda embute voz neural (${padrao})`);
    assert.doesNotMatch(appJson, padrao, `app.json ainda pede voz neural (${padrao})`);
  }

  // E o APK não leva modelo de voz: a pasta de assets do motor someu.
  const assets = path.join(projectRoot, 'native-android', 'assets');
  assert.equal(
    (() => {
      try {
        return readdirSync(assets).length > 0;
      } catch {
        return false;
      }
    })(),
    false,
    'native-android/assets não pode mais guardar modelo de voz',
  );
});

test('a voz do Nexus é a do aparelho, com a melhor voz pt-BR escolhida', () => {
  const voice = sources.find(({ file }) => file.endsWith('NexusDeviceVoice.kt'));
  assert.ok(voice, 'NexusDeviceVoice.kt não encontrado');

  const { content } = voice;

  // O motor é o do sistema (TextToSpeech do Android) — nada embarcado.
  assert.match(content, /android\.speech\.tts\.TextToSpeech/);
  assert.doesNotMatch(content, /OfflineTts|assets\.open|model\.onnx/);

  // A escolha da voz é explícita: sem isso o Android usa a padrão do motor,
  // que no Google TTS é a `pt-BR-language-standard` — a que soa robótica.
  assert.match(content, /\.voices/);
  assert.match(content, /engine\?\.voice = voice/);
  assert.match(content, /Locale\("pt", "BR"\)/);

  // Critérios da escolha, em ordem: local (offline e instantâneo), neural,
  // nome feminino do Google em português e, por último, a qualidade.
  assert.match(content, /isNetworkConnectionRequired/);
  assert.match(content, /wavenet/);
  assert.match(content, /neural/);
  assert.match(content, /FEMININE_PT_BR/);
  assert.match(content, /cacilda/);
  assert.match(content, /language-standard/);

  // O timbre é acertado: a voz sobe um pouco (feminina) e desce um pouco
  // (cadência humana, em vez de quem lê o texto correndo).
  assert.match(content, /setPitch\(PITCH\)/);
  assert.match(content, /setSpeechRate\(RATE\)/);
  assert.match(content, /const val PITCH = 1\.06f/);
  assert.match(content, /const val RATE = 0\.95f/);

  // E nenhuma promessa fica pendurada: a fala tem teto de tempo.
  assert.match(content, /SPEECH_TIMEOUT_MS/);
  assert.match(content, /INIT_TIMEOUT_MS/);
});

test('a ponte expõe a voz do aparelho e a parada dela', () => {
  const module = sources.find(({ file }) => file.endsWith('NexusNativeModule.kt'));
  assert.ok(module, 'NexusNativeModule.kt não encontrado');

  assert.match(module.content, /fun speakVoice\(text: String, promise: Promise\)/);
  assert.match(module.content, /fun stopVoice\(promise: Promise\)/);
  assert.match(module.content, /fun listVoices\(promise: Promise\)/);

  // O JS conhece os três.
  assert.match(bridge, /async speakVoice\(text: string\)/);
  assert.match(bridge, /async stopVoice\(\)/);
  assert.match(bridge, /async listVoices\(\)/);

  // E o módulo é quem decide a voz, não o app.
  assert.match(module.content, /NexusDeviceVoice/);
});

test('o app oferece baixar a voz neural quando só tem a robotic', () => {
  const module = sources.find(({ file }) => file.endsWith('NexusNativeModule.kt'));
  assert.ok(module, 'NexusNativeModule.kt não encontrado');

  // A tela de voz do Android (para baixar Cacilda, Katita, Maria, Yara).
  assert.match(module.content, /android\.speech\.tts\.engine\.INSTALL_TTS_DATA/);
  assert.match(module.content, /fun installVoiceData\(promise: Promise\)/);
  assert.match(bridge, /async installVoiceData\(\)/);

  // E o botão só aparece quando a voz do aparelho é a "standard" ou depende
  // de internet — a que soa robótica.
  assert.match(app, /voiceUpgradeAvailable/);
  assert.match(app, /language-standard/);
  assert.match(app, /VOZ NEURAL/);
});

test('o app fala com a voz do aparelho e cai no expo-speech se ela falhar', () => {
  // 1. a voz do aparelho (nativa) é o caminho normal;
  assert.match(app, /nexusNative\s*\.speakVoice\(text\)/);
  // 2. o expo-speech é a rede de segurança;
  assert.match(app, /Speech\.speak\(text/);
  assert.match(app, /language: 'pt-BR'/);
  // 3. e o texto continua na tela quando nenhuma das duas funciona.
  assert.match(app, /Não consegui reproduzir a resposta em voz neste aparelho/);
});

test('parar a fala corta as duas vozes', () => {
  // Se só uma das vozes parasse, a outra continuaria depois do "parar" (e o
  // microfone voltaria a abrir no meio).
  assert.match(app, /const stopSpeech = useCallback/);
  assert.match(app, /const stops: Promise<unknown>\[\] = \[Speech\.stop\(\)\];/);
  assert.match(app, /stops\.push\(nexusNative\.stopVoice\(\)\)/);
  assert.match(app, /await Promise\.allSettled\(stops\)/);

  // A parada é SEMPRE a mesma: o `Speech.stop` cru não fica em nenhum canto.
  const stops = app.match(/Speech\.stop\(\)/g) ?? [];
  assert.equal(stops.length, 1, 'Speech.stop() deve existir só dentro de stopSpeech');
  assert.match(app, /await stopSpeech\(\)/);
  assert.match(app, /void stopSpeech\(\)/);
});

test('parar a fala não deixa o expo-speech recomeçar o texto', () => {
  // O `stopVoice` nativo resolve `false`; sem o token, esse `false` era lido
  // como falha do motor e o `expo-speech` recomeçava justamente a fala que o
  // usuário acabou de interromper.
  assert.match(app, /const speechTokenRef = useRef\(0\)/);
  assert.match(app, /const token = \+\+speechTokenRef\.current/);
  assert.match(app, /const isCurrent = \(\) => speechTokenRef\.current === token/);

  // A invalidação vem ANTES de parar o áudio.
  assert.match(app, /speechTokenRef\.current \+= 1;[\s\S]{0,300}Speech\.stop\(\)/);

  // E o caminho alternativo só roda se a fala ainda for a atual.
  assert.match(app, /if \(!isCurrent\(\)\) return;[\s\S]{0,300}speakWithExpo\(\)/);
});

test('a fala tem um fim só: o microfone não abre no meio da resposta', () => {
  // O TTS pode chamar "terminou" e "parou" juntos: sem esta trava o fim era
  // contado duas vezes e o microfone voltava a abrir no meio da fala.
  assert.match(app, /let claimed = false/);
  assert.match(app, /if \(claimed\) return;/);
});

test('a resposta curta não se perde entre a pergunta e o microfone', () => {
  // A política manda FECHAR o microfone dentro do app. Abrir a resposta antes
  // de a política terminar deixava o fechamento cancelar a captura recém-aberta.
  assert.match(
    app,
    /await syncVoiceSessionRef\.current\(\);[\s\S]{0,400}listenForAnswerRef\.current\(\)/,
  );

  // Um "sim" isolado pode voltar como NO_MATCH; os parciais já ouvidos são
  // aceitos em vez de virarem "não ouvi nada".
  const engine = sources.find(({ file }) => file.endsWith('NexusVoiceEngine.kt'));
  assert.ok(engine, 'NexusVoiceEngine.kt não encontrado');
  assert.match(engine.content, /Pedido recuperado do parcial/);
  assert.match(engine.content, /EXTRA_BIASING_STRINGS/);
  assert.match(engine.content, /EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 1000L/);

  // E o viés só existe quando o app pede (resposta curta), nunca na dicção.
  assert.match(engine.content, /fun startDirectCapture\(bias: List<String> = emptyList\(\)\)/);
  assert.match(bridge, /async startDirectCapture\(bias: string\[\] = \[\]\)/);
  assert.match(app, /startDirectCapture\(bias\)/);
});

test('"leia" e "abrir" confirmam a leitura da notificação', () => {
  assert.match(app, /const READ_CONFIRM_TOKENS/);
  assert.match(app, /flow\.step === 'ask-read' && isReadConfirmation\(text\)/);
});
