package com.jefferson.nexusassistente.reminder

import android.content.Context
import com.jefferson.nexusassistente.storage.Reminder
import com.jefferson.nexusassistente.storage.ReminderStore

/**
 * As duas decisões que o usuário toma quando um lembrete toca.
 *
 * Existe para a TELA ("Parar" / "Daqui a pouco") e o pedido por voz ("pausa o
 * lembrete") usarem exatamente a mesma regra — duas cópias da mesma lógica
 * acabariam divergindo.
 */
object ReminderActions {

    /** Os 5 minutos do botão "Daqui a pouco". */
    const val SNOOZE_MINUTES = 5

    /**
     * CONCLUIR: o toque de agora acabou.
     *
     * O lembrete de UMA vez só é apagado — a função dele já foi cumprida. O
     * DIÁRIO continua valendo para amanhã no mesmo horário: apagar seria o
     * mesmo que desligar o "todo dia às 6" que o usuário pediu.
     */
    fun complete(context: Context, reminder: Reminder) {
        val scheduler = ReminderScheduler(context)

        if (reminder.repeatDaily) {
            /*
             * O alarme de amanhã já está agendado (o receptor reagendou quando
             * este tocou). Cancelar o principal aqui apagaria o "todo dia às 6":
             * só o "daqui a pouco" pendente é que sai.
             */
            scheduler.cancelSnooze(reminder.id)
            return
        }

        scheduler.cancel(reminder.id)
        ReminderStore(context).delete(reminder.id)
    }

    /**
     * ADIAR: o mesmo lembrete toca de novo em [minutes] minutos.
     *
     * No DIÁRIO o horário de sempre fica intacto (o toque de agora é que é
     * adiado). No de uma vez só, o novo horário passa a ser o do lembrete — é o
     * que a lista mostra e o que o aparelho reagenda ao reiniciar.
     *
     * @return o lembrete como ficou, ou `null` se ele não existe mais.
     */
    fun snooze(context: Context, reminder: Reminder, minutes: Int = SNOOZE_MINUTES): Reminder? {
        val scheduler = ReminderScheduler(context)

        if (reminder.repeatDaily) {
            scheduler.snooze(reminder, minutes)
            return reminder
        }

        val at = System.currentTimeMillis() + minutes * 60_000L
        val updated = ReminderStore(context).update(
            reminder.id,
            triggerAtMillis = at,
            enabled = true,
        ) ?: return null

        scheduler.schedule(updated)
        return updated
    }
}
