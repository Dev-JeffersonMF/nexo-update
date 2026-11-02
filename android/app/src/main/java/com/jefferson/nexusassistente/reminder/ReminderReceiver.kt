package com.jefferson.nexusassistente.reminder

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import com.jefferson.nexusassistente.R
import com.jefferson.nexusassistente.alert.AlarmeActivity
import com.jefferson.nexusassistente.alert.AlertActivityBase
import com.jefferson.nexusassistente.alert.AlertSpeech
import com.jefferson.nexusassistente.alert.LembreteActivity
import com.jefferson.nexusassistente.native.NexusNativeModule
import com.jefferson.nexusassistente.storage.Reminder
import com.jefferson.nexusassistente.storage.ReminderStore

/**
 * Quem toca o lembrete na hora marcada.
 *
 * Faz três coisas, nesta ordem:
 *
 *  1. mostra a notificação de categoria ALARME, com FULL-SCREEN INTENT — é o
 *     caminho oficial do Android para abrir uma tela em cima da tela de
 *     bloqueio (um `startActivity` comum vindo de um receptor é bloqueado
 *     desde o Android 10);
 *  2. abre a TELA do lembrete ou do alarme, com o mascote falando;
 *  3. avisa o JS (para o app registrar na conversa, quando estiver aberto).
 *
 * Quem fala é a TELA, não o receptor: duas vozes ao mesmo tempo atrapalhariam o
 * usuário. Quando o lembrete é diário, ele é reagendado para o dia seguinte; o
 * de uma vez só fica esperando a decisão da tela ("Parar" conclui, "Daqui a
 * pouco" adia em 5 minutos).
 */
class ReminderReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_FIRE) return
        val id = intent.getStringExtra(EXTRA_ID) ?: return

        val appContext = context.applicationContext
        val reminder = ReminderStore(appContext).get(id) ?: return

        /*
         * O instante deste toque. No alarme principal é o horário guardado no
         * lembrete; no "daqui a pouco" vem junto no Intent. A tela fala ESTE
         * horário — nunca o de amanhã, que o diário já reagendou.
         */
        val fireAt = intent.getLongExtra(EXTRA_AT, reminder.triggerAtMillis)

        val speech = buildSpeech(appContext, reminder)

        notifyUser(appContext, reminder, speech, fireAt)
        NexusNativeModule.emitEvent(
            "onReminderFired",
            mapOf("id" to reminder.id, "text" to speech, "title" to reminder.title),
        )

        openAlertScreen(appContext, reminder, fireAt)

        /*
         * O lembrete DIÁRIO se reagenda para o dia seguinte (é o "todo dia às
         * 6"). O de uma vez só fica esperando a decisão da tela.
         */
        if (reminder.repeatDaily) {
            val next = ReminderScheduler.nextTriggerAt(reminder, System.currentTimeMillis())
            val updated = if (next != null) {
                ReminderStore(appContext).update(reminder.id, triggerAtMillis = next)
            } else {
                null
            }
            if (updated != null) ReminderScheduler(appContext).schedule(updated)
        }
    }

    // ------------------------------------------------------------------
    // A tela
    // ------------------------------------------------------------------

    /**
     * Abre a tela do lembrete (ou do alarme) em cima de tudo.
     *
     * `NEW_TASK` porque o receptor não é uma Activity. O `try` existe porque o
     * Android 10+ pode recusar a abertura em segundo plano; nesse caso a
     * notificação (com full-screen intent) é quem chama a tela.
     */
    private fun openAlertScreen(context: Context, reminder: Reminder, fireAt: Long) {
        try {
            context.startActivity(alertIntent(context, reminder, fireAt))
        } catch (error: Exception) {
            Log.w(TAG, "Não consegui abrir a tela do lembrete: ${error.message}")
        }
    }

    /** O Intent da tela certa: LEMBRETE ou ALARME. */
    private fun alertIntent(context: Context, reminder: Reminder, fireAt: Long): Intent {
        val target = if (reminder.isAlarm) AlarmeActivity::class.java else LembreteActivity::class.java
        return Intent(context, target).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_CLEAR_TOP or
                Intent.FLAG_ACTIVITY_NO_ANIMATION
            putExtra(AlertActivityBase.EXTRA_ID, reminder.id)
            putExtra(AlertActivityBase.EXTRA_AT, fireAt)
        }
    }

    // ------------------------------------------------------------------
    // Fala (usada no texto da notificação e no evento para o app)
    // ------------------------------------------------------------------

    /*
     * A MESMA frase da tela (AlertSpeech): "Jefferson, trabalho." — só nome e
     * descrição (ou a frase motivacional, no "trabalho"). Duas regras
     * diferentes fariam a notificação dizer uma coisa e a tela falar outra.
     */
    private fun buildSpeech(context: Context, reminder: Reminder): String =
        AlertSpeech.phraseFor(context, reminder)

    // ------------------------------------------------------------------
    // Notificação
    // ------------------------------------------------------------------

    private fun notifyUser(context: Context, reminder: Reminder, speech: String, fireAt: Long) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
        ensureChannel(manager)

        val open = alertIntent(context, reminder, fireAt)
        val pending = PendingIntent.getActivity(
            context,
            reminder.id.hashCode(),
            open,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle(reminder.title.ifEmpty { "Lembrete do Nexus" })
            .setContentText(speech)
            .setStyle(NotificationCompat.BigTextStyle().bigText(speech))
            .setSmallIcon(R.mipmap.ic_launcher)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            /*
             * FULL-SCREEN INTENT: é o que o Android aceita para abrir a tela
             * com o aparelho bloqueado. A notificação fica na tela (ongoing) até
             * o usuário decidir no botão "Parar" ou "Daqui a pouco".
             */
            .setFullScreenIntent(pending, true)
            .setContentIntent(pending)
            .setOngoing(true)
            .setAutoCancel(false)
            .build()

        try {
            manager.notify(notificationId(reminder.id), notification)
        } catch (error: Exception) {
            Log.w(TAG, "Não consegui mostrar a notificação do lembrete", error)
        }
    }

    private fun ensureChannel(manager: NotificationManager) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return

        val channel = NotificationChannel(
            CHANNEL_ID,
            "Lembretes do Nexus",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "Avisos dos lembretes e do despertador criados pelo Nexus"
            enableVibration(true)
        }
        manager.createNotificationChannel(channel)
    }

    companion object {
        private const val TAG = "NEXUS_REMINDER"

        const val ACTION_FIRE = "com.jefferson.nexusassistente.REMINDER_FIRE"
        const val EXTRA_ID = "reminder_id"

        /** O instante DESTE toque (o "daqui a pouco" acontece em outro horário). */
        const val EXTRA_AT = "reminder_at"

        private const val CHANNEL_ID = "NexusReminders"
        private const val NOTIFICATION_BASE = 4200

        /** O mesmo id usado para mostrar e para cancelar a notificação. */
        fun notificationId(id: String): Int = NOTIFICATION_BASE + (id.hashCode() and 0xffff)
    }
}
