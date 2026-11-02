/**
 * Base inicial do aprendizado: a "infância" da rede neural do Nexus.
 *
 * O usuário falou claro: a rede tem que aprender NO DIA A DIA — e ela aprende
 * mesmo (cada comando que dá certo vira treino, cada correção vira ligação
 * nova). Mas nascer sem NADA significaria errar feio nas primeiras semanas,
 * quando o usuário ainda está ganhando confiança.
 *
 * Aqui é o VOCABULÁRIO de nascimento: falares informais brasileiros mapeados
 * para as MESMAS intenções dos roteadores determinísticos (`planNativeCommand`).
 * Nada aqui executa nada — o papel disto é só ensinar à rede que "tempo",
 * "clima", "climma" e "temperatura" puxam para a mesma intenção.
 *
 * É aplicado UMA vez (flag `seeded` no estado da rede, persistido junto com
 * ela) e nunca mais — depois disso, quem ensina é o uso.
 */

import { train } from './neuralLearner.mjs';

/**
 * Intenções = ações do `planNativeCommand` (é isso que o dia a dia treina,
 * então o seed fala a mesma língua).
 *
 * Só entram intenções que o `neuralIntent.mjs` sabe converter de volta em
 * pedido canônico SEGURO. Mensagem de WhatsApp NÃO entra de propósito:
 * contato errado aprendido é mensagem para a pessoa errada.
 */
export const NEURAL_SEED = [
  {
    intent: 'weather',
    examples: [
      'clima em bh',
      'me informe o clima da cidade de matozinhos',
      'clima de matozinhos',
      'tempo em matozinhos',
      'qual o tempo da cidade de matozinhos',
      'me informe o tempo de matozinhos',
      'tempo da cidade de matozinhos amanha',
      'vai chover hoje',
      'vai chover amanha em bh',
      'como esta o tempo em belo horizonte',
      'previsao do tempo para amanha',
      'temperatura em matozinhos',
      'esta chovendo em bh',
      'me fala o tempo de matozinhos',
      'tempo la em matozinhos',
      'clima la em matozinhos hoje',
      'como ta o tempo em bh',
    ],
  },
  {
    intent: 'music',
    examples: [
      'toca musica do zezinho',
      'quero ouvir musica',
      'coloca um som',
      'toca aquela musica',
      'bota uma musica boa',
      'poe aquela musica do legiao',
      'toca um sertanejo',
    ],
  },
  {
    intent: 'radio-play',
    examples: [
      'toca radio itatiaia',
      'liga a radio',
      'coloca a radio 98 fm',
      'toca a radio alvorada',
      'bota a radio pra mim',
      'quero ouvir a radio',
    ],
  },
  {
    intent: 'youtube',
    examples: [
      'toca no youtube',
      'coloca no youtube o video do galo',
      'quero ouvir no youtube',
      'bota la no youtube',
      'toca aquela live no youtube',
    ],
  },
  {
    intent: 'media',
    examples: [
      'pausa a musica',
      'continua a musica',
      'proxima musica',
      'musica anterior',
      'pula essa musica',
      'para a musica',
    ],
  },
  {
    intent: 'volume-up',
    examples: ['aumenta o volume', 'sobe o som', 'aumenta o som ai', 'poe pra tocar mais alto'],
  },
  {
    intent: 'volume-down',
    examples: ['diminui o volume', 'abaixa o som', 'baixa o volume', 'coloca o volume mais baixo'],
  },
  {
    intent: 'local-call',
    examples: [
      'liga para amor',
      'ligar para a mae',
      'me liga pro joao',
      'faz uma ligacao pra maria',
      'quero ligar para o dentista',
      'disca para o meu irmao',
    ],
  },
  {
    intent: 'open-last-message',
    examples: [
      'leia a mensagem',
      'le a mensagem que chegou',
      'tem mensagem nova',
      'le as mensagens do whatsapp',
      'le meu zap',
    ],
  },
  {
    intent: 'launch-app',
    examples: ['abrir whatsapp', 'abre o youtube', 'abrir camera', 'abre a galeria', 'abre o app do banco'],
  },
];

/**
 * Aplica a base inicial UMA vez na vida da rede.
 *
 * @param {object} net Rede viva (`createNetwork()` / `deserialize()`).
 * @returns {object} A própria rede, treinada (ou intacta, se já tinha seed).
 */
export function applySeedOnce(net) {
  if (!net || net.seeded) return net;
  for (const entry of NEURAL_SEED) {
    for (const example of entry.examples) {
      train(net, example, entry.intent, 1);
    }
  }
  net.seeded = true;
  return net;
}
