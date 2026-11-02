import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CORRECTION_MIN_OVERLAP,
  MIN_CONFIDENCE,
  contentOverlap,
  createNetwork,
  deserialize,
  learnFromCorrection,
  predict,
  registerNegative,
  serialize,
  train,
} from '../app/core/neuralLearner.mjs';
import { applySeedOnce } from '../app/core/neuralSeed.mjs';

test('cria rede e prediz null sem intents', () => {
  const net = createNetwork();
  const r = predict(net, 'ola');
  assert.equal(r.intent, null);
});

test('TEMPO é CLIMA: a ligação de palavras que o usuário pediu', () => {
  const net = createNetwork();
  // O dia a dia ensina os dois JEITOS de pedir a mesma coisa:
  train(net, 'me informe o tempo da cidade de matozinhos', 'weather', 1);
  train(net, 'me informe o clima da cidade de matozinhos', 'weather', 1);

  // As duas frases agora puxam para o clima...
  const r1 = predict(net, 'me informe o tempo da cidade de matozinhos');
  const r2 = predict(net, 'me informe o clima da cidade de matozinhos');
  assert.equal(r1.intent, 'weather');
  assert.equal(r2.intent, 'weather');

  // ...e uma variante NUNCA FALADA também entende, porque as PALAVRAS
  // "tempo" e "matozinhos" já estão ligadas à intenção.
  const r3 = predict(net, 'o tempo la em matozinhos hoje');
  assert.equal(r3.intent, 'weather');
  assert.ok(r3.confidence >= MIN_CONFIDENCE);
});

test('aprendizado por correção liga a frase que falhou à que deu certo', () => {
  const net = createNetwork();
  // A frase 1 não foi entendida; o usuário repetiu de outro jeito (frase 2)
  // e deu certo. As duas falam do MESMO pedido:
  const failed = 'me passa o tempo la em matozinhos';
  const resolved = 'me passe o clima em matozinhos';

  // Ninguém aprende nada quando os assuntos são diferentes:
  assert.equal(learnFromCorrection(net, 'toca uma musica', resolved, 'weather'), false);

  assert.equal(learnFromCorrection(net, failed, resolved, 'weather'), true);
  const r = predict(net, failed);
  assert.equal(r.intent, 'weather');
  assert.ok(r.confidence >= MIN_CONFIDENCE);
});

test('correção exige sobreposição de conteúdo (não aprende erro)', () => {
  const net = createNetwork();
  // "manda zap pro joao" não tem NADA a ver com clima: a trava impede a
  // rede de ligar assuntos diferentes só porque vieram em sequência.
  assert.equal(
    learnFromCorrection(net, 'manda zap pro joao', 'clima em matozinhos', 'weather'),
    false,
  );
  const r = predict(net, 'manda zap pro joao');
  assert.notEqual(r.intent, 'weather');
});

test('feedback negativo desaprende a ligação', () => {
  const net = createNetwork();
  const phrase = 'tempo da cidade de matozinhos';
  train(net, phrase, 'weather', 6);
  let r = predict(net, phrase);
  assert.equal(r.intent, 'weather');

  registerNegative(net, phrase);
  r = predict(net, phrase);
  // A intenção fantasma "resposta_errada" passa à frente: o Nexus não
  // auto-executa mais essa frase (ela não está na lista segura).
  assert.equal(r.intent, 'resposta_errada');
});

test('serializacao roundtrip preserva aprendizado e seed', () => {
  const net = applySeedOnce(createNetwork());
  train(net, 'me informe o tempo da cidade de matozinhos', 'weather', 1);
  const state = JSON.parse(serialize(net));

  const restored = deserialize(serialize(net));
  assert.equal(restored.intents.length, net.intents.length);
  assert.equal(restored.seeded, true);
  assert.ok(restored.wordStats.tempo, 'a ligação de palavras sobreviveu');

  const r = predict(restored, 'tempo da cidade de matozinhos');
  assert.equal(r.intent, 'weather');
  assert.ok(r.confidence >= MIN_CONFIDENCE);

  // Seed NÃO é reaplicado num estado que já foi salvo com ele.
  const before = restored.interactions;
  applySeedOnce(restored);
  assert.equal(restored.interactions, before);
});

test('a base inicial já nasce sabendo que tempo é clima', () => {
  const net = applySeedOnce(createNetwork());
  const r = predict(net, 'me informe o tempo da cidade de matozinhos');
  assert.equal(r.intent, 'weather');
  assert.ok(r.confidence >= MIN_CONFIDENCE);

  const informal = predict(net, 'me fala o tempo de matozinhos');
  assert.equal(informal.intent, 'weather');
});

test('sobreposição de conteúdo: Jaccard sobre palavras de conteúdo', () => {
  assert.ok(contentOverlap('tempo da cidade de matozinhos', 'clima da cidade de matozinhos') >= CORRECTION_MIN_OVERLAP);
  assert.ok(contentOverlap('toca musica do zeze', 'clima em matozinhos') < CORRECTION_MIN_OVERLAP);
});
