package com.jefferson.nexusassistente.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.jefferson.nexusassistente.native.NexusNativeModule

/**
 * Recebe o toque nos dois telefones da notificação de chamada do Nexus.
 *
 * Verde = atender, vermelho = recusar/desligar. O caminho de cada um depende da
 * origem da chamada (WhatsApp ou telefone). O resultado é devolvido ao JS para
 * o Nexus poder falar a verdade sobre o que aconteceu, quando estiver vivo.
 */
class NexusCallActionReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        val answer = action == NexusCallNotification.ACTION_ANSWER
        val source = intent.getStringExtra(NexusCallNotification.EXTRA_SOURCE)
            ?: NexusCallNotification.source

        val success = try {
            if (source == "phone") {
                if (answer) NexusPhoneCallManager.answer(context)
                else NexusPhoneCallManager.decline(context)
            } else {
                if (answer) NexusNotificationListenerService.answerRingingCall()
                else NexusNotificationListenerService.declineRingingCall()
            }
        } catch (e: Exception) {
            Log.w(TAG, "Falha na ação da chamada ($source): ${e.message}")
            false
        }

        Log.d(
            TAG,
            "Ação ${if (answer) "atender" else "recusar"} ($source): " +
                if (success) "ok" else "indisponível",
        )

        if (success) {
            NexusCallNotification.dismiss(context)
        }

        // A interface pode estar viva (mascote): ela encerra a pergunta falada
        // "quer atender?" e não repete o anúncio.
        NexusNativeModule.emitEvent(
            "onCallActionTaken",
            mapOf(
                "action" to if (answer) "answer" else "decline",
                "source" to source,
                "success" to success,
            ),
        )
    }

    private companion object {
        const val TAG = "NEXUS_CALL_ACTION"
    }
}
