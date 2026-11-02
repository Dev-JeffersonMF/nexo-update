/**
 * Horóscopo do dia — consulta offline com base na data atual.
 *
 * Não depende de internet nem de servidor: usa a data do aparelho para
 * determinar o período do signo e devolve uma previsão curta e positiva em
 * português do Brasil. Cada signo tem seu próprio texto, que gira conforme
 * o dia para não ser sempre o mesmo.
 */

const SIGNO_TEXTOS: Record<string, string[]> = {
  aries: [
    'Hoje é um dia de começos, Áries. A energia está a seu favor para iniciar o que estiver adiando.',
    'Áries, o dia pede ação corajosa. Não espere a permissão de ninguém para seguir em frente.',
    'Sua determinação está em alta. Aproveite para resolver o que tem ficado para trás.',
  ],
  touro: [
    'Touro, o dia traz estabilidade e oportunidades de crescer no que já construiu.',
    'Invista no conforto e na segurança hoje, Touro. O resultado vem com paciência.',
    'Seus passos estão firmes. Continue no ritmo que traz resultados concretos.',
  ],
  gemeos: [
    'Gêmeos, a comunicação está aberta. Boas conversas podem trazer surpresas boas.',
    'Sua curiosidade é sua maior aliada hoje. Pergunte, explore, aprenda algo novo.',
    'O dia favorece trocas e parcerias. Esteja disponível para o que vier.',
  ],
  cancer: [
    'Câncer, o dia pede cuidado com as emoções. Reserve um tempo para você.',
    'Sua intuição está aguçada. Confie no que o coração está dizendo.',
    'O ambiente familiar traz acolhimento. Aproveite para se reconectar.',
  ],
  leao: [
    'Leão, hoje é dia de brilhar. Sua presença ilumina quem está ao seu redor.',
    'A criatividade está em alta. Use sua voz para inspirar e liderar.',
    'O dia reconhece seu esforço. Aceite os elogios com gratidão.',
  ],
  virgem: [
    'Virgem, o dia favorece organização e foco nos detalhes que importam.',
    'Sua análise está precisa. Use isso para tomar decisões com clareza.',
    'O cuidado com a rotina traz resultados. Pequenos passos, grandes avanços.',
  ],
  libra: [
    'Libra, o equilíbrio é a palavra de hoje. Busque harmonia em suas escolhas.',
    'Sua diplomacia abre portas. Esteja pronto para mediar e acordar.',
    'O dia favorece parcerias justas e relações equilibradas.',
  ],
  escorpiao: [
    'Escorpião, a transformação começa dentro de você. Deixe o antigo para trás.',
    'Sua intensidade é sua força. Use-a para conquistar o que deseja.',
    'O dia revela verdades. Esteja pronto para enxergar o que importa.',
  ],
  sagitario: [
    'Sagitário, a aventura chama. O dia pede movimento e novas perspectivas.',
    'Seu otimismo é contagiante. Compartilhe sua visão com quem está perto.',
    'A sorte favorece quem ousa. Dê o próximo passo com confiança.',
  ],
  capricornio: [
    'Capricórnio, a disciplina traz resultados. Mantenha o foco na meta.',
    'Seu trabalho está sendo visto. Continue com responsabilidade e seriedade.',
    'O dia recompensa o esforço constante. Não desista agora.',
  ],
  aquario: [
    'Aquário, a inovação está do seu lado. Apresente suas ideias diferentes.',
    'Seu pensamento à frente do tempo traz soluções inesperadas.',
    'O dia favorece causas coletivas e amizades verdadeiras.',
  ],
  peixes: [
    'Peixes, sua sensibilidade é um presente. Ouça sua intuição hoje.',
    'O dia pede descanso e cuidado com as emoções. Respire fundo.',
    'Sua criatividade flui livremente. Deixe a imaginação guiar você.',
  ],
};

function normalizarSigno(signo: string): string {
  const map: Record<string, string> = {
    áries: 'aries', aries: 'aries',
    touro: 'touro',
    gêmeos: 'gemeos', gemeos: 'gemeos',
    câncer: 'cancer', cancer: 'cancer',
    leão: 'leao', leao: 'leao',
    virgem: 'virgem',
    escorpião: 'escorpiao', escorpiao: 'escorpiao',
    sagitário: 'sagitario', sagitario: 'sagitario',
    capricórnio: 'capricornio', capricornio: 'capricornio',
    aquário: 'aquario', aquario: 'aquario',
    peixes: 'peixes',
  };
  return map[signo.toLowerCase()] ?? signo.toLowerCase();
}

export function consultarHoroscopo(signo: string): { signo: string; texto: string; data: string } {
  const chave = normalizarSigno(signo);
  const textos = SIGNO_TEXTOS[chave];
  if (!textos || textos.length === 0) {
    return { signo: chave, texto: 'Não consegui encontrar a previsão para esse signo agora.', data: new Date().toLocaleDateString('pt-BR') };
  }
  // Gira o texto conforme o dia para variar sem precisar de internet.
  const hoje = new Date();
  const indice = hoje.getDate() % textos.length;
  return {
    signo: chave.charAt(0).toUpperCase() + chave.slice(1),
    texto: textos[indice],
    data: hoje.toLocaleDateString('pt-BR'),
  };
}

export const SIGNOS_DISPONIVEIS = [
  'Áries', 'Touro', 'Gêmeos', 'Câncer', 'Leão', 'Virgem', 'Libra', 'Escorpião', 'Sagitário', 'Capricórnio', 'Aquário', 'Peixes',
];
