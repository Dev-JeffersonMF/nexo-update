/**
 * Roteador determinístico de comandos nativos.
 *
 * Traduz um comando em português para uma intenção executável pelo módulo
 * nativo (WhatsApp, chamadas, rádio, mídia, clima). É puro e testável: não
 * executa nada, apenas devolve o plano. Quem executa é a interface.
 */

import { isPlaceQuery } from './phoneLookup.mjs';
import { normalizeSpeech, repairCommand } from './speechText.mjs';

/**
 * Normaliza para minúsculas, sem acento e com espaços simples.
 *
 * E corrige o que a gente fala na correria: "toca musicha" vira
 * "toca musica", "climma" vira "clima". O texto da MENSAGEM nunca é tocado
 * (ver `speechText.repairCommand`).
 */
export function normalizeCommand(input) {
  return repairCommand(normalizeSpeech(input));
}

/**
 * Pedido de lembrete, mesmo quando a descrição tem um verbo de chamada.
 *
 * "me lembra de ligar para a mãe" / "lembra de ligar para a mãe" / "cria um
 * lembrete para ligar para a mãe": o "ligar" é o ASSUNTO do lembrete, não uma
 * ordem para discar agora. Quem trata é o planejador de tarefas.
 */
const REMINDER_REQUEST =
  /^(?:me\s+)?(?:lembra|lembre|lembrar)(?:\s+(?:ai|aqui))?\s+de\b|\b(?:lembrete|lembretes|alarme|alarmes|despertador|despertadores)\b/;

/** Texto depois do último termo encontrado, limpo de conectivos iniciais. */
function tailAfter(text, terms) {
  let index = -1;
  let matched = '';
  for (const term of terms) {
    const found = text.lastIndexOf(term);
    if (found > index) {
      index = found;
      matched = term;
    }
  }
  if (index < 0) return '';
  return text
    .slice(index + matched.length)
    .trim()
    .replace(/^(?:para|pro|pra|de|do|da|o|a|os|as|em|no|na)\s+/u, '')
    .replace(/^[:,-]\s*/u, '')
    .trim();
}

/**
 * Tira enfeites do pedido de rádio ("itatiaia para mim" → "itatiaia").
 *
 * Sem isso o nome da emissora chegava ao nativo com a frase inteira e a
 * resposta do Nexus saía torta ("tocando itatiaia para mim").
 */
function cleanStation(value) {
  return String(value ?? '')
    .replace(/\b(?:pra mim|para mim|por favor|pfv|agora|ai)\b/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Apelidos de WhatsApp que o reconhecedor costuma devolver.
 *
 * "zap" é o mais comum na fala ("manda no zap"), mas o ditado também escreve
 * "whatsap", "watsap" e "zapzap". A lista é a MESMA usada para limpar o nome do
 * contato — antes eram duas listas e elas viviam se desencontrando.
 */
const WHATSAPP_TERMS =
  'whatsapp|whatssap|whatsap|watsap|uatsap|zapzinho|zapzap|zappro|whats|zap|wpp|w4b';

/** Palavras que marcam o WhatsApp como canal ("no zap", "pelo whatsapp"). */
const WHATSAPP_WORDS = new RegExp(`\\b(?:${WHATSAPP_TERMS})\\b`, 'u');

/** Nomes e verbos de chamada, em qualquer ordem na frase. */
const CALL_WORDS =
  /\b(chamada|chamadas|ligacao|ligacoes|ligar|liga|ligue|liguem|discar|disca|chamar|chama|chamem|videochamada)\b/;

/**
 * Chamada de vídeo.
 *
 * Vídeo é chamada de WhatsApp na prática: o discador do telefone não faz vídeo.
 * Por isso "chamada de vídeo para a Maria" (sem citar o app) vai para o
 * WhatsApp — e continua indo para o telefone tudo que não é vídeo.
 */
const VIDEO_CALL_WORDS = /\b(video|videochamada|chamada de video)\b/;

/**
 * Chamada de VOZ pedida de propósito ("chamada de voz no zap", "ligação de voz").
 *
 * Serve para separar três casos: vídeo, voz explícita e tipo não dito. No
 * terceiro o Nexus PERGUNTA antes de ligar — no WhatsApp o botão de voz fica ao
 * lado do de vídeo, e chutar um deles já fez o usuário cair na chamada errada.
 */
const VOICE_CALL_WORDS = /\b(voz|audio|chamada de voz|ligacao de voz)\b/;

/** Nomes/verbos que pedem mensagem escrita. */
const MESSAGE_WORDS =
  /\b(mensagem|mensagens|msg|mandar|manda|mande|enviar|envia|envie|escrever|escreve)\b/;

/**
 * Comando que é SÓ a confirmação de envio ("sim", "pode enviar", "envia").
 *
 * A frase inteira precisa ser a confirmação: sem essa trava, "manda uma
 * mensagem para o João" também casaria e a mensagem nunca seria escrita.
 */
const STANDALONE_SEND_CONFIRM =
  /^(?:nexos?[,\s]*)?(?:sim|isso|certo|ok|pode enviar|pode mandar|envia|envie|enviar|manda|mandar|confirma|confirmar|confirmo)[.!]*$/u;

/** Comando que é só o cancelamento do envio pendente. */
const STANDALONE_SEND_CANCEL =
  /^(?:nexos?[,\s]*)?(?:nao|cancela|cancelar|desiste|desistir|esquece|esquecer|deixa pra la|deixa para la)[.!]*$/u;

/** Tira do texto o canal e o tipo de chamada, para sobrar só o contato. */
function stripChannelWords(text) {
  return String(text ?? '')
    .replace(
      new RegExp(`\\b(?:no|na|pelo|pela|via|por|de)\\s+(?:${WHATSAPP_TERMS})\\b`, 'gu'),
      ' ',
    )
    .replace(new RegExp(`\\b(?:${WHATSAPP_TERMS})\\b`, 'gu'), ' ')
    .replace(/\bchamada\s+de\s+(?:video|voz)\b/gu, ' ')
    .replace(/\b(?:videochamada|chamada|ligacao)\b/gu, ' ')
    .replace(/\b(?:de|por|com|em)\s+(?:video|voz)\b/gu, ' ')
    .replace(/\b(?:video|voz)\b/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Corta o texto onde a MENSAGEM começa, para o contato não vir colado nela.
 *
 * Sem isso, "manda para o João dizendo oi" e "manda para a Maria: bom dia"
 * devolviam o contato como "joão dizendo oi" / "maria: bom dia" e a busca na
 * agenda não encontrava ninguém.
 */
function cutAtMessageStart(text) {
  let cut = text.length;
  for (const marker of [/\b(?:dizendo|falando|com a mensagem|com o texto|que)\b/u, /:\s/u, /\s+-\s+/u]) {
    const found = text.search(marker);
    if (found >= 0 && found < cut) cut = found;
  }
  return text.slice(0, cut);
}

/** Nome do contato a partir de "para <nome>". */
function extractContact(text) {
  const match = cutAtMessageStart(text).match(/\b(?:para|pro|pra)\s+(.+)$/u);
  if (!match) return '';
  return stripChannelWords(match[1])
    .replace(/^(?:o|a|os|as|um|uma)\s+/u, '')
    .trim();
}

/**
 * Contato de um pedido de APAGAR a última mensagem.
 *
 * Sem o [cutAtMessageStart]: ele corta no primeiro "que" — e "apaga a última
 * mensagem QUE enviei para a mica" perdia o "para a mica" logo depois do
 * "que". Apagar não tem corpo de mensagem: o alvo vem do "para" até o fim.
 */
function extractDeleteContact(text) {
  const match = text.match(/\b(?:para|pro|pra)\s+(.+)$/u);
  if (!match) return '';
  return stripChannelWords(match[1])
    .replace(/^(?:o|a|os|as|um|uma)\s+/u, '')
    .replace(/[.!,;?]+$/u, '')
    .trim();
}

/**
 * Nome do contato de um pedido de chamada.
 *
 * Diferente de [extractContact], não exige o "para": "liga a Maria no zap" e
 * "chama o João no whatsapp" também precisam funcionar. O canal e o tipo de
 * chamada saem antes, então o que sobra é só o nome.
 */
function extractCallContact(text) {
  const cleaned = stripChannelWords(cutAtMessageStart(text));
  return tailAfter(cleaned, [
    'ligar para',
    'ligar',
    'liga',
    'ligue',
    'discar',
    'disca',
    'chamar',
    'chama',
    'para',
    'pro',
    'pra',
    'com',
  ]);
}

/** Texto da mensagem (após "dizendo/falando/que", ":" ou " - "). */
function extractMessage(text) {
  const said = text.match(/\b(?:dizendo|falando|com a mensagem|com o texto|que)\s+(.+)$/u);
  const colon = text.match(/(?::|\s+-\s+)\s*(.+)$/u);
  const value = said?.[1] ?? colon?.[1] ?? '';
  return value.trim();
}

/**
 * Alvo de um pedido EXPLÍCITO de pesquisa ("pesquise o número da UPA e ligue").
 *
 * Nas frases de ligação normais o alvo vem DEPOIS do verbo ("liga para a UPA"),
 * e quem extrai é [extractCallContact]. Aqui a ordem é invertida — o alvo vem
 * antes ("pesquise o número da UPA de Matozinhos e ligue") — e o extrator normal
 * devolveria vazio. Sem esse tratamento o pedido virava "para quem eu ligo?".
 *
 * Devolve o alvo, ou `null` quando a frase não é um pedido de pesquisa.
 */
function parseLookupTarget(text) {
  const asksSearch = /\b(pesquis\w+|procur\w+|busc\w+|encontr\w+|ach\w+|consult\w+)\b/.test(text);
  if (!asksSearch) return null;

  // Tem que pedir o NÚMERO/TELEFONE: "pesquisa uma música" não é isto.
  if (!/\b(numero|telefone|fone|contato)\b/.test(text)) return null;

  // E tem que pedir a ligação.
  if (!CALL_WORDS.test(text)) return null;

  const afterNumber = text.replace(
    /^.*?\b(?:numero|telefone|fone|contato)\b\s*(?:d[aeo]s?)?\s*/u,
    '',
  );

  const target = afterNumber
    // Corta onde começa o pedido de ligar ("... e ligue", "... e me liga").
    .split(/\s+e?\s*(?:depois\s+)?(?:me\s+)?(?:lig\w+|cham\w+|disc\w+)\b/u)[0]
    .replace(/\b(?:por favor|pra mim|para mim|pfv|agora|ai)\b/gu, ' ')
    .replace(/[.,;:!?]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim();

  return target || null;
}

const PLAY_VERBS = /\b(tocar|toca|toque|colocar|coloca|coloque|por|poe|ouvir|escuta|escute|reproduzir|reproduza)\b/;

/**
 * Verbos que desligam a rádio.
 *
 * "para" sozinho ficou de fora de propósito: ele aparece em frases comuns como
 * "toca a rádio Itatiaia para mim" e a rádio seria desligada em vez de tocada.
 * O que desliga é o verbo colado na rádio ("para a rádio") ou um verbo
 * inequívoco (parar, desligar, encerrar).
 */
const RADIO_STOP_VERBS =
  /\b(parar|paro|pare|desligar|desliga|desligue|encerrar|encerra)\b|\bpara\s+(?:a|o)\s+(?:radio|radios|emissora)\b/;

/** Pedido de troca de emissora sem dizer qual ("toca outra rádio"). */
const RADIO_SWITCH_WORDS = /\b(outra|outro|proxima|proximo|muda|mudar|troca|trocar|passa|passar|pula|pular)\b/;

/**
 * Vocabulário das emissoras mineiras conhecidas.
 *
 * O catálogo de verdade (nome, cidade e endereço do stream) vive no nativo, em
 * `RadioStreamManager.kt`. Aqui é só a lista de nomes e apelidos: serve para o
 * Nexus entender que o pedido é de rádio mesmo quando o usuário não fala a
 * palavra "rádio" ("toca 98 rock", "coloca a Itatiaia"). Quem valida o nome de
 * verdade é o nativo, que responde com a emissora ou com o motivo da falha.
 */
const RADIO_ALIASES = [
  'itatiaia',
  '98 fm',
  '98fm',
  '98 news',
  '98 rock',
  'noventa e oito',
  'alvorada',
];

/**
 * Verbos que abrem um pedido de música ("toca", "quero ouvir"...).
 *
 * Fica separado de [PLAY_VERBS] porque a música aceita frases mais naturais.
 */
const ASK_MUSIC_VERBS =
  /^(?:nexos?[,\s]*)?(?:toca|tocar|toque|coloca|colocar|coloque|reproduz|reproduzir|reproduza|bota|botar|poe|poem|quero ouvir|queria ouvir|gostaria de ouvir|ouvir|escuta|escute|me toca|me coloca)\b/u;

/**
 * Extrai o pedido de música.
 *
 * - `"toca a música Bohemian Rhapsody"` → `"Bohemian Rhapsody"`
 * - `"quero ouvir Coldplay"` → `"Coldplay"`
 * - `"toca uma música"` → `""` (a interface pergunta qual)
 * - `null` quando não é pedido de música.
 *
 * @param {string} text Comando já normalizado.
 * @returns {string | null}
 */
function parseMusicQuery(text) {
  if (/\b(radio|youtube|oitube|whatsapp|whats|zap|wpp|chamada|ligar|liga|ligacao|filme|video)\b/.test(text)) {
    return null;
  }
  if (
    /\b(de novo|novamente|mais uma vez|continua|continuar|retoma|retomar|pausa|pausar|proxima|proximo|anterior)\b/.test(
      text,
    )
  ) {
    return null;
  }

  const match = text.match(ASK_MUSIC_VERBS);
  if (!match) return null;

  let rest = text.slice(match[0].length).trim();

  // "toca a música X", "coloca aquela do X", "quero ouvir o X"
  rest = rest.replace(/^(?:aquela|aquele|essa|esse|esta|este|umas|uma|uns|um|as|os|a|o)\s+/u, '');
  rest = rest.replace(/^(?:musicas?|soms?|cancoes?|cancao|playlists?|albuns?|album)\b\s*/u, '');
  rest = rest.replace(/^(?:do|da|de|dos|das|no|na)\s+/u, '');
  rest = rest
    .replace(/\b(?:pra mim|para mim|por favor|pfv|agora|ai)\b/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return rest;
}

/**
 * Texto pesquisado dentro de uma plataforma ("no YouTube", "no OiTube").
 *
 * Aceita as duas ordens naturais: "toca X no YouTube" e "toca no YouTube X".
 */
function mediaQuery(text, platform) {
  const after = tailAfter(text, [`no ${platform}`, platform]);
  if (after) return after;

  return text
    .replace(new RegExp(`\\bno\\s+${platform}\\b.*$`, 'u'), ' ')
    .replace(
      /^(?:nexos?[,\s]*)?(?:toca|tocar|toque|coloca|colocar|coloque|reproduz|reproduzir|reproduza|bota|botar|poe|por|quero ouvir|queria ouvir|ouvir|escuta|escute)\b/u,
      ' ',
    )
    .replace(/^(?:a|o|as|os|uma|um)\s+/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resposta falada à pergunta "que tipo de música ou qual cantor você quer ouvir?".
 *
 * O usuário responde do jeito dele, muitas vezes nomeando a plataforma onde quer
 * ouvir ("Bruno e Marrone no YouTube", "no OiTube, Legião Urbana"). Antes essa
 * frase ia inteira como termo de busca, o YouTube não devolvia o vídeo exato e o
 * Nexus acabava só abrindo a lista de resultados em vez de tocar.
 *
 * @param {string} input Resposta falada (ou digitada).
 * @returns {{ query: string, platform?: 'youtube' | 'oitube' }}
 */
export function planMusicAnswer(input) {
  let text = normalizeCommand(input);
  if (!text) return { query: '' };

  const PLATFORMS = ['oitube', 'youtube'];
  let platform;
  for (const name of PLATFORMS) {
    if (!new RegExp(`\\b${name}\\b`, 'u').test(text)) continue;
    platform = name;
    // Tira a plataforma (e a preposição que vier antes dela) de qualquer posição.
    text = text
      .replace(new RegExp(`\\b(?:no|na|pelo|pela|do|da|de)\\s+${name}\\b`, 'gu'), ' ')
      .replace(new RegExp(`\\b${name}\\b`, 'gu'), ' ');
    break;
  }

  const query = text
    // Sobrou pontuação do trecho onde a plataforma estava ("no OiTube, X").
    .replace(/^[\s,;:.!?–-]+/u, '')
    .replace(
      /^(?:nexos?\b)?[,\s]*(?:toca|tocar|toque|coloca|colocar|coloque|bota|botar|poe|por|quero ouvir|queria ouvir|quero|ouvir|escuta|escute)\b/u,
      ' ',
    )
    .replace(/^[\s,;:.!?–-]+/u, '')
    .replace(/^(?:a|o|as|os|uma|um)\s+/u, '')
    .replace(/^(?:do|da|de|dos|das|no|na)\s+/u, '')
    .replace(/\b(?:por favor|pra mim|para mim|pfv|agora)\b/gu, ' ')
    .replace(/[.!?,;:]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim();

  return platform ? { query, platform } : { query };
}

/**
 * @param {string} input Comando em linguagem natural.
 * @returns {{action: string, [key: string]: unknown} | undefined}
 */
export function planNativeCommand(input) {
  const text = normalizeCommand(input);
  if (!text) return undefined;

  // Pedido de lembrete não é chamada: "lembra de ligar para a mãe" tem um
  // "ligar", mas quem decide o que fazer é o planejador de tarefas.
  if (REMINDER_REQUEST.test(text)) return undefined;

  // --- WhatsApp: APAGAR a última mensagem enviada ------------------------
  //
  // Vem primeiro de propósito: "apaga a última mensagem que enviei para a
  // mica" tem "mensagem" E "para a mica" — o bloco de mensagem lia isso como
  // um pedido de ENVIO e mandava "enviei para a mica" para a própria mica.
  // E "apaga a mensagem que chegou" tem "chegou" — o bloco de notificação
  // abriria a conversa em vez de apagar. Apagar é apagar: nunca cai em outro.
  const DELETE_WORDS =
    /\b(apaga|apagar|apague|deleta|deletar|delete|desfaz|desfazer|exclui|excluir|remove|remover|retira|retirar)\b/;
  // O plural de "mensagem" é "mensagens" (o "m" vira "ns"): as duas formas
  // precisam constar na regex.
  if (DELETE_WORDS.test(text) && (/\bmensagem\b/.test(text) || /\bmensagens\b/.test(text))) {
    // "apaga o lembrete/mensagens do lembrete" continua sendo lembrete: o
    // planejador de tarefas (que roda ANTES disto na interface) cuida disso.
    // O contato é opcional: com ele o Nexus abre a conversa da pessoa; sem
    // ele, apaga na conversa que está aberta.
    return { action: 'whatsapp-delete-last-message', contact: extractDeleteContact(text) };
  }

  // --- Rádio (emissoras de Minas Gerais, tocadas dentro do próprio app) ---
  const mentionsRadio = /\b(radio|radios|emissora|emissoras)\b/.test(text);
  const stationAlias = RADIO_ALIASES.find((alias) => text.includes(alias));

  if (mentionsRadio || stationAlias) {
    if (/\b(pausar|pausa|pausem|silenciar|silencia)\b/.test(text)) {
      return { action: 'radio-pause' };
    }
    if (/\b(continuar|continua|retomar|retoma|voltar a tocar|volta a tocar)\b/.test(text)) {
      return { action: 'radio-resume' };
    }
    if (RADIO_STOP_VERBS.test(text)) {
      return { action: 'radio-stop' };
    }
    // Trocar de emissora vem antes de "tocar": "toca outra rádio" não diz qual.
    if (RADIO_SWITCH_WORDS.test(text)) {
      return { action: 'radio-next' };
    }
    // Falou o nome/apelido sem a palavra "rádio": já sabemos a emissora.
    if (!mentionsRadio && stationAlias) {
      return { action: 'radio-play', station: stationAlias };
    }
    if (PLAY_VERBS.test(text) || /^(?:radio|radios|emissora)\b/.test(text)) {
      return {
        action: 'radio-play',
        station: cleanStation(tailAfter(text, ['radio', 'emissora']) || stationAlias || ''),
      };
    }
    // Só disse "rádio": a interface pergunta qual.
    return { action: 'radio-play', station: '' };
  }

  // --- YouTube / OiTube --------------------------------------------------
  if (/\byoutube\b/.test(text) && PLAY_VERBS.test(text)) {
    return { action: 'youtube', query: mediaQuery(text, 'youtube') };
  }
  if (/\boitube\b/.test(text) && PLAY_VERBS.test(text)) {
    return { action: 'oitube', query: mediaQuery(text, 'oitube') };
  }

  // --- Pesquisa do número + ligação normal -------------------------------
  // "pesquise o número da UPA de Matozinhos e ligue": aqui o alvo vem ANTES do
  // verbo, então o extrator de chamada comum devolveria vazio. É sempre ligação
  // do TELEFONE (operadora): pesquisar número na internet para depois chamar no
  // WhatsApp não faria sentido (o WhatsApp precisa do contato, não do número).
  const lookupTarget = parseLookupTarget(text);
  if (lookupTarget && !WHATSAPP_WORDS.test(text) && !VIDEO_CALL_WORDS.test(text)) {
    return { action: 'local-call', contact: lookupTarget, lookup: true };
  }

  // --- WhatsApp: chamada de voz / vídeo ----------------------------------
  // O CANAL decide o caminho, não a posição das palavras: "no zap", "no
  // whatsapp" ou "chamada de vídeo" são do WhatsApp; o resto ("ligar para a
  // Maria") é a ligação normal do telefone, tratada mais abaixo.
  const wantsCall = CALL_WORDS.test(text);
  const whatsAppCall = wantsCall && (WHATSAPP_WORDS.test(text) || VIDEO_CALL_WORDS.test(text));
  if (whatsAppCall) {
    const contact = extractCallContact(text);
    // Três estados de propósito: `true` = vídeo, `false` = voz pedida e
    // `null` = o usuário não disse qual. Com `null` a interface pergunta
    // "voz ou vídeo?" e só depois liga.
    const video = VIDEO_CALL_WORDS.test(text)
      ? true
      : VOICE_CALL_WORDS.test(text)
        ? false
        : null;
    return { action: contact ? 'whatsapp-call' : 'whatsapp-start-call', contact, video };
  }

  // --- Notificação recente (mensagem que acabou de chegar) ---------------
  // Cobre tanto o pedido direto ("leia a mensagem") quanto a pergunta
  // ("chegou mensagem?", "o que chegou?", "quem mandou?"). Antes só o pedido
  // com verbo era reconhecido; o resto caía na pesquisa e respondia que o
  // serviço estava indisponível — mesmo sem a pesquisa ter nada a ver com isso.
  const notificationNoun = /\b(mensagem|mensagens|conversa|notificacao|notificacoes)\b/;
  const openVerb = /\b(abrir|abra|abre|ler|leia|ver|ve|mostrar|mostra|ouvir|escuta|escute)\b/;
  const arrivalQuestion =
    /\b(chegou|chegaram)\b/.test(text) ||
    /\b(tem|temos|ha)\s+(alguma\s+|algumas\s+|uma\s+|novas?\s+|nova\s+)?(mensagem|mensagens|notificacao|notificacoes)\b/.test(
      text,
    ) ||
    /\bo\s+que\s+(chegou|chegaram)\b/.test(text) ||
    /\bquem\s+(me\s+)?mandou\b/.test(text);

  if (arrivalQuestion || (notificationNoun.test(text) && openVerb.test(text))) {
    return { action: 'open-last-message' };
  }

  // --- WhatsApp: confirmação de envio / cancelamento --------------------
  // Vem ANTES do bloco de mensagem de propósito: antes ficava depois, e
  // "enviar" sozinho era lido como "para quem é a mensagem?" — a confirmação
  // do envio pendente nunca acontecia.
  if (STANDALONE_SEND_CANCEL.test(text)) {
    return { action: 'whatsapp-cancel-send' };
  }
  if (STANDALONE_SEND_CONFIRM.test(text)) {
    return { action: 'whatsapp-confirm-send' };
  }

  // --- Lista de transmissão (WhatsApp) ------------------------------------
  //
  // "mande uma mensagem para minha lista de transmissão": a lista já existe
  // no WhatsApp. O Nexus pergunta o texto da mensagem e envia.
  // A palavra sai torta no ditado ("transmissao", "trasmissao", "transmisao"),
  // então a busca é pelo pedaço que sobrevive a todos esses erros.
  // IMPORTANTE: precisa ter "lista" + preposição + "transmissao" para não
  // confundir "alice de transmissao" com "lista de transmissao".
  const broadcastMatch = text.match(
    /\blista\b\s+(?:da|de|do|minha|minhas?|a|as?)\s+\w{0,6}(?:smiss|smis)\w{0,6}\b/u
  );
  if (broadcastMatch) {
    return { action: 'whatsapp-broadcast', listName: parseBroadcastListName(text) };
  }

  // --- WhatsApp: mensagem ------------------------------------------------
  if (MESSAGE_WORDS.test(text) || (WHATSAPP_WORDS.test(text) && extractContact(text))) {
    const contact = extractContact(text);
    const message = extractMessage(text);
    // Se tem contato E mensagem, executa direto. Se falta algo, inicia o fluxo.
    if (contact && message) {
      return { action: 'whatsapp-message', contact, message };
    }
    return { action: 'whatsapp-start-message', contact, message };
  }

  // --- Ligações normais (discador do telefone) ---------------------------
  // Só o que sobrou depois do filtro do WhatsApp chega aqui: esta ligação é a
  // do telefone, com código separado da chamada pelo WhatsApp.
  //
  // `lookup` marca os pedidos que são de um LUGAR ("upa de matozinhos") e não
  // de uma pessoa: nesse caso, se o nome não estiver na agenda, o Nexus pode
  // procurar o telefone na internet antes de discar.
  if (wantsCall) {
    const contact = extractCallContact(text);
    return { action: 'local-call', contact, lookup: isPlaceQuery(contact) };
  }

  // --- Clima -------------------------------------------------------------
  //
  // O "tempo" sozinho NÃO entra: "quanto tempo a luz do sol leva para chegar
  // na Terra" é uma curiosidade, não o clima. O que vale é o tempo COM lugar
  // ("tempo em BH", "tempo DA CIDADE de Matozinhos") ou a pergunta do tempo
  // ("vai chover", "como está o tempo"). "Tempo" e "clima" são a MESMA coisa
  // aqui: é o pedido do usuário, e a rede neural aprende o resto no dia a dia.
  if (
    /\b(clima|temperatura|previsao|como esta o tempo|vai chover|esta chovendo|chovendo|chuva|tempo em|tempo de|tempo na|tempo no|tempo da (?:minha |nossa )?cidade|clima da (?:minha |nossa )?cidade)\b/.test(
      text,
    )
  ) {
    let city = tailAfter(text, [
      'temperatura em', 'temperatura de', 'temperatura',
      'clima em', 'clima de', 'clima da cidade de', 'clima da cidade', 'clima da', 'clima do', 'clima',
      'tempo em', 'tempo de', 'tempo na', 'tempo no', 'tempo da cidade de', 'tempo da cidade', 'tempo',
      'previsao para', 'previsao de', 'previsao para', 'previsao',
      'chuva em', 'chuva de', 'chuva',
    ]);

    /*
     * O que sobrou NÃO é lugar: "me informe o clima que está agora" deixava
     * "que esta agora" no lugar e a consulta ao tempo saía errada.
     */
    city = city
      .replace(/^(?:que|como|qual|o|a)\s+(?:e|esta|ta|estao)\s+(?:o\s+)?(?:tempo|clima|previsao|chuva)\s*/, '')
      .replace(/^(?:que|como)\s+(?:esta|ta)\s*/, '')
      .replace(/\b(?:agora|hoje|nesse momento|no momento|para hoje|para amanha|amanha|depois de amanha|em bh|para bh)\b/g, '')
      // "tempo da cidade de matozinhos" pode chegar aqui como
      // "cidade de matozinhos": o lugar é matozinhos, não "cidade de".
      // E "da minha cidade de X" traz o X depois do possessivo.
      .replace(/^(?:d[aeo]\s+)?(?:minh[ao]s?|noss[ao]s?)\s+cidade\s+(?:de|do|da)?\s*/u, '')
      .replace(/^(?:cidade|vila|municipio)\s+(?:de|do|da|d')\s*/u, '')
      // "tempo da minha cidade" não traz cidade NENHUMA: o lugar tem que ser
      // perguntado, e não virar uma cidade chamada "minha cidade".
      .replace(/^(?:d[aeo]?\s*)?(?:minh[ao]s?|noss[ao]s?)\s+cidade(?:\s+d[aeo]\s+.*)?$/u, '')
      .replace(/[?.!,;]+/g, '')
      .trim();

    // "vai chover amanhã" é a PREVISÃO de amanhã, não o tempo de agora.
    const tomorrow = /\b(amanha|depois de amanha)\b/.test(text);
    return { action: 'weather', city, day: tomorrow ? 'tomorrow' : 'today' };
  }

  // --- Controles de mídia ------------------------------------------------
  // Vale para a rádio do Nexus E para a música que está tocando no OiTube/
  // YouTube: quem decide o alvo é o nativo (rádio carregada primeiro; senão o
  // player do outro app, pelo botão da tela ou por evento de mídia).
  if (/\b(pausar|pausa|para a musica|pausar a musica|pausa o video|pausa o som|pausa isso|pausa ai)\b/.test(text)) {
    return { action: 'media', control: 'pause' };
  }
  if (/\b(continuar|continua|retomar|retoma|toca de novo|volta a tocar|despausa)\b/.test(text)) {
    return { action: 'media', control: 'play' };
  }
  if (/\b(proxima|proximo|pular|pula a musica|pula essa|pula isso|pula o video|pula a faixa|proxima musica|proxima faixa|avanca)\b/.test(text)) {
    return { action: 'media', control: 'next' };
  }
  if (/\b(anterior|voltar a musica|musica anterior|volta a musica|volta a faixa|volta essa|volta o video|retrocede|voltar a faixa)\b/.test(text)) {
    return { action: 'media', control: 'prev' };
  }
  // "pula" e "volta" sozinhos também são controle — mas só quando a frase não é
  // um pedido de música: "toca Pula Cerca" continua sendo busca, não "próxima".
  const looksLikeMusicRequest = /^(toca|tocar|coloca|colocar|poe|bota|ouve|ouvir)\b/.test(text);
  if (!looksLikeMusicRequest && /\bpula\b/.test(text)) {
    return { action: 'media', control: 'next' };
  }
  if (!looksLikeMusicRequest && /\b(volta|voltar)\b/.test(text)) {
    return { action: 'media', control: 'prev' };
  }
  if (/\b(parar a musica|parar musica|parar tudo|para o video|para tudo|parar o video|desliga a musica|desligar a musica|para o som|parar o som)\b/.test(text)) {
    return { action: 'media', control: 'stop' };
  }

  // --- Volume do som (escala de 0 a 5) ------------------------------------
  //
  // Vem depois da PARADA da mídia ("para o som" é parar a música) e antes da
  // música: "coloca o volume no 0" é volume, não pedido de música.
  const volume = parseVolumeCommand(text);
  if (volume) return volume;

  // --- Música: pesquisa no OiTube/YouTube pelo nome ou pelo artista ------
  const musicQuery = parseMusicQuery(text);
  if (musicQuery !== null) {
    return { action: 'music', query: musicQuery };
  }

  // --- Abrir aplicativos -------------------------------------------------
  const open = text.match(
    /^(?:abrir|abra|abre|iniciar|inicie|inicia|executar|executa|entrar em|entra em)\s+(?:o |a |no |na |app |aplicativo )?(.+)$/u,
  );
  if (open) {
    return { action: 'launch-app', query: open[1].trim() };
  }

  // --- Horóscopo do dia --------------------------------------------------
  // "horoscopo do dia signo de virgem", "me fale sobre o signo de virgem",
  // "qual é o horoscopo de leão hoje". Extrai o signo e consulta.
  const signo = extractSigno(text);
  if (signo) {
    return { action: 'horoscopo', signo };
  }

  return undefined;
}

/**
 * Extrai o signo do zodíaco de um comando de horóscopo.
 *
 * Aceita: "horoscopo de virgem", "signo de leão", "horóscopo do áries hoje",
 * "me fale sobre o signo de escorpião", etc.
 *
 * @param {string} text Comando já normalizado.
 * @returns {string | null} Nome do signo (ex.: "virgem") ou null.
 */
function extractSigno(text) {
  const signos = [
    'aries', 'áries', 'touro', 'gemeos', 'gêmeos', 'cancer', 'câncer', 'leao',
    'leão', 'virgem', 'libra', 'escorpiao', 'escorpião', 'sagitario',
    'sagitário', 'capricornio', 'capricórnio', 'aquario', 'aquário', 'peixes',
  ];

  // Tenta padrões como "signo de X", "horoscopo de X", "horóscopo do X"
  const patterns = [
    /\b(?:signo|signo de)\s+(?:de\s+)?(\w+)\b/i,
    /\b(?:horoscopo|horóscopo)\b[^.]*\b(?:de|do|da)\s+(\w+)\b/i,
    /\b(?:horoscopo|horóscopo)\b[^.]*\b(do\s+signo\s+de\s+)?(\w+)\b/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match && match[1]) {
      const candidato = match[1].toLowerCase();
      if (signos.includes(candidato)) return candidato;
    }
  }

  // Também aceita o signo sozinho quando o contexto já é claramente horóscopo
  for (const signo of signos) {
    if (text.includes(signo)) return signo;
  }

  return null;
}

/**
 * Nome da lista de transmissão, quando o usuário diz.
 *
 * "mande mensagem para a lista de transmissão" → sem nome (o Nexus acha a
 * lista pelo nome padrão). "mande mensagem para a lista de transmissão da
 * empresa" → "empresa": é assim que uma lista renomeada é encontrada.
 *
 * @param {string} text Comando já normalizado.
 * @returns {string} nome da lista, ou `""` quando não foi dito.
 */
export function parseBroadcastListName(text) {
  const match = /\b\w{0,6}(?:smiss|smis)\w{0,6}\b\s*(.*)$/.exec(String(text ?? ''));
  if (!match) return '';
  const rest = match[1].trim();
  if (!rest) return '';

  const words = rest
    .split(' ')
    .filter(Boolean)
    .filter((word) => !/^(da|do|de|das|dos|que|e|para|com|chamada|denominada|nome|minha|meu)$/.test(word));
  if (words.length === 0 || words.length > 3) return '';
  return words.join(' ');
}

/**
 * Volume do som pedido por voz.
 *
 * A escala é do Nexus: 0 desligado, 1 a 3 subindo, 4 médio, 5 máximo. Cada
 * "aumenta"/"diminui" muda UM degrau — o som não salta do silêncio no máximo.
 *
 * @param {string} text Comando já normalizado.
 * @returns {object | null} plano de volume, ou `null` quando não é volume.
 */
export function parseVolumeCommand(text) {
  const normalized = String(text ?? '').trim();
  if (!normalized) return null;

  // "volume 3", "coloca o volume no 2", "volume nivel 4"
  const exact = normalized.match(
    /\b(?:volume|som)\b[^.]*\b(?:nivel|level|no|em)?\s*([0-5])\b/,
  );
  if (exact && /\b(volume|som)\b/.test(normalized)) {
    const level = Number(exact[1]);
    // Só é volume exato se não for um "aumenta"/"diminui" (esses valem um degrau).
    if (!/\b(aumenta|increase|aumentar|sobe|subir|diminui|diminua|diminuir|baixa|abaixa)\b/.test(normalized)) {
      return { action: 'volume-set', level };
    }
  }

  if (/\bvolume\b[^.]*\b(maximo|max|mais alto)\b/.test(normalized)) {
    return { action: 'volume-set', level: 5 };
  }
  if (/\bvolume\b[^.]*\b(zero|mudo|mute|silencio|silencia)\b/.test(normalized)) {
    return { action: 'volume-set', level: 0 };
  }
  if (
    /\b(aumenta|increase|aumentar|sobe|subir|levanta|raise)\b[^.]*\b(volume|som)\b/.test(
      normalized,
    ) ||
    /\b(volume|som)\b[^.]*\b(aumenta|sobe|subir|aumentar)\b/.test(normalized)
  ) {
    return { action: 'volume-up' };
  }
  if (
    /\b(diminui|diminua|diminuir|baixa|abaixa|lower|muda|tira)\b[^.]*\b(volume|som)\b/.test(
      normalized,
    ) ||
    /\b(volume|som)\b[^.]*\b(diminui|baixa|abaixa|diminuir)\b/.test(normalized)
  ) {
    return { action: 'volume-down' };
  }
  if (/\b(qual|quanto)\b[^.]*\bvolume\b/.test(normalized) || /\bvolume\b\s*\??$/.test(normalized)) {
    return { action: 'volume-level' };
  }

  return null;
}

/**
 * Resposta à pergunta "chamada de voz ou de vídeo?".
 *
 * Devolve `true` para vídeo, `false` para voz e `null` quando não deu para
 * entender. Com `null` a interface repete a pergunta: escolher um tipo no
 * chute é justamente o que fazia o usuário cair na chamada errada.
 */
export function parseCallKindAnswer(input) {
  const text = normalizeCommand(input);
  if (!text) return null;
  if (/\b(video|videochamada|imagem|camera)\b/u.test(text)) return true;
  if (/\b(voz|audio|fone|ligacao normal|chamada normal|normal)\b/u.test(text)) return false;
  return null;
}

/**
 * É um pedido de chamada dito SOZINHO ("ligar", "liga no zap", "chamada de
 * vídeo")?
 *
 * Serve para a conversa de uma notificação: depois de ouvir a mensagem, o
 * usuário pode escolher responder, ligar ou chamar no vídeo — e "ligar" não
 * pode ser escrito no chat como se fosse o texto da resposta.
 *
 * Só vale para frases curtas (até quatro palavras) e sem negação: "não liga"
 * é recusa, e "ligar para a Maria depois do almoço" não é uma ordem para
 * discar agora (o roteador normal cuida do contato nesse caso).
 *
 * @param {string} input
 * @returns {{ video: boolean } | undefined}
 */
export function parseCallRequest(input) {
  const text = normalizeCommand(input);
  if (!text) return undefined;

  // "lembra de ligar" é um lembrete, não uma ordem de chamada.
  if (REMINDER_REQUEST.test(text)) return undefined;

  const words = text.split(' ').filter(Boolean);
  if (words.length === 0 || words.length > 4) return undefined;

  // "não liga", "nem pensar em ligar": a negação manda mais que o verbo.
  if (/\b(nao|nem|nunca)\b/u.test(text)) return undefined;

  const video = VIDEO_CALL_WORDS.test(text);
  if (!video && !CALL_WORDS.test(text)) return undefined;

  return { video };
}
