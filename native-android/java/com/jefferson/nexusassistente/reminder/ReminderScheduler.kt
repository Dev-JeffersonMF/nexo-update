package com.jefferson.nexusassistente.reminder

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import com.jefferson.nexusassistente.MainActivity
import com.jefferson.nexusassistente.storage.Reminder
import com.jefferson.nexusassistente.storage.ReminderStore

/**
 * Quem realmente acorda o aparelho no horário do lembrete.
 *
 * Usa `setAlarmClock`, que é o único agendamento que o Android trata como
 * despertador de verdade: toca mesmo em Doze, mostra o ícone de alarme na barra
 * de status e é exatamente o que o usuário pediu ("me acorde às 6h").
 *
 * Sem a permissão de alarme exato (Android 12+, quando o usuário nunca abriu a
 * tela de permissão), o Nexus não desiste: agenda de forma aproximada e devolve
 * `false` para o JS poder avisar que o horário pode escorregar alguns minutos.
 */
class ReminderScheduler(private val context: Context) {

    private val alarms = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager

    /**
     * Agenda um lembrete.
     *
     * @return `true` quando o alarme é EXATO; `false` quando foi agendado de
     *         forma aproximada (ou quando não deu para agendar).
     */
    fun schedule(reminder: Reminder): Boolean {
        val manager = alarms ?: return false
        if (!reminder.enabled) return false

        val pending = pendingIntentFor(reminder)

        return try {
            if (canScheduleExact(manager)) {
                manager.setAlarmClock(
                    AlarmManager.AlarmClockInfo(reminder.triggerAtMillis, showIntent()),
                    pending,
                )
                true
            } else {
                manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, reminder.triggerAtMillis, pending)
                Log.w(TAG, "Alarme exato indisponível: agendei ${reminder.title} de forma aproximada")
                false
            }
        } catch (e: SecurityException) {
            // Acontece em Android 12 sem SCHEDULE_EXACT_ALARM liberado.
            Log.w(TAG, "Sem permissão de alarme exato, usando modo aproximado", e)
            try {
                manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, reminder.triggerAtMillis, pending)
            } catch (inner: Exception) {
                Log.e(TAG, "Não consegui agendar ${reminder.title}", inner)
            }
            false
        } catch (e: Exception) {
            Log.e(TAG, "Não consegui agendar ${reminder.title}", e)
            false
        }
    }

    /** Cancela o alarme principal E o "daqui a pouco" pendente. */
    fun cancel(id: String) {
        cancelMain(id)
        cancelSnooze(id)
    }

    /**
     * Cancela só o "daqui a pouco".
     *
     * É o que o botão "Parar" de um lembrete DIÁRIO precisa: o alarme de amanhã
     * já está agendado e tem de continuar valendo.
     */
    fun cancelSnooze(id: String) {
        cancelPending(snoozeRequestCodeFor(id))
    }

    private fun cancelMain(id: String) {
        cancelPending(requestCodeFor(id))
    }

    private fun cancelPending(requestCode: Int) {
        val manager = alarms ?: return
        val intent = Intent(context, ReminderReceiver::class.java).apply {
            action = ReminderReceiver.ACTION_FIRE
        }
        val pending = PendingIntent.getBroadcast(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_NO_CREATE,
        ) ?: return

        manager.cancel(pending)
        pending.cancel()
    }

    /**
     * Adia o PRÓXIMO toque em `minutes`, sem mexer no horário do lembrete.
     *
     * É o que mantém o "todo dia às 6" intacto quando o usuário aperta "Daqui a
     * pouco": o alarme de amanhã continua sendo às 6, e o toque de agora é
     * repetido daqui a 5 minutos quantas vezes ele quiser.
     *
     * @return `true` quando o adiamento ficou agendado.
     */
    fun snooze(reminder: Reminder, minutes: Int): Boolean {
        val manager = alarms ?: return false
        val at = System.currentTimeMillis() + minutes * 60_000L
        val pending = snoozePendingIntent(reminder.id, at)

        return try {
            if (canScheduleExact(manager)) {
                manager.setAlarmClock(AlarmManager.AlarmClockInfo(at, showIntent()), pending)
            } else {
                manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
            }
            true
        } catch (e: Exception) {
            Log.e(TAG, "Não consegui adiar ${reminder.title}", e)
            false
        }
    }

    /**
     * Agenda o PRÓXIMO disparo válido de um lembrete.
     *
     * Diário que já passou rola sozinho para o dia seguinte; de uma vez só que
     * já passou é desligado. Devolve o lembrete como ficou (ou `null` se ele
     * nem existe mais).
     */
    fun scheduleNext(reminder: Reminder, store: ReminderStore = ReminderStore(context)): Reminder? =
        scheduleNextExact(reminder, store).first

    /**
     * Igual a [scheduleNext], mas também diz se o alarme ficou EXATO.
     *
     * Sem isso o app não teria como saber que o Android só aceitou um alarme
     * aproximado — e acabaria prometendo um horário que pode escorregar.
     */
    fun scheduleNextExact(
        reminder: Reminder,
        store: ReminderStore = ReminderStore(context),
    ): Pair<Reminder?, Boolean> {
        if (!reminder.enabled) {
            cancel(reminder.id)
            return reminder to false
        }

        val next = nextTriggerAt(reminder, System.currentTimeMillis())
        if (next == null) {
            // Alarme de uma vez só que já passou: não faz sentido tocar agora.
            val expired = store.update(reminder.id, enabled = false)
            cancel(reminder.id)
            return expired to false
        }

        val updated = if (next != reminder.triggerAtMillis) {
            store.update(reminder.id, triggerAtMillis = next)
        } else {
            reminder
        }

        val exact = if (updated != null) schedule(updated) else false
        return updated to exact
    }

    /**
     * Reagenda tudo o que está ativo. Chamado quando o aparelho liga de novo: os
     * alarmes não sobrevivem a um reinício.
     */
    fun rescheduleAll(store: ReminderStore = ReminderStore(context)) {
        for (reminder in store.listEnabled()) {
            scheduleNext(reminder, store)
        }
    }

    private fun canScheduleExact(manager: AlarmManager): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.S || manager.canScheduleExactAlarms()

    private fun pendingIntentFor(reminder: Reminder): PendingIntent {
        val intent = Intent(context, ReminderReceiver::class.java).apply {
            action = ReminderReceiver.ACTION_FIRE
            putExtra(ReminderReceiver.EXTRA_ID, reminder.id)
        }
        return PendingIntent.getBroadcast(
            context,
            requestCodeFor(reminder.id),
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }

    /** Intent mostrada quando o usuário toca no ícone de alarme da barra. */
    private fun showIntent(): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        return PendingIntent.getActivity(
            context,
            0,
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }

    private fun requestCodeFor(id: String): Int = id.hashCode()

    /**
     * O alarme do "Daqui a pouco" é SEPARADO do alarme principal.
     *
     * O código do pedido é diferente, mas o efeito é o mesmo: o receptor toca o
     * lembrete de novo. Assim o horário guardado no lembrete não muda.
     */
    private fun snoozeRequestCodeFor(id: String): Int = id.hashCode() xor 0x5A5A

    private fun snoozePendingIntent(id: String, at: Long): PendingIntent {
        val intent = Intent(context, ReminderReceiver::class.java).apply {
            action = ReminderReceiver.ACTION_FIRE
            putExtra(ReminderReceiver.EXTRA_ID, id)
            /*
             * O instante do toque vai junto: é o horário que a TELA fala. Sem
             * isso o "daqui a pouco" mostraria o horário antigo do lembrete.
             */
            putExtra(ReminderReceiver.EXTRA_AT, at)
        }
        return PendingIntent.getBroadcast(
            context,
            snoozeRequestCodeFor(id),
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }

    companion object {
        private const val TAG = "NEXUS_REMINDER"

        /**
         * Próximo disparo de um lembrete a partir de `now`.
         *
         * `null` quando é um lembrete de uma vez só que já passou.
         */
        fun nextTriggerAt(reminder: Reminder, now: Long): Long? {
            if (reminder.triggerAtMillis > now) return reminder.triggerAtMillis
            if (!reminder.repeatDaily) return null

            // Soma dia a dia no calendário (e não 24h fixas) para o horário
            // continuar sendo o mesmo se o fuso mudar.
            val calendar = java.util.Calendar.getInstance().apply {
                timeInMillis = reminder.triggerAtMillis
            }
            var guard = 0
            while (calendar.timeInMillis <= now && guard < 400) {
                calendar.add(java.util.Calendar.DAY_OF_YEAR, 1)
                guard += 1
            }
            return calendar.timeInMillis
        }
    }
}
