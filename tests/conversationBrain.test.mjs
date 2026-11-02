import test from 'node:test';
import assert from 'node:assert/strict';
import {
  answerByTopic,
  answerConversation,
  answerFromLearned,
  isConversational,
  learnConversationPair,
  pruneLearnedPairs,
} from '../app/core/conversationBrain.mjs';

test('piada, tédio e motivação são papo — e respondem', () => {
  const joke = answerConversation('me conta uma piada');
  assert.ok(joke);
  assert.equal(joke.topic, 'piada');
  assert.ok(joke.text.length > 10);

  const bored = answerConversation('to entediado');
  assert.equal(bored?.topic, 'tedio');

  const motivation = answerConversation('me motiva');
  assert.equal(motivation?.topic, 'motivacao');

  const support = answerConversation('to meio pra baixo hoje');
  assert.equal(support?.topic, 'apoio');

  const about = answerConversation('como voce aprende comigo');
  assert.equal(about?.topic, 'como-aprendo');
});

test('comando não é papo', () => {
  assert.equal(answerConversation('clima em matozinhos'), null);
  assert.equal(answerConversation('liga para a mae'), null);
  assert.equal(answerConversation('me lembra de comprar pao as 18'), null);
  // Frase LONGA de verdade (>90 caracteres) não é conversa curta — é
  // pergunta para o conhecimento/pesquisa.
  assert.equal(
    answerConversation(
      'me explica com calma aquela historia toda do descubrimento do brasil que eu aprendi na escola',
    ),
    null,
  );
});

test('respostas variam (o papo não pode parecer gravação)', () => {
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    seen.add(answerByTopic('piada'));
  }
  assert.ok(seen.size >= 3, `esperava variedade, veio sempre a mesma (${seen.size} únicas)`);
});

test('isConversational: só papo vira par aprendido', () => {
  assert.equal(isConversational('me conta uma piada'), true);
  assert.equal(isConversational('clima em matozinhos'), false);
});

test('pares aprendidos: a resposta da internet passa a valer offline', () => {
  const learned = [
    { q: 'me conta uma piada de portugues', a: 'Por que o portugues levou a escada? Para subir de nível.' },
  ];

  // Pergunta parecida (Jaccard de conteúdo alto) responde offline:
  const answer = answerFromLearned('conta uma piada de portugues', learned);
  assert.equal(answer, learned[0].a);

  // Pergunta diferente não pega resposta emprestada:
  assert.equal(answerFromLearned('piada de tartaruga', learned), null);
  assert.equal(answerFromLearned('me conta uma piada de joão e maria que morava na roça', learned), null);
});

test('learnConversationPair: só guarda papo com resposta curta', () => {
  const pair = learnConversationPair('me conta uma piada', 'Por que o livro tava triste? Muitos problemas.');
  assert.deepEqual(pair, { q: 'me conta uma piada', a: 'Por que o livro tava triste? Muitos problemas.' });

  // Pergunta de fato não vira par de papo:
  assert.equal(learnConversationPair('qual a capital da frança', 'Paris'), null);
  // Resposta gigante é artigo, não papo:
  assert.equal(learnConversationPair('me conta uma piada', 'x'.repeat(500)), null);
});

test('pruneLearnedPairs mantém o limite', () => {
  const pairs = Array.from({ length: 20 }, (_, i) => ({ q: `p${i}`, a: `r${i}` }));
  const kept = pruneLearnedPairs(pairs, 10);
  assert.equal(kept.length, 10);
  assert.equal(kept[0].q, 'p10'); // os mais antigos saem
});
