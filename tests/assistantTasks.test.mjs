import assert from 'node:assert/strict';
import test from 'node:test';

import {
  composeReminderTime,
  describeReminderShort,
  describeTrigger,
  deriveTitle,
  extractReminderPieces,
  formatDateTime,
  parseIndex,
  parseWhen,
  planAssistantTask,
  speakReminderList,
} from '../app/core/assistantTasks.mjs';

/** Quinta-feira, 14/05/2026, 22:10 — fim de dia, então \"às 6\" é amanhã. */
const NOW = new Date(2026, 4, 14, 22, 10, 0).getTime();

function at(...args) {
  return new Date(...args).getTime();
}

// ---------------------------------------------------------------------
// Anotações
// ---------------------------------------------------------------------

test('anotação: \"anota: comprar leite\" guarda o texto puro', () => {
  assert.deepEqual(planAssistantTask('anota: comprar leite', NOW), {
    action: 'note-save',
    text: 'comprar leite',
    title: 'comprar leite',
  });
});

test('anotação: conectivos iniciais saem sem perder acento', () => {
  assert.deepEqual(planAssistantTask('anota aí que eu preciso comprar leite', NOW), {
    action: 'note-save',
    text: 'preciso comprar leite',
    title: 'preciso comprar leite',
  });
});

test('anotação: pergunta com \"anota\" continua sendo anotação', () => {
  // Regressão: \"anota: qual é a capital?\" caía na leitura da lista só por
  // causa do \"qual\".
  assert.deepEqual(planAssistantTask('anota: qual é a capital do Brasil', NOW), {
    action: 'note-save',
    text: 'qual é a capital do Brasil',
    title: 'qual é a capital do Brasil',
  });
});

test('anotação: pedir a lista e ler uma específica', () => {
  assert.deepEqual(planAssistantTask('quais são minhas anotações?', NOW), { action: 'note-list' });
  assert.deepEqual(planAssistantTask('minhas notas', NOW), { action: 'note-list' });
  assert.deepEqual(planAssistantTask('lê a anotação 2', NOW), { action: 'note-read', index: 2 });
  assert.deepEqual(planAssistantTask('lê a segunda anotação', NOW), { action: 'note-read', index: 2 });
  assert.deepEqual(planAssistantTask('lê a última anotação', NOW), { action: 'note-read', index: -1 });
});

test('anotação: apagar uma ou todas', () => {
  assert.deepEqual(planAssistantTask('apaga a anotação 3', NOW), {
    action: 'note-delete',
    index: 3,
  });
  assert.deepEqual(planAssistantTask('apaga todas as anotações', NOW), {
    action: 'note-delete',
    all: true,
  });
});

// ---------------------------------------------------------------------
// Lembretes: criação
// ---------------------------------------------------------------------

test('lembrete: horário que já passou rola para amanhã', () => {
  assert.deepEqual(planAssistantTask('cria um lembrete para tomar remédio às 8 da manhã', NOW), {
    action: 'reminder-create',
    title: 'tomar remédio',
    description: 'tomar remédio',
    triggerAtMillis: at(2026, 4, 15, 8, 0, 0),
    repeatDaily: false,
    spokenTime: 'amanhã às 8 da manhã',
    dayText: null,
    hourText: 'às 8 da manhã',
    kind: 'lembrete',
  });
});

test('lembrete: "todo dia", hora falada e descrição nenhuma vira despertador', () => {
  assert.deepEqual(planAssistantTask('me acorda às 6 todo dia', NOW), {
    action: 'reminder-create',
    title: 'Despertador',
    // Sem assunto dito, a descrição fica VAZIA: é assim que a conversa por
    // etapas sabe que ainda precisa perguntar o quê.
    description: '',
    triggerAtMillis: at(2026, 4, 15, 6, 0, 0),
    repeatDaily: true,
    spokenTime: 'amanhã às 6 da manhã',
    dayText: null,
    hourText: 'às 6',
    kind: 'alarme',
  });
});

test('lembrete: \"para\" na descrição NÃO é pedido de desativar', () => {
  const plan = planAssistantTask('cria um lembrete para tomar remédio às 8 da manhã', NOW);
  assert.equal(plan.action, 'reminder-create');
});

test('lembrete: da tarde e da noite somam 12 horas', () => {
  assert.equal(
    planAssistantTask('me lembra de ligar para a mãe às 3 da tarde hoje', NOW).triggerAtMillis,
    at(2026, 4, 14, 15, 0, 0),
  );
  assert.equal(
    planAssistantTask('me lembra de estudar às 9 da noite', NOW).triggerAtMillis,
    at(2026, 4, 15, 21, 0, 0),
  );
});

test('lembrete: 6:30, 18h e \"seis e meia\"', () => {
  assert.equal(
    planAssistantTask('cria um lembrete às 6:30 para acordar', NOW).triggerAtMillis,
    at(2026, 4, 15, 6, 30, 0),
  );
  assert.equal(
    planAssistantTask('lembrete de academia às 18h', NOW).triggerAtMillis,
    at(2026, 4, 15, 18, 0, 0),
  );
  assert.equal(
    planAssistantTask('cria um lembrete para tomar café às seis e meia', NOW).triggerAtMillis,
    at(2026, 4, 15, 6, 30, 0),
  );
});

test('lembrete: meio-dia e meia-noite', () => {
  assert.equal(
    planAssistantTask('me lembra de almoçar ao meio-dia', NOW).triggerAtMillis,
    at(2026, 4, 15, 12, 0, 0),
  );
  assert.equal(
    planAssistantTask('me acorda à meia-noite amanhã', NOW).triggerAtMillis,
    at(2026, 4, 15, 0, 0, 0),
  );
});

test('lembrete: dia de amanhã, dia da semana e dia do mês', () => {
  assert.equal(
    planAssistantTask('cria um lembrete amanhã às 7 para acordar cedo', NOW).triggerAtMillis,
    at(2026, 4, 15, 7, 0, 0),
  );
  // 14/05/2026 é uma quinta; \"sexta\" é 15/05.
  assert.equal(
    planAssistantTask('me lembra sexta às 9 de tomar café', NOW).triggerAtMillis,
    at(2026, 4, 15, 9, 0, 0),
  );
  assert.equal(
    planAssistantTask('cria um lembrete dia 20 às 10 para pagar a conta', NOW).triggerAtMillis,
    at(2026, 4, 20, 10, 0, 0),
  );
  assert.equal(
    planAssistantTask('cria um lembrete em 25/12 às 8 para o natal', NOW).triggerAtMillis,
    at(2026, 11, 25, 8, 0, 0),
  );
});

test('lembrete: \"daqui a 10 minutos\" e \"em 2 horas\"', () => {
  assert.equal(
    planAssistantTask('me lembra de tirar o remédio daqui a 10 minutos', NOW).triggerAtMillis,
    NOW + 10 * 60_000,
  );
  assert.equal(
    planAssistantTask('me lembra de virar o bolo em 2 horas', NOW).triggerAtMillis,
    NOW + 2 * 3_600_000,
  );
});

test('lembrete: "daqui a N" sem unidade reconhecida NAO vira hora', () => {
  // A preposicao solta "a" ja foi lida como "as" e um lembrete de 1 minuto
  // acabou agendado para 01:00 do dia seguinte. Sem unidade, o certo e perguntar.
  for (const frase of [
    'me lembra de testar o aviso daqui a 1 minut',
    'me lembra de comprar a 2 caixas de leite',
  ]) {
    const plan = planAssistantTask(frase, NOW);
    assert.equal(plan.action, 'reminder-create', frase);
    assert.equal(plan.triggerAtMillis, 0, frase);
  }
});

test('lembrete: sem horário o Nexus pergunta (triggerAtMillis 0)', () => {
  assert.deepEqual(planAssistantTask('me lembra de comprar leite', NOW), {
    action: 'reminder-create',
    title: 'comprar leite',
    description: 'comprar leite',
    triggerAtMillis: 0,
    repeatDaily: false,
    dayText: null,
    hourText: null,
    kind: 'lembrete',
  });
});

test('lembrete: "lembra de ligar..." cria lembrete e NÃO liga', () => {
  // Regressão: sem o "me", a frase não entrava no planejador de tarefas e o
  // "ligar para a mãe" que vinha depois virava uma ligação de verdade.
  for (const frase of [
    'lembra de ligar para a mãe',
    'lembre de ligar para a mãe',
    'lembrar de ligar para a mãe',
    'me lembra de ligar para a mãe',
  ]) {
    const plan = planAssistantTask(frase, NOW);
    assert.equal(plan.action, 'reminder-create', frase);
    assert.equal(plan.triggerAtMillis, 0, frase);
    assert.equal(plan.description, 'ligar para a mãe', frase);
  }

  // "você lembra..." é conversa, não pedido de lembrete.
  assert.equal(planAssistantTask('você lembra da festa?', NOW), undefined);
});

// ---------------------------------------------------------------------
// Lembretes: leitura, edição e remoção
// ---------------------------------------------------------------------

test('lembrete: perguntar quais são', () => {
  assert.deepEqual(planAssistantTask('quais são meus lembretes?', NOW), { action: 'reminder-list' });
  assert.deepEqual(planAssistantTask('lista meus alarmes', NOW), { action: 'reminder-list' });
});

test('lembrete: desativar, reativar e apagar', () => {
  assert.deepEqual(planAssistantTask('desliga o lembrete 2', NOW), {
    action: 'reminder-disable',
    index: 2,
  });
  assert.deepEqual(planAssistantTask('para o alarme 1', NOW), {
    action: 'reminder-disable',
    index: 1,
  });
  assert.deepEqual(planAssistantTask('ativa o lembrete 2', NOW), {
    action: 'reminder-enable',
    index: 2,
  });
  assert.deepEqual(planAssistantTask('apaga o lembrete 3', NOW), {
    action: 'reminder-delete',
    index: 3,
  });
  assert.deepEqual(planAssistantTask('apaga todos os lembretes', NOW), {
    action: 'reminder-delete',
    all: true,
  });
});

test('lembrete: mudar horário sem mexer na descrição', () => {
  assert.deepEqual(planAssistantTask('muda o lembrete 2 para as 9 da noite', NOW), {
    action: 'reminder-edit',
    index: 2,
    triggerAtMillis: at(2026, 4, 15, 21, 0, 0),
    repeatDaily: false,
    spokenTime: 'amanhã às 9 da noite',
  });
});

test('lembrete: mudar só a descrição', () => {
  assert.deepEqual(planAssistantTask('muda o lembrete 2 para comprar pão', NOW), {
    action: 'reminder-edit',
    index: 2,
    description: 'comprar pão',
  });
});

// ---------------------------------------------------------------------
// Não é tarefa
// ---------------------------------------------------------------------

test('frases normais não viram anotação nem lembrete', () => {
  assert.equal(planAssistantTask('que horas são?', NOW), undefined);
  assert.equal(planAssistantTask('liga para o João', NOW), undefined);
  assert.equal(planAssistantTask('toca uma música', NOW), undefined);
  assert.equal(planAssistantTask('', NOW), undefined);
});

// ---------------------------------------------------------------------
// Fala e formatação
// ---------------------------------------------------------------------

test('horário falado', () => {
  assert.equal(describeTrigger(at(2026, 4, 14, 20, 0, 0), NOW), 'hoje às 8 da noite');
  assert.equal(describeTrigger(at(2026, 4, 15, 6, 30, 0), NOW), 'amanhã às 6 e meia da manhã');
  assert.equal(describeTrigger(at(2026, 4, 16, 12, 0, 0), NOW), 'depois de amanhã ao meio-dia');
  assert.equal(describeTrigger(at(2026, 4, 17, 0, 0, 0), NOW), '17/5 à meia-noite');
});

test('lista de lembretes falada', () => {
  assert.equal(speakReminderList([], NOW), 'Você não tem nenhum lembrete agendado.');

  const spoken = speakReminderList(
    [
      {
        title: 'tomar remédio',
        description: 'tomar remédio',
        triggerAtMillis: at(2026, 4, 15, 8, 0, 0),
        enabled: true,
        repeatDaily: true,
      },
      {
        title: 'pagar conta',
        description: 'pagar conta',
        triggerAtMillis: at(2026, 4, 20, 10, 0, 0),
        enabled: false,
      },
    ],
    NOW,
  );

  assert.match(spoken, /Você tem 2 lembretes/);
  // A lista é ABREVIADA: "tomar remédio às 08:00 para amanhã".
  assert.match(spoken, /1\. tomar remédio às 08:00 para amanhã \(todo dia\)/);
  assert.match(spoken, /2\. pagar conta às 10:00 para 20\/5 — desativado/);
});

test('horário curto: o que é, que horas e quando', () => {
  // Abreviar a lista não pode perder informação: o QUE, a HORA e o DIA.
  assert.equal(
    describeReminderShort(at(2026, 4, 15, 14, 0, 0), NOW),
    'às 14:00 para amanhã',
  );
  assert.equal(
    describeReminderShort(at(2026, 9, 27, 18, 30, 0), NOW),
    'às 18:30 para 27/10',
  );
  assert.equal(describeReminderShort(at(2026, 4, 14, 9, 5, 0), NOW), 'às 09:05 para hoje');
});

test('índice citado e título curto', () => {
  assert.equal(parseIndex('apaga a anotação 4'), 4);
  assert.equal(parseIndex('a terceira'), 3);
  assert.equal(parseIndex('a última'), -1);
  assert.equal(parseIndex('apaga ela'), null);

  assert.equal(deriveTitle('', 'Anotação'), 'Anotação');
  assert.equal(deriveTitle('curto'), 'curto');
  assert.equal(deriveTitle('a'.repeat(70)).length, 60);
  assert.ok(deriveTitle('a'.repeat(70)).endsWith('...'));

  assert.equal(formatDateTime(at(2026, 4, 9, 8, 5, 0)), '09/05 08:05');
});

test('parseWhen devolve o trecho casado para a descrição ser cortada', () => {
  const when = parseWhen('cria um lembrete para tomar remédio às 8 da manhã', NOW);
  const raw = 'cria um lembrete para tomar remédio às 8 da manhã';
  // O trecho casado começa no "às" e termina no "da manhã".
  assert.equal(raw.slice(when.start, when.end).trim(), 'às 8 da manhã');
});

// ---------------------------------------------------------------------
// Relógio de 12 horas, "meia", dia exato e conversa por etapas
// ---------------------------------------------------------------------

test('hora: "meia" vale sempre 30 minutos', () => {
  const meia = composeReminderTime('27/10', 'meio dia e meia', NOW);
  assert.equal(meia.triggerAtMillis, at(2026, 9, 27, 12, 30, 0));
  assert.equal(meia.spokenTime, '27/10 ao meio-dia e meia');

  assert.equal(
    composeReminderTime('27/10', 'meia noite e meia', NOW).triggerAtMillis,
    at(2026, 9, 27, 0, 30, 0),
  );

  // "meio-dia e quinze" não é meia: o minuto dito manda.
  assert.equal(
    composeReminderTime('27/10', 'meio dia e quinze', NOW).triggerAtMillis,
    at(2026, 9, 27, 12, 15, 0),
  );
});

test('hora: am/pm, 24 horas e 00 na resposta curta', () => {
  assert.equal(composeReminderTime('27/10', '3 pm', NOW).triggerAtMillis, at(2026, 9, 27, 15, 0, 0));
  assert.equal(composeReminderTime('27/10', '3 da tarde', NOW).triggerAtMillis, at(2026, 9, 27, 15, 0, 0));
  assert.equal(composeReminderTime('27/10', '9 am', NOW).triggerAtMillis, at(2026, 9, 27, 9, 0, 0));
  assert.equal(composeReminderTime('27/10', '12 am', NOW).triggerAtMillis, at(2026, 9, 27, 0, 0, 0));
  assert.equal(composeReminderTime('27/10', '12 pm', NOW).triggerAtMillis, at(2026, 9, 27, 12, 0, 0));
  assert.equal(composeReminderTime('27/10', '15', NOW).triggerAtMillis, at(2026, 9, 27, 15, 0, 0));
  assert.equal(composeReminderTime('27/10', '00', NOW).triggerAtMillis, at(2026, 9, 27, 0, 0, 0));
  assert.equal(
    composeReminderTime('27/10', '3 e meia pm', NOW).triggerAtMillis,
    at(2026, 9, 27, 15, 30, 0),
  );
});

test('hora: 24 horas com dois-pontos, e período da tarde soma 12', () => {
  assert.equal(
    composeReminderTime('27/10', '13:00', NOW).triggerAtMillis,
    at(2026, 9, 27, 13, 0, 0),
  );
  assert.equal(
    composeReminderTime('27/10', '12:45', NOW).triggerAtMillis,
    at(2026, 9, 27, 12, 45, 0),
  );

  // "uma da tarde" é a hora DITA sem o "as" — a resposta natural de
  // "para que horas?".
  assert.equal(
    composeReminderTime('27/10', 'uma da tarde', NOW).triggerAtMillis,
    at(2026, 9, 27, 13, 0, 0),
  );
  assert.equal(
    composeReminderTime('27/10', 'duas da tarde', NOW).triggerAtMillis,
    at(2026, 9, 27, 14, 0, 0),
  );
  assert.equal(
    composeReminderTime('27/10', 'seis e meia da noite', NOW).triggerAtMillis,
    at(2026, 9, 27, 18, 30, 0),
  );
  assert.equal(
    composeReminderTime('27/10', 'meia noite', NOW).triggerAtMillis,
    at(2026, 9, 27, 0, 0, 0),
  );
});

test('fala: meio-dia e meia-noite continuam valendo com minutos', () => {
  assert.equal(describeTrigger(at(2026, 9, 27, 12, 0, 0), NOW), '27/10 ao meio-dia');
  assert.equal(describeTrigger(at(2026, 9, 27, 12, 30, 0), NOW), '27/10 ao meio-dia e meia');
  assert.equal(describeTrigger(at(2026, 9, 27, 12, 45, 0), NOW), '27/10 ao meio-dia e quarenta e cinco');
  assert.equal(describeTrigger(at(2026, 9, 27, 0, 0, 0), NOW), '27/10 à meia-noite');
  assert.equal(describeTrigger(at(2026, 9, 27, 0, 30, 0), NOW), '27/10 à meia-noite e meia');
  assert.equal(describeTrigger(at(2026, 9, 27, 13, 5, 0), NOW), '27/10 às 1 e cinco da tarde');
});

test('dia: data exata, abreviações e "dia 27"', () => {
  // NOW = quinta-feira, 14/05/2026, 22:10.
  assert.equal(extractReminderPieces('27/10', NOW).dayText, '27/10');
  assert.equal(
    composeReminderTime('27/10', '12:00', NOW).triggerAtMillis,
    at(2026, 9, 27, 12, 0, 0),
  );

  assert.equal(
    composeReminderTime('amanhã', '12:00', NOW).triggerAtMillis,
    at(2026, 4, 15, 12, 0, 0),
  );
  // "sexta" é a PRÓXIMA sexta (15/05), não a de hoje.
  assert.equal(
    composeReminderTime('sexta', '12:00', NOW).triggerAtMillis,
    at(2026, 4, 15, 12, 0, 0),
  );
  assert.equal(
    composeReminderTime('dia 27', '12:00', NOW).triggerAtMillis,
    at(2026, 4, 27, 12, 0, 0),
  );
});

test('dia: "ter" verbo não vira terça-feira', () => {
  // "ter paciência" é o verbo; virar terça criaria o lembrete no dia errado.
  assert.equal(extractReminderPieces('ter paciência', NOW).dayText, null);

  const sozinho = composeReminderTime('ter', '12:00', NOW);
  assert.equal(new Date(sozinho.triggerAtMillis).getDay(), 2);

  const comHora = composeReminderTime('ter às 9', '12:00', NOW);
  assert.equal(new Date(comHora.triggerAtMillis).getDay(), 2);
});

test('lembrete: dia e hora no meio da frase, com "com o nome"', () => {
  const plan = planAssistantTask(
    'cria um lembrete para o dia 27/10 às 12 horas com o nome ir ao psicólogo',
    NOW,
  );

  assert.equal(plan.action, 'reminder-create');
  assert.equal(plan.description, 'ir ao psicólogo');
  assert.equal(plan.kind, 'lembrete');
  assert.equal(plan.dayText, '27/10');
  assert.equal(plan.triggerAtMillis, at(2026, 9, 27, 12, 0, 0));
  assert.equal(plan.spokenTime, '27/10 ao meio-dia');
});

test('lembrete: "dia 27/10" não sobra na descrição', () => {
  const plan = planAssistantTask('cria um lembrete para ir ao psicólogo dia 27/10 às 12:30', NOW);
  assert.equal(plan.description, 'ir ao psicólogo');
  assert.equal(plan.triggerAtMillis, at(2026, 9, 27, 12, 30, 0));
});

test('lembrete: alarme sem assunto fica sem descrição (a tela chama pelo nome)', () => {
  const plan = planAssistantTask('cria um alarme para as 6 da manhã', NOW);
  assert.equal(plan.kind, 'alarme');
  assert.equal(plan.title, 'Despertador');
  assert.equal(plan.description, '');
});

test('conversa por etapas: cada resposta preenche uma peça', () => {
  const pecas = extractReminderPieces('ir ao psicólogo amanhã às 9', NOW);
  assert.equal(pecas.description, 'ir ao psicólogo');
  assert.equal(pecas.dayText, 'amanhã');
  assert.equal(pecas.hourText, 'às 9');

  const vazio = extractReminderPieces('comprar pão', NOW);
  assert.equal(vazio.description, 'comprar pão');
  assert.equal(vazio.dayText, null);
  assert.equal(vazio.hourText, null);

  // Só o dia: a descrição fica vazia (o Nexus ainda pergunta o quê).
  const soDia = extractReminderPieces('dia 27/10 às 12:30', NOW);
  assert.equal(soDia.description, '');
  assert.equal(soDia.dayText, '27/10');
  assert.equal(soDia.hourText, '12:30');
});

test('conversa por etapas: junta o dia e a hora no instante exato', () => {
  const composed = composeReminderTime('27/10', 'meio dia e meia', NOW);
  assert.equal(composed.triggerAtMillis, at(2026, 9, 27, 12, 30, 0));
  assert.equal(composed.spokenTime, '27/10 ao meio-dia e meia');

  assert.equal(composeReminderTime('27/10', 'blablabla', NOW), null);
});
