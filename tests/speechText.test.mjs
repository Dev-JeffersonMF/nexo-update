import assert from 'node:assert/strict';
import test from 'node:test';

import {
  containsAnyFuzzy,
  editDistance,
  isFuzzyMatch,
  normalizeSpeech,
  repairCommand,
} from '../app/core/speechText.mjs';
import { planNativeCommand } from '../app/core/nativeCommands.mjs';
import { resolveLocalCommand } from '../app/core/intentRouter.mjs';
import { planAssistantTask } from '../app/core/assistantTasks.mjs';

/**
 * A voz na correria.
 *
 * A gente fala e digita com pressa: falta letra, falta sílaba, sobra letra.
 * O Nexus tem que entender o pedido do mesmo jeito — e, principalmente, NÃO
 * entender errado (trocar o nome de um contato pelo nome de um comando é pior
 * do que não entender).
 */

test('a distância de edição respeita o teto', () => {
  assert.equal(editDistance('musica', 'musica'), 0);
  assert.equal(editDistance('musicha', 'musica'), 1);
  assert.equal(editDistance('musi', 'musica'), 2);
  assert.ok(editDistance('musica', 'radio', 1) > 1);
});

test('a palavra falada casa com a do vocabulário', () => {
  assert.ok(isFuzzyMatch('musicha', 'musica'));
  assert.ok(isFuzzyMatch('musi', 'musica'));
  assert.ok(isFuzzyMatch('climma', 'clima'));
  assert.ok(isFuzzyMatch('whatsap', 'whatsapp'));
  assert.ok(isFuzzyMatch('radu', 'radio'));
  assert.ok(isFuzzyMatch('anotaí', 'anota'));
  // A primeira letra tem que ser a mesma: é o que segura "Amanda".
  assert.equal(isFuzzyMatch('amanda', 'manda'), false);
  // Palavra curta é exata.
  assert.equal(isFuzzyMatch('pr', 'pra'), false);
});

test('o pedido falado torto vira o comando certo', () => {
  // "musicha" (letra trocada) vira "musica".
  assert.deepEqual(planNativeCommand('toca musicha do bohemian'), {
    action: 'music',
    query: 'bohemian',
  });

  // "climma" (letra a mais) vira "clima".
  assert.deepEqual(planNativeCommand('climma em belo horizonte'), {
    action: 'weather',
    city: 'belo horizonte',
    day: 'today',
  });

  // "whatsap" (falta o p) continua sendo WhatsApp.
  const zap = planNativeCommand('manda whatsap pro amanda');
  assert.equal(zap?.action, 'whatsapp-start-message');
  assert.equal(zap?.contact, 'amanda');
});

test('o nome de um contato NUNCA vira um comando', () => {
  // "Amanda" começa com "A" e "manda" com "M": a palavra fica como está.
  // E o nome depois de "pro"/"para" nunca é corrigido.
  const plan = planNativeCommand('manda mensagem pro amanda');
  assert.equal(plan?.action, 'whatsapp-start-message');
  assert.equal(plan?.contact, 'amanda');

  // E o contato que começa igual a um comando também sobrevive.
  const other = planNativeCommand('liga maria no zap');
  assert.equal(other?.action, 'whatsapp-call');
  assert.equal(other?.contact, 'maria');
});

test('o corpo da mensagem nunca é "corrigido"', () => {
  // O "toca" do meio é da MENSAGEM, não do pedido: se fosse trocado, a
  // mensagem enviada seria outra.
  const plan = planNativeCommand('manda pro joao: toca violao');
  assert.equal(plan?.action, 'whatsapp-message');
  assert.equal(plan?.contact, 'joao');
  assert.equal(plan?.message, 'toca violao');
});

test('uma palavra que casa com duas não é trocada', () => {
  // "xyzabc" não é palavra de comando: fica como está.
  const repaired = repairCommand(normalizeSpeech('xyzabc'));
  assert.equal(repaired, 'xyzabc');
});

test('a busca na internet não mexe no que o usuário pediu', () => {
  const plan = resolveLocalCommand('pesquise a diferenca entre X e Y');
  assert.equal(plan?.kind, 'search');
  assert.equal(plan?.query, 'a diferenca entre X e Y');
});

test('o comando local continua funcionando depois da correção', () => {
  assert.equal(resolveLocalCommand('que horas sao')?.kind, 'reply');
  assert.equal(resolveLocalCommand('oi')?.kind, 'reply');
  assert.equal(resolveLocalCommand('abrir google')?.kind, 'open-link');
  // E o ditado torto também entende.
  assert.equal(resolveLocalCommand('abri o google')?.kind, 'open-link');
});

test('a anotação e o lembrete falados tortos são entendidos', () => {
  // "me lembe às 6" — faltou a letra do fim.
  const reminder = planAssistantTask('me lembe de comprar pão às 6');
  assert.equal(reminder?.action, 'reminder-create');
  assert.ok((reminder?.triggerAtMillis ?? 0) > 0);

  // "anotaí" — a letra extra no fim.
  const note = planAssistantTask('anotaí que preciso comprar leite');
  assert.equal(note?.action, 'note-save');
  assert.match(String(note?.text ?? ''), /leite/);
});

test('a detecção por palavra tolera o ditado', () => {
  assert.ok(containsAnyFuzzy('me lembe as 6', ['lembre', 'lembrete']));
  assert.ok(containsAnyFuzzy('anotaí', ['anota', 'anote']));
  assert.equal(containsAnyFuzzy('bom dia', ['lembrete', 'anota']), false);
});
test('infinitivo completo nao vira flexao maior ("chegar" nao e "chegaram")', () => {
  // A regra da silaba faltante virava "chegar" em "chegaram": a curiosidade
  // "quanto tempo a luz do sol leva para CHEGAR na Terra" era lida como
  // "o que chegou?" e abria a mensagem do WhatsApp no meio da pergunta.
  const folded = repairCommand(normalizeSpeech('quanto tempo a luz do sol leva para chegar na terra'));
  assert.doesNotMatch(folded, /chegaram/);
  // A regra continua valendo para o ditado CORTADO de verdade.
  const music = repairCommand(normalizeSpeech('toca musi do bohemian'));
  assert.match(music, /musica/);
});
