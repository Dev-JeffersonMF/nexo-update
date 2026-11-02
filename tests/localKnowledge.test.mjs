import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { answerFromLocalKnowledge, localKnowledgeCount } from '../app/core/localKnowledge.mjs';
import { planNativeCommand } from '../app/core/nativeCommands.mjs';

/**
 * O conhecimento de bolso.
 *
 * O Gemini é o pesquisador. Mas curiosidade e fato simples não podem depender
 * de rede: quando a internet cai (ou o serviço dá erro), é exatamente aí que o
 * usuário precisa da resposta.
 */

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(path.join(projectRoot, 'App.tsx'), 'utf8');

test('o Nexus responde as curiosidades sem internet', () => {
  assert.ok(localKnowledgeCount() >= 30, 'o base de fatos está pequena demais');

  const maior = answerFromLocalKnowledge('qual a maior cidade do mundo');
  assert.ok(maior, 'não respondeu sobre a maior cidade do mundo');
  assert.match(maior, /Tóquio/i);

  assert.match(answerFromLocalKnowledge('qual a capital do brasil') ?? '', /Brasília/i);
  assert.match(answerFromLocalKnowledge('quantos habitantes tem o brasil') ?? '', /milhões/i);
  assert.match(answerFromLocalKnowledge('quantos dias tem o ano') ?? '', /365/);
  assert.match(answerFromLocalKnowledge('qual o maior planeta') ?? '', /Júpiter/i);
  assert.match(answerFromLocalKnowledge('o que é dna') ?? '', /molécula/i);
  assert.match(answerFromLocalKnowledge('velocidade da luz') ?? '', /300 mil/);
});

test('a pergunta vem com acento, maiúscula ou sem pontuação — e ainda funciona', () => {
  const comAcento = answerFromLocalKnowledge('Qual é a capital do Brasil?');
  const semAcento = answerFromLocalKnowledge('qual e a capital do brasil');
  const maiusculo = answerFromLocalKnowledge('QUAL A CAPITAL DO BRASIL');
  assert.equal(comAcento, semAcento);
  assert.equal(maiusculo, semAcento);
});

test('um comando NÃO é pergunta de curiosidade', () => {
  // "abre o google" é comando; o conhecimento de bolso não pode responder.
  assert.equal(answerFromLocalKnowledge('abre o google'), undefined);
  assert.equal(answerFromLocalKnowledge('toca a musica'), undefined);
  assert.equal(answerFromLocalKnowledge('manda mensagem pro joao'), undefined);
});

test('o que o Nexus não sabe, ele não inventa', () => {
  assert.equal(answerFromLocalKnowledge('quem ganhou a copa de 2026'), undefined);
  assert.equal(answerFromLocalKnowledge('qual o preço do dolar hoje'), undefined);
  assert.equal(answerFromLocalKnowledge('quem é o presidente agora'), undefined);
});

test('o conhecimento de bolso vem ANTES da pesquisa na internet', () => {
  const knowledge = app.indexOf('answerFromLocalKnowledge(text)');
  const search = app.indexOf('nexusNative.searchWeb(');
  assert.ok(knowledge > 0, 'o conhecimento de bolso não está no App');
  assert.ok(search > 0, 'a pesquisa do Nexus não está no App');
  assert.ok(knowledge < search, 'o conhecimento de bolso tem que vir antes da pesquisa');
  // E o Gemini não existe mais: a conversa não é enviada para modelo nenhum.
  assert.doesNotMatch(app, /askAssistant|geminiApiKey|requestGeminiAnswer/);
});

test('o clima é reconhecido em mais jeitos — mas "tempo" sozinho não', () => {
  assert.deepEqual(planNativeCommand('como esta o tempo em belo horizonte'), {
    action: 'weather',
    city: 'belo horizonte',
    day: 'today',
  });
  assert.deepEqual(planNativeCommand('clima em bh'), {
    action: 'weather',
    city: 'bh',
    day: 'today',
  });
  assert.deepEqual(planNativeCommand('vai chover hoje'), {
    action: 'weather',
    city: '',
    day: 'today',
  });

  // "quanto tempo a luz do sol leva" é uma CURIOSIDADE, não o clima.
  assert.notEqual(planNativeCommand('quanto tempo a luz do sol leva para chegar na terra')?.action, 'weather');
});

test('fatos corrigidos: nada de resposta trocada ou texto quebrado', () => {
  const estado = answerFromLocalKnowledge('qual o maior estado do brasil') ?? '';
  assert.match(estado, /Amazonas/);
  assert.match(estado, /1,56 milh/);
  assert.doesNotMatch(estado, /alinewidth|15,6 milh/);

  const mar = answerFromLocalKnowledge('por que o mar e azul') ?? '';
  assert.match(mar, /azul/);
  assert.doesNotMatch(mar, /salgado/);

  const capital = answerFromLocalKnowledge('qual a capital de minas') ?? '';
  assert.match(capital, /1897/);
  assert.doesNotMatch(capital, /1923/);

  const pao = answerFromLocalKnowledge('o que e pao de queijo') ?? '';
  assert.match(pao, /polvilho/);

  const abelhas = answerFromLocalKnowledge('por que as abelhas dancam') ?? '';
  assert.match(abelhas, /ângulo/);
  assert.match(abelhas, /distância/);

  const lua = answerFromLocalKnowledge('o que e a lua') ?? '';
  assert.doesNotMatch(lua, /365 dias/);
});

test('ano bissexto e calculado na hora (nao envelhece)', () => {
  const texto = answerFromLocalKnowledge('o que e ano bissexto') ?? '';
  assert.match(texto, /366/);
  assert.match(texto, /20\d\d/);
});
