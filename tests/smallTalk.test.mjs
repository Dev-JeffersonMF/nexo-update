import assert from 'node:assert/strict';
import test from 'node:test';

import { answerSmallTalk, MAX_SOCIAL_LENGTH, smallTalkCount } from '../app/core/smallTalk.mjs';

/** Data fixa: a variante do dia é determinística, então o teste não oscila. */
const DAY = new Date(2026, 9, 21, 9, 0);

test('conversa social: "como você está" responde e devolve a pergunta', () => {
  const answer = answerSmallTalk('Como você está?', DAY);

  assert.ok(answer);
  assert.match(answer, /E você|Como posso|tudo bem/i);
  // O mesmo dia devolve a mesma variante.
  assert.equal(answerSmallTalk('como você está?', DAY), answer);
  // "olá tudo bem" também é conversa: antes caía na pesquisa da internet.
  const greeting = answerSmallTalk('olá tudo bem', DAY);
  assert.ok(greeting, '"olá tudo bem" não é conversa');
  assert.match(greeting, /E você|Como posso|tudo bem/i);
});

test('conversa social: "dormiu bem?" não vira pesquisa', () => {
  const answer = answerSmallTalk('Nexo, dormiu bem?', DAY);

  assert.ok(answer);
  assert.match(answer, /acordado|ligado/i);
});

test('conversa social: agradecimento e bom dia juntos', () => {
  const answer = answerSmallTalk('Obrigado, tenha um excelente dia', DAY);

  assert.ok(answer);
  assert.match(answer, /De nada|Por nada/);
  assert.match(answer, /dia/i);
});

test('conversa social: agradecimento sozinho e despedida', () => {
  assert.match(answerSmallTalk('obrigado', DAY) ?? '', /De nada|Por nada|Disponha/);
  assert.match(answerSmallTalk('valeu!', DAY) ?? '', /De nada|Por nada|Disponha/);
  assert.match(answerSmallTalk('tchau', DAY) ?? '', /Até logo|Até mais/);
});

test('conversa social: elogio e apresentação', () => {
  assert.ok(answerSmallTalk('você é muito legal', DAY));
  assert.match(answerSmallTalk('qual é o seu nome?', DAY) ?? '', /Nexus/);
});

test('pergunta de verdade NÃO é tratada como conversa', () => {
  assert.equal(answerSmallTalk('qual é a capital da França?', DAY), undefined);
  assert.equal(answerSmallTalk('obrigado, qual é a capital da França?', DAY), undefined);
  assert.equal(answerSmallTalk('como faço um bolo de cenoura?', DAY), undefined);
  assert.equal(answerSmallTalk('dormiu bem e me explica a fotossíntese', DAY), undefined);
});

test('texto longo não é conversa curta', () => {
  const long = 'obrigado '.repeat(MAX_SOCIAL_LENGTH);
  assert.ok(long.length > MAX_SOCIAL_LENGTH);
  assert.equal(answerSmallTalk(long, DAY), undefined);
  assert.equal(answerSmallTalk('', DAY), undefined);
  assert.equal(answerSmallTalk('   ', DAY), undefined);
});

test('o dicionário social tem intenções cadastradas', () => {
  assert.ok(smallTalkCount() >= 8);
});
