import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Contrato da ponte nativo ↔ JS e do "tocar música".
 *
 * Estes testes leem o código Kotlin do Nexus (`native-android/`) e travam os
 * dois defeitos que já custaram caro no aparelho:
 *
 *  1. método nativo devolvendo mapa do Kotlin — o RN 0.86 só converte mapa
 *     "writable" e a chamada morria com "Cannot convert argument of type class
 *     java.util.Collections$SingletonMap", então música, WhatsApp, ligação e
 *     abrir app falhavam mesmo com o comando reconhecido;
 *  2. música que apenas abria a busca, sem mandar o player tocar.
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

test('nenhum método nativo devolve mapa do Kotlin para o JS', () => {
  const offenders = sources
    .filter(({ content }) => /promise\.resolve\(\s*mapOf\(/.test(content))
    .map(({ file }) => file);

  assert.deepEqual(
    offenders,
    [],
    `Use WritableNativeMap (ou commandResult/radioResultMap): ${offenders.join(', ')}`,
  );
});

test('tocar música manda o player tocar, não só abrir a busca', () => {
  const launcher = sources.find(({ file }) => file.endsWith('MusicLauncher.kt'));
  assert.ok(launcher, 'MusicLauncher.kt não encontrado');

  // Resolve o vídeo pela busca do YouTube...
  assert.match(launcher.content, /youtube\.com\/results\?search_query=/);
  // ...abre o vídeo encontrado no app (e não a lista de resultados)...
  assert.match(launcher.content, /vnd\.youtube:/);
  assert.match(launcher.content, /watch\?v=/);
  // ...e confere se o player ficou pausado para dar play (OiTube abre parado),
  // sempre com o identificador do pedido: é ele que impede o segundo toque de
  // pausar a música que já começou.
  assert.match(launcher.content, /pressPlayIfPaused\(requestId\)/);

  // UM app só por pedido: sem lista de tentativas que abre o outro player.
  assert.doesNotMatch(launcher.content, /attempts/);
  assert.match(launcher.content, /val chosen = target/);

  // Preferência do usuário: música sem plataforma nomeada toca SÓ no OiTube
  // (grátis e com reprodução em segundo plano). O YouTube só abre quando é
  // pedido pelo nome — nada de troca automática nem de navegador.
  assert.match(launcher.content, /val target = requested \?: oiTube\.takeIf \{ it\.installed \}/);
  assert.doesNotMatch(launcher.content, /youTube\.installed -> youTube/);
  assert.doesNotMatch(launcher.content, /openWebSearch/);
  // ...e no OiTube o endereço do vídeo vem antes do esquema do YouTube, que ele
  // recusa (era um intent perdido a cada música).
  assert.match(launcher.content, /app\.packageName == AppDetector\.OITUBE_PACKAGE/);
});

test('o botão de play só clica quando a mídia está pausada', () => {
  const service = sources.find(({ file }) => file.endsWith('NexusAccessibilityService.kt'));
  assert.ok(service, 'NexusAccessibilityService.kt não encontrado');

  const { content } = service;
  // O botão é um alternador: clicar nele com a música tocando pausaria o que o
  // usuário está ouvindo.
  assert.match(content, /PlayState\.PLAYING/);
  assert.match(content, /PlayState\.PAUSED/);
  // Um toque por pedido: as conferências seguintes não pausam a música.
  assert.match(content, /playClickedForRequest/);
  assert.match(content, /playRequestId/);
});

test('o controle de mídia também alcança a música de OUTRO app', () => {
  const module = sources.find(({ file }) => file.endsWith('NexusNativeModule.kt'));
  const keys = sources.find(({ file }) => file.endsWith('MediaKeysController.kt'));
  const service = sources.find(({ file }) => file.endsWith('NexusAccessibilityService.kt'));
  assert.ok(module, 'NexusNativeModule.kt não encontrado');
  assert.ok(keys, 'MediaKeysController.kt não encontrado');
  assert.ok(service, 'NexusAccessibilityService.kt não encontrado');

  // A rádio do próprio Nexus tem prioridade: se ela está carregada, quem
  // obedece é ela; só fora da rádio o comando vai para o player do outro app.
  assert.match(module.content, /radioManager\.currentStationName\(\) != null/);
  assert.match(module.content, /KeyEvent\.KEYCODE_MEDIA_PAUSE/);
  assert.match(module.content, /KeyEvent\.KEYCODE_MEDIA_NEXT/);
  assert.match(module.content, /KeyEvent\.KEYCODE_MEDIA_PREVIOUS/);

  // O evento de mídia chega na sessão ativa (funciona com o player em segundo
  // plano, que é o caso quando o usuário fala com o mascote).
  assert.match(keys.content, /dispatchMediaKeyEvent/);
  // E o Nexus só confirma depois de o áudio do aparelho realmente mudar.
  assert.match(keys.content, /isMusicActive/);
  assert.match(keys.content, /fun sendAndConfirm\(/);

  // Pausar o player de outro app só pode clicar com a mídia TOCANDO: o botão é
  // um alternador e, sem essa conferência, começaria um vídeo parado.
  assert.match(service.content, /fun pressPauseIfPlaying\(/);
  assert.match(service.content, /wantPlaying = false/);
  assert.match(service.content, /não arrisco pausar/);

  // Nunca prometer uma pausa que não aconteceu.
  assert.match(module.content, /Não consegui pausar a música que está tocando/);
});

test('a rádio toca dentro do app (ExoPlayer) e conhece o catálogo mineiro', () => {
  const radio = sources.find(({ file }) => file.endsWith('RadioStreamManager.kt'));
  assert.ok(radio, 'RadioStreamManager.kt não encontrado');

  const { content } = radio;
  assert.match(content, /ExoPlayer/);
  // Pausar, parar e trocar de emissora são pedidos do usuário.
  assert.match(content, /fun pauseRadio\(/);
  assert.match(content, /fun resumeRadio\(/);
  assert.match(content, /fun stopRadio\(/);
  assert.match(content, /fun playStation\(/);
  assert.match(content, /fun playNeighbour\(/);
  // Falha de stream precisa chegar ao JS, para o Nexus avisar em vez de mentir.
  assert.match(content, /onPlaybackError/);
  // Todo endereço de stream é https (nada de host inventado em http).
  for (const url of content.match(/streamUrl\s*=\s*"([^"]+)"/g) ?? []) {
    assert.match(url, /streamUrl\s*=\s*"https:\/\//, `stream sem https: ${url}`);
  }
});

test('o player de rádio só é tocado no thread principal', () => {
  const radio = sources.find(({ file }) => file.endsWith('RadioStreamManager.kt'));
  assert.ok(radio, 'RadioStreamManager.kt não encontrado');

  const { content } = radio;
  // O ExoPlayer recusa acesso fora do thread em que nasceu e as chamadas chegam
  // pelo thread dos módulos nativos: sem o desvio, tudo terminava em
  // "Player is accessed on the wrong thread" — a rádio nunca tocava.
  assert.match(content, /Looper\.getMainLooper\(\)/);
  assert.match(content, /private fun <T : Any> onPlayerThread\(/);
  assert.match(content, /PLAYER_CALL_TIMEOUT_MS/);
  // play, trocar de emissora, parar, pausar, retomar, consultar e liberar: as
  // sete chamadas públicas passam pelo desvio.
  const guarded = content.match(/onPlayerThread\(/g) ?? [];
  assert.ok(
    guarded.length >= 7,
    `esperado o desvio em todas as chamadas do player, achei ${guarded.length}`,
  );
});

test('o toque no mascote nunca é engolido e o ícone não cresce', () => {
  const overlay = sources.find(({ file }) => file.endsWith('NexusOverlayService.kt'));
  assert.ok(overlay, 'NexusOverlayService.kt não encontrado');

  const { content } = overlay;
  // Antes o toque era ignorado quando o serviço achava que já estava ouvindo:
  // com a flag presa, o mascote ficava mudo e o usuário sem falar.
  assert.doesNotMatch(content, /if \(listening \|\| longPressed\)/);
  assert.match(content, /onMascotTapped\?\.invoke\(\)/);
  // Toque e escuta são sinalizados por ALFA: o ícone não cresce.
  assert.doesNotMatch(content, /scaleX\(1\.08f\)/);
  assert.doesNotMatch(content, /scaleX\(if \(on\) 1\.18f/);
  assert.match(content, /ObjectAnimator\.ofFloat\(image, View\.ALPHA/);
});

test('a espera de mídia não fica presa: o mascote volta a ouvir sozinho', () => {
  const engine = sources.find(({ file }) => file.endsWith('NexusVoiceEngine.kt'));
  assert.ok(engine, 'NexusVoiceEngine.kt não encontrado');

  const { content } = engine;
  // A espera de mídia vinha só do JS e podia ficar ligada para sempre depois de
  // a música parar sozinha — era o "modo de espera eterno".
  assert.match(content, /mediaCheckRunnable/);
  assert.match(content, /MEDIA_CHECK_MS/);
  assert.match(content, /isMusicActive/);
  assert.match(content, /private fun isAudioPlayingNow\(/);
});

test('"parar a música" também fecha o player de outro app', () => {
  const module = sources.find(({ file }) => file.endsWith('NexusNativeModule.kt'));
  const keys = sources.find(({ file }) => file.endsWith('MediaKeysController.kt'));
  const service = sources.find(({ file }) => file.endsWith('NexusAccessibilityService.kt'));
  assert.ok(module && keys && service, 'fontes do controle de mídia não encontrados');

  // Parar = parar a reprodução + sair do aplicativo (pausar continua pausando).
  assert.match(module.content, /private fun finishStopIfNeeded\(/);
  assert.match(keys.content, /fun closeApp\(/);
  assert.match(keys.content, /killBackgroundProcesses/);
  assert.match(service.content, /fun leaveForegroundMediaApp\(/);
  // O app a fechar é lembrado quando a música é aberta, para o caso de o player
  // estar em segundo plano quando o usuário pede para parar.
  assert.match(module.content, /mediaKeys\.lastMediaPackage/);
});

test('o microfone tem duas portas separadas no motor de voz', () => {
  const engine = sources.find(({ file }) => file.endsWith('NexusVoiceEngine.kt'));
  assert.ok(engine, 'NexusVoiceEngine.kt não encontrado');

  const { content } = engine;
  assert.match(content, /fun startFloatingListening\(/);
  assert.match(content, /fun startDirectCapture\(/);
  assert.match(content, /fun suspendForForeground\(/);
  // O assistente avisa quando está falando: o microfone fecha para ele não se
  // ouvir e não cortar a própria resposta no meio.
  assert.match(content, /fun setAssistantSpeaking\(/);
  // A janela de 5 s é exclusiva do mascote flutuante.
  assert.match(content, /COMMAND_SILENCE_MS/);
});

test('o microfone fica fechado com a tela bloqueada e nunca abre sozinho', () => {
  const engine = sources.find(({ file }) => file.endsWith('NexusVoiceEngine.kt'));
  assert.ok(engine, 'NexusVoiceEngine.kt não encontrado');

  const { content } = engine;
  // Tela bloqueada/apagada: era ali que o microfone abria e fechava sozinho
  // (com o aviso sonoro do reconhecedor) sem ninguém na frente dela.
  assert.match(content, /fun setScreenLocked\(/);
  // O toque no mascote confere o estado real da tela: mesmo que o broadcast se
  // perca, o microfone não abre com o aparelho bloqueado.
  assert.match(content, /if \(screenLocked \|\| isScreenLocked\(\)\)/);
  assert.match(content, /fun setMediaPlaying\(/);
  // Toque no mascote: a única porta fora do app.
  assert.match(content, /fun startMascotCapture\(/);
  // Fim do pedido: fecha. Não existe mais reabertura agendada ("scheduleWake").
  assert.doesNotMatch(content, /scheduleWake/);
  assert.match(content, /private fun endMascotCapture\(/);
  // Uma sessão por toque: sem retentativas automáticas (o antigo vaivém).
  assert.match(content, /MAX_COMMAND_ATTEMPTS = 1/);
});

test('o mascote não abre o microfone sozinho: só o toque abre', () => {
  const engine = sources.find(({ file }) => file.endsWith('NexusVoiceEngine.kt'));
  assert.ok(engine, 'NexusVoiceEngine.kt não encontrado');
  const policy = readFileSync(
    path.join(projectRoot, 'app', 'core', 'voiceSessionPolicy.mjs'),
    'utf8',
  );

  // O aviso do JS ("o mascote está na tela") não arma escuta nenhuma.
  const floating = engine.content.slice(engine.content.indexOf('fun startFloatingListening('));
  assert.match(floating.slice(0, 400), /floatingWanted = false/);
  assert.doesNotMatch(floating.slice(0, 400), /openSession\(/);

  // A política só diz se o mascote aparece e mantém o microfone fechado: não
  // existe mais escuta passiva de palavra de ativação.
  assert.doesNotMatch(policy, /listenWakeWord/);
  assert.doesNotMatch(policy, /wakeWord/);
  assert.match(policy, /reason: 'mascot-idle'/);
  assert.doesNotMatch(policy, /startFloating: true/);
});

test('a palavra "Nexo" saiu e o motor Kokoro foi removido do app', () => {
  // A palavra de ativação continua fora: o KWS do sherpa-onnx segurava um
  // AudioRecord contínuo e travava o SpeechRecognizer do sistema.
  for (const removido of ['NexusWakeWord.kt', 'NexusComplements.kt']) {
    assert.equal(
      sources.some(({ file }) => file.endsWith(removido)),
      false,
      `${removido} deveria ter sido removido`,
    );
  }

  // A implementação antiga da voz (NexusTtsEngine) também continua fora.
  assert.equal(
    sources.some(({ file }) => file.endsWith('NexusTtsEngine.kt')),
    false,
    'NexusTtsEngine.kt deveria ter sido removido',
  );

  const engine = sources.find(({ file }) => file.endsWith('NexusVoiceEngine.kt'));
  assert.ok(engine, 'NexusVoiceEngine.kt não encontrado');
  // A palavra de ativação saiu do APP como motor próprio: o que existe hoje é
  // o filtro do nome dentro do pedido do mascote (ver o teste do toque).
  assert.doesNotMatch(engine.content, /NexusWakeWord/);

  // O Kokoro saiu do app: sem motor Kotlin, sem AAR e sem bridge. A fala
  // agora é sempre o TTS do sistema (expo-speech), o fallback normal.
  assert.equal(
    sources.some(({ file }) => file.endsWith('NexusKokoroTts.kt')),
    false,
    'NexusKokoroTts.kt deveria ter sido removido',
  );

  const nativeModule = sources.find(({ file }) => file.endsWith('NexusNativeModule.kt'));
  assert.ok(nativeModule, 'NexusNativeModule.kt não encontrado');
  assert.doesNotMatch(
    nativeModule.content,
    /NexusKokoroTts|speakWithKokoro|getKokoroStatus|stopKokoro/,
  );
});

test('o toque no mascote: o microfone abre na hora, sem aviso falado antes', () => {
  const engine = sources.find(({ file }) => file.endsWith('NexusVoiceEngine.kt'));
  assert.ok(engine, 'NexusVoiceEngine.kt não encontrado');

  const start = engine.content.indexOf('fun startMascotCapture(');
  assert.ok(start > 0, 'startMascotCapture não encontrado');
  const body = engine.content.slice(start, start + 1400);

  // O pedido chega rápido: o microfone abre direto, sem o aviso "Estou
  // ouvindo" (que roubava ~2,5 s e obrigava o usuário a falar alto).
  assert.match(body, /mode = Mode\.FLOATING/);
  assert.match(body, /phase = Phase\.COMMAND/);
  assert.match(body, /openSession\(mascotIntent\(\), Phase\.COMMAND\)/);
  assert.doesNotMatch(body, /speakAcknowledgement\(\)/);
  assert.doesNotMatch(body, /phase = Phase\.ACK/);

  // A palavra do Nexus é o convite, não o comando: sai do pedido.
  assert.match(engine.content, /private val WAKE_WORD = Regex/);
  assert.match(engine.content, /private fun splitWakeWord\(text: String\)/);
});

test('a escuta passiva de palavra de ativação continua fora (sem KWS próprio)', () => {
  const engine = sources.find(({ file }) => file.endsWith('NexusVoiceEngine.kt'));
  assert.ok(engine, 'NexusVoiceEngine.kt não encontrado');

  // O microfone SÓ abre no toque: o botão do app ou o mascote flutuante.
  // Não existe escuta contínua nem KWS próprio (o antigo segurava um
  // AudioRecord contínuo e travava o reconhecedor do sistema).
  const semAudioRecord = engine.content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(semAudioRecord, /AudioRecord/);
  assert.doesNotMatch(semAudioRecord, /createAudioRecord/);
  assert.equal(
    sources.some(({ file }) => file.endsWith('NexusHotwordListener.kt')),
    false,
    'a escuta contínua não deve existir: o microfone abre no toque',
  );
});

test('o filtro de ruído não rebaixa a voz do usuário a barulho', () => {
  const engine = sources.find(({ file }) => file.endsWith('NexusVoiceEngine.kt'));
  assert.ok(engine, 'NexusVoiceEngine.kt não encontrado');

  // O piso do ambiente é o MENOR volume do começo (não o primeiro): o
  // microfone abre no toque e a pessoa já começa a falar.
  assert.match(engine.content, /private const val FLOOR_SAMPLES = 8/);
  assert.match(engine.content, /private var peakDb = -120f/);
  assert.match(engine.content, /if \(!floorReliable\) return false/);
  // E a decisão olha o pico da sessão: houve som acima do piso = houve fala.
  assert.match(engine.content, /if \(peakDb >= noiseFloorDb \+ SPEECH_MARGIN_DB\) return false/);
});

test('o toque no mascote abre o microfone e o toque longo abre o app', () => {
  const overlay = sources.find(({ file }) => file.endsWith('NexusOverlayService.kt'));
  assert.ok(overlay, 'NexusOverlayService.kt não encontrado');

  const { content } = overlay;
  assert.match(content, /onMascotTapped\?\.invoke\(\)/);
  assert.match(content, /LONG_PRESS_MS/);
  assert.match(content, /fun setListening\(/);
});

test('a chamada do WhatsApp usa o botão direto do topo e, se faltar, o menu', () => {
  const analyzer = sources.find(({ file }) => file.endsWith('ReaLayoutAnalyzer.kt'));
  const service = sources.find(({ file }) => file.endsWith('NexusAccessibilityService.kt'));
  const module = sources.find(({ file }) => file.endsWith('NexusNativeModule.kt'));
  assert.ok(analyzer && service && module, 'fontes do WhatsApp não encontrados');

  // Identificadores lidos do app instalado (não supostos). Sem eles, a chamada
  // e o envio falhavam em silêncio: o mapa apontava para botões inexistentes
  // (`voice_call`, `send_btn`, `conversations_list`, `contact_cell_layout`).
  assert.match(analyzer.content, /"entry"/);
  assert.match(analyzer.content, /"send_container"/);
  assert.match(analyzer.content, /"voice_note_btn"/);
  assert.match(analyzer.content, /"conversation_contact_name"/);
  assert.match(analyzer.content, /"my_search_bar"/);
  assert.match(analyzer.content, /"search_input"/);
  assert.match(analyzer.content, /"result_list"/);
  // No WhatsApp atual (Android 15) o topo da conversa tem os DOIS botões
  // diretos, sem resource-id: "Ligação de vídeo" e "Ligação de voz".
  assert.match(analyzer.content, /Ligação de voz/);
  assert.match(analyzer.content, /Ligação de vídeo/);
  assert.match(service.content, /private fun startCall\(isVideo: Boolean/);
  assert.match(service.content, /val direct = find\(itemKey\)/);
  // O "Menu de ligação" continua como plano B para versões que o usam.
  assert.match(analyzer.content, /Menu de ligação/);
  assert.match(service.content, /private fun openCallMenu\(/);
  assert.doesNotMatch(analyzer.content, /"voice_call"/);
  assert.doesNotMatch(analyzer.content, /"send_btn"/);
  assert.doesNotMatch(analyzer.content, /"conversations_list"/);
  assert.doesNotMatch(analyzer.content, /"contact_cell_layout"/);
});

test('a busca de contato usa o nome exato e os ids reais da tela', () => {
  const service = sources.find(({ file }) => file.endsWith('NexusAccessibilityService.kt'));
  const analyzer = sources.find(({ file }) => file.endsWith('ReaLayoutAnalyzer.kt'));
  assert.ok(service && analyzer, 'fontes da busca não encontrados');

  // Resultado escolhido pelo NOME exato (sem acento/caixa): buscar "Amor"
  // devolve "Amor", "Amor Kezia" e "Amor 2 Claro" na mesma lista.
  assert.match(service.content, /private fun findListRowByName\(/);
  assert.match(service.content, /conversations_row_contact_name/);
  assert.match(service.content, /fold\(it\.text\) == wanted/);

  // O caminho é o da tela real: barra → campo → resultado → conversa.
  assert.match(analyzer.content, /primaryId = "my_search_bar"/);
  assert.match(analyzer.content, /primaryId = "search_input"/);
  assert.match(analyzer.content, /primaryId = "conversations_row_contact_name"/);
  assert.match(analyzer.content, /primaryId = "entry"/);
  assert.match(analyzer.content, /primaryId = "send_container"/);
});

test('a automação toca na coordenada quando o botão não é clicável', () => {
  const service = sources.find(({ file }) => file.endsWith('NexusAccessibilityService.kt'));
  assert.ok(service, 'NexusAccessibilityService.kt não encontrado');

  // Os botões de chamar e de enviar do WhatsApp vêm com clickable=false: sem o
  // toque por coordenada, ACTION_CLICK devolve false e nada acontece.
  assert.match(service.content, /private fun clickOrTap\(/);
  assert.match(service.content, /private fun tapNode\(/);
  assert.match(service.content, /dispatchGesture/);

  // E o serviço precisa estar autorizado a desenhar gestos.
  const config = readFileSync(
    path.join(projectRoot, 'native-android', 'res', 'xml', 'accessibility_service_config.xml'),
    'utf8',
  );
  assert.match(config, /canPerformGestures="true"/);

  // O envio confere o microfone: ele só existe com o campo VAZIO, então o
  // desaparecimento dele é o sinal de que o botão de enviar tomou o lugar.
  assert.match(service.content, /"voice_note_button"/);
  assert.match(service.content, /Campo esvaziou/);
});

test('a chamada só é anunciada quando a tela de chamada assume a frente', () => {
  const service = sources.find(({ file }) => file.endsWith('NexusAccessibilityService.kt'));
  const module = sources.find(({ file }) => file.endsWith('NexusNativeModule.kt'));
  assert.ok(service && module, 'fontes da chamada não encontrados');

  // O fluxo tem começo, meio e fim observáveis.
  assert.match(service.content, /private fun callFlow\(/);
  assert.match(service.content, /private fun openCallMenu\(/);
  assert.match(service.content, /tela de chamada confirmada/);
  assert.match(service.content, /fun startWhatsAppCall\(/);

  // E o módulo nativo responde com a VERDADE: antes ele só abria a conversa e
  // devolvia sucesso, então o app dizia "chamada aberta" sem ter ligado.
  assert.match(module.content, /private fun startCallAndResolve\(/);
  assert.match(module.content, /não consegui iniciar a chamada/);
});

test('a espera da tela do WhatsApp pergunta em vez de dormir', () => {
  const service = sources.find(({ file }) => file.endsWith('NexusAccessibilityService.kt'));
  assert.ok(service, 'NexusAccessibilityService.kt não encontrado');

  // O antigo fluxo dormia 500/800 ms e torcia. Agora pergunta até responder.
  assert.match(service.content, /private fun <T> waitFor\(/);
  assert.match(service.content, /predicate/);
  assert.doesNotMatch(service.content, /delay para o teclado aparecer/);
  assert.doesNotMatch(service.content, /delay para a busca filtrar/);
  // A busca abre o resultado pelo NOME, não pelo primeiro item da lista.
  assert.match(service.content, /private fun findListRowByName\(/);
});

test('a resposta por voz escreve primeiro e só envia depois do "sim"', () => {
  const service = sources.find(({ file }) => file.endsWith('NexusAccessibilityService.kt'));
  const module = sources.find(({ file }) => file.endsWith('NexusNativeModule.kt'));
  assert.ok(service && module, 'fontes da resposta não encontrados');

  // Escrever é separado de enviar: é essa separação que permite APAGAR a
  // resposta quando o usuário diz "não" antes de qualquer coisa sair.
  const write = service.content.slice(
    service.content.indexOf('private fun writeInOpenChatInternal('),
  );
  const writeBody = write.slice(0, write.indexOf('\n    /**'));
  assert.match(writeBody, /ACTION_SET_TEXT/);
  assert.doesNotMatch(writeBody, /tapSendAndConfirm/);
  assert.match(writeBody, /callback\(written\)/);

  // Apagar reaproveita a escrita com texto vazio (nada de um caminho paralelo).
  assert.match(
    service.content,
    /fun clearOpenChat\(callback: \(Boolean\) -> Unit\) \{[\s\S]{0,200}writeInOpenChatInternal\("", callback\)/,
  );

  // E o envio confirma pelo campo esvaziando, nunca "toquei e deu certo".
  assert.match(service.content, /private fun sendInOpenChatInternal\(/);
  assert.match(service.content, /tapSendAndConfirm\(callback\)/);

  // A ponte expõe as três operações separadas.
  assert.match(module.content, /fun writeWhatsAppReply\(text: String, promise: Promise\)/);
  assert.match(module.content, /fun clearWhatsAppReply\(promise: Promise\)/);
  assert.match(module.content, /fun sendWhatsAppReply\(promise: Promise\)/);
});

test('o áudio é tocado pelo nome acessível da tela e nunca é prometido à toa', () => {
  const service = sources.find(({ file }) => file.endsWith('NexusAccessibilityService.kt'));
  const module = sources.find(({ file }) => file.endsWith('NexusNativeModule.kt'));
  assert.ok(service && module, 'fontes do áudio não encontrados');

  // Sem ID inventado: o controle é achado pelo nome acessível que o WhatsApp usa.
  assert.match(service.content, /VOICE_PLAY_LABELS/);
  assert.match(service.content, /VOICE_PAUSE_LABELS/);
  assert.match(service.content, /reproduzir/);
  assert.match(service.content, /pausar/);
  assert.match(service.content, /private fun collectByLabels\(/);

  // A espera olha a tela e tem teto: nenhum áudio prende o Nexus para sempre.
  assert.match(service.content, /private fun waitForVoiceNoteEnd\(/);
  assert.match(service.content, /VOICE_NOTE_MAX_MS/);

  // Não achou o controle? Diz que não tocou.
  const play = service.content.slice(service.content.indexOf('private fun playLastVoiceNoteInternal('));
  assert.match(play.slice(0, 1400), /callback\(false\)/);

  assert.match(module.content, /fun playLastNotificationAudio\(promise: Promise\)/);
});

test('anotações e lembretes têm ponte nativa de ponta a ponta', () => {
  const module = sources.find(({ file }) => file.endsWith('NexusNativeModule.kt'));
  assert.ok(module, 'NexusNativeModule.kt não encontrado');

  for (const method of [
    'fun saveNote(',
    'fun listNotes(',
    'fun deleteNote(',
    'fun clearNotes(',
    'fun saveReminder(',
    'fun listReminders(',
    'fun updateReminder(',
    'fun deleteReminder(',
    'fun setReminderEnabled(',
    'fun getNextReminder(',
    'fun rescheduleReminders(',
  ]) {
    assert.match(module.content, new RegExp(method.replace(/[()]/g, '\\$&')));
  }

  // A lista vive no app (preferências privadas), sem depender de app de notas.
  assert.ok(
    sources.some(({ file }) => file.endsWith('NoteStore.kt')),
    'NoteStore.kt não encontrado',
  );
  assert.ok(
    sources.some(({ file }) => file.endsWith('ReminderStore.kt')),
    'ReminderStore.kt não encontrado',
  );

  // E a ponte JS conhece tudo isso.
  const bridge = readFileSync(
    path.join(projectRoot, 'app', 'services', 'nexusNative.ts'),
    'utf8',
  );
  for (const method of [
    'saveNote(',
    'listNotes(',
    'deleteNote(',
    'clearNotes(',
    'saveReminder(',
    'listReminders(',
    'updateReminder(',
    'deleteReminder(',
    'setReminderEnabled(',
    'getNextReminder(',
  ]) {
    assert.ok(
      bridge.includes(method),
      `nexusNative.ts sem o método ${method}`,
    );
  }
});

test('o lembrete avisa quando o Android só aceitou alarme aproximado', () => {
  const scheduler = sources.find(({ file }) => file.endsWith('ReminderScheduler.kt'));
  const module = sources.find(({ file }) => file.endsWith('NexusNativeModule.kt'));
  assert.ok(scheduler && module, 'fontes do agendamento não encontrados');

  // O agendamento devolve a VERDADE (exato ou aproximado)...
  assert.match(scheduler.content, /fun scheduleNextExact\(/);
  assert.match(scheduler.content, /Pair<Reminder\?, Boolean>/);
  assert.match(scheduler.content, /canScheduleExactAlarms\(\)/);
  assert.match(scheduler.content, /setAlarmClock\(/);
  assert.match(scheduler.content, /setAndAllowWhileIdle\(/);

  // ...e o módulo repassa isso ao JS em vez de calcular no chute.
  assert.match(module.content, /val \(scheduled, exact\) = reminderScheduler\.scheduleNextExact\(/);
  assert.match(module.content, /putBoolean\("exact", exact\)/);
  assert.doesNotMatch(
    module.content,
    /val exact = scheduled\.enabled && scheduled\.triggerAtMillis/,
  );

  // O app fala o aviso quando o alarme não foi exato.
  const app = readFileSync(path.join(projectRoot, 'App.tsx'), 'utf8');
  assert.match(app, /exact === false/);
});

test('os receptores de lembrete e de boot estão declarados para sobreviver ao prebuild', () => {
  const plugin = readFileSync(
    path.join(projectRoot, 'plugins', 'nexus-native.js'),
    'utf8',
  );
  const appJson = readFileSync(path.join(projectRoot, 'app.json'), 'utf8');

  // Sem essas permissões o alarme exato é recusado e o lembrete some no boot.
  for (const permission of [
    'android.permission.USE_EXACT_ALARM',
    'android.permission.SCHEDULE_EXACT_ALARM',
    'android.permission.RECEIVE_BOOT_COMPLETED',
  ]) {
    assert.ok(
      plugin.includes(permission),
      `plugin sem a permissão ${permission}`,
    );
  }
  assert.match(appJson, /android\.permission\.USE_EXACT_ALARM/);
  assert.match(appJson, /android\.permission\.RECEIVE_BOOT_COMPLETED/);

  // Os receptores entram pelo plugin (o `android/` é regenerado no prebuild).
  assert.match(plugin, /\.reminder\.ReminderReceiver/);
  assert.match(plugin, /\.reminder\.BootReceiver/);
  assert.match(plugin, /android\.intent\.action\.BOOT_COMPLETED/);
  assert.match(plugin, /android\.intent\.action\.MY_PACKAGE_REPLACED/);
});

test('a conversa da notificação é decidida por um módulo testável, não no meio do App', () => {
  const app = readFileSync(path.join(projectRoot, 'App.tsx'), 'utf8');

  // O passo a passo (ler? tocar? responder? enviar?) vem do módulo puro.
  assert.match(app, /from '\.\/app\/core\/notificationFlow\.mjs'/);
  assert.match(app, /startNotificationFlow\(/);
  assert.match(app, /advanceNotificationFlow\(/);

  // As ações do fluxo são executadas com o resultado REAL do nativo.
  assert.match(app, /writeWhatsAppReply\(/);
  assert.match(app, /sendWhatsAppReply\(/);
  assert.match(app, /clearWhatsAppReply\(/);
  assert.match(app, /playLastNotificationAudio\(/);

  // A conversa da notificação é respondida ANTES do roteador de comandos:
  // senão "sim" cairia no confirmar-envio do WhatsApp, que é outro fluxo.
  const flowAt = app.indexOf('const flow = pendingNotificationRef.current;');
  const planAt = app.indexOf('const plan = planNativeCommand(text);');
  assert.ok(flowAt > 0 && planAt > 0, 'blocos não encontrados no App');
  assert.ok(
    flowAt < planAt,
    'a conversa da notificação precisa ser tratada antes do roteador de comandos',
  );

  // E existe o gancho para o lembrete entrar na conversa quando dispara.
  assert.match(app, /onReminderFired\(/);
});

test('a voz separa fala de barulho antes de executar um pedido', () => {
  const engine = sources.find(({ file }) => file.endsWith('NexusVoiceEngine.kt'));
  assert.ok(engine, 'NexusVoiceEngine.kt não encontrado');

  // O volume medido pelo próprio reconhecedor é usado (nada de reescrever
  // AudioRecord): o piso do ambiente e a margem de fala.
  assert.match(engine.content, /override fun onRmsChanged\(rmsdB: Float\) \{\s*\n\s*if \(stale\(\)\) return\s*\n\s*noteRms\(rmsdB\)/);
  assert.match(engine.content, /private fun noteRms\(/);
  assert.match(engine.content, /SPEECH_MARGIN_DB/);
  assert.match(engine.content, /noiseFloorDb/);

  // Sem amostras de volume o Nexus NÃO julga: recusar fala real seria pior.
  assert.match(engine.content, /private fun isNoiseOnly\(\): Boolean \{/);
  assert.match(engine.content, /if \(vadSamples < MIN_VAD_SAMPLES\) return false/);

  // Frase que veio do barulho termina como "noise", nunca como comando.
  assert.match(engine.content, /const val REASON_NOISE = "noise"/);
  assert.match(engine.content, /endDirectCapture\(REASON_NOISE\)/);
  assert.match(engine.content, /endMascotCapture\(REASON_NOISE\)/);

  // O fim de fala do motor é respeitado e o teto só estende com fala em curso.
  assert.match(engine.content, /override fun onEndOfSpeech\(\)/);
  assert.match(engine.content, /speechEnded = true/);
  assert.match(engine.content, /MAX_DIRECT_EXTENSIONS/);
  assert.match(engine.content, /directExtensions < MAX_DIRECT_EXTENSIONS/);

  // Rede e microfone são motivos diferentes na tela.
  assert.match(engine.content, /const val REASON_NETWORK = "network"/);
  assert.match(engine.content, /private fun failureReason\(error: Int\): String/);
  assert.match(engine.content, /ERROR_NETWORK_TIMEOUT/);
});

test('a chamada é atendida ou recusada com honestidade (nunca no chute)', () => {
  const service = sources.find(({ file }) => file.endsWith('NexusAccessibilityService.kt'));
  const module = sources.find(({ file }) => file.endsWith('NexusNativeModule.kt'));
  const app = readFileSync(path.join(projectRoot, 'App.tsx'), 'utf8');
  assert.ok(service && module, 'fontes da chamada não encontrados');

  // O botão da chamada é achado pelo nome acessível e tocado no centro; sem
  // botão reconhecível, o retorno é `false` (nada de "atendeu" de mentira).
  assert.match(service.content, /fun answerIncomingCall\(callback: \(Boolean\) -> Unit\)/);
  assert.match(service.content, /fun declineIncomingCall\(callback: \(Boolean\) -> Unit\)/);
  assert.match(service.content, /ANSWER_CALL_LABELS/);
  assert.match(service.content, /DECLINE_CALL_LABELS/);
  assert.match(service.content, /private fun tapCallButton\(/);
  assert.match(service.content, /callback\(false\)/);

  assert.match(module.content, /fun answerWhatsAppCall\(promise: Promise\)/);
  assert.match(module.content, /fun declineWhatsAppCall\(promise: Promise\)/);

  // O app NUNCA responde "atendida" sem o retorno real: e jamais liga de volta
  // no lugar de atender (era o risco do triggerWhatsAppCall aqui).
  assert.match(app, /answerWhatsAppCall\(\)/);
  assert.match(app, /declineWhatsAppCall\(\)/);
  const answerBlock = app.slice(app.indexOf("case 'answer-call'"), app.indexOf("case 'decline-call'"));
  assert.doesNotMatch(answerBlock, /triggerWhatsAppCall/);
});

test('chamada perdida é reconhecida pela notificação, não pelo texto solto', () => {
  const listener = sources.find(({ file }) =>
    file.endsWith('NexusNotificationListenerService.kt'),
  );
  assert.ok(listener, 'NexusNotificationListenerService.kt não encontrado');

  // Chamada a atender = categoria CALL + notificação contínua (o Android diz).
  assert.match(listener.content, /isRingingCall/);
  assert.match(listener.content, /Notification\.CATEGORY_CALL/);
  assert.match(listener.content, /FLAG_ONGOING_EVENT/);

  // Chamada perdida tem tipo próprio, e o texto de chamada NÃO a promove a
  // "chamada para atender" (era o defeito: "Chamada perdida" pedia atender).
  assert.match(listener.content, /isMissedCall/);
  assert.match(listener.content, /"missed-call"/);
  assert.match(listener.content, /val isRingingCall = !isMissedCall/);
  assert.doesNotMatch(listener.content, /val isCallByText/);
});

test('abrir a conversa da notificação tem plano B quando o intent do WhatsApp expira', () => {
  const module = sources.find(({ file }) => file.endsWith('NexusNativeModule.kt'));
  const service = sources.find(({ file }) => file.endsWith('NexusAccessibilityService.kt'));
  assert.ok(module && service, 'fontes da abertura de conversa não encontrados');

  // O PendingIntent da notificação é trocado/cancelado pelo WhatsApp a cada
  // mensagem nova. Se o envio falha, NÃO pode devolver false: o contato ainda
  // está guardado e a busca por acessibilidade abre a conversa.
  const block = module.content.slice(
    module.content.indexOf('fun openNotificationConversation'),
    module.content.indexOf('fun requestMicrophonePermission'),
  );
  assert.match(block, /isConversationFrom\(contactName\) &&/);
  assert.match(block, /openLastConversation\(\)/);
  assert.match(block, /searchAndOpenWhatsAppContact\(contactName\)/);
  // E contato vazio não vira busca (a busca por "" abriria nada).
  assert.match(block, /if \(contactName\.isBlank\(\)/);
});

test('o WhatsApp é aberto pelo intent de lançamento do sistema, não por intent implícito', () => {
  const service = sources.find(({ file }) => file.endsWith('NexusAccessibilityService.kt'));
  assert.ok(service, 'NexusAccessibilityService.kt não encontrado');

  // Evidência (moto g84, Android 15): o intent implícito MAIN/LAUNCHER com
  // setPackage falhava com "No Activity found to handle Intent".
  assert.match(service.content, /packageManager\.getLaunchIntentForPackage\(/);
  assert.doesNotMatch(service.content, /setPackage\(ReaLayoutAnalyzer\.WHATSAPP_PACKAGE\)/);

  // A busca (`my_search_bar`) só existe na lista: dentro de um chat o fluxo
  // precisa voltar uma tela antes de procurar.
  assert.match(service.content, /performGlobalAction\(GLOBAL_ACTION_BACK\)/);
  assert.match(service.content, /find\("conversation_contact_name"\) != null/);
});

test('resumo do WhatsApp (sem contato real) não vira pergunta de leitura', () => {
  const listener = sources.find(({ file }) =>
    file.endsWith('NexusNotificationListenerService.kt'),
  );
  assert.ok(listener, 'NexusNotificationListenerService.kt não encontrado');

  // "Chegaram 10 mensagens enquanto você estava fora" chega com título
  // "WhatsApp", não com o nome de quem mandou. Sem esta trava o Nexus
  // perguntava "quer que eu leia?" e não tinha conversa para abrir.
  assert.match(listener.content, /contact\.isEmpty\(\)/);
  assert.match(listener.content, /contact\.equals\("WhatsApp", ignoreCase = true\)/);
  assert.match(listener.content, /contact\.equals\(appLabel\(sbn\.packageName\), ignoreCase = true\)/);
});

test('enviar e buscar no WhatsApp não caem em classe genérica de widget', () => {
  const analyzer = sources.find(({ file }) => file.endsWith('ReaLayoutAnalyzer.kt'));
  const service = sources.find(({ file }) => file.endsWith('NexusAccessibilityService.kt'));
  assert.ok(analyzer && service, 'fontes do WhatsApp não encontrados');

  // Evidência (moto g84, Android 15): com o campo cheio, `voice_note_button`
  // era "encontrado" em qualquer ImageButton (menu, chamada de vídeo) e o
  // envio esperava 5 s, desistia e deixava a mensagem como RASCUNHO.
  const voiceBlock = analyzer.content.slice(
    analyzer.content.indexOf('"voice_note_button"'),
    analyzer.content.indexOf('"chat_contact_name"'),
  );
  assert.doesNotMatch(voiceBlock, /android\.widget\.ImageButton/);

  // O enviar também não pode ser o primeiro FrameLayout/RelativeLayout da tela.
  const sendBlock = analyzer.content.slice(
    analyzer.content.indexOf('"send_button"'),
    analyzer.content.indexOf('"voice_note_button"'),
  );
  assert.doesNotMatch(sendBlock, /android\.widget\.(FrameLayout|RelativeLayout|ImageButton)/);

  // A busca tem id estável (`my_search_bar`); o primeiro FrameLayout é a lista.
  const searchBlock = analyzer.content.slice(
    analyzer.content.indexOf('"search_box"'),
    analyzer.content.indexOf('"search_input"'),
  );
  assert.doesNotMatch(searchBlock, /android\.widget\.(FrameLayout|EditText)/);

  // A MENSAGEM nunca pode ser escrita num EditText qualquer: a caixa de busca
  // também é EditText. Sem esta trava o texto ia para a busca (evidência:
  // search_input com "teste do nexus 4") e o contato nunca abria.
  const messageBlock = analyzer.content.slice(
    analyzer.content.indexOf('"message_input"'),
    analyzer.content.indexOf('"send_button"'),
  );
  assert.doesNotMatch(messageBlock, /android\.widget\.EditText/);

  // E o campo de busca só pode ser achado pelo id/descrição dele.
  const searchInputBlock = analyzer.content.slice(
    analyzer.content.indexOf('"search_input"'),
    analyzer.content.indexOf('"chat_list"'),
  );
  assert.doesNotMatch(searchInputBlock, /android\.widget\.(EditText|AutoCompleteTextView)/);

  // O serviço confere que a busca está fechada antes de escrever e só espera
  // a conversa abrir quando o campo de busca NÃO está na tela.
  assert.match(service.content, /if \(find\("search_input"\) != null\)/);
  assert.match(service.content, /find\("search_input", root\)/);

  // O campo vazio mostra o placeholder "Mensagem": ele não é rascunho.
  assert.match(service.content, /EMPTY_MESSAGE_HINTS/);
  assert.match(service.content, /private fun messageFieldIsClear\(\)/);
});

test('mensagem lida pelo Nexus é marcada como lida no WhatsApp', () => {
  const listener = sources.find(({ file }) =>
    file.endsWith('NexusNotificationListenerService.kt'),
  );
  assert.ok(listener, 'NexusNotificationListenerService.kt não encontrado');

  // Evidência (moto g84, Android 15): a notificação de mensagem do WhatsApp
  // traz a ação "Marcar como lida". Disparar o PendingIntent é o caminho
  // oficial: limpa o aviso E o contador de não lidas da conversa.
  assert.match(listener.content, /Marcar como lida/);
  assert.match(listener.content, /action\.actionIntent\.send\(\)/);
  assert.match(listener.content, /cancelNotification\(sbn\.key\)/);

  // Só para mensagem: apagar o aviso de uma chamada tocando seria errado.
  assert.match(listener.content, /type == "message"[\s\S]{0,80}markAsRead/);
});

test('resposta com falha essencial para o fluxo (e o Nexus já avisou o motivo)', () => {
  const app = readFileSync(path.join(projectRoot, 'App.tsx'), 'utf8');

  // Escrever, enviar e apagar são ESSENCIAIS: se falham, o fluxo para em vez de
  // falar a próxima pergunta ("posso enviar?" de uma resposta que não existe).
  assert.match(app, /let criticalFailed = false/);
  assert.match(app, /return !criticalFailed/);
  assert.match(app, /if \(!progressed\) \{/);

  // E quem fala "respondida"/"apagada" é a interface, com o retorno real.
  assert.match(app, /Mensagem respondida para \$\{repliedTo\}/);
  assert.match(app, /'Apaguei a resposta\.'/);
});

test('a interface não promete escuta passiva nem palavra de ativação', () => {
  const app = readFileSync(path.join(projectRoot, 'App.tsx'), 'utf8');
  const engine = sources.find(({ file }) => file.endsWith('NexusVoiceEngine.kt'));
  assert.ok(engine, 'NexusVoiceEngine.kt não encontrado');

  // O texto que o usuário lê não pode mandar dizer a palavra de ativação: o
  // microfone fora do app abre no TOQUE no mascote.
  assert.doesNotMatch(app, /mascote acorda com/i);
  assert.doesNotMatch(app, /diga "Nexo"/i);
  assert.match(app, /toque no mascote/i);

  // A função que o JS chama para "escutar flutuando" NÃO pode abrir sessão.
  const start = engine.content.indexOf('fun startFloatingListening()');
  assert.ok(start >= 0, 'startFloatingListening não encontrado');
  const body = engine.content.slice(start, start + 500);
  assert.doesNotMatch(body, /openSession\(/);

  // A permissão de microfone também não fala mais em palavra de ativação.
  const plan = readFileSync(path.join(projectRoot, 'app', 'core', 'permissionPlan.mjs'), 'utf8');
  assert.doesNotMatch(plan, /Nexo/);
});

test('os lugares nunca são discados sem confirmação e pessoa nunca vira pesquisa', () => {
  const app = readFileSync(path.join(projectRoot, 'App.tsx'), 'utf8');

  // Contato primeiro, número depois, internet por último — e só com o "sim".
  const contactsAt = app.indexOf('nexusNative.searchContacts(value)');
  const lookupAt = app.indexOf('lookupPhoneNumber(value)');
  assert.ok(contactsAt > 0 && lookupAt > 0, 'placeLocalCall não encontrado');

  // O pedido de pesquisa fica pendente até o usuário confirmar.
  assert.match(app, /pendingLookupCallRef\.current = \{/);
  assert.match(app, /Quer que eu ligue\?/);
});

test('o WhatsApp não é aberto quando a automação está desligada', () => {
  const service = sources.find(({ file }) => file.endsWith('NexusAccessibilityService.kt'));
  const module = sources.find(({ file }) => file.endsWith('NexusNativeModule.kt'));
  assert.ok(service && module, 'fontes do WhatsApp não encontrados');

  // Reinstalar o APK desliga o serviço de acessibilidade no Android. O módulo
  // precisa responder ANTES de abrir a conversa; sem isso a conversa abre pelo
  // wa.me e a promessa do React Native nunca resolve ("Pensando..." eterno).
  assert.match(module.content, /private fun ensureAccessibilityAutomation\(promise: Promise\)/);
  assert.match(module.content, /A automação do Nexus está desligada/);

  for (const signature of [
    'fun sendWhatsAppMessage(contactName: String, message: String, promise: Promise)',
    'fun makeWhatsAppCall(contactName: String, isVideo: Boolean, promise: Promise)',
  ]) {
    const start = module.content.indexOf(signature);
    assert.ok(start > 0, `${signature} não encontrado`);
    const body = module.content.slice(start, start + 700);
    assert.match(body, /ensureAccessibilityAutomation\(promise\)/);
  }

  // E nenhum método com callback pode retornar em silêncio: quem chamou tem
  // que receber a falha para o app sair do estado de espera.
  const inject = service.content.slice(
    service.content.indexOf('fun injectTextAndSendAndWait(message: String'),
  );
  assert.match(inject.slice(0, 700), /callback\(false, false\)/);
  assert.doesNotMatch(inject.slice(0, 700), /instance \?: return\s*\n/);
});

test('a permissao de acessibilidade se apoia no servico vivo, nao so em leitura protegida', () => {
  // O defeito (duas rodadas):
  // 1) A deteccao so olhava a lista de servicos ATIVOS do sistema. Um
  //    servico que cai sai dessa lista - e foi o proprio crash do mascote que
  //    o derrubava - entao o app dizia "a automacao esta desligada" mesmo com
  //    a permissao JA DADA na tela de boas-vindas.
  // 2) Depois disso a deteccao passou a ler so a configuracao do Android
  //    (Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES). Nesse aparelho essa
  //    leitura VOLTA `null` para app comum (a leitura e protegida) - e o
  //    auto-bot estava ligado e conectado, mas o app continuava pedindo a
  //    permissao. Falso positivo que vira erro e bug.
  //
  // A prova que funciona em todo aparelho: o PROPRIO servico rodando.
  const module = sources.find(({ file }) => file.endsWith('NexusNativeModule.kt'));
  assert.ok(module, 'NexusNativeModule.kt nao encontrado');

  const detection = module.content.slice(
    module.content.indexOf('private fun isAccessibilityServiceEnabled'),
  );
  const body = detection.slice(0, detection.indexOf('\n    }'));

  // A fonte principal: o servico de acessibilidade vivo.
  assert.match(body, /NexusAccessibilityService\.isConnected\(\)/);
  // A configuracao do Android fica como reserva (nem todo aparelho deixa ler).
  assert.match(body, /Settings\.Secure\.ENABLED_ACCESSIBILITY_SERVICES/);
  // A lista de ativos tambem, como ultima reserva.
  assert.match(body, /getEnabledAccessibilityServiceList/);
});

test('o app avisa o JS quando o Auto-Bot conecta, para a tela de permissoes se corrigir', () => {
  // O defeito: a tela de permissoes le um RETRATO do estado no momento em que
  // abre. O servico de acessibilidade so conecta DEPOIS que o app sobe (o
  // Android instancia o servico poucos segundos depois), entao o retrato
  // dizia "desligada" com a automacao ja ligada. Como a tela so re-leu o
  // estado quando o app voltava do background, o "PERMITIR" ficava na tela e
  // o usuario re-liberava uma permissao que ja tinha aceito.
  //
  // A correcao: o servico avisa o JS quando conecta, e a tela re-le o retrato.
  const service = sources.find(({ file }) => file.endsWith('NexusAccessibilityService.kt'));
  assert.ok(service, 'NexusAccessibilityService.kt nao encontrado');
  assert.match(
    service.content,
    /emitEvent\(\s*"onAccessibilityStateChanged"/,
    'o servico de acessibilidade nao avisa que conectou',
  );

  const screen = readFileSync(
    path.join(projectRoot, 'app', 'ui', 'PermissionsScreen.tsx'),
    'utf8',
  );
  assert.match(
    screen,
    /onAccessibilityStateChanged/,
    'a tela de permissoes nao escuta a conexao do Auto-Bot',
  );
});

test('o mascote entra em foreground no onCreate, antes do prazo de 5 s do Android', () => {  // O defeito: o startForeground() so acontecia no onStartCommand. Quando a
  // thread principal estava ocupada (app voltando do background), o Android
  // estourava o PROCESSO com ForegroundServiceDidNotStartInTimeException. Como
  // o servico de acessibilidade mora no mesmo processo, o auto-bot caia junto e
  // o app voltava a dizer que a permissao nunca foi dada.
  const overlay = sources.find(({ file }) => file.endsWith('NexusOverlayService.kt'));
  assert.ok(overlay, 'NexusOverlayService.kt nao encontrado');

  const onCreate = overlay.content.slice(
    overlay.content.indexOf('override fun onCreate'),
    overlay.content.indexOf('override fun onStartCommand'),
  );
  assert.match(onCreate, /startForegroundSafely\(\)/);

  // E o startForeground nao pode depender de o mascote realmente aparecer.
  const onStart = overlay.content.slice(
    overlay.content.indexOf('override fun onStartCommand'),
  ).slice(0, 1200);
  const foregroundCall = onStart.indexOf('startForegroundSafely()');
  const overlayCall = onStart.indexOf('startOverlay()');
  assert.ok(foregroundCall >= 0, 'onStartCommand nao chama startForegroundSafely');
  assert.ok(
    foregroundCall < overlayCall,
    'startForeground tem de vir antes de startOverlay',
  );
});