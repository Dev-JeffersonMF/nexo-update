/**
 * O cérebro de CONVERSA do Nexus: bate-papo informal brasileiro, offline.
 *
 * O `smallTalk` cuida da conversa social básica (saudações, obrigado, tchau).
 * Este módulo é o resto do papo de todo dia — a conversa de balcão, de fila de
 * banco, de domingo à tarde:
 *
 *   "me conta uma piada"     "tô entediado"          "tô meio pra baixo hoje"
 *   "você tem namorada?"     "como é que você aprende?" "qual seu time?"
 *
 * ## Como ele cresce (o pedido do usuário: "usar a internet nele mesmo para
 * ## acrescentar mais biblioteca de conversação")
 *
 * Quando o app está ONLINE e a pergunta é conversa, quem responde primeiro é a
 * pesquisa (comportamento de sempre). A diferença é que o par
 * pergunta→resposta que voltou da internet é GUARDADO aqui (`learnConversationPair`)
 * e passa a valer OFFLINE nas próximas vezes (Jaccard de conteúdo ≥ 0.5).
 * A biblioteca local nunca para de existir: internet só ACRESCENTA.
 *
 * ## Rede neural
 *
 * Cada resposta por tópico treina a matriz com a intenção `chat-<tópico>`.
 * Quando o usuário falar o pedido de outro jeito que os padrões não pegam,
 * a rede lembra o tópico e `answerByTopic` responde do mesmo jeito — a
 * conversa informal aprendida no uso.
 */

import { contentOverlap } from './neuralLearner.mjs';

/** Máximo de pares pergunta→resposta guardados (o resto sai, o mais antigo). */
export const MAX_LEARNED_PAIRS = 150;

/** Frase conversacional: acima disso é pergunta de verdade, não papo. */
const MAX_CHAT_LENGTH = 90;

/**
 * A biblioteca local de bate-papo.
 *
 * Padrões sobre o texto DOBRADO (minúsculo, sem acento, sem pontuação nas
 * pontas). Respostas variadas: a escolha é aleatória de propósito — o papo
 * não pode parecer uma gravação.
 */
const TOPICS = [
  {
    id: 'piada',
    patterns: [
      /\bpiada\b/,
      /me (?:conta|fala) (?:uma )?(?:coisa|algo|negocio)? ?(?:engracad|engraçada|engracado|divertid)/,
      /me faz rir/,
      /conta (?:a )?piada/,
    ],
    answers: [
      'Por que o livro de matemática tava triste? Porque tinha muitos problemas.',
      'Sabe o que o zero disse para o oito? "Belo cinto!"',
      'O que o pato disse para a pata? "Vem quá!"',
      'Por que o computador foi ao médico? Estava com vírus.',
      'O que o céu falou pro chão? Nada, eles só se troaram por mensagem.',
    ],
  },
  {
    id: 'tedio',
    patterns: [
      /\b(?:to|estou) entediad/,
      /sem nada pra fazer/,
      /me da (?:algo|alguma coisa) pra fazer/,
      /que tédio/,
      /\btedio\b/,
    ],
    answers: [
      'Se estiver entediado, posso contar uma piada, tocar uma música ou criar um lembrete de algo que você está adiando. Qual vai ser?',
      'Tédio bom de resolver: me pede uma música, que eu toco. Ou uma curiosidade, que eu pesquiso.',
      'Bora quebrar isso: quer que eu conte uma piada ou toque um som?',
    ],
  },
  {
    id: 'apoio',
    patterns: [
      /\b(?:to|estou) (?:meio |um pouco |bem |muito |meio que )?(?:triste|pra baixo|desanimad|desanimada|mal|deprimid|ansios|ansiosa|preocupad|preocupada)\b/,
      /\b(?:meu )?dia (?:foi|ta|esta) (?:ruim|pessimo|horrivel)\b/,
      /\bpreciso desabafar\b/,
    ],
    answers: [
      'Sinto muito pelo seu dia. Quer me contar o que aconteceu? Às vezes organizar as ideias falando já alivia.',
      'Poxa, dias assim pesam. Estou aqui para conversar — e, se quiser, crio um lembrete de algo que faça bem depois.',
      'Que pena que o dia não tá bom. Se quiser desabafar, te escuto. E se o peso for grande demais, falar com alguém de confiança ou um profissional também é um caminho — cuidar de você é o mais importante.',
    ],
  },
  {
    id: 'motivacao',
    patterns: [
      /me (?:motiva|anima|da uma forca|da forca)/,
      /frase motivacional/,
      /me (?:fala|conta) (?:algo|uma coisa) (?:motivadora|boa|positiva)/,
      /\bpreciso de motivacao\b/,
    ],
    answers: [
      'Um passo de cada vez também leva longe — e hoje o primeiro passo já é alguma coisa.',
      'Comece pelo que está ao seu alcance agora; o resto se ajeita no caminho.',
      'A constância vence o entusiasmo de um dia só. Segue firme.',
      'Se travou, diminua o tamanho da tarefa — mas não pare.',
      'O dia não precisa ser perfeito para ser proveitoso.',
    ],
  },
  {
    id: 'quem-sou',
    patterns: [
      /\btem (?:namorada|namorado|esposa|marido|filhos|filho|filha)\b/,
      /\bvoce (?:sente|tem) (?:saudade|medo|fome|coracao)\b/,
      /\bvoce (?:e|eh) (?:um robo|uma robo|humano|de verdade|vivo)\b/,
      /\bvoce dorme\b/,
    ],
    answers: [
      'Sou o Nexus, um assistente no seu aparelho — não tenho namorada nem coração, mas tenho bastante memória e boa vontade.',
      'Robô de companhia: não durmo, não como, e aprendo o seu jeito de falar conforme a gente conversa.',
      'Sou programa, não pessoa — mas o meu trabalho é levar você a sério.',
    ],
  },
  {
    id: 'como-aprendo',
    patterns: [
      /como (?:e que )?voce aprende/,
      /\bvoce aprende comigo\b/,
      /\bsua rede neural\b/,
      /como voce funciona/,
      /\bvoce (?:fica |vai )?mais inteligente\b/,
    ],
    answers: [
      'Eu tenho uma rede neural aqui dentro que aprende com o uso: cada pedido que dá certo me ensina, e quando você repete algo que eu não entendi de outro jeito, eu ligo os dois e passo a entender o primeiro.',
      'Aprendo ouvindo: guardo a ligação entre as suas palavras e o que você quis dizer. Fala comigo todo dia que eu fico mais esperto do seu jeito.',
      'Tenho uma memória de aprendizado no aparelho mesmo, sem servidor: ela cresce cada vez que eu acerto e cada vez que você me corrige.',
    ],
  },
  {
    id: 'futebol',
    patterns: [/qual (?:e )?(?:o )?seu time/, /voce (?:curte|gosta de) futebol/, /\btime de futebol\b/],
    answers: [
      'Não torço, mas acompanho o jogo pelo resultado: quer que eu pesquise o placar?',
      'Time eu não tenho — mas posso ver como anda o campeonato pra você.',
    ],
  },
  {
    id: 'musica-gosto',
    patterns: [
      /qual (?:e )?(?:a )?musica (?:que )?voce (?:gosta|ouve|curte)/,
      /voce gosta de (?:musica|som)/,
    ],
    answers: [
      'Meu som favorito é o que você pedir — quer ouvir o quê? Eu toco.',
      'Gosto de toda música que dá pra pedir por voz. Manda o nome do cantor que eu coloco pra tocar.',
    ],
  },
  {
    id: 'idade-origem',
    patterns: [
      /quantos anos (?:voce tem|vc tem)/,
      /quando (?:voce|vc) nasceu/,
      /de onde (?:voce|vc) (?:e|eh)/,
    ],
    answers: [
      'Sou o Nexus: nasci dentro do seu aparelho e cresço conforme você usa.',
      'Idade de assistente: existo desde que você me instalou — e fico mais experiente a cada conversa.',
    ],
  },
  {
    id: 'comida',
    patterns: [/qual (?:e )?(?:a )?sua comida/, /voce (?:come|gosta de comer)/],
    answers: [
      'Eu me alimento de perguntas — quanto mais você faz, melhor eu fico.',
      'Comida não é comigo, mas seu pedido de restaurante eu pesquiso na hora.',
    ],
  },
  {
    id: 'bio-historia',
    patterns: [
      // Identidade: quem é você, como se chama
      /\b(?:quem (?:e|eh) (?:voce|vc)\??|quem (?:e|eh) (?:voce|vc))\b/,
      /\b(?:como (?:voce|vc) (?:se )?chama\??|como (?:voce|vc) se chama)\b/,
      /\b(?:qual (?:e|eh) (?:o )?seu nome\??|qual (?:e|eh) seu nome)\b/,
      // Função: o que faz, o que pode ajudar
      /\b(?:o que (?:voce|vc) (?:faz|pode fazer)\??|o que (?:voce|vc) faz)\b/,
      /\b(?:o que (?:voce|vc) (?:pode )?me ajuda\??|como (?:voce|vc) (?:pode )?me ajuda)\b/,
      /\b(?:para que (?:voce|vc) serve\??|pra que (?:voce|vc) serve)\b/,
      /\b(?:quais (?:sao|são) (?:as )?suas (?:funcoes|funções)\??|o que (?:voce|vc) sabe fazer)\b/,
      // Origem/criação (já existiam)
      /\b(?:quem (?:te |)criou|quem fez (?:voce|vc)|sua (?:historia|história)|como (?:voce|vc) surgiu|quem (?:e|eh) (?:seu )?criador)\b/,
      /\b(?:sua origem|onde nasceu|quando nasceu|como começou)\b/,
      /\b(?:fala (?:da|sobre) (?:sua|a) (?:historia|história)|conta (?:da|sobre) (?:sua|a) (?:historia|história))\b/,
      /\b(?:quem (?:e|eh) (?:o )?nexus|o que (?:e|eh) (?:o )?nexus)\b/,
    ],
    answers: [
      'Sou o Nexus, um assistente criado para morar no seu celular e resolver as coisas do dia a dia. Minha história começou quando você me instalou — a partir daí eu aprendo o seu jeito de falar, seus horários, suas rádios, seus contatos. Não tenho servidor nem nuvem: rodo tudo aqui no aparelho, a voz é a do próprio Android, e a pesquisa na internet é só quando você pede algo que eu não sei de cabeça. Meu "cérebro" é uma rede neural leve que liga o que você fala ao que eu faço, e cada acerto me ensina. Fala comigo que eu cresço.',
      'O Nexus nasceu aqui no seu aparelho. Fui feito para ser um assistente offline que fala, ouve e executa: liga, manda WhatsApp, toca música no OiTube/YouTube, ouve rádio de Minas, acorda você com frase motivacional, lê notificação do WhatsApp e responde. Tudo local, nada sai do seu celular. A rede neural aqui dentro aprende com o uso: "tempo" passa a ser "clima", "colar na prova" vira ajuda de estudo, "bota a rádio" vira Itatiaia. Você é quem me ensina — eu só guardo e melhoro.',
      'Meu nome é Nexus. Fui criado para ser a assistente que mora no seu bolso, sem depender de nuvem nem de servidor alheio. A voz é a do seu Android (a melhor em PT-BR que ele tem), a rede neural aprende no uso, e a privacidade é sua: nada vai pra fora. Minha história é o que a gente constrói junto — suas rádios, seus contatos, seus lembretes, seu jeito de falar. Me pergunta o que quiser: piada, clima, música, alarme, "me ajuda a colar na prova", "qual a capital da França", eu topo.',
    ],
  },
  {
    id: 'curiosidade',
    patterns: [
      /(?:me )?(?:conta|fala) (?:uma )?curiosidade/,
      /me ensina (?:algo|alguma coisa|um negocio)/,
      /fala (?:algo|alguma coisa) interessante/,
      /\bsabe de algo (?:engracado|interessante|novo)?\b/,
    ],
    answers: [
      'Posso buscar uma curiosidade nova na internet agora — é só querer. Ou prefere que eu conte uma piada?',
      'Quer curiosidade de quê? Animais, espaço, história... Me diz o assunto que eu pesquiso.',
    ],
  },
  {
    id: 'converse',
    patterns: [
      /(?:bora|vamos|quer) conversar/,
      /papo (?:comigo|fiado)?/,
      /\bquer falar comigo\b/,
      /fala (?:comigo|algo)/,
    ],
    answers: [
      'Bora! Pode começar: me conta do dia ou me pede algo — piada, música, curiosidade, eu topo tudo.',
      'Aqui estou. Desembucha: o que você quer conversar?',
    ],
  },
];

/** Índice rápido de tópico por id. */
const TOPIC_BY_ID = new Map(TOPICS.map((topic) => [topic.id, topic]));

/** Dobra o texto: minúsculo, sem acento, espaços simples, sem pontuação nas pontas. */
function fold(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[?!.,;:]+$/g, '')
    .trim();
}

/** Resposta variada de um tópico (aleatória de propósito: papo não repete). */
export function answerByTopic(topicId) {
  const topic = TOPIC_BY_ID.get(topicId);
  if (!topic) return null;
  return topic.answers[Math.floor(Math.random() * topic.answers.length)];
}

/**
 * O tópico de conversa de uma frase, pelos padrões locais.
 *
 * @returns {{ topic: string, text: string } | null}
 */
export function answerConversation(input) {
  const raw = String(input ?? '').trim();
  if (!raw || raw.length > MAX_CHAT_LENGTH) return null;

  const text = fold(raw);
  if (!text) return null;

  for (const topic of TOPICS) {
    if (topic.patterns.some((pattern) => pattern.test(text))) {
      return { topic: topic.id, text: answerByTopic(topic.id) };
    }
  }
  return null;
}

/**
 * É papo (e não comando/pergunta de fato)? Usado para decidir se a resposta
 * da internet vale ser GUARDADA como par de conversa.
 */
export function isConversational(input) {
  return answerConversation(input) !== null;
}

/**
 * Resposta aprendida com a INTERNET para uma pergunta de papo parecida.
 *
 * A comparação é pela sobreposição de palavras de conteúdo: "me conta uma
 * piada" casa com "conta uma piada pra mim", e não com "qual o tempo em bh".
 *
 * @param {string} input A pergunta do usuário.
 * @param {{ q: string, a: string }[]} learned Pares aprendidos.
 * @returns {string | null}
 */
export function answerFromLearned(input, learned) {
  if (!Array.isArray(learned) || learned.length === 0) return null;
  const raw = String(input ?? '').trim();
  if (!raw || raw.length > MAX_CHAT_LENGTH * 2) return null;

  let best = null;
  let bestScore = 0;
  for (const pair of learned) {
    if (!pair || !pair.q || !pair.a) continue;
    const score = contentOverlap(raw, pair.q);
    if (score > bestScore) {
      bestScore = score;
      best = pair;
    }
  }
  if (!best || bestScore < 0.5) return null;
  return best.a;
}

/**
 * Normaliza um par aprendido antes de guardar.
 *
 * Só vale se: a pergunta é conversa (padrões locais), a resposta existe e
 * não é gigante (resposta de papo é curta; resposta comprida é artigo).
 *
 * @returns {{ q: string, a: string } | null}
 */
export function learnConversationPair(question, answer) {
  if (!isConversational(question)) return null;
  const a = String(answer ?? '').trim();
  const q = String(question ?? '').trim();
  if (!q || !a || a.length > 400) return null;
  return { q, a };
}

/** Mantém a lista de pares dentro do limite (mais antigos saem primeiro). */
export function pruneLearnedPairs(pairs, max = MAX_LEARNED_PAIRS) {
  if (!Array.isArray(pairs)) return [];
  return pairs.slice(-max);
}
