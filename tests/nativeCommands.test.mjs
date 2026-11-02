import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCallKindAnswer, parseCallRequest, parseVolumeCommand, planMusicAnswer, planNativeCommand } from '../app/core/nativeCommands.mjs';

test('volume: sobe e desce UM degrau de cada vez', () => {
  assert.deepEqual(planNativeCommand('aumenta o volume'), { action: 'volume-up' });
  assert.deepEqual(planNativeCommand('aumenta o som'), { action: 'volume-up' });
  assert.deepEqual(planNativeCommand('sobe o volume'), { action: 'volume-up' });
  assert.deepEqual(planNativeCommand('diminui o volume'), { action: 'volume-down' });
  assert.deepEqual(planNativeCommand('diminui o som'), { action: 'volume-down' });
  assert.deepEqual(planNativeCommand('baixa o volume'), { action: 'volume-down' });
});

test('volume: a escala é de 0 a 5 (0 desligado, 5 máximo)', () => {
  assert.deepEqual(planNativeCommand('volume 3'), { action: 'volume-set', level: 3 });
  assert.deepEqual(planNativeCommand('coloca o volume no 0'), { action: 'volume-set', level: 0 });
  assert.deepEqual(planNativeCommand('volume no máximo'), { action: 'volume-set', level: 5 });
  assert.deepEqual(planNativeCommand('qual o volume'), { action: 'volume-level' });
  // O volume é do APARELHO: "para o som" continua sendo parar a música.
  assert.deepEqual(planNativeCommand('para o som'), { action: 'media', control: 'stop' });
});

test('clima: o lugar vem limpo e o dia é respeitado', () => {
  // "me informe o clima que está agora" deixava "que esta agora" no lugar e a
  // consulta ao tempo saía errada.
  assert.deepEqual(planNativeCommand('me informe o clima que esta agora'), {
    action: 'weather',
    city: '',
    day: 'today',
  });
  // "vai chover amanhã" é a PREVISÃO de amanhã, não o tempo de agora.
  assert.deepEqual(planNativeCommand('vai chover amanha'), {
    action: 'weather',
    city: '',
    day: 'tomorrow',
  });
  // Com o lugar, o lugar é o lugar.
  assert.deepEqual(planNativeCommand('clima em belo horizonte'), {
    action: 'weather',
    city: 'belo horizonte',
    day: 'today',
  });
});

test('clima: TEMPO é CLIMA quando o pedido traz lugar ("tempo da cidade de...")', () => {
  // A frase exata do usuário: "tempo" com cidade é o clima, não curiosidade.
  assert.deepEqual(planNativeCommand('me informe o tempo da cidade de matozinhos'), {
    action: 'weather',
    city: 'matozinhos',
    day: 'today',
  });
  assert.deepEqual(planNativeCommand('qual o tempo da cidade de matozinhos'), {
    action: 'weather',
    city: 'matozinhos',
    day: 'today',
  });
  // "clima da cidade de" também chega limpo (antes vinha "cidade de X").
  assert.deepEqual(planNativeCommand('me informe o clima da cidade de matozinhos'), {
    action: 'weather',
    city: 'matozinhos',
    day: 'today',
  });
  // Amanhã é previsão, mesmo pedido com "tempo".
  assert.deepEqual(planNativeCommand('tempo da cidade de matozinhos amanha'), {
    action: 'weather',
    city: 'matozinhos',
    day: 'tomorrow',
  });
  // "tempo da minha cidade" não traz cidade NENHUMA: pergunta em vez de
  // consultar "minha cidade" como se fosse lugar.
  assert.deepEqual(planNativeCommand('tempo da minha cidade'), {
    action: 'weather',
    city: '',
    day: 'today',
  });
  // O "tempo" SOZINHO continua NÃO sendo clima: é curiosidade, e a resposta
  // dela vem do conhecimento/pesquisa, não daqui.
  assert.equal(
    planNativeCommand('quanto tempo a luz do sol leva para chegar na terra'),
    undefined,
  );
});

test('apagar a última mensagem enviada NUNCA vira envio', () => {
  // A frase que o usuário testa: "apaga a última mensagem que enviei para a
  // mica". Antes deste caso, ela caía no bloco de MENSAGEM e o Nexus ENVIAVA
  // "enviei para a mica" para a própria mica — o contrário do pedido.
  assert.deepEqual(planNativeCommand('apaga a ultima mensagem que enviei para a mica'), {
    action: 'whatsapp-delete-last-message',
    contact: 'mica',
  });
  assert.deepEqual(planNativeCommand('apaga a mensagem'), {
    action: 'whatsapp-delete-last-message',
    contact: '',
  });
  // E "apaga a mensagem que CHEGOU" também é apagar — não "abrir conversa"
  // (o "chegou" do bloco de notificação não pode roubar o pedido).
  assert.deepEqual(planNativeCommand('apaga a mensagem que chegou'), {
    action: 'whatsapp-delete-last-message',
    contact: '',
  });
  // "Desfazer o envio" é o mesmo pedido, dito do outro jeito.
  assert.deepEqual(planNativeCommand('desfaz a mensagem para a mica'), {
    action: 'whatsapp-delete-last-message',
    contact: 'mica',
  });
  // Regressões: o pedido normal de enviar continua enviando...
  assert.equal(
    planNativeCommand('manda mensagem para a mica dizendo bom dia')?.action,
    'whatsapp-message',
  );
  // ...e apagar LEMBRETE/ANOTAÇÃO continua com o planejador de tarefas
  // (nada de "mensagem" na frase para este roteador roubar).
  assert.equal(planNativeCommand('apaga o lembrete'), undefined);
});

test('lista de transmissão: o pedido de mensagem para a lista do WhatsApp', () => {
  assert.deepEqual(planNativeCommand('mande uma mensagem para minha lista de transmissão'), {
    action: 'whatsapp-broadcast',
    listName: '',
  });
  assert.deepEqual(planNativeCommand('manda mensagem pra lista de trasmissao'), {
    action: 'whatsapp-broadcast',
    listName: '',
  });
  // Uma lista com nome próprio: o nome é guardado para a lista ser achada.
  assert.deepEqual(planNativeCommand('mande mensagem para a lista de transmissao da empresa'), {
    action: 'whatsapp-broadcast',
    listName: 'empresa',
  });
  // Uma mensagem para uma pessoa continua sendo mensagem para a pessoa.
  assert.deepEqual(planNativeCommand('manda uma mensagem para a mae').action, 'whatsapp-start-message');
});

test('música: nome da canção ou do artista vira busca', () => {
  assert.deepEqual(planNativeCommand('toca a música Bohemian Rhapsody'), {
    action: 'music',
    query: 'bohemian rhapsody',
  });
  assert.deepEqual(planNativeCommand('quero ouvir Coldplay'), {
    action: 'music',
    query: 'coldplay',
  });
  assert.deepEqual(planNativeCommand('coloca aquela música do Bruno Mars'), {
    action: 'music',
    query: 'bruno mars',
  });
  assert.deepEqual(planNativeCommand('toca música do Legião Urbana'), {
    action: 'music',
    query: 'legiao urbana',
  });
});

test('música: sem o nome, o Nexus pergunta qual é', () => {
  assert.deepEqual(planNativeCommand('toca uma música'), { action: 'music', query: '' });
  assert.deepEqual(planNativeCommand('toca uma música pra mim'), { action: 'music', query: '' });
  assert.deepEqual(planNativeCommand('coloca um som'), { action: 'music', query: '' });
});

test('resposta de música: separa a plataforma do nome cantado', () => {
  // "Bruno e Marrone no YouTube" chegava inteiro ao buscador e o vídeo exato
  // não era encontrado — o Nexus só abria a lista de resultados.
  assert.deepEqual(planMusicAnswer('Bruno e Marrone no YouTube'), {
    query: 'bruno e marrone',
    platform: 'youtube',
  });
  assert.deepEqual(planMusicAnswer('no OiTube, Legião Urbana'), {
    query: 'legiao urbana',
    platform: 'oitube',
  });
  assert.deepEqual(planMusicAnswer('toca Skank no oitube'), {
    query: 'skank',
    platform: 'oitube',
  });
  // Sem plataforma: só o nome, e a escolha fica com o Nexus (OiTube primeiro).
  assert.deepEqual(planMusicAnswer('toca Bruno e Marrone'), {
    query: 'bruno e marrone',
  });
  assert.deepEqual(planMusicAnswer('sertanejo'), { query: 'sertanejo' });
  assert.deepEqual(planMusicAnswer('   '), { query: '' });
});

test('música: controles de mídia continuam tendo prioridade', () => {
  assert.deepEqual(planNativeCommand('toca de novo'), { action: 'media', control: 'play' });
  assert.deepEqual(planNativeCommand('para a música'), { action: 'media', control: 'pause' });
  assert.deepEqual(planNativeCommand('próxima música'), {
    action: 'media',
    control: 'next',
  });
});

test('música de outro app: pausar, pular, voltar e parar são reconhecidos', () => {
  // O usuário fala do player do OiTube/YouTube, não da rádio do Nexus: quem
  // decide o alvo é o nativo, mas a frase precisa chegar como controle.
  assert.deepEqual(planNativeCommand('pausa o vídeo'), { action: 'media', control: 'pause' });
  assert.deepEqual(planNativeCommand('pausa a música do OiTube'), {
    action: 'media',
    control: 'pause',
  });
  assert.deepEqual(planNativeCommand('pula'), { action: 'media', control: 'next' });
  assert.deepEqual(planNativeCommand('pula essa'), { action: 'media', control: 'next' });
  assert.deepEqual(planNativeCommand('volta'), { action: 'media', control: 'prev' });
  assert.deepEqual(planNativeCommand('volta a faixa'), { action: 'media', control: 'prev' });
  assert.deepEqual(planNativeCommand('para o vídeo'), { action: 'media', control: 'stop' });
  assert.deepEqual(planNativeCommand('desliga a música'), { action: 'media', control: 'stop' });
  // Voltar a tocar não pode ser confundido com "voltar a faixa".
  assert.deepEqual(planNativeCommand('volta a tocar'), { action: 'media', control: 'play' });
  // Pedido de música com "pula"/"volta" no nome continua sendo música.
  assert.deepEqual(planNativeCommand('toca Pula Cerca'), {
    action: 'music',
    query: 'pula cerca',
  });
});

test('rádio: tocar, pausar, continuar, trocar e desligar', () => {
  assert.deepEqual(planNativeCommand('toca a rádio Itatiaia'), {
    action: 'radio-play',
    station: 'itatiaia',
  });
  assert.deepEqual(planNativeCommand('coloca a rádio 98 rock'), {
    action: 'radio-play',
    station: '98 rock',
  });
  // Apelido sem a palavra "rádio" também é rádio (o catálogo é de MG).
  assert.deepEqual(planNativeCommand('toca 98 rock'), {
    action: 'radio-play',
    station: '98 rock',
  });
  assert.deepEqual(planNativeCommand('toca a rádio Alvorada FM'), {
    action: 'radio-play',
    station: 'alvorada fm',
  });
  assert.deepEqual(planNativeCommand('coloca a Alvorada'), {
    action: 'radio-play',
    station: 'alvorada',
  });
  assert.deepEqual(planNativeCommand('pausar a rádio'), { action: 'radio-pause' });
  assert.deepEqual(planNativeCommand('continua a rádio'), { action: 'radio-resume' });
  assert.deepEqual(planNativeCommand('para a rádio'), { action: 'radio-stop' });
  assert.deepEqual(planNativeCommand('desliga o rádio'), { action: 'radio-stop' });
  assert.deepEqual(planNativeCommand('toca outra rádio'), { action: 'radio-next' });
  // Só "rádio": a interface pergunta qual emissora.
  assert.deepEqual(planNativeCommand('toca uma rádio'), { action: 'radio-play', station: '' });
});

test('rádio: "para mim" no fim da frase não desliga a rádio', () => {
  assert.deepEqual(planNativeCommand('toca a rádio Itatiaia para mim'), {
    action: 'radio-play',
    station: 'itatiaia',
  });
});

test('música: plataforma explícita continua indo para o app certo', () => {
  assert.deepEqual(planNativeCommand('toca Bohemian Rhapsody no YouTube'), {
    action: 'youtube',
    query: 'bohemian rhapsody',
  });
  assert.deepEqual(planNativeCommand('toca no OiTube Legião Urbana'), {
    action: 'oitube',
    query: 'legiao urbana',
  });
});

test('ligação normal: sem citar WhatsApp, quem liga é o telefone', () => {
  assert.deepEqual(planNativeCommand('ligar para a Maria'), {
    action: 'local-call',
    contact: 'maria',
    lookup: false,
  });
  assert.deepEqual(planNativeCommand('liga para o João'), {
    action: 'local-call',
    contact: 'joao',
    lookup: false,
  });
  assert.deepEqual(planNativeCommand('chama a Maria'), {
    action: 'local-call',
    contact: 'maria',
    lookup: false,
  });
  assert.deepEqual(planNativeCommand('disca para 11999998888'), {
    action: 'local-call',
    contact: '11999998888',
    lookup: false,
  });
});

test('lembrete com "ligar" na descrição não vira ligação', () => {
  // Regressão: "lembra de ligar para a mãe" era lida como uma ordem para
  // discar. O "ligar" ali é o assunto do lembrete.
  for (const frase of [
    'me lembra de ligar para a mãe',
    'lembra de ligar para a mãe',
    'lembre de ligar para a mãe',
    'cria um lembrete para ligar para a mãe',
  ]) {
    assert.equal(planNativeCommand(frase), undefined, frase);
  }

  // A ligação de verdade continua sendo ligação.
  assert.deepEqual(planNativeCommand('liga para a mãe'), {
    action: 'local-call',
    contact: 'mae',
    lookup: false,
  });
  // E "lembra de ligar" sozinho não é resposta de chamada.
  assert.equal(parseCallRequest('lembra de ligar'), undefined);
});

test('ligação pelo WhatsApp: o canal decide, em qualquer ordem da frase', () => {
  // Antes o "whatsapp" tinha de vir DEPOIS do verbo: "liga no zap para a
  // Maria" caía no discador do telefone.
  assert.deepEqual(planNativeCommand('liga no zap para a Maria'), {
    action: 'whatsapp-call',
    contact: 'maria',
    video: null,
  });
  assert.deepEqual(planNativeCommand('chama o João no whatsapp'), {
    action: 'whatsapp-call',
    contact: 'joao',
    video: null,
  });
  assert.deepEqual(planNativeCommand('ligar para a Maria no WhatsApp'), {
    action: 'whatsapp-call',
    contact: 'maria',
    video: null,
  });
  assert.deepEqual(planNativeCommand('chamada de voz no whatsapp para o João'), {
    action: 'whatsapp-call',
    contact: 'joao',
    video: false,
  });
});

test('apelidos que o ditado devolve também valem como WhatsApp', () => {
  // "zap" já era reconhecido; agora o que o reconhecedor escreve torto
  // ("whatsap", "watsap", "zapzinho") também cai no WhatsApp — e o contato
  // continua limpo.
  for (const alias of ['zap', 'zapzap', 'whatsap', 'watsap', 'whatssap', 'zapzinho', 'wpp']) {
    assert.deepEqual(
      planNativeCommand(`liga no ${alias} para a Maria`),
      { action: 'whatsapp-call', contact: 'maria', video: null },
      `alias "${alias}"`,
    );
  }

  assert.deepEqual(planNativeCommand('manda mensagem para a Maria no zapzinho'), {
    action: 'whatsapp-start-message',
    contact: 'maria',
    message: '',
  });
});

test('chamada de vídeo vai para o WhatsApp mesmo sem citar o app', () => {
  assert.deepEqual(planNativeCommand('faz uma chamada de vídeo para a Maria'), {
    action: 'whatsapp-call',
    contact: 'maria',
    video: true,
  });
  assert.deepEqual(planNativeCommand('videochamada para o João'), {
    action: 'whatsapp-call',
    contact: 'joao',
    video: true,
  });
});

test('canais de ligação: telefone por padrão, WhatsApp/vídeo só quando ditos', () => {
  // 1) Sem citar app nenhum, a ligação é a do telefone (operadora) — mesmo que o
  //    nome seja de alguém da agenda que também tem WhatsApp.
  assert.deepEqual(planNativeCommand('liga para o amor'), {
    action: 'local-call',
    contact: 'amor',
    lookup: false,
  });

  // 2) Com o canal dito no fim da frase ("via whatsapp"), é chamada do app —
  //    mas o tipo não foi dito: o Nexus pergunta voz ou vídeo antes de ligar.
  assert.deepEqual(planNativeCommand('liga para o amor via whatsapp'), {
    action: 'whatsapp-call',
    contact: 'amor',
    video: null,
  });

  // 3) Chamada de vídeo é sempre pelo WhatsApp (o discador não faz vídeo).
  assert.deepEqual(planNativeCommand('ligar para o amor chamada de vídeo'), {
    action: 'whatsapp-call',
    contact: 'amor',
    video: true,
  });

  // 4) "no zap" no meio da frase também é canal do WhatsApp.
  assert.deepEqual(planNativeCommand('liga para o amor no zap'), {
    action: 'whatsapp-call',
    contact: 'amor',
    video: null,
  });
});

test('pesquisa de número: o alvo vem antes do verbo e a ligação é a normal', () => {
  // "pesquise o número da UPA de Matozinhos e ligue": o alvo está ANTES do
  // verbo. Antes isso virava "para quem eu ligo?".
  assert.deepEqual(planNativeCommand('pesquise o número da upa de matozinhos e ligue'), {
    action: 'local-call',
    contact: 'upa de matozinhos',
    lookup: true,
  });
  assert.deepEqual(planNativeCommand('procura o telefone da farmácia popular e liga'), {
    action: 'local-call',
    contact: 'farmacia popular',
    lookup: true,
  });
  assert.deepEqual(planNativeCommand('procura o telefone do joão e me liga'), {
    action: 'local-call',
    contact: 'joao',
    // O usuário pediu a pesquisa de propósito: se o João estiver na agenda, a
    // agenda vence (placeLocalCall consulta os contatos primeiro).
    lookup: true,
  });
});

test('pesquisa de número não rouba comandos que não são ligação', () => {
  // Pedir pesquisa sem pedir ligação continua sendo outra coisa.
  assert.notEqual(
    planNativeCommand('pesquise o telefone da upa de matozinhos')?.action,
    'local-call',
  );
  // Música continua música.
  assert.deepEqual(planNativeCommand('toca uma música do Coldplay'), {
    action: 'music',
    query: 'coldplay',
  });
});

test('lugar pede busca na internet; pessoa nunca', () => {
  assert.deepEqual(planNativeCommand('liga para a upa de matozinhos'), {
    action: 'local-call',
    contact: 'upa de matozinhos',
    lookup: true,
  });
  assert.deepEqual(planNativeCommand('liga para a dona maria'), {
    action: 'local-call',
    contact: 'dona maria',
    lookup: false,
  });
});

test('chamada sem contato pergunta para quem (sem ligar para ninguém)', () => {
  assert.deepEqual(planNativeCommand('liga no zap'), {
    action: 'whatsapp-start-call',
    contact: '',
    video: null,
  });
  assert.deepEqual(planNativeCommand('chamada de vídeo'), {
    action: 'whatsapp-start-call',
    contact: '',
    video: true,
  });
});

test('tipo de chamada tem três estados: vídeo, voz dita e tipo não dito', () => {
  // O WhatsApp tem um botão de voz ao lado do de vídeo. Sem saber qual, o
  // Nexus pergunta — não chuta (era o que fazia cair sempre na chamada de voz).
  assert.equal(planNativeCommand('liga para a Maria no whatsapp')?.video, null);
  assert.equal(planNativeCommand('liga para a Maria no whatsapp chamada de voz')?.video, false);
  assert.equal(planNativeCommand('liga para a Maria no whatsapp no vídeo')?.video, true);
  // "voz" não é contato: sai do nome.
  assert.equal(planNativeCommand('ligação de voz no zap para o João')?.contact, 'joao');
});

test('resposta da pergunta voz/vídeo entende o que a pessoa fala', () => {
  assert.equal(parseCallKindAnswer('vídeo'), true);
  assert.equal(parseCallKindAnswer('a de vídeo'), true);
  assert.equal(parseCallKindAnswer('chamada de vídeo'), true);
  assert.equal(parseCallKindAnswer('voz'), false);
  assert.equal(parseCallKindAnswer('a de voz'), false);
  assert.equal(parseCallKindAnswer('ligação de voz'), false);
  // Sem entender, devolve null e a interface repete a pergunta.
  assert.equal(parseCallKindAnswer('toca uma música'), null);
  assert.equal(parseCallKindAnswer(''), null);
});

test('mensagem: o contato sai limpo, sem artigo e sem o texto colado', () => {
  assert.deepEqual(planNativeCommand('manda uma mensagem no zap para o João dizendo oi'), {
    action: 'whatsapp-message',
    contact: 'joao',
    message: 'oi',
  });
  assert.deepEqual(planNativeCommand('envia uma mensagem para a Maria: bom dia'), {
    action: 'whatsapp-message',
    contact: 'maria',
    message: 'bom dia',
  });
  assert.deepEqual(planNativeCommand('manda mensagem para o João'), {
    action: 'whatsapp-start-message',
    contact: 'joao',
    message: '',
  });
});

test('confirmação e cancelamento de envio são comandos sozinhos', () => {
  // "enviar" sozinho era lido como "para quem é a mensagem?" e a confirmação
  // do envio pendente nunca acontecia.
  assert.deepEqual(planNativeCommand('enviar'), { action: 'whatsapp-confirm-send' });
  assert.deepEqual(planNativeCommand('pode enviar'), { action: 'whatsapp-confirm-send' });
  assert.deepEqual(planNativeCommand('sim'), { action: 'whatsapp-confirm-send' });
  assert.deepEqual(planNativeCommand('cancela'), { action: 'whatsapp-cancel-send' });
  assert.deepEqual(planNativeCommand('esquece'), { action: 'whatsapp-cancel-send' });
  // A frase inteira precisa ser a confirmação: pedido de mensagem não é.
  assert.equal(planNativeCommand('manda uma mensagem para o João').action, 'whatsapp-start-message');
});

test('notificacao: perguntar sobre a mensagem NAO cai no Gemini', () => {
  // "chegou mensagem?", "o que chegou?" e "quem mandou?" nao tinham verbo nem
  // substantivo reconhecidos e caíam no Gemini, que respondia "indisponivel"
  // mesmo sem ter nada a ver com a notificacao.
  for (const frase of [
    'leia a mensagem',
    'ler a notificacao',
    'chegou mensagem',
    'chegaram mensagens',
    'tem mensagem nova',
    'o que chegou',
    'quem mandou',
    'abrir a conversa',
  ]) {
    assert.deepEqual(planNativeCommand(frase), { action: 'open-last-message' }, frase);
  }
});

test('notificacao: pedido de ENVIO continua sendo envio', () => {
  assert.equal(
    planNativeCommand('manda uma mensagem para o joao').action,
    'whatsapp-start-message',
  );
});

test('chamada sozinha: ligar e video sao reconhecidos sem contato', () => {
  assert.deepEqual(parseCallRequest('ligar'), { video: false });
  assert.deepEqual(parseCallRequest('pode ligar'), { video: false });
  assert.deepEqual(parseCallRequest('chamada de video'), { video: true });
  assert.deepEqual(parseCallRequest('videochamada'), { video: true });
});

test('chamada sozinha: negacao e frase longa NAO viram ordem de discar', () => {
  assert.equal(parseCallRequest('nao liga'), undefined);
  assert.equal(parseCallRequest('nem pensar em ligar'), undefined);
  assert.equal(
    parseCallRequest('ligar para a maria depois do almoco de amanha'),
    undefined,
  );
  assert.equal(parseCallRequest('qual o horario do almoco'), undefined);
});
