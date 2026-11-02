/**
 * O que o Nexus sabe sem internet.
 *
 * A pesquisa na web é o **pesquisador**: responde o que é aberto, atual e
 * difícil. Mas ela depende de rede e da boa vontade do serviço — e aí o
 * assistente cala na hora que o usuário mais precisa dele.
 *
 * Este módulo é o **conhecimento de bolso**: um conjunto de fatos (curiosidades,
 * Brasil, Minas, ciência, geografia) que o Nexus responde na hora, sem
 * internet, e com a mesma voz de sempre.
 *
 * ## Como a pergunta é reconhecida
 *
 * O texto é dobrado (minúsculas, sem acento) e comparado com os padrões de
 * cada fato. Os padrões são escritos como frases inteiras ("maior cidade do
 * mundo"), porque é assim que a pessoa pergunta.
 *
 * ## O que NÃO entra aqui
 *
 * Notícia, preço, pessoa do momento, dado que muda: isso é da pesquisa na web.
 * Aqui só entra o que é verdade há anos e não muda amanhã.
 */

/**
 * Os fatos.
 *
 * A ordem importa: o primeiro que casar ganha. Por isso as perguntas mais
 * específicas (com o país) vêm antes das genéricas.
 */
const FACTS = [
  // -------------------------------------------------------------------
  // Brasil
  // -------------------------------------------------------------------
  {
    id: 'capital-brasil',
    patterns: [/capital do brasil/, /qual e a capital do brasil/, /brasilia e a capital/],
    answer:
      'A capital do Brasil é Brasília — foi inaugurada em 21 de abril de 1960, planejada pelo urbanista Lúcio Costa, com os prédios do Niemeyer. Antes dela, Salvador foi a primeira capital e o Rio de Janeiro, a segunda.',
  },
  {
    id: 'populacao-brasil',
    patterns: [
      /populacao do brasil/,
      /quantos habitantes.*brasil/,
      /habitantes do brasil/,
      /gente (tem|vive) no brasil/,
    ],
    answer:
      'O Brasil tem mais de 200 milhões de habitantes — a estimativa de 2024 do IBGE ficou em cerca de 212 milhões. É o país mais populoso da América do Sul e o sétimo do mundo.',
  },
  {
    id: 'maior-cidade-brasil',
    patterns: [
      /maior cidade do brasil/,
      /cidade mais populosa do brasil/,
      /maior cidade brasileira/,
      /qual e a maior cidade do brasil/,
    ],
    answer:
      'São Paulo é a maior cidade do Brasil: cerca de 12 milhões de habitantes na cidade e mais de 22 milhões na região metropolitana. Rio de Janeiro é a segunda.',
  },
  {
    id: 'estados-brasil',
    patterns: [/quantos estados (o )?brasil/, /estados tem o brasil/],
    answer:
      'O Brasil tem 26 estados e 1 Distrito Federal (Brasília). São 27 unidades federativas.',
  },
  {
    id: 'moeda-brasil',
    patterns: [/qual e a moeda do brasil/, /moeda do brasil/],
    answer: 'A moeda do Brasil é o real (R$), em circulação desde 1994.',
  },
  {
    id: 'bandeira-brasil',
    patterns: [/quantas estrelas (na )?bandeira/, /bandeira do brasil/, /cores da bandeira/],
    answer:
      'A bandeira do Brasil tem verde, amarelo, azul e branco, com 27 estrelas (uma por estado e o Distrito Federal) e o lema "Ordem e Progresso".',
  },
  {
    id: 'maior-estado-brasil',
    patterns: [/maior estado do brasil/, /estado mais grande do brasil/],
    answer:
      'O Amazonas é o maior estado do Brasil em área, com cerca de 1,56 milhão de km² — maior que muitos países. Já o estado mais populoso é São Paulo.',
  },

  // -------------------------------------------------------------------
  // Minas Gerais
  // -------------------------------------------------------------------
  {
    id: 'capital-minas',
    patterns: [/capital de minas/, /capital de minas gerais/, /belo horizonte e a capital/],
    answer:
      'A capital de Minas Gerais é Belo Horizonte. A cidade foi planejada por Aarão Reis e inaugurada em 1897 — Juscelino Kubitschek foi prefeito dela décadas depois, antes de ser presidente.',
  },
  {
    id: 'minas-nome',
    patterns: [/por que (se chama )?minas gerais/, /porque minas se chama/, /significado de minas gerais/],
    answer:
      'O nome vem das "minas gerais" — as minas de ouro descobertas no fim do século 17. A capitania de Minas Gerais foi separada da de São Paulo em 1720.',
  },
  {
    id: 'minas-melhor',
    patterns: [/minas gerais e (o |a )?melhor/, /por que minas/],
    answer:
      'Minas Gerais é conhecida pelo ferro e pelo café, pelo pão de queijo e pelas cidades históricas como Ouro Preto, Diamantina e Tiradentes. É também o estado com o maior número de municípios do Brasil.',
  },
  {
    id: 'minas-pao-de-queijo',
    patterns: [/pao de queijo/],
    answer:
      'O pão de queijo é mineiro: massa de polvilho com queijo, assada até ficar dourada. Virou patrimônio da cozinha de Minas e é servido no café da manhã em quase todo o estado.',
  },

  // -------------------------------------------------------------------
  // Mundo
  // -------------------------------------------------------------------
  {
    id: 'maior-cidade-mundo',
    patterns: [
      /maior cidade do mundo/,
      /cidade mais populosa do mundo/,
      /maior cidade do planeta/,
      /qual e a maior cidade do mundo/,
    ],
    answer:
      'Tóquio, no Japão, é a maior cidade do mundo: mais de 37 milhões de habitantes na área metropolitana. A maior do Brasil é São Paulo.',
  },
  {
    id: 'maior-pais',
    patterns: [/maior pais do mundo/, /pais mais populoso do mundo/, /qual e o maior pais/],
    answer:
      'Em área, o maior país do mundo é a Rússia. Em população, o maior é a Índia, que passou a China em 2023. A Rússia também é o maior país da Ásia.',
  },
  {
    id: 'populacao-mundo',
    patterns: [/populacao do mundo/, /quantos habitantes tem o mundo/, /habitantes do mundo/],
    answer: 'O mundo tem cerca de 8,2 bilhões de habitantes.',
  },
  {
    id: 'maior-oceano',
    patterns: [/maior oceano/, /oceano mais grande/],
    answer:
      'O Pacífico é o maior oceano: cobre um terço da superfície da Terra e tem a fossa mais profunda (Mar das Marianas, quase 11 km).',
  },
  {
    id: 'maior-floresta',
    patterns: [/maior floresta/, /floresta maior do mundo/, /maior floresta do mundo/],
    answer:
      'A Amazônia é a maior floresta do mundo (cerca de 6,7 milhões de km²), dentro do Brasil. A maior do Brasil em área é a amazônica; a segunda é a Mata Atlântica.',
  },
  {
    id: 'maior-deserto',
    patterns: [/maior deserto/],
    answer:
      'O maior deserto do mundo é a Antártida — deserto é lugar de pouca chuva, não só de areia quente. Entre os desertos quentes, o maior é o Saara, com cerca de 9 milhões de km².',
  },
  {
    id: 'maior-rio',
    patterns: [/maior rio/, /rio mais (longo|grande|caudaloso) do mundo/],
    answer:
      'O rio Amazonas é o maior do mundo em volume de água — sozinho, despeja no mar mais água que os próximos rios juntos. Em comprimento, ele e o Nilo disputam o primeiro lugar, ambos com cerca de 6.650 km.',
  },
  {
    id: 'continentes',
    patterns: [/quantos continentes/, /quantos continentes tem/],
    answer:
      'São sete: África, América do Norte, América do Sul, Antártida, Ásia, Europa e Oceania.',
  },
  {
    id: 'montanha-mais-alta',
    patterns: [/montanha mais alta/, /maior montanha/, /qual e a montanha mais alta/],
    answer:
      'O Monte Everest é o mais alto: 8.849 metros acima do mar. No Brasil, o Pico da Neblina, com 2.993 metros.',
  },
  {
    id: 'maior-planeta',
    patterns: [/maior planeta/, /planeta mais grande/],
    answer:
      'Júpiter é o maior planeta do Sistema Solar — cabe mais de mil Terras dentro dele. E o menor é Mercúrio.',
  },
  {
    id: 'planeta-vermelho',
    patterns: [/planeta vermelho/, /qual e o planeta vermelho/],
    answer:
      'É Marte, o quarto planeta do Sol. Fica vermelho por causa do óxido de ferro (ferrugem) na superfície dele.',
  },
  {
    id: 'estrela-mais-perto',
    patterns: [/estrela mais proxima/, /qual e a estrela mais proxima/],
    answer:
      'O Sol. A estrela mais próxima depois dele é Proxima Centauri, a 4,2 anos-luz.',
  },

  // -------------------------------------------------------------------
  // Ciência
  // -------------------------------------------------------------------
  {
    id: 'velocidade-luz',
    // Aceita sem pergunta: "velocidade da luz" já é pergunta na cabeça de
    // quem escreve.
    free: true,
    patterns: [/velocidade da luz/, /quanto tempo a luz/, /quao tempo a luz/],
    answer:
      'A luz viaja a 300 mil km por segundo. Do Sol até a Terra ela leva cerca de 8 minutos e 20 segundos.',
  },
  {
    id: 'o-que-e-dna',
    patterns: [/o que e dna/, /o que e o dna/, /significado de dna/],
    answer:
      'O DNA (ácido desoxirribonucleico) é a molécula que guarda a receita de cada ser vivo: uma espiral de dois filamentos, lida em quatro letras (A, T, C e G).',
  },
  {
    id: 'o-que-e-gravidade',
    patterns: [/o que e gravidade/, /o que e a gravidade/],
    answer:
      'Gravidade é a força com que a Terra (e qualquer massa) puxa os corpos para o seu centro. Foi descrita por Isaac Newton em 1687.',
  },
  {
    id: 'quantos-ossos',
    patterns: [/quantos ossos/, /quantos ossos tem o corpo/],
    answer:
      'O corpo de um adulto tem 206 ossos. São 270 nos bebês — alguns se fundem enquanto a criança cresce.',
  },
  {
    id: 'fotosintese',
    patterns: [/o que e fotossintese/, /o que e fotosintese/],
    answer:
      'É como a planta faz a própria comida: com luz, água e CO₂, ela produz açúcar e solta oxigênio. Por isso as plantas são o "filtro" do ar.',
  },
  {
    id: 'o-que-e-lua',
    patterns: [/o que e a lua/, /a lua e/],
    answer:
      'A Lua é o satélite natural da Terra. Ela é grande em relação ao planeta: o ponto em torno do qual os dois giram fica dentro da Terra, mas deslocado do centro — e é a Lua que puxa as marés.',
  },
  {
    id: 'por-que-mar',
    patterns: [/por que o mar e salgado/],
    answer:
      'O mar é salgado porque a água da chuva dissolve as rochas e leva o sal para o oceano, onde ele se acumula há bilhões de anos.',
  },

  // -------------------------------------------------------------------
  // Tempo e calendário
  // -------------------------------------------------------------------
  {
    id: 'dias-ano',
    patterns: [/quantos dias tem o ano/, /dias tem um ano/],
    answer:
      'São 365 dias — e 366 quando é ano bissexto (divisível por 4, exceto os séculos não divisíveis por 400).',
  },
  {
    id: 'quantos-meses',
    patterns: [/quantos meses/, /meses tem o ano/],
    answer: 'O ano tem 12 meses, com 28 a 31 dias cada.',
  },
  {
    id: 'estacoes',
    patterns: [/quantas estacoes/, /estacoes do ano/],
    answer:
      'São quatro no Brasil: verão, outono, inverno e primavera. E aqui o verão é de dezembro a março.',
  },
  {
    id: 'dia-semana',
    patterns: [/quantos dias tem a semana/, /dias da semana/],
    answer: 'São sete: domingo, segunda, terça, quarta, quinta, sexta e sábado.',
  },
  {
    id: 'bissexto',
    patterns: [/o que e ano bissexto/, /ano bissexto/],
    answer: () => {
      // O ano é calculado na hora: "o próximo é 2028" envelhece em dois anos.
      const leap = (year) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
      const today = new Date().getFullYear();
      if (leap(today)) {
        return `É o ano que tem 366 dias, para corrigir o desvio de um dia a cada quatro anos. Este ano (${today}) é bissexto.`;
      }
      let next = today + 1;
      while (!leap(next)) next += 1;
      return `É o ano que tem 366 dias, para corrigir o desvio de um dia a cada quatro anos. O próximo é ${next}.`;
    },
  },

  // -------------------------------------------------------------------
  // Curiosidades
  // -------------------------------------------------------------------
  {
    id: 'agua-quente',
    patterns: [/por que a agua (quente|ferve) sobe/, /por que a agua ferve/, /por que a agua quente sobe/],
    answer:
      'A água quente é menos densa que a fria, então sobe e deixa a fria descer: é a corrente de convecção. O mesmo acontece com o ar — o quente sobe, o frio ocupa o lugar.',
  },
  {
    id: 'ouro-pesado',
    patterns: [/qual e o metal mais (pesado|denso)/, /metal mais pesado/],
    answer: 'O ósmio, seguido do irídio — o ouro é denso, mas não é o mais pesado.',
  },
  {
    id: 'maior-animal',
    patterns: [/maior animal/, /qual e o maior animal/],
    answer:
      'A baleia-azul: até 30 metros e 150 toneladas. O maior animal terrestre é o elefante-africano.',
  },
  {
    id: 'golfinhos',
    patterns: [/golfinhos/, /por que os golfinhos/],
    answer:
      'Golfinhos dormem com metade do cérebro de cada vez: um lado descansa enquanto o outro continua controlando a respiração e de olho no que acontece ao redor.',
  },
  {
    id: 'abelhas',
    patterns: [/abelha/, /por que as abelhas/],
    answer:
      'As abelhas "dançam" dentro da colmeia para indicar onde está a comida: o ângulo da dança aponta a direção em relação ao sol, e o tempo de requebrado indica a distância.',
  },
  {
    id: 'gelo',
    patterns: [/por que o gelo flutua/, /o gelo flutua/],
    answer:
      'O gelo é menos denso que a água: na cristalização, as moléculas se organizam abrindo espaços entre elas. Por isso ele flutua — e a camada de gelo na superfície ajuda a conservar a vida embaixo no inverno.',
  },
  {
    id: 'chuva',
    patterns: [/como se forma a chuva/, /por que chove/],
    answer:
      'O sol evapora a água, ela sobe, esfria e vira nuvem; quando as gotas ficam pesadas, caem. Depois escorre para rios e oceanos, e o ciclo da água recomeça.',
  },
  {
    id: 'vento',
    patterns: [/como se forma o vento/, /por que existe vento/],
    answer:
      'O sol esquenta o ar em alguns lugares mais que em outros, e o ar quente sobe. O ar frio entra no lugar — e isso é o vento.',
  },
  {
    id: 'cor-do-ceu',
    patterns: [/por que o ceu e azul/, /cor do ceu/],
    answer:
      'A luz do sol tem todas as cores. O ar espalha mais o azul, e é essa luz azul que chega aos nossos olhos de todos os lados do céu.',
  },
  {
    id: 'cor-do-mar',
    patterns: [/por que o mar e (azul|verde)/],
    answer:
      'O mar parece azul porque a água absorve o vermelho e o laranja da luz e espalha o azul. À distância, o céu é o que domina a cor.',
  },
  {
    id: 'vacina',
    patterns: [/como funciona (uma )?vacina/, /o que e vacina/],
    answer:
      'A vacina mostra ao sistema imunológico uma versão inofensiva do inimigo (um antígeno), para que o corpo aprenda a fabricar anticorpos antes de encontrar o vírus de verdade.',
  },
  {
    id: 'coracao',
    patterns: [/quantas vezes o coracao bate/, /o coracao bate/],
    answer:
      'Cerca de 100 mil vezes por dia — são 35 milhões de batidas por ano, bombeando cerca de 7 mil litros de sangue.',
  },
  {
    id: 'sono',
    patterns: [/por que a gente dorme/, /para que serve o sono/],
    answer:
      'O sono não é só descanso: é quando o corpo conserta o que se quebrou de dia e o cérebro passa as memórias do dia para a memória de longo prazo.',
  },
];

/** Dobra o texto: minúsculas, sem acento, espaços simples. */
function fold(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');
}

/**
 * O Nexus sabe responder isso sem internet?
 *
 * @param {string} input A pergunta do usuário.
 * @returns {string | undefined} A resposta, ou `undefined` se não souber.
 */
export function answerFromLocalKnowledge(input) {
  const text = fold(input);
  if (!text) return undefined;

  for (const fact of FACTS) {
    // A pergunta tem que ser uma PERGUNTA: um comando ("abre o google") não é
    // para o conhecimento de bolso. Os fatos marcados como `free` são exceções
    // ("velocidade da luz" já é pergunta sozinha).
    if (!fact.free) {
      const looksLikeQuestion =
        /\b(qual|quais|quem|quando|onde|como|por que|porque|quanto|quanta|quantos|quantas|o que|que)\b/.test(
          text,
        );
      if (!looksLikeQuestion) continue;
    }

    for (const pattern of fact.patterns) {
      if (pattern.test(text)) {
        // Alguns fatos mudam com o tempo (o próximo ano bissexto, por exemplo):
        // nesses, a resposta é calculada na hora.
        return typeof fact.answer === 'function' ? fact.answer() : fact.answer;
      }
    }
  }

  return undefined;
}

/** Os fatos disponíveis (para o app mostrar e para o teste). */
export function localKnowledgeCount() {
  return FACTS.length;
}
