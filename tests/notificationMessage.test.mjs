import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_QUOTED_LENGTH,
  describeNotification,
  summarizeNotification,
} from '../app/core/notificationMessage.mjs';

test('describeNotification conta quem mandou e o que disse', () => {
  const phrase = describeNotification({
    app: 'WhatsApp',
    contact: 'Maria',
    message: 'Bom dia, tudo bem?',
  });

  assert.equal(
    phrase,
    'Mensagem de Maria no WhatsApp: "Bom dia, tudo bem?". Diga "abrir a mensagem" para ler.',
  );
});

test('describeNotification funciona com apenas contato ou apenas mensagem', () => {
  assert.match(describeNotification({ contact: 'João' }), /mensagem de João no WhatsApp/);
  assert.match(describeNotification({ message: 'Oi' }), /Chegou uma mensagem no WhatsApp/);
  assert.equal(describeNotification({}), '');
  assert.equal(describeNotification(), '');
});

test('describeNotification limita mensagens gigantes e normaliza espaços', () => {
  const long = 'a'.repeat(MAX_QUOTED_LENGTH + 50);
  const phrase = describeNotification({ contact: 'Ana', message: `  ${long}  ` });

  assert.ok(phrase.length < long.length + 80, 'a fala deveria encurtar a mensagem');
  assert.ok(phrase.includes('…'), 'mensagem longa precisa terminar em reticências');

  assert.match(
    describeNotification({ contact: 'Ana', message: 'linha 1\nlinha  2' }),
    /linha 1 linha 2/,
  );
});

test('summarizeNotification gera o aviso curto da tela', () => {
  assert.equal(
    summarizeNotification({ app: 'WhatsApp', contact: 'Maria', message: 'Oi' }),
    '💬 WhatsApp — Maria: Oi',
  );
  assert.equal(
    summarizeNotification({ app: 'WhatsApp', contact: 'Maria' }),
    '💬 WhatsApp — nova mensagem de Maria',
  );
  assert.equal(summarizeNotification({}), '');
});
