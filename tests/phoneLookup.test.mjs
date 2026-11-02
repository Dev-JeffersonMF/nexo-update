import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPhoneSearchQuery,
  extractPhones,
  formatPhoneBR,
  hostOf,
  isPlaceQuery,
  looksLikePhoneNumber,
  parseDuckDuckGoResults,
  pickPhoneCandidate,
  stripTags,
} from '../app/core/phoneLookup.mjs';
import { planNativeCommand } from '../app/core/nativeCommands.mjs';

/** HTML reduzido, na mesma forma do endpoint html.duckduckgo.com. */
const DDG_HTML = `
<div class="result results_links web-result">
  <h2 class="result__title">
    <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=x">UPA 24 Horas Matozinhos - Centro, Matozinhos - MG</a>
  </h2>
  <a class="result__snippet" href="x">Telefone: (31) 3712-0401. Endere&ccedil;o: Av. Minas Gerais, 1171 - Centro, Matozinhos - MG, 35720-000. CNES 2158639.</a>
  <a class="result__url" href="x">cebes.com.br</a>
</div>
<div class="result results_links web-result">
  <h2 class="result__title">
    <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=y">UPA Matozinhos: telefone, endere&ccedil;o e hor&aacute;rio</a>
  </h2>
  <a class="result__snippet" href="y">Ligue para a UPA de Matozinhos pelo telefone +55 31 3712-0401.</a>
  <a class="result__url" href="y">guiasaude.com.br</a>
</div>
<div class="result results_links web-result">
  <h2 class="result__title">
    <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=z">UPA de Sete Lagoas</a>
  </h2>
  <a class="result__snippet" href="z">Telefone (31) 3773-9000.</a>
  <a class="result__url" href="z">outro.com.br</a>
</div>
`;

test('telefone: acha o número brasileiro e ignora CEP e código', () => {
  const phones = extractPhones(
    'Telefone: (31) 3712-0401. CEP 35720-000. CNES 2158639. Atendimento 24 horas.',
  );

  assert.deepEqual(
    phones.map((phone) => phone.digits),
    ['3137120401'],
  );
  assert.equal(phones[0].formatted, '(31) 3712-0401');
});

test('telefone: aceita celular, +55 e 0800', () => {
  assert.deepEqual(
    extractPhones('Fale com (31) 99999-1234 agora').map((phone) => phone.digits),
    ['31999991234'],
  );
  assert.deepEqual(
    extractPhones('Central +55 31 3712-0401').map((phone) => phone.digits),
    ['3137120401'],
  );
  assert.deepEqual(
    extractPhones('SAC 0800 123 4567').map((phone) => phone.digits),
    ['08001234567'],
  );
});

test('telefone: o mesmo número não conta duas vezes', () => {
  const phones = extractPhones('(31) 3712-0401 ou 31 3712-0401 ou +55 31 3712-0401');
  assert.equal(phones.length, 1);
});

test('telefone: formata fixo, celular e 0800', () => {
  assert.equal(formatPhoneBR('3137120401'), '(31) 3712-0401');
  assert.equal(formatPhoneBR('31999991234'), '(31) 99999-1234');
  assert.equal(formatPhoneBR('08001234567'), '0800 123 4567');
});

test('telefone: lê o HTML do DuckDuckGo e tira as tags', () => {
  const results = parseDuckDuckGoResults(DDG_HTML);

  assert.equal(results.length, 3);
  assert.equal(results[0].title, 'UPA 24 Horas Matozinhos - Centro, Matozinhos - MG');
  assert.equal(results[0].source ?? results[0].url, 'cebes.com.br');
  assert.match(results[0].snippet, /\(31\) 3712-0401/);
  // Entidades HTML resolvidas.
  assert.match(results[0].snippet, /Endereço/);
  assert.equal(hostOf('https://www.cebes.com.br/pagina'), 'cebes.com.br');
});

test('telefone: escolhe o número mais votado e batendo com o pedido', () => {
  const results = parseDuckDuckGoResults(DDG_HTML);
  const best = pickPhoneCandidate(results, 'upa de matozinhos');

  assert.ok(best, 'deveria encontrar um telefone');
  assert.equal(best.digits, '3137120401');
  assert.equal(best.formatted, '(31) 3712-0401');
  // Aparece em dois resultados → confiança maior.
  assert.equal(best.votes, 2);
  assert.notEqual(best.confidence, 'baixa');
  // O número de outra cidade não pode vencer a votação.
  assert.notEqual(best.digits, '3137739000');
  assert.equal(best.candidates[0].digits, '3137120401');
});

test('telefone: sem número no resultado, não inventa nada', () => {
  assert.equal(pickPhoneCandidate(parseDuckDuckGoResults(DDG_HTML), 'padaria do zé'), null);
  assert.equal(pickPhoneCandidate([], 'upa'), null);
});

test('telefone: stripTags devolve texto puro', () => {
  assert.equal(stripTags('<b>Oi</b>&nbsp;<i>tudo</i>   bem?'), 'Oi tudo bem?');
});

test('lugar: reconhece estabelecimento, mas não pessoa', () => {
  assert.equal(isPlaceQuery('upa de matozinhos'), true);
  assert.equal(isPlaceQuery('táxi de matozinhos'), true);
  assert.equal(isPlaceQuery('farmacia popular'), true);
  assert.equal(isPlaceQuery('joao'), false);
  assert.equal(isPlaceQuery('maria silva'), false);
});

test('lugar: a busca leva a cidade quando ela não foi dita', () => {
  assert.equal(buildPhoneSearchQuery('upa'), 'upa Matozinhos MG telefone');
  assert.equal(
    buildPhoneSearchQuery('upa de matozinhos'),
    'upa de matozinhos telefone',
  );
});

test('número falado: reconhece só dígitos', () => {
  assert.equal(looksLikePhoneNumber('31 3712-0401'), true);
  assert.equal(looksLikePhoneNumber('(31) 99999-1234'), true);
  assert.equal(looksLikePhoneNumber('joao'), false);
  assert.equal(looksLikePhoneNumber('upa de matozinhos'), false);
});

test('roteador: lugar pede busca na internet, pessoa não', () => {
  assert.deepEqual(planNativeCommand('liga para a upa de matozinhos'), {
    action: 'local-call',
    contact: 'upa de matozinhos',
    lookup: true,
  });
  assert.deepEqual(planNativeCommand('liga para o joao'), {
    action: 'local-call',
    contact: 'joao',
    lookup: false,
  });
});
