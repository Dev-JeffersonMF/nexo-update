import test from 'node:test';
import assert from 'node:assert/strict';
import { createNetwork, train } from '../app/core/neuralLearner.mjs';
import { applySeedOnce } from '../app/core/neuralSeed.mjs';
import { AUTO_INTENTS, canonicalForIntent, recallLearnedIntent } from '../app/core/neuralIntent.mjs';

test('weather: a intenção vira o pedido canônico com a cidade extraída', () => {
  const built = canonicalForIntent('weather', 'me passe o tempo da cidade de matozinhos');
  assert.equal(built?.canonical, 'clima em matozinhos');
  assert.deepEqual(built?.plan, { action: 'weather', city: 'matozinhos', day: 'today' });

  const tomorrow = canonicalForIntent('weather', 'o tempo da cidade de matozinhos amanha');
  assert.deepEqual(tomorrow?.plan, { action: 'weather', city: 'matozinhos', day: 'tomorrow' });

  // Sem cidade sobrando: o canônico pergunta (o plano segue com cidade vazia).
  const ask = canonicalForIntent('weather', 'me passa o tempo da minha cidade');
  assert.deepEqual(ask?.plan, { action: 'weather', city: '', day: 'today' });
});

test('música, rádio e plataformas viram busca pelos nomes', () => {
  const music = canonicalForIntent('music', 'bota um som do zezinho');
  assert.equal(music?.canonical, 'toca zezinho');
  assert.deepEqual(music?.plan, { action: 'music', query: 'zezinho' });

  const radio = canonicalForIntent('radio-play', 'coloca a itatiaia pra mim');
  assert.equal(radio?.plan.action, 'radio-play');
  assert.equal(radio?.plan.station, 'itatiaia');

  const youtube = canonicalForIntent('youtube', 'quero ver no youtube o video do galo');
  assert.equal(youtube?.plan.action, 'youtube');
  assert.ok(youtube?.plan.query.length > 0);
});

test('volume e mídia viram o controle certo', () => {
  assert.deepEqual(canonicalForIntent('volume-up', 'poe o volume mais alto')?.plan, {
    action: 'volume-up',
  });
  assert.deepEqual(canonicalForIntent('volume-down', 'abaixa o som')?.plan, {
    action: 'volume-down',
  });
  assert.deepEqual(canonicalForIntent('media', 'pausa isso')?.plan, {
    action: 'media',
    control: 'pause',
  });
  assert.deepEqual(canonicalForIntent('media', 'pula essa')?.plan, {
    action: 'media',
    control: 'next',
  });
  // Mídia sem verbo reconhecível: sem plano (não chuta).
  assert.equal(canonicalForIntent('media', 'musica'), null);
});

test('local-call exige alvo explícito — nunca chuta nome', () => {
  const withTarget = canonicalForIntent('local-call', 'faz uma ligacao pra maria');
  assert.equal(withTarget?.canonical, 'liga para maria');
  assert.equal(withTarget?.plan.action, 'local-call');

  const noTarget = canonicalForIntent('local-call', 'quero telefonar');
  assert.equal(noTarget?.canonical, 'ligar');
  assert.deepEqual(noTarget?.plan, { action: 'local-call', contact: '', lookup: false });
});

test('segurança: mensagem de WhatsApp NUNCA é auto-executada pela rede', () => {
  assert.equal(AUTO_INTENTS.has('whatsapp-message'), false);
  assert.equal(AUTO_INTENTS.has('whatsapp-call'), false);
  assert.equal(AUTO_INTENTS.has('whatsapp-start-message'), false);
  assert.equal(canonicalForIntent('whatsapp-message', 'manda zap pro joao dizendo oi'), null);
});

test('segurança: intenção desconhecida não vira plano', () => {
  assert.equal(canonicalForIntent('pesquisa', 'pesquise sobre carros'), null);
  assert.equal(canonicalForIntent('conversa-local', 'bom dia'), null);
  assert.equal(canonicalForIntent('', 'qualquer coisa'), null);
});

test('recall end-to-end: frase informal → intenção → plano executável', () => {
  const net = applySeedOnce(createNetwork());
  // O usuário fala de um jeito que os roteadores não conhecem...
  const recalled = recallLearnedIntent(net, 'me passe o tempo da cidade de matozinhos');
  assert.ok(recalled, 'a rede lembrava a intenção');
  assert.equal(recalled.intent, 'weather');
  assert.deepEqual(recalled.plan, { action: 'weather', city: 'matozinhos', day: 'today' });
  assert.ok(recalled.confidence >= 0.62);
});

test('recall não força: sem aprendizado suficiente não devolve nada', () => {
  const net = createNetwork(); // sem seed, sem treino: rede vazia não chuta
  assert.equal(recallLearnedIntent(net, 'me passe o tempo da cidade de matozinhos'), null);
});

test('recall com aprendizado do dia a dia entende o jeito novo de falar', () => {
  const net = applySeedOnce(createNetwork());
  // O uso ensinou uma variante dita torta:
  train(net, 'tempim em matozinhos', 'weather', 1);

  const recalled = recallLearnedIntent(net, 'tempim em matozinhos');
  assert.ok(recalled);
  assert.equal(recalled.plan.action, 'weather');
  assert.equal(recalled.plan.city, 'matozinhos');
});
