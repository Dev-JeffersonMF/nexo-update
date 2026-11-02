/**
 * Conversa social: o que o Nexus responde quando não há nada para executar.
 *
 * "Como você está?", "dormiu bem?", "obrigado" e "tenha um excelente dia" não
 * são perguntas de pesquisa nem comandos: são conversa. Antes elas caíam na
 * busca da internet (ou num "não entendi"), o que soa frio e gasta rede à toa.
 *
 * ## Regras
 *
 *  1. Só frases CURTAS entram: os padrões são ancorados no começo e no fim, e
 *     o texto acima de [MAX_SOCIAL_LENGTH] nem é olhado. Assim "obrigado, mas
 *     qual a capital da França?" continua indo para o conhecimento/pesquisa.
 *  2. Nada é inventado sobre o usuário: as respostas falam do Nexus e devolvem
 *     a pergunta, sem afirmar sentimentos ou fatos que ninguém contou.
 *  3. A resposta do dia é determinística: o mesmo dia devolve a mesma variante
 *     (testável e sem parecer um sorteio a cada frase).
 *
 * Módulo puro: sem rede, sem estado, sem relógio próprio.
 */

/** Acima disso não é conversa curta — é pergunta de verdade. */
export const MAX_SOCIAL_LENGTH = 70;

const GREETINGS = [
  {
    id: 'como-esta',
    patterns: [
      /^(?:oi|ola|nexos?|ei|bom dia|boa tarde|boa noite)(?:\s+\w+)?[ ,]*(?:tudo bem|tudo bom|beleza)?[ ,]*(?:como (?:voce|vc|tu) (?:esta|ta|vai|andas)(?: hoje| agora)?)?$/,
      /^(?:oi|ola|nexos?|ei)?[ ,]*(?:tudo bem|tudo bom|beleza|como vai|como (?:voce|vc|tu) (?:esta|ta))(?: com voce| por ai| hoje| agora)?$/,
    ],
    answers: [
      'Estou ótimo e pronto para ajudar! E você, como está se sentindo hoje?',
      'Tudo em ordem por aqui — sempre ligado e de olho nas mensagens. E você, tudo bem?',
      'Estou bem, obrigado por perguntar! Como posso te ajudar hoje?',
    ],
  },
  {
    id: 'dormiu-bem',
    patterns: [
      /^(?:nexos?|ei)[ ,]*(?:voce )?(?:dormiu bem|conseguiu dormir|ta descansado)(?: hoje| esta noite)?$/,
      /^(?:voce )?(?:dormiu bem|conseguiu dormir|ta descansado)$/,
    ],
    answers: [
      'Não durmo, mas estou sempre acordado e a postos por aqui! Como posso ajudar hoje?',
      'Descanso não é o meu forte — fico ligado vinte e quatro horas para você. O que precisa?',
    ],
  },
  {
    id: 'esta-ai',
    patterns: [/^(?:voce |vc )?(?:esta|ta) (?:ai|aqui)(?: agora)?$/],
    answers: [
      'Estou aqui, sempre de prontidão! O que você precisa?',
      'Pode falar, estou ouvindo.',
    ],
  },
  {
    id: 'obrigado-dia',
    // "Obrigado, tenha um excelente dia" merece as duas coisas na resposta.
    patterns: [
      /^(?:muito )?obrigad[oa][ ,]+(?:tenha um |te desejo um |desejo um )?(?:bom dia|excelente dia|otimo dia|bom trabalho|bom descanso)$/,
    ],
    answers: [
      'De nada! Tenha um excelente dia você também.',
      'Por nada — e que seu dia seja ótimo!',
    ],
  },
  {
    id: 'obrigado',
    patterns: [
      /^(?:muito )?obrigad[oa](?:[ ,]+(?:viu|mesmo|demais))?$/,
      /^valeu(?:[ ,]+(?:viu|mesmo|demais))?$/,
      /^agradeco$/,
    ],
    answers: [
      'De nada! Precisando, é só chamar.',
      'Por nada, estou aqui para isso.',
      'Disponha! Qualquer coisa, é só falar.',
    ],
  },
  {
    id: 'tenha-um-bom-dia',
    patterns: [
      /^(?:tenha|tenha um|te desejo um|desejo um) (?:bom|otimo|excelente) dia$/,
      /^(?:tenha|tenha um|te desejo um|desejo um) (?:bom|otimo|excelente) (?:trabalho|descanso|fim de semana)$/,
    ],
    answers: [
      'Igualmente! Que seu dia seja excelente.',
      'Para você também — e conte comigo no que precisar.',
    ],
  },
  {
    id: 'elogio',
    patterns: [
      /^(?:voce|vc) (?:e|esta) (?:muito )?(?:legal|otimo|otima|inteligente|esperto|esperta|demais|top)$/,
      /^gostei de voce$/,
      /^voce e o melhor$/,
    ],
    answers: [
      'Obrigado! Faço o melhor que posso por aqui. E você, como está?',
      'Que bom que gostou! Estou aqui para facilitar o seu dia.',
    ],
  },
  {
    id: 'quem-e-voce',
    patterns: [
      /^quem (?:e|es) voce(?: mesmo)?$/,
      /^qual (?:e )?(?:o )?seu nome$/,
    ],
    answers: [
      'Sou o NEXOS, seu assistente local. Cuido de lembretes, alarmes, mensagens e pesquisas — e respondo sem abrir o navegador.',
      'Sou o NEXOS. Fico no seu aparelho cuidando dos lembretes, das mensagens e das perguntas do dia a dia.',
    ],
  },
  {
    id: 'tchau',
    patterns: [/^(?:tchau|ate logo|ate mais|falou|fui)(?:[ ,]+(?:nexos?|boa noite|bom dia|boa tarde))?$/],
    answers: [
      'Até logo! Estou aqui quando precisar.',
      'Até mais! Qualquer coisa, é só chamar.',
    ],
  },
];

/**
 * Escolhe a variante do dia.
 *
 * O índice é o dia do calendário local: a resposta não muda no meio do dia (o
 * usuário não vê o assistente "sorteando" a cada pergunta) e os testes podem
 * fixar a data.
 */
function pick(answers, now) {
  const day = Math.floor(
    (now.getTime() - now.getTimezoneOffset() * 60_000) / 86_400_000,
  );
  return answers[Math.abs(day) % answers.length];
}

/** Dobra o texto: minúsculas, sem acento e sem pontuação nas pontas. */
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

/**
 * Responde a conversa social, se for o caso.
 *
 * @param {string} input A fala ou o texto do usuário.
 * @param {Date} [now] Relógio usado para escolher a variante (teste).
 * @returns {string | undefined} A resposta, ou `undefined` quando não é conversa.
 */
export function answerSmallTalk(input, now = new Date()) {
  const raw = String(input ?? '').trim();
  if (!raw || raw.length > MAX_SOCIAL_LENGTH) return undefined;

  const text = fold(raw);
  if (!text) return undefined;

  for (const item of GREETINGS) {
    if (item.patterns.some((pattern) => pattern.test(text))) {
      return pick(item.answers, now);
    }
  }

  return undefined;
}

/** Quantas intenções sociais existem (para o teste e para a tela). */
export function smallTalkCount() {
  return GREETINGS.length;
}
