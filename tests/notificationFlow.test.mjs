import assert from 'node:assert/strict';
import test from 'node:test';

import {
  advanceNotificationFlow,
  isAudioNotification,
  notificationFlowLabel,
  resolveNotificationType,
  startNotificationFlow,
} from '../app/core/notificationFlow.mjs';

/** Fluxo de mensagem de texto, do começo ao fim. */
function textFlow() {
  return startNotificationFlow({
    contact: 'Amor',
    message: 'Bom dia, meu amor',
    type: 'message',
  });
}

const yes = { type: 'answer', affirmative: true };
const no = { type: 'answer', affirmative: false };

test('mensagem: fala o remetente e pergunta se pode ler', () => {
  const started = textFlow();

  assert.equal(started.state.step, 'ask-read');
  assert.match(started.say, /Chegou mensagem de Amor/);
  assert.match(started.say, /Quer que eu leia\?/);
  // Abre o microfone para a resposta, sem abrir conversa ainda.
  assert.deepEqual(started.actions, [{ type: 'listen' }]);
});

test('a mensagem lida NA TELHA vale mais que a da notificação', () => {
  const started = startNotificationFlow({
    contact: 'Amor',
    message: 'oi',
    type: 'message',
  });
  // A notificação chega truncada: o balão aberto tem o texto inteiro.
  const read = advanceNotificationFlow(started.state, {
    type: 'answer',
    affirmative: true,
    message: 'oi, tudo bem? hj a gente se fala',
  });

  assert.match(read.say, /Amor/);
  assert.match(read.say, /tudo bem/);
  // E a conversa abre: o Nexus entra no WhatsApp para ler.
  assert.ok(read.actions.some((action) => action.type === 'open-chat'));
});

test('mensagem: lida, pergunta se quer responder', () => {
  const read = advanceNotificationFlow(textFlow().state, yes);

  assert.equal(read.state.step, 'ask-reply');
  assert.match(read.say, /Mensagem de Amor: "Bom dia, meu amor"/);
  // As três opções precisam ser DITAS: responder, ligar ou chamada de vídeo.
  assert.match(read.say, /Deseja responder, ligar ou fazer chamada de vídeo\?/);
  // Abre a conversa do contato ANTES de perguntar (o usuário pediu para entrar
  // no WhatsApp e ler a mensagem de quem mandou).
  assert.deepEqual(read.actions, [{ type: 'open-chat' }, { type: 'listen' }]);
});

test('mensagem: dizer não encerra e devolve a mídia', () => {
  const declined = advanceNotificationFlow(textFlow().state, no);

  assert.equal(declined.state.step, 'done');
  assert.deepEqual(declined.actions, [{ type: 'resume-media' }]);
  assert.equal(declined.say, 'Tudo bem.');
});

test('responder: abre a conversa e abre o microfone', () => {
  const reading = advanceNotificationFlow(textFlow().state, yes);
  const replying = advanceNotificationFlow(reading.state, yes);

  assert.equal(replying.state.step, 'listening');
  assert.match(replying.say, /Pode falar/);
  assert.deepEqual(replying.actions, [{ type: 'open-chat' }, { type: 'listen' }]);
});

test('responder: a fala vira texto no campo e o Nexus envia na sequência', () => {
  const reading = advanceNotificationFlow(textFlow().state, yes);
  const replying = advanceNotificationFlow(reading.state, yes);
  const captured = advanceNotificationFlow(replying.state, {
    type: 'captured',
    text: 'Bom dia, tudo bem?',
  });

  assert.equal(captured.state.step, 'done');
  assert.equal(captured.state.reply, 'Bom dia, tudo bem?');
  assert.match(captured.say, /Enviando sua resposta para Amor/);
  // Escreve e ENVIA na mesma sequência: o usuário já falou a resposta.
  assert.deepEqual(captured.actions, [
    { type: 'write-reply', text: 'Bom dia, tudo bem?' },
    { type: 'send-reply' },
  ]);
});

test('responder: depois de falar, o Nexus envia sem pedir outra confirmação', () => {
  const reading = advanceNotificationFlow(textFlow().state, yes);
  const replying = advanceNotificationFlow(reading.state, yes);
  const captured = advanceNotificationFlow(replying.state, { type: 'captured', text: 'oi' });

  assert.equal(captured.state.step, 'done');
  assert.deepEqual(captured.actions, [
    { type: 'write-reply', text: 'oi' },
    { type: 'send-reply' },
  ]);
  // Quem fala "Mensagem respondida para X" é a interface, com o resultado real.
  assert.match(captured.say, /Enviando sua resposta para Amor/);

  // O caminho antigo de confirmação continua existindo para estados antigos.
  const legacy = advanceNotificationFlow(
    { ...captured.state, step: 'confirm-send', reply: 'oi' },
    yes,
  );
  assert.equal(legacy.state.step, 'done');
  assert.deepEqual(legacy.actions, [{ type: 'send-reply' }, { type: 'resume-media' }]);
});

test('responder: fala vazia pede para repetir sem inventar mensagem', () => {
  const reading = advanceNotificationFlow(textFlow().state, yes);
  const replying = advanceNotificationFlow(reading.state, yes);
  const empty = advanceNotificationFlow(replying.state, { type: 'captured', text: '   ' });

  assert.equal(empty.state.step, 'listening');
  assert.match(empty.say, /Não entendi/);
  assert.deepEqual(empty.actions, [{ type: 'listen' }]);
});

test('áudio: toca direto, sem pedir permissão para tocar', () => {
  const started = startNotificationFlow({
    contact: 'Amor',
    message: 'Mensagem de voz',
    type: 'message',
  });

  assert.equal(started.state.isAudio, true);
  assert.equal(started.state.step, 'playing-audio');
  assert.match(started.say, /Chegou um áudio de Amor/);
  assert.match(started.say, /Vou tocar/);
  assert.deepEqual(started.actions, [{ type: 'open-chat' }, { type: 'play-audio' }]);
});

test('áudio: depois de tocar, pergunta se quer responder', () => {
  const started = startNotificationFlow({
    contact: 'Amor',
    message: 'Mensagem de voz',
    type: 'message',
  });

  const afterAudio = advanceNotificationFlow(started.state, { type: 'audio-finished' });
  assert.equal(afterAudio.state.step, 'ask-reply');
  assert.match(afterAudio.say, /Quer responder para Amor\?/);
  assert.deepEqual(afterAudio.actions, [{ type: 'listen' }]);
});

test('áudio: a pergunta é de resposta, não de leitura', () => {
  const started = startNotificationFlow({ contact: 'Amor', message: 'Mensagem de voz' });
  const afterAudio = advanceNotificationFlow(started.state, { type: 'audio-finished' });

  assert.doesNotMatch(afterAudio.say, /Quer que eu leia/);
  assert.match(afterAudio.say, /Quer responder/);
});

test('mensagem sem texto não promete leitura: oferece abrir a conversa', () => {
  const started = startNotificationFlow({ contact: 'Amor', message: '', type: 'message' });

  assert.equal(started.state.step, 'ask-read');
  assert.equal(started.state.hasText, false);
  assert.match(started.say, /sem texto/);
  assert.doesNotMatch(started.say, /Quer que eu leia/);

  const opened = advanceNotificationFlow(started.state, yes);
  assert.deepEqual(opened.actions, [{ type: 'open-chat' }, { type: 'resume-media' }]);
});

test('foto/mídia sem a palavra áudio NÃO é tratada como áudio', () => {
  assert.equal(isAudioNotification({ message: 'Foto' }), false);
  assert.equal(isAudioNotification({ message: 'Vídeo' }), false);
  assert.equal(isAudioNotification({ message: '' }), false);
  assert.equal(isAudioNotification({ message: 'Mensagem de voz' }), true);
  assert.equal(isAudioNotification({ message: 'Áudio (0:12)' }), true);
  assert.equal(isAudioNotification({ isAudio: true }), true);
});

test('chamada de número desconhecido bloqueada: só ANUNCIA, não pergunta atender', () => {
  const started = startNotificationFlow({
    contact: 'número desconhecido',
    message: '+55 31 99999-9999',
    type: 'blocked-call',
  });

  // A chamada já foi recusada pelo Nexus: perguntar "quer atender?" seria
  // oferecer uma ação impossível. Só se avisa o bloqueio.
  assert.equal(started.state.step, 'done');
  assert.match(started.say, /bloqueada/);
  assert.ok(!started.say.includes('atender'), 'não pode oferecer atender');

  // A mídia pausada para o aviso volta sozinha: o fluxo terminou.
  assert.deepEqual(started.actions, [{ type: 'resume-media' }]);
});

test('chamada: pergunta se atende; atender e recusar NUNCA são prometidos', () => {
  const started = startNotificationFlow({ contact: 'Amor', type: 'video-call' });

  assert.equal(started.state.step, 'ask-attend');
  assert.match(started.say, /Chamada de vídeo de Amor/);
  // O usuário precisa saber que "não" recusa, sem adivinhar.
  assert.match(started.say, /sim para atender/);
  assert.match(started.say, /não para recusar/);

  // Atender é um toque numa tela que pode não expor o botão: a ação é pedida,
  // mas quem fala "atendida" é a interface, com o retorno real do aparelho.
  const accepted = advanceNotificationFlow(started.state, yes);
  assert.deepEqual(accepted.actions, [{ type: 'answer-call' }]);
  assert.equal(accepted.say, '');
  // Nada de devolver a rádio no meio de uma chamada.
  assert.ok(!accepted.actions.some((action) => action.type === 'resume-media'));

  const refused = advanceNotificationFlow(started.state, no);
  assert.deepEqual(refused.actions, [{ type: 'decline-call' }]);
  assert.equal(refused.say, '', 'não pode dizer "recusada" sem ter recusado');
});

test('chamada viva continua sendo chamada para atender', () => {
  const now = 1_700_000_000_000;

  assert.equal(
    resolveNotificationType({ type: 'voice-call', at: now - 5_000 }, now),
    'voice-call',
  );
  assert.equal(
    resolveNotificationType({ type: 'video-call' }, now),
    'video-call',
    'evento ao vivo chega sem at; não pode virar chamada perdida',
  );
});

test('chamada guardada há muito tempo vira chamada perdida', () => {
  const now = 1_700_000_000_000;

  assert.equal(
    resolveNotificationType({ type: 'video-call', at: now - 120_000 }, now),
    'missed-call',
  );
  assert.equal(
    resolveNotificationType({ type: 'voice-call', at: now + 5_000 }, now),
    'voice-call',
    'relógio adiantado não pode transformar uma chamada viva em perdida',
  );
});

test('mensagem não muda de tipo por causa do horário', () => {
  const now = 1_700_000_000_000;

  assert.equal(
    resolveNotificationType({ type: 'message', at: now - 999_999 }, now),
    'message',
  );
  assert.equal(resolveNotificationType({}, now), 'message');
});

test('chamada perdida não vira "quer atender?": a oferta é ligar de volta', () => {
  const started = startNotificationFlow({ contact: 'Amor', type: 'missed-call' });

  assert.equal(started.state.step, 'ask-call-back');
  assert.match(started.say, /Chamada perdida de Amor/);
  assert.match(started.say, /ligue de volta/);
  assert.doesNotMatch(started.say, /atender/);

  const callBack = advanceNotificationFlow(started.state, yes);
  assert.deepEqual(callBack.actions, [{ type: 'call-back' }]);
  assert.equal(callBack.say, '', 'quem diz se ligou é a interface');

  const skip = advanceNotificationFlow(started.state, no);
  assert.deepEqual(skip.actions, [{ type: 'resume-media' }]);
  assert.match(skip.say, /Tudo bem/);
});

test('notificação sem remetente não vira conversa', () => {
  const started = startNotificationFlow({ contact: '', message: 'oi' });

  assert.equal(started.state.step, 'done');
  assert.equal(started.say, '');
  assert.deepEqual(started.actions, [{ type: 'resume-media' }]);
});

test('fluxo encerrado não responde mais nada', () => {
  const ended = advanceNotificationFlow({ ...textFlow().state, step: 'done' }, yes);
  assert.deepEqual(ended.actions, []);
  assert.equal(ended.say, '');
});

test('depois de ler, "ligar" e "chamada de vídeo" são chamadas, não texto', () => {
  const reading = advanceNotificationFlow(textFlow().state, yes);
  assert.equal(reading.state.step, 'ask-reply');

  // "Ligar" dito logo depois da leitura.
  const voice = advanceNotificationFlow(reading.state, { type: 'call', video: false });
  assert.equal(voice.state.step, 'done');
  assert.equal(voice.say, '', 'quem fala se a chamada começou é a interface');
  assert.deepEqual(voice.actions, [{ type: 'call-contact', video: false }]);

  // "Chamada de vídeo" diretamente na primeira pergunta (antes de ler).
  const video = advanceNotificationFlow(textFlow().state, { type: 'call', video: true });
  assert.deepEqual(video.actions, [{ type: 'call-contact', video: true }]);
});

test('"ligar" no lugar da resposta NÃO é escrito no chat', () => {
  const reading = advanceNotificationFlow(textFlow().state, yes);
  const replying = advanceNotificationFlow(reading.state, yes);
  assert.equal(replying.state.step, 'listening');

  const call = advanceNotificationFlow(replying.state, { type: 'captured', text: 'ligar' });
  assert.equal(call.state.step, 'done');
  assert.deepEqual(call.actions, [{ type: 'call-contact', video: false }]);
  assert.ok(
    !call.actions.some((action) => action.type === 'write-reply'),
    'a palavra "ligar" não pode virar mensagem para o contato',
  );

  const video = advanceNotificationFlow(replying.state, {
    type: 'captured',
    text: 'chamada de vídeo',
  });
  assert.deepEqual(video.actions, [{ type: 'call-contact', video: true }]);
});

test('desistir do envio para ligar apaga o rascunho antes de discar', () => {
  const reading = advanceNotificationFlow(textFlow().state, yes);
  const replying = advanceNotificationFlow(reading.state, yes);
  const captured = advanceNotificationFlow(replying.state, { type: 'captured', text: 'oi' });

  // Estado antigo de confirmação: o usuário pode desistir e ligar.
  const call = advanceNotificationFlow(
    { ...captured.state, step: 'confirm-send' },
    { type: 'call', video: false },
  );
  assert.deepEqual(call.actions, [
    { type: 'clear-reply' },
    { type: 'call-contact', video: false },
  ]);
});

test('negação não vira chamada: "não liga" é texto normal', () => {
  const reading = advanceNotificationFlow(textFlow().state, yes);
  const replying = advanceNotificationFlow(reading.state, yes);
  const captured = advanceNotificationFlow(replying.state, {
    type: 'captured',
    text: 'não liga para mim agora',
  });

  assert.equal(captured.state.step, 'done');
  assert.match(captured.state.reply, /não liga/);
  assert.deepEqual(captured.actions, [
    { type: 'write-reply', text: 'não liga para mim agora' },
    { type: 'send-reply' },
  ]);
});

test('rótulo curto para a tela', () => {
  assert.equal(notificationFlowLabel(textFlow().state), 'Mensagem recebida');
  assert.equal(notificationFlowLabel({ step: 'confirm-send' }), 'Confirmar envio');
  assert.equal(notificationFlowLabel({ step: 'done' }), 'Em espera');
});
