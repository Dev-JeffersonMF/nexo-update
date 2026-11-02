/**
 * Falas do mascote.
 *
 * A coruja do NEXOS não fica muda: ela diz o que está fazendo enquanto o
 * pedido é processado. E não repete a mesma frase toda vez — a Variety é o que
 * faz ela parecer viva em vez de um rótulo fixo.
 *
 * São frases curtas de propósito: elas aparecem na tela E são faladas em voz
 * alta, e uma frase de vinte palavras cansa.
 */

/** As frases de cada estado do mascote. */
export const MASCOT_PHRASES = {
  /** Parada, esperando o pedido. */
  idle: [
    'Estou aqui pra ajudar.',
    'Pode falar comigo.',
    'Me chama quando quiser.',
    'Tô aqui, sem pressa.',
    'Esperando você.',
    'Quando quiser, é só falar.',
  ],

  /** O microfone está aberto: ela está ouvindo. */
  listening: [
    'Estou ouvindo...',
    'Pode falar.',
    'Tô te ouvindo.',
    'Fala, estou aqui.',
    'Pode mandar.',
    'Te escutando.',
  ],

  /** Pensando no pedido. */
  thinking: [
    'Deixa eu pensar...',
    'Um instante...',
    'Vou ver isso...',
    'Procurando...',
    'Já já volto.',
    'Boa pergunta, deixa eu ver...',
  ],

  /** Falando a resposta. */
  speaking: [
    'Tô falando.',
    'Um segundo.',
    'Aqui vai.',
    'Escuta aí.',
    'Olha só...',
  ],

  /** A primeira fala do dia. */
  greeting: [
    'Sou o NEXOS. Escreva seu pedido aqui ou toque no ⏺ para falar comigo. Fora do app, toque no mascote que eu abro o microfone na hora e escuto o seu pedido.',
    'Sou o NEXOS, seu assistente. Pode escrever o pedido aqui ou tocar no ⏺ e falar. Dentro do app é só digitar; fora dele, toque no mascote que eu escuto do mesmo jeito.',
    'NEXOS aqui. Me conta o que você precisa: escreva aqui ou toque no ⏺ para falar. Se você sair do app, toque no mascote que eu escuto do mesmo jeito.',
  ],
};

/**
 * Escolhe uma frase do estado, sem repetir a que acabou de ser usada.
 *
 * @param {keyof typeof MASCOT_PHRASES} mood
 * @param {string} [previous] A frase usada na última vez.
 */
export function pickMascotPhrase(mood, previous = '') {
  const pool = MASCOT_PHRASES[mood];
  if (!pool || pool.length === 0) return '';
  if (pool.length === 1) return pool[0];

  const others = pool.filter((phrase) => phrase !== previous);
  const chosen = others[Math.floor(Math.random() * others.length)];
  return chosen ?? pool[0];
}
