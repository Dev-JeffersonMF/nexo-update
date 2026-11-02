import assert from 'node:assert/strict';
import test from 'node:test';

import {
  answerLottery,
  formatLotteryGames,
  formatMegaSenaResult,
  normalizeMegaSenaResult,
  parseLotteryRequest,
  pickNumbers,
} from '../app/core/lottery.mjs';

/**
 * O pedido de números da Mega-Sena.
 *
 * Antes esta frase não casava com nenhum intent e caía na pesquisa da internet,
 * que respondia um assunto completamente diferente (Brasil x Alemanha de 2014).
 * A resposta agora é local, aleatória e honesta: não existe "número certo".
 *
 * O resultado do sorteio é outro caminho: vem da Caixa, é normalizado aqui e
 * nunca vira jogo aleatório por engano.
 */

/** Gerador determinístico para os testes (LCG simples). */
function seeded(seed = 1) {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
}

/** Extrai as dezenas de cada "Jogo N, dezenas:" da resposta falada. */
function gamesFrom(answer) {
  return [...answer.matchAll(/Jogo \d+, dezenas: ([\d,\s]+)/g)].map(([, list]) =>
    list.split(',').map((part) => Number(part.trim())),
  );
}

const caixa = {
  numero: 3072,
  dataApuracao: '20/10/2026',
  listaDezenas: ['02', '06', '09', '16', '31', '40'],
  acumulado: true,
  listaRateioPremio: [
    { faixa: 1, numeroDeGanhadores: 0, valorPremio: 0 },
    { faixa: 2, numeroDeGanhadores: 140, valorPremio: 38295.72 },
  ],
  dataProximoConcurso: '22/10/2026',
  valorEstimadoProximoConcurso: 200_000_000,
};

test('pedido de números da Mega-Sena responde com seis dezenas válidas', () => {
  const answer = answerLottery(
    'no momento eu só queria o número certo para jogar na mega-sena, você teria alguns números para mim?',
    () => 0.42,
  );

  assert.ok(answer, 'a frase real do usuário precisa ser reconhecida');
  assert.match(answer, /Mega-Sena/);
  assert.match(answer, /aleatórias/);
  assert.match(answer, /sem garantia/);

  const numbers = (answer.match(/\b\d{2}\b/g) ?? []).map(Number);
  assert.equal(numbers.length, 6);
  assert.equal(new Set(numbers).size, 6, 'as dezenas não podem repetir');
  for (const number of numbers) {
    assert.ok(number >= 1 && number <= 60, `dezena fora da faixa: ${number}`);
  }
});

test('as dezenas saem em ordem crescente e sem repetição', () => {
  const picks = pickNumbers(6, 60, () => 0.7);
  assert.equal(picks.length, 6);
  assert.deepEqual([...picks].sort((a, b) => a - b), picks);
  assert.equal(new Set(picks).size, 6);
});

test('quantos jogos o usuário pedir, todos têm seis dezenas de 1 a 60', () => {
  const answer = answerLottery('me dá 3 jogos aleatórios da mega-sena', seeded(7));
  assert.ok(answer);

  const games = gamesFrom(answer);
  assert.equal(games.length, 3, 'precisa falar os três jogos');
  assert.match(answer, /3 jogos aleatórios/);

  for (const game of games) {
    assert.equal(game.length, 6, 'cada jogo tem exatamente seis dezenas');
    assert.equal(new Set(game).size, 6, 'não pode repetir dezena no mesmo jogo');
    for (const number of game) {
      assert.ok(number >= 1 && number <= 60, `dezena fora da faixa: ${number}`);
    }
  }

  // Jogos diferentes entre si (o gerador avança entre um e outro).
  const signatures = games.map((game) => game.join(','));
  assert.equal(new Set(signatures).size, 3);
});

test('quantidade por extenso também vale', () => {
  const answer = answerLottery('quero dois jogos para jogar na mega-sena', seeded(3));
  assert.ok(answer);
  assert.equal(gamesFrom(answer).length, 2);
});

test('a numeração dos jogos não vira hora na fala', () => {
  // "Jogo 2: 09..." era lido como "jogo duas da manhã" (2:09 é hora). A
  // separação precisa ser vírgula + "dezenas:", nunca dígito dois-pontos dígito.
  const answer = answerLottery('me dá 2 jogos da mega-sena', seeded(11));
  assert.ok(answer);
  assert.match(answer, /Jogo 2, dezenas: \d{2}/);
  // O padrão que vira hora aceita espaço: "2: 09" também é lido como 2h09.
  assert.doesNotMatch(answer, /\d\s*:\s*\d/);
});

test('sem quantidade explícita, sai um jogo', () => {
  const request = parseLotteryRequest('me dá umas dezenas da mega-sena');
  assert.deepEqual(request, { wantsResult: false, wantsGames: true, count: 1 });
});

test('pedido acima do limite é aparado em 20 jogos', () => {
  const request = parseLotteryRequest('me dá 99 jogos da mega-sena');
  assert.equal(request.count, 20);
  assert.equal(gamesFrom(formatLotteryGames(request.count, seeded(9))).length, 20);
});

test('resultado e jogo no mesmo pedido são reconhecidos separadamente', () => {
  assert.deepEqual(parseLotteryRequest('qual foi o último resultado da mega-sena?'), {
    wantsResult: true,
    wantsGames: false,
    count: 0,
  });

  assert.deepEqual(parseLotteryRequest('último resultado da mega-sena e dois jogos'), {
    wantsResult: true,
    wantsGames: true,
    count: 2,
  });

  // "Quais foram os números" é resultado, não pedido de jogo.
  assert.deepEqual(parseLotteryRequest('quais foram os números sorteados da mega-sena?'), {
    wantsResult: true,
    wantsGames: false,
    count: 0,
  });
});

test('pergunta sobre o resultado do sorteio NÃO vira jogo aleatório', () => {
  // Resultado é dado atual: o app consulta a Caixa, não sorteia dezenas.
  assert.equal(answerLottery('qual foi o resultado da mega-sena ontem?'), null);
  assert.equal(answerLottery('a mega-sena acumulou para o próximo concurso?'), null);
});

test('texto sem relação com a loteria não é sequestrado', () => {
  assert.equal(answerLottery('qual a capital da França?'), null);
  assert.equal(answerLottery('quero jogar futebol amanhã'), null);
  assert.equal(answerLottery('me dá um número de telefone da UPA'), null);
});

test('o JSON da Caixa é normalizado com desconfiança', () => {
  assert.deepEqual(normalizeMegaSenaResult(caixa), {
    contest: 3072,
    date: '20/10/2026',
    numbers: [2, 6, 9, 16, 31, 40],
    accumulated: true,
    sixWinners: 0,
    nextDate: '22/10/2026',
    estimatedPrize: 200_000_000,
  });

  // Sem seis dezenas válidas não existe resultado.
  assert.equal(
    normalizeMegaSenaResult({ ...caixa, listaDezenas: ['02', '02', '09', '16', '31', '40'] }),
    null,
  );
  assert.equal(normalizeMegaSenaResult({ ...caixa, listaDezenas: ['02', '06'] }), null);
  assert.equal(normalizeMegaSenaResult({ ...caixa, numero: null }), null);
  assert.equal(normalizeMegaSenaResult(null), null);
});

test('o último resultado é falado com concurso, dezenas, acúmulo e próxima data', () => {
  const spoken = formatMegaSenaResult(normalizeMegaSenaResult(caixa));

  assert.match(spoken, /concurso 3072/);
  assert.match(spoken, /20\/10\/2026/);
  assert.match(spoken, /02, 06, 09, 16, 31, 40/);
  assert.match(spoken, /Ninguém acertou as seis dezenas/);
  assert.match(spoken, /prêmio acumulou/);
  assert.match(spoken, /22\/10\/2026/);
  assert.match(spoken, /R\$ 200\.000\.000,00/);

  const winners = formatMegaSenaResult({
    ...normalizeMegaSenaResult(caixa),
    accumulated: false,
    sixWinners: 2,
  });
  assert.match(winners, /2 apostas acertaram as seis dezenas/);
  assert.doesNotMatch(winners, /acumulou/);
});

test('resultado inválido não vira fala', () => {
  assert.equal(formatMegaSenaResult(null), '');
  assert.equal(formatMegaSenaResult({ numbers: [1, 2] }), '');
});
