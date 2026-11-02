import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * A conversa do lembrete por etapas: o QUE é → o DIA → a HORA.
 *
 * O problema real no aparelho: o Nexus perguntava "para que dia?" e a resposta
 * do usuário SUMIA. Duas causas, ambas na interface:
 *
 *  1. o fluxo da notificação ("quer que eu leia?") roubava a resposta curta
 *     ("amanhã") e a tratava como um "não";
 *  2. depois de perguntar, o microfone não abria: a resposta falada ficava
 *     impossível.
 *
 * A parte que entende a frase (dia, hora, am/pm) é testada em
 * `assistantTasks.test.mjs`. Aqui é travado o COMPORTAMENTO da conversa.
 */

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(path.join(projectRoot, 'App.tsx'), 'utf8');

test('a pergunta do lembrete reabre o microfone para a resposta falada', () => {
  // O helper é quem amarra a pergunta à escuta.
  assert.match(
    app,
    /const askAndListen = useCallback\([\s\S]*?awaitingAnswerRef\.current = true;[\s\S]*?forceReplyCaptureRef\.current = true;[\s\S]*?appendAssistantMessage\(text\);/,
  );
});

test('todas as perguntas do lembrete usam o helper que reabre o microfone', () => {
  // LEMBRETE: o que é → o dia → a hora (como sempre foi).
  // ALARME: o NOME → a HORA → o DIA — o diálogo do despertador que o
  // usuário pediu ("qual o nome?" → "para que hora?" → "para qual dia?").
  const perguntas = [
    /askAndListen\(\s*pendingReminder\.type === 'alarme'\s*\?\s*'Qual o nome do alarme\?'\s*:\s*'Que tipo de lembrete\?'/,
    /askAndListen\(\s*isAlarmFlow\s*\?\s*'Para que hora quer o alarme\?[^']*'\s*:\s*'Para que horas\?/,
    /askAndListen\(\s*isAlarmFlow\s*\?\s*'Para qual dia você quer o alarme\?/,
    /askAndListen\(\s*'Para que dia quer esse lembrete\?/,
    /askAndListen\(\s*'Não entendi a hora\./,
    /askAndListen\(\s*'Não entendi o horário\./,
  ];
  for (const pergunta of perguntas) {
    assert.match(app, pergunta, `pergunta sem microfone: ${pergunta}`);
  }
});

test('o lembrete por etapas tem prioridade sobre a notificação', () => {
  // A notificação é a conversa ANTIGA: a resposta é do lembrete.
  assert.match(app, /if \(pendingReminder && flow && flow\.step !== 'done'\)/);
  // E o lembrete é lido uma vez só (a variável é declarada antes do bloco).
  assert.equal(
    app.match(/const pendingReminder = pendingReminderRef\.current;/g)?.length,
    1,
  );
});

test('a pergunta do lembrete também liberta a mídia da notificação', () => {
  // Sem isto, a notificação ficava pendurada esperando "sim" por baixo da
  // conversa do lembrete.
  assert.match(
    app,
    /const pendingFlow = pendingNotificationRef\.current;[\s\S]*?await runNotificationActions\(\[\{ type: 'resume-media' \}\], pendingFlow\);/,
  );
});
