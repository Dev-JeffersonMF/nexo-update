/**
 * Dicionário do português (e das abreviações) do Nexus.
 *
 * A gente fala e digita como fala: "às 6", "as 6", "6h", "6:30", "daqui a 10
 * min", "hj as 18", "terça as 9", "me acorda 5 min depois". O parser de
 * lembretes precisa saber essas palavras — e as abreviações que o ditado e o
 * teclado jogam no meio.
 *
 * Aqui ficam as tabelas: números, unidades de tempo, dias da semana, periode
 * do dia e as abreviações do dia a dia.
 */

/** Números por extenso (até 60, que é o que a hora usa). */
export const NUMBER_WORDS = {
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  onze: 11,
  doze: 12,
  treze: 13,
  quatorze: 14,
  catorze: 14,
  quinze: 15,
  dezesseis: 16,
  dezessete: 17,
  dezoito: 18,
  dezenove: 19,
  vinte: 20,
  trinta: 30,
  quarenta: 40,
  cinquenta: 50,
  meia: 30,
  meio: 30,
};

/** Números por extenso até 24 (as horas). */
export const HOUR_WORDS = {
  uma: 1,
  duas: 2,
  duashoras: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  onze: 11,
  doze: 12,
  treze: 13,
  quatorze: 14,
  catorze: 14,
  quinze: 15,
  dezesseis: 16,
  dezessete: 17,
  dezoito: 18,
  dezenove: 19,
  vinte: 20,
  vinteuma: 21,
  vinteeduas: 22,
  vintedois: 22,
  vinteetres: 23,
  vinteequatro: 24,
};

/**
 * Unidades de tempo, em milissegundos.
 *
 * A chave é a unidade dita/digitada; o valor é quanto ela dura. As abreviações
 * ("10 min", "2 h", "30 seg") estão aqui com as formas por extenso.
 */
export const TIME_UNITS = {
  segundo: 1000,
  segundos: 1000,
  seg: 1000,
  secs: 1000,
  s: 1000,
  minuto: 60_000,
  minutos: 60_000,
  min: 60_000,
  mins: 60_000,
  hora: 3_600_000,
  horas: 3_600_000,
  h: 3_600_000,
  hr: 3_600_000,
  hrs: 3_600_000,
};

/** Períodos do dia (somam ou tiram 12 horas). */
export const PERIOD_WORDS = [
  ['da manha', 'am'],
  ['de manha', 'am'],
  ['pela manha', 'am'],
  ['da madrugada', 'am'],
  ['da tarde', 'pm'],
  ['a tarde', 'pm'],
  ['da noite', 'pm'],
  ['de noite', 'pm'],
  ['a noite', 'pm'],
  ['de tarde', 'pm'],
  // O usuário também fala a marcação em inglês: "3 pm", "9 am". É a mesma
  // regra de 12 horas, só com outro rótulo.
  ['am', 'am'],
  ['pm', 'pm'],
];

/** Dias da semana por extenso (0 = domingo). */
export const WEEKDAYS = {
  domingo: 0,
  segunda: 1,
  'segunda-feira': 1,
  terca: 2,
  'terca-feira': 2,
  quarta: 3,
  'quarta-feira': 3,
  quinta: 4,
  'quinta-feira': 4,
  sexta: 5,
  'sexta-feira': 5,
  sabado: 6,
};

/**
 * Abreviações dos dias da semana (0 = domingo).
 *
 * "ter as 9" é terça. Sem esta tabela, o "ter" era lido como palavra solta e
 * o horário caía no dia errado.
 */
export const WEEKDAY_ABBR = {
  dom: 0,
  domingo: 0,
  seg: 1,
  segunda: 1,
  ter: 2,
  terca: 2,
  qua: 3,
  quarta: 3,
  qui: 4,
  quinta: 4,
  sex: 5,
  sexta: 5,
  sab: 6,
  sabado: 6,
};

/**
 * Palavras de dia, por extenso e abreviadas.
 *
 * `hj` e `amanh` são as que mais aparecem no ditado do dia a dia.
 */
export const DAY_WORDS = {
  hj: 'hoje',
  hoje: 'hoje',
  amanha: 'amanha',
  amanh: 'amanha',
  'depois de amanha': 'depois de amanha',
  depois: 'depois de amanha',
  anteontem: 'anteontem',
};

/**
 * Abreviações do dia a dia → palavra por extenso.
 *
 * O ditado e a digitação rápida encolhem o português: "vc", "tbm", "qdo",
 * "pq", "hj", "min", "hrs". O Nexus entende as duas formas.
 */
export const ABBREVIATIONS = {
  vc: 'voce',
  vcs: 'voces',
  tbm: 'tambem',
  tb: 'tambem',
  qdo: 'quando',
  qd: 'quando',
  pq: 'porque',
  prq: 'porque',
  hj: 'hoje',
  amanh: 'amanha',
  agr: 'agora',
  agora: 'agora',
  dmais: 'de mais',
  hj_: 'hoje',
  obs: 'observacao',
  sds: 'se Deus quiser',
  td: 'tudo',
  tds: 'todos',
  tvz: 'talvez',
  cmg: 'comigo',
  ctg: ' contigo',
  msm: 'mesmo',
  msma: 'mesma',
  blz: 'beleza',
  vlw: 'valeu',
  obg: 'obrigado',
  obgdo: 'obrigado',
  sr: 'senhor',
  sra: 'senhora',
  dr: 'doutor',
  dra: 'doutora',
  mins: 'minutos',
  segs: 'segundos',
};

/**
 * Verbos que pedem a CRIAÇÃO de um lembrete (ou alarme).
 *
 * "cria", "manda", "anota", "acorda" — a pessoa está pedindo, não mandando
 * desativar nada.
 */
export const CREATE_VERBS = [
  'me lembra',
  'me lembrate',
  'me lembrar',
  'lembra',
  'lembre',
  'me acorda',
  'me acorda',
  'me acorde',
  'me acordar',
  'acorda',
  'acorde',
  'acordar',
  'cria',
  'criar',
  'crio',
  'cria um',
  'cria uma',
  'cria o',
  'cria a',
  'faz um',
  'faz uma',
  'faz o',
  'faz a',
  'manda um',
  'manda uma',
  'manda o',
  'manda a',
  'me manda um',
  'me manda uma',
  'me manda o',
  'me manda a',
  'me cria um',
  'me cria uma',
  'me cria o',
  'me cria a',
  'alerta',
  'alertas',
  'alarme',
  'alarmes',
  'despertador',
  'despertadores',
  'me alerta',
  'me alertas',
  'me alarme',
  'me despertador',
];

/**
 * Verbos que pedem a PAUSA de um lembrete.
 *
 * A pausa adia o toque por 5 minutos e o lembrete volta a tocar — até o
 * usuário mandar parar.
 */
export const PAUSE_VERBS = [
  'pausa',
  'pausar',
  'pausa o',
  'pausa a',
  'pausa um',
  'pausa uma',
  'pausa o lembrete',
  'pausa essa',
  'pausa esse',
  'silencia',
  'silenciar',
  'silencia o',
  'silencia a',
  'adiar',
  'adiar o',
  'adiar a',
  'postergar',
  'posterga',
  'deixa pra depois',
  'daqui a pouco',
  'espera',
  'esperar',
];

/**
 * Verbos que PARAM um lembrete (desligam de vez).
 */
export const STOP_VERBS = [
  'para',
  'parar',
  'paro',
  'pare',
  'cancela',
  'cancelar',
  'desliga',
  'desligar',
  'desliga o',
  'desliga a',
  'encerra',
  'encerrar',
  'tira',
  'tirar',
  'remove',
  'remover',
  'deleta',
  'deletar',
  'apaga',
  'apagar',
  'exclui',
  'excluir',
];

/**
 * Verbos que pedem a ATIVAÇÃO de um lembrete.
 *
 * Cuidado: "liga" e "ligar" também são "ligar para alguém" — por isso eles
 * NÃO entram aqui. A reativação é "ativa", "reativa", "liga o lembrete".
 */
export const ENABLE_VERBS = [
  'ativa',
  'ativar',
  'ativei',
  'reativa',
  'reativar',
  'reativei',
  'religa',
  'religar',
  'liga o lembrete',
  'liga a lembrete',
  'liga os lembretes',
  'liga o alarme',
  'liga o despertador',
  'volta a ativar',
  'ativa o lembrete',
  'ativa a lembrete',
  'ativa os lembretes',
];

/** Verbos que guardam uma anotação. */
export const SAVE_VERBS = [
  'anota',
  'anote',
  'anotar',
  'guarda',
  'guardar',
  'salva',
  'salvar',
  'salve',
  'faz',
  'faca',
  'cria',
  'criar',
  'crio',
  'cria uma nota',
  'cria um',
  'cria uma',
  'anota ai',
  'guarda ai',
  'salva ai',
];

/**
 * Minutos da PAUSA.
 *
 * A pausa de um lembrete adia o toque por 5 minutos; ele volta a tocar e pode
 * ser pausado de novo, até o usuário mandar parar.
 */
export const PAUSE_MINUTES = 5;
