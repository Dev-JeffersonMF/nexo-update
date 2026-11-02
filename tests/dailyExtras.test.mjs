import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dayIndex,
  parseRssTitles,
  pickDailyPhrase,
  planDailyExtra,
  summarizeHeadlines,
} from '../app/core/dailyExtras.mjs';

test('a frase do dia é a mesma durante todo o dia e muda de um dia para o outro', () => {
  const hoje = dayIndex(new Date(2025, 4, 10, 8, 0));
  const maisTarde = dayIndex(new Date(2025, 4, 10, 23, 30));

  assert.equal(hoje, maisTarde, 'o dia não pode virar à noite de hoje');
  assert.equal(pickDailyPhrase(hoje), pickDailyPhrase(maisTarde));

  // A lista é fixa: sempre alguma frase, nunca vazia e nunca inventada.
  for (const dia of [0, 1, 7, 100, 730, -3]) {
    assert.ok(pickDailyPhrase(dia).length > 10);
  }
});

test('"frase para animar" e "fofoca do dia" são pedidos reconhecidos', () => {
  assert.deepEqual(planDailyExtra('me dá uma frase para animar meu dia'), {
    action: 'phrase',
  });
  assert.deepEqual(planDailyExtra('frase do dia'), { action: 'phrase' });
  assert.deepEqual(planDailyExtra('me inspira aí'), { action: 'phrase' });

  assert.deepEqual(planDailyExtra('fofoca do dia'), { action: 'news', topic: 'gossip' });
  assert.deepEqual(planDailyExtra('novidades dos famosos'), {
    action: 'news',
    topic: 'gossip',
  });
  assert.deepEqual(planDailyExtra('quais as notícias de hoje'), {
    action: 'news',
    topic: 'general',
  });
});

test('conversa comum e comandos não viram frase nem notícia', () => {
  for (const frase of [
    'bom dia',
    'liga para o João',
    'me lembra de comprar pão',
    'toca uma música',
    'que horas são',
    'me manda uma mensagem para a Maria',
  ]) {
    assert.equal(planDailyExtra(frase), undefined, `não devia reconhecer: ${frase}`);
  }
});

test('as manchetes faladas são os títulos reais, na ordem do feed', () => {
  const texto = summarizeHeadlines(['Primeira notícia', 'Segunda notícia'], {
    topic: 'general',
  });
  assert.match(texto, /As manchetes de agora/);
  assert.match(texto, /1\. Primeira notícia\./);
  assert.match(texto, /2\. Segunda notícia\./);
  // Nada inventado: nenhum título aparece se não veio do feed.
  assert.doesNotMatch(texto, /3\./);
});

test('sem feed, o Nexus diz que não conseguiu (nunca inventa notícia)', () => {
  const vazio = summarizeHeadlines([], { topic: 'general' });
  assert.match(vazio, /Não consegui buscar as notícias/);

  const fofoca = summarizeHeadlines([], { topic: 'gossip' });
  assert.match(fofoca, /Não consegui buscar as fofocas/);

  // Lista suja (vazios, nulos, espaços) não vira título na fala.
  assert.match(
    summarizeHeadlines(['', '   ', null, undefined], { topic: 'gossip' }),
    /Não consegui/,
  );
});

test('o feed é lido por item, com CDATA e entidades resolvidos', () => {
  const xml = `<?xml version="1.0"?>
    <rss><channel>
      <item><title><![CDATA[Chuva &amp; frio em Minas]]></title><link>x</link></item>
      <item><title>Economia: d&#243;lar sobe 1%</title></item>
      <item><title>   </title></item>
      <item><title>&lt;Ao vivo&gt; jogo de hoje</title></item>
    </channel></rss>`;

  assert.deepEqual(parseRssTitles(xml), [
    'Chuva & frio em Minas',
    'Economia: dólar sobe 1%',
    '<Ao vivo> jogo de hoje',
  ]);

  // O limite corta pelo começo do feed (as mais recentes vêm primeiro).
  assert.deepEqual(parseRssTitles(xml, 1), ['Chuva & frio em Minas']);
  // Feed cortado no meio de um item não vira título pela metade.
  assert.deepEqual(parseRssTitles('<rss><channel><item><title>Sem fim'), []);
  assert.deepEqual(parseRssTitles(''), []);
  assert.deepEqual(parseRssTitles(undefined), []);
});
