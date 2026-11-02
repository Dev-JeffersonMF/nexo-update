import assert from 'node:assert/strict';
import test from 'node:test';

import { estimateBubbleWidthDp, estimateTextWidthDp } from '../app/core/textMetrics.mjs';

test('texto vazio não tem largura', () => {
  assert.equal(estimateTextWidthDp('', 15), 0);
  assert.equal(estimateTextWidthDp(undefined, 15), 0);
});

test('largura cresce com o tamanho da fonte', () => {
  const small = estimateTextWidthDp('Bom dia, Jefferson!', 13);
  const big = estimateTextWidthDp('Bom dia, Jefferson!', 26);
  assert.ok(big > small, 'a fonte maior precisa medir mais largo');
  assert.ok(Math.abs(big / small - 2) < 0.01, 'dobrar a fonte dobra a largura');
});

test('caractere largo ocupa mais que caractere estreito', () => {
  const largo = estimateTextWidthDp('MMMM', 15);
  const estreito = estimateTextWidthDp('iiii', 15);
  assert.ok(largo > estreito);
  assert.ok(estreito > 0);
});

test('balão tem largura definida e respeita o máximo', () => {
  const largura = estimateBubbleWidthDp('que horas sao', {
    fontSizeDp: 15,
    maxWidthDp: 256,
    paddingDp: 32,
  });

  // Tem que ser DEFINIDA (nunca automática) e caber o texto inteiro.
  assert.ok(Number.isFinite(largura));
  assert.ok(largura > 0);
  assert.ok(largura <= 256, 'não passa do máximo');
  assert.ok(
    largura - 32 >= estimateTextWidthDp('que horas sao', 15),
    'o texto cabe no balão sem quebrar a linha',
  );
});

test('frase muito longa para no máximo', () => {
  const longa = 'a'.repeat(400);
  const largura = estimateBubbleWidthDp(longa, {
    fontSizeDp: 15,
    maxWidthDp: 256,
    paddingDp: 32,
  });
  assert.equal(largura, 256);
});

test('o balão deixa folga: a última linha não fica na borda', () => {
  // Com a folga no limite, o Android corta a última linha (a palavra "mundo"
  // sumia do balão). A folga tem que ser real, e não só a margem da
  // estimativa.
  const texto = 'qual o maior cidade do mundo';
  const largura = estimateBubbleWidthDp(texto, {
    fontSizeDp: 15,
    maxWidthDp: 400,
    paddingDp: 32,
  });
  const folga = largura - 32 - estimateTextWidthDp(texto, 15);
  assert.ok(folga >= 8, `folga de ${folga}dp é curta demais`);
  assert.ok(folga >= largura * 0.1, `folga de ${folga}dp é curta demais para a margem`);
});

test('texto curtinho não deixa o balão estreito demais', () => {
  const largura = estimateBubbleWidthDp('oi', {
    fontSizeDp: 15,
    maxWidthDp: 256,
    paddingDp: 32,
  });
  assert.ok(largura >= 64, 'o balão tem um mínimo de largura');
});
