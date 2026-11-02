package com.jefferson.nexusassistente.reminder

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Reagenda os lembretes quando o aparelho reinicia.
 *
 * O Android apaga todos os alarmes no desligamento. Sem este receptor, um
 * despertador criado na véspera simplesmente não tocaria depois de o celular
 * reiniciar — que é justamente quando ele mais importa.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        val relevant = action == Intent.ACTION_BOOT_COMPLETED ||
            action == Intent.ACTION_LOCKED_BOOT_COMPLETED ||
            action == Intent.ACTION_MY_PACKAGE_REPLACED ||
            action == "android.intent.action.QUICKBOOT_POWERON"

        if (!relevant) return

        try {
            ReminderScheduler(context.applicationContext).rescheduleAll()
        } catch (e: Exception) {
            // Um erro aqui não pode impedir o aparelho de terminar de ligar.
            Log.w(TAG, "Falha ao reagendar os lembretes", e)
        }
    }

    companion object {
        private const val TAG = "NEXUS_REMINDER"
    }
}
