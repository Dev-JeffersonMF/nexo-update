import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveLocalCommand } from '../app/core/intentRouter.mjs';

test('resolves greetings and help locally', () => {
  const manha = new Date(2025, 0, 2, 9, 7);
  assert.equal(
    resolveLocalCommand(' Oi! ', manha)?.text,
    'Bom dia! Estou aqui. O que você precisa?',
  );
  // Com o nome do usuário (onboarding) a saudação sai pessoal e pela hora.
  assert.equal(
    resolveLocalCommand('boa tarde', new Date(2025, 0, 2, 15, 0), { name: 'Jefferson' })
      ?.text,
    'Boa tarde, Jefferson! Estou aqui. O que você precisa?',
  );
  assert.equal(
    resolveLocalCommand('oi', new Date(2025, 0, 2, 22, 0), { name: 'Jefferson' })?.text,
    'Boa noite, Jefferson! Estou aqui. O que você precisa?',
  );
  assert.match(resolveLocalCommand('que comandos você entende?')?.text, /Google, YouTube/);
});

test('uses the supplied clock for local date and time answers', () => {
  const now = new Date(2025, 0, 2, 9, 7);
  assert.equal(resolveLocalCommand('que horas são?', now)?.text, 'Agora são 09:07.');
  assert.match(resolveLocalCommand('qual é a data de hoje?', now)?.text, /quinta-feira/);
});

test('a hora é respondida do jeito que a pessoa pergunta', () => {
  const now = new Date(2025, 0, 2, 22, 10);
  // As formas que a pessoa fala — e que antes caíam na pesquisa da internet.
  for (const frase of [
    'que horas são agora',
    'que horas é agora',
    'me informa as horas',
    'me informe as horas',
    'qual é a hora agora',
    'as horas',
  ]) {
    assert.equal(resolveLocalCommand(frase, now)?.text, 'Agora são 22:10.', frase);
  }
});

test('a saudação aceita o "tudo bem" junto', () => {
  const now = new Date(2025, 0, 2, 9, 7);
  assert.equal(
    resolveLocalCommand('olá tudo bem', now, { name: 'Jefferson' })?.text,
    'Bom dia, Jefferson! Estou aqui. O que você precisa?',
  );
  assert.equal(
    resolveLocalCommand('oi tudo bom', now, { name: 'Jefferson' })?.text,
    'Bom dia, Jefferson! Estou aqui. O que você precisa?',
  );
});

test('calculates expressions without evaluating arbitrary code', () => {
  assert.equal(resolveLocalCommand('quanto é 2 + 3 * 4')?.text, '2 + 3 * 4 = 14.');
  assert.equal(resolveLocalCommand('calcule (8 - 2) / 3')?.text, '(8 - 2) / 3 = 2.');
  assert.match(resolveLocalCommand('calcule 5 / 0')?.text, /Não consegui calcular/);
  assert.match(resolveLocalCommand('calcule process.exit()')?.text, /Não consegui calcular/);
});

test('opens only explicitly supported sites and percent-encodes searches', () => {
  assert.equal(
    resolveLocalCommand('abra YouTube')?.url,
    'https://www.youtube.com/',
  );
  assert.equal(
    resolveLocalCommand('pesquise na internet café e pão')?.query,
    'café e pão',
  );
  assert.equal(resolveLocalCommand('abra um aplicativo desconhecido'), undefined);
});

test('pedido de ligação não vira pesquisa na web', () => {
  // "pesquise o número da UPA de Matozinhos e ligue" é LIGAÇÃO: se a busca da
  // internet pegasse a frase, o Nexus abriria o Google e nunca discaria.
  assert.equal(
    resolveLocalCommand('pesquise o número da UPA de Matozinhos e ligue'),
    undefined,
  );
  assert.equal(resolveLocalCommand('procura o telefone da farmácia e liga'), undefined);
  assert.equal(resolveLocalCommand('pesquisa o número do táxi e me chama'), undefined);

  // Pesquisa sem pedido de ligação continua sendo uma pesquisa INTERNA, que o
  // Nexus responde na conversa sem abrir o navegador.
  assert.equal(
    resolveLocalCommand('pesquise o número da UPA de Matozinhos')?.kind,
    'search',
  );
});
