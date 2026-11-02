import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { MASCOT_PHRASES, pickMascotPhrase } from '../app/core/mascotPhrases.mjs';

/**
 * O mascote dentro da tela do Nexus.
 *
 * A coruja é parte da conversa: ela fica DENTRO do balão (não solta na
 * margem), diz o que está fazendo e tem falas variadas — uma coruja que repete
 * a mesma frase o dia inteiro parece um rótulo, não uma companhia.
 */

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(path.join(projectRoot, 'App.tsx'), 'utf8').replace(/\r\n/g, '\n');
const mascot = readFileSync(path.join(projectRoot, 'app', 'ui', 'Mascot.tsx'), 'utf8').replace(/\r\n/g, '\n');

test('o mascote fica DENTRO do balão, não do lado', () => {
  // O balão abre ANTES do mascote: o mascote é filho do balão.
  const bubbleAt = app.indexOf('styles.bubble,\n          { width: bubbleWidth },');
  const mascotAt = app.indexOf('<Mascot');
  assert.ok(bubbleAt > 0, 'balão não encontrado');
  assert.ok(mascotAt > bubbleAt, 'o mascote tem que vir depois do balão');

  // E o balão do "pensando" também tem o mascote dentro dele.
  const thinking = app.slice(app.indexOf('{busy && ('));
  assert.match(thinking, /styles\.assistantBubble/);
  assert.ok(
    thinking.indexOf('<Mascot') < thinking.indexOf('<TypingDots'),
    'no balão do "pensando" o mascote vem antes dos pontinhos',
  );

  // O avatar solto na margem não existe mais.
  assert.doesNotMatch(app, /style=\{styles\.avatar\}/);
});

test('a coruja não gira: o app é retrato e o mascote só flutua', () => {
  // `rotate` no React Native exige string com unidade ("2deg"); um número
  // solto derrubava o render com "Transform with key of rotate must be a
  // string". Como o app é retrato e não há rotação desejada, o transform de
  // rotação saiu de vez.
  assert.doesNotMatch(mascot, /rotate:/);
  assert.doesNotMatch(mascot, /transform:[^\n]*rotate/);
  assert.doesNotMatch(mascot, /180/);
  assert.doesNotMatch(mascot, /scaleY:\s*-1/);

  // O movimento continua: flutuação e respiração, sem giro.
  assert.match(mascot, /transform: \[\{ translateY: float \}, \{ scale: bob \}\]/);
});

test('o mascote tem falas para cada estado', () => {
  for (const mood of ['idle', 'listening', 'thinking', 'speaking', 'greeting']) {
    assert.ok(MASCOT_PHRASES[mood]?.length >= 3, `faltam falas para "${mood}"`);
  }

  // A frase escolhida nunca é a mesma da vez anterior.
  const first = pickMascotPhrase('thinking', 'Deixa eu pensar...');
  assert.notEqual(first, 'Deixa eu pensar...');
  assert.ok(MASCOT_PHRASES.thinking.includes(first));

  // E a primeira fala do dia varia também.
  const greeting = pickMascotPhrase('greeting');
  assert.ok(MASCOT_PHRASES.greeting.includes(greeting));
});

test('a tela usa as falas do mascote', () => {
  assert.match(app, /pickMascotPhrase/);
  assert.match(app, /const mascotStatus = mascotPhrase/);
  assert.match(app, /mascotMood/);
});

test('o texto do balão tem largura em NÚMERO, não em porcentagem', () => {
  // No Android, `width: '100%'` no Text é resolvido com um arredondamento
  // diferente do desenho: a última linha da frase era desenhada e CORTADA
  // (a resposta do Nexus aparecia pela metade). Com a largura em número, a
  // medição e o desenho usam a mesma conta e a frase quebra sozinha, sem
  // perder nada.
  const style = app.slice(app.indexOf('messageText: {'));
  const block = style.slice(0, style.indexOf('},'));
  // Sem os comentários (que explicam o problema) para sobrar só o estilo.
  const code = block.replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(code, /width:/, 'o estilo do texto não pode ter largura');

  assert.match(app, /styles\.messageText,\s*\n?\s*\{ width: textWidth \}/);

  /*
   * A ALTURA da última linha medida: o Android às vezes mede 2 linhas e
   * desenha 3 — a última sumia (o "falta palavra" que o usuário viu). O
   * `onTextLayout` entrega a posição real da última linha e o `minHeight`
   * passa a cobrir TODAS as linhas desenhadas.
   */
  assert.match(app, /onTextLayout=\{\(event\) =>/);
  assert.match(app, /const needed = Math\.ceil\(last\.y \+ last\.height \+ 4\)/);
  assert.match(app, /textMinHeight > 0 && \{ minHeight: textMinHeight \}/);
  assert.match(app, /includeFontPadding: false/);

  // E a largura do texto é a do balão menos o padding E as duas bordas de
  // 1px — sem isso o texto medido era mais largo que o conteúdo do balão.
  assert.match(app, /const textWidth = useMemo\([\s\S]{0,180}bubbleWidth - spacing\.lg \* 2 - 2/);
});
