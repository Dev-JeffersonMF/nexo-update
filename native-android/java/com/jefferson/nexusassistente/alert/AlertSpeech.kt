package com.jefferson.nexusassistente.alert

import android.content.Context
import com.jefferson.nexusassistente.storage.ProfileStore
import com.jefferson.nexusassistente.storage.Reminder
import java.text.Normalizer

/**
 * A ÚNICA regra do que o Nexus fala quando um alarme ou um lembrete toca.
 *
 * ## O pedido do usuário (24/10/2026)
 *
 * Falar SOMENTE "nome do usuário + descrição" — nada de data, nada de hora,
 * nada de saudação. Exemplo: "Jefferson, trabalho.".
 *
 * ## A exceção "TRABALHO"
 *
 * Todo alarme ou lembrete criado com a palavra "trabalho" (ou "trabalhar")
 * tem a descrição SUBSTITUÍDA por uma frase motivacional curta do tema
 * trabalho. A fala vira "nome do usuário + frase motivacional". A frase é
 * sorteada do banco local [MotivationalPhrases] — o banco mora no aparelho
 * porque o alarme toca também sem internet.
 *
 * ## Uma regra, dois lugares
 *
 * A TELA do alerta e o texto da notificação/evento ([com.jefferson
 * .nexusassistente.reminder.ReminderReceiver]) saem DAQUI: duas cópias
 * desta lógica acabariam falando coisas diferentes para o mesmo lembrete.
 */
object AlertSpeech {

    /** O texto que substitui a descrição quando o assunto é trabalho. */
    const val WORK_TAG = "trabalho"

    /** A frase que este toque fala: "Jefferson, trabalho." */
    fun phraseFor(context: Context, reminder: Reminder): String {
        val name = ProfileStore(context).getFirstName()
        val what = if (isWorkSubject(reminder)) {
            MotivationalPhrases.nextWorkRandom(context)
        } else {
            reminder.description.ifEmpty { reminder.title }.ifEmpty { "seu lembrete" }
        }
        return compose(name, what)
    }

    /** "Jefferson, trabalho." — sem nome, só "Trabalho." */
    fun compose(name: String, what: String): String {
        val subject = what.trim()
        val who = name.trim()
        return when {
            who.isEmpty() && subject.isEmpty() -> "Seu lembrete."
            who.isEmpty() -> "$subject."
            subject.isEmpty() -> "$who, seu lembrete."
            else -> "$who, $subject."
        }
    }

    /**
     * O assunto do lembrete é TRABALHO?
     *
     * Vale a palavra em qualquer posição ("trabalho", "trabalhar", "hora do
     * trabalho"), sem acento e sem maiúscula — é o ditado que escreve.
     */
    fun isWorkSubject(reminder: Reminder): Boolean {
        val subject = fold(
            reminder.description.ifEmpty { reminder.title },
        )
        return subject.contains(WORK_TAG) || subject.contains("trabalhar")
    }

    /** Minúsculas e sem acento, para comparar o que o usuário ditou. */
    private fun fold(value: String): String =
        Normalizer.normalize(value, Normalizer.Form.NFD)
            .replace(Regex("\\p{Mn}+"), "")
            .lowercase()
}
