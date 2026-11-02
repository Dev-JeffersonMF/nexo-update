package com.jefferson.nexusassistente.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.jefferson.nexusassistente.R

/**
 * Notificação própria do Nexus para uma chamada recebida.
 *
 * O usuário pediu dois telefones na própria notificação: um VERDE para atender
 * e um VERMELHO para desligar/recusar. As ações disparam
 * [NexusCallActionReceiver], que atende/recusa pelo caminho oficial:
 *
 *  - WhatsApp: dispara o PendingIntent "Atender"/"Recusar" da notificação da
 *    chamada (funciona mesmo com a tela bloqueada).
 *  - Telefone: usa o TelecomManager (permissão ANSWER_PHONE_CALLS).
 *
 * A notificação é silenciosa de propósito: quem toca é o app de chamada; o
 * Nexus só oferece os dois botões e o nome de quem está ligando.
 */
object NexusCallNotification {

    private const val TAG = "NEXUS_CALL_NOTIF"

    const val CHANNEL_ID = "NexusCallChannel"
    const val NOTIFICATION_ID = 42

    const val ACTION_ANSWER = "com.jefferson.nexusassistente.CALL_ANSWER"
    const val ACTION_DECLINE = "com.jefferson.nexusassistente.CALL_DECLINE"
    const val EXTRA_SOURCE = "call_source"

    /** `whatsapp` ou `phone`: quem está tocando agora. */
    @Volatile
    var source: String = "whatsapp"
        private set

    /** `true` enquanto a notificação de chamada está na tela. */
    @Volatile
    var ringing: Boolean = false
        private set

    /**
     * Mostra (ou atualiza) a notificação da chamada.
     *
     * @param contact nome do contato já resolvido (o nome salvo no aparelho,
     *   quando a chamada é telefônica).
     * @param kind "Chamada de voz" ou "Chamada de vídeo".
     * @param callSource `whatsapp` ou `phone`.
     * @param contentIntent abre a tela da chamada ao tocar no corpo da notificação.
     */
    fun show(
        context: Context,
        contact: String,
        kind: String,
        callSource: String,
        contentIntent: PendingIntent? = null,
    ) {
        source = callSource
        ringing = true
        createChannel(context)

        val answerIntent = PendingIntent.getBroadcast(
            context,
            1,
            Intent(context, NexusCallActionReceiver::class.java).apply {
                action = ACTION_ANSWER
                putExtra(EXTRA_SOURCE, callSource)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val declineIntent = PendingIntent.getBroadcast(
            context,
            2,
            Intent(context, NexusCallActionReceiver::class.java).apply {
                action = ACTION_DECLINE
                putExtra(EXTRA_SOURCE, callSource)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(contact.ifBlank { "Chamada recebida" })
            .setContentText("$kind — atender ou recusar")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setSilent(true)
            // Os dois telefones pedidos: verde atende, vermelho recusa.
            .addAction(R.drawable.ic_call_green, "🟢 Atender", answerIntent)
            .addAction(R.drawable.ic_call_red, "🔴 Recusar", declineIntent)

        if (contentIntent != null) builder.setContentIntent(contentIntent)

        try {
            NotificationManagerCompat.from(context)
                .notify(NOTIFICATION_ID, builder.build())
            Log.d(TAG, "Chamada de \"$contact\" ($callSource) notificada")
        } catch (e: SecurityException) {
            Log.w(TAG, "Sem permissão para notificar a chamada: ${e.message}")
        } catch (e: Exception) {
            Log.w(TAG, "Falha ao notificar a chamada: ${e.message}")
        }
    }

    /** Remove a notificação quando a chamada foi atendida, recusada ou caiu. */
    fun dismiss(context: Context) {
        ringing = false
        try {
            NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
        } catch (e: Exception) {
            Log.w(TAG, "Falha ao remover a notificação da chamada: ${e.message}")
        }
    }

    private fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Chamadas recebidas",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "Mostra quem está ligando e os botões verde (atender) e vermelho (recusar)"
            setSound(null, null)
            enableVibration(false)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }
        manager.createNotificationChannel(channel)
    }
}
