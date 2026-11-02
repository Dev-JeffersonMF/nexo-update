package com.jefferson.nexusassistente.service

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.jefferson.nexusassistente.MainActivity
import com.jefferson.nexusassistente.R
import com.jefferson.nexusassistente.native.NexusNativeModule
import com.jefferson.nexusassistente.voice.WakeWordService

/**
 * Serviço em primeiro plano que mantém o processo do Nexus vivo com a tela
 * apagada. A escuta de voz é controlada pelo JS (NexusNativeModule), então este
 * serviço cuida apenas da notificação permanente — assim dois
 * SpeechRecognizer não disputam o microfone.
 *
 * Desde o pedido do despertar por "nexo", ele também é quem mantém a escuta da
 * palavra-chave quando o app está no modo mascote (tela apagada/bloqueada).
 */
class NexusForegroundService : Service() {

    companion object {
        const val CHANNEL_ID = "NexusAssistantChannel"
        const val NOTIFICATION_ID = 1
        const val ACTION_START = "com.jefferson.nexusassistente.START_FOREGROUND"
        const val ACTION_STOP = "com.jefferson.nexusassistente.STOP_FOREGROUND"
        const val ACTION_START_WAKE = "com.jefferson.nexusassistente.START_WAKE"
        const val ACTION_STOP_WAKE = "com.jefferson.nexusassistente.STOP_WAKE"
        private const val TAG = "NEXUS_FG"
        private const val PREFS = "nexus_wake_word"
        private const val PREF_ENABLED = "enabled"
    }

    private var isRunning = false
    private var wakeWord: WakeWordService? = null
    private var wakeListening = false

    private val prefs by lazy { getSharedPreferences(PREFS, Context.MODE_PRIVATE) }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        Log.d(TAG, "Foreground service criado")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action ?: ACTION_START

        try {
            when (action) {
                ACTION_STOP -> stopNexusService()
                ACTION_START_WAKE -> {
                    startNexusService()
                    startWakeListening()
                }
                ACTION_STOP_WAKE -> stopWakeListening()
                else -> {
                    startNexusService()
                    // Processo recriado pelo Android (intent == null): se a escuta
                    // estava ligada, ela volta sozinha (a tela pode estar apagada).
                    // FIX: Também verifica se a ação foi START_WAKE mas o intent
                    // veio sem ação explícita (ex.: restart do sistema).
                    val shouldRestartWake = intent == null || intent.action == null
                    if (shouldRestartWake && prefs.getBoolean(PREF_ENABLED, false)) {
                        Log.d(TAG, "Processo recriado: reiniciando escuta da palavra-chave")
                        startWakeListening()
                    }
                }
            }
        } catch (e: Exception) {
            // Um serviço em primeiro plano nunca deve derrubar o aplicativo.
            Log.e(TAG, "Falha ao executar o serviço em primeiro plano", e)
            stopSelf()
        }

        return START_STICKY
    }

    private fun startNexusService() {
        if (isRunning) return

        val type = foregroundServiceType()
        try {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), type)
            isRunning = true
            Log.d(TAG, "NEXUS ativo em segundo plano (tipo=$type)")
        } catch (e: Exception) {
            Log.e(TAG, "startForeground falhou com o tipo $type", e)

            // Android 14+ recusa o tipo "microphone" sem RECORD_AUDIO liberado.
            if (type != ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK) {
                try {
                    ServiceCompat.startForeground(
                        this,
                        NOTIFICATION_ID,
                        buildNotification(),
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                    )
                    isRunning = true
                    Log.w(TAG, "NEXUS ativo sem o tipo microphone (permissão ausente)")
                    return
                } catch (inner: Exception) {
                    Log.e(TAG, "startForeground falhou também no modo mídia", inner)
                }
            }

            stopSelf()
        }
    }

    /** O tipo "microphone" só é usado quando o app realmente pode gravar. */
    private fun foregroundServiceType(): Int {
        val canRecord = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED

        return if (canRecord) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
        } else {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
        }
    }

    private fun stopNexusService() {
        stopWakeListening()
        isRunning = false
        try {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        } catch (e: Exception) {
            Log.w(TAG, "Falha ao remover a notificação do serviço", e)
        }
        stopSelf()
        Log.d(TAG, "NEXUS parado")
    }

    /**
     * Escuta contínua da palavra "nexo".
     *
     * O microfone fica com o serviço em primeiro plano (tipo `microphone`), que é
     * o que o Android exige para ouvir com a tela apagada/bloqueada. Quando a
     * palavra é detectada, a escuta para na hora — o microfone é liberado para o
     * comando — e o app é trazido para a frente, inclusive sobre a tela de
     * bloqueio.
     */
    private fun startWakeListening() {
        if (wakeListening) return
        prefs.edit().putBoolean(PREF_ENABLED, true).apply()
        wakeListening = true

        // Atualiza a notificação para o usuário saber que o microfone está ativo.
        try {
            ServiceCompat.startForeground(
                this,
                NOTIFICATION_ID,
                buildNotification(),
                foregroundServiceType(),
            )
        } catch (e: Exception) {
            Log.w(TAG, "Não consegui atualizar a notificação da palavra-chave", e)
        }

        wakeWord = WakeWordService(applicationContext).also { listener ->
            listener.startListening {
                Log.d(TAG, "Palavra-chave 'nexo' detectada")
                stopWakeListening()
                // Emite para o JS (quando o processo está vivo)...
                NexusNativeModule.emitEvent("onWakeWordDetected")
                // ...e traz a tela para a frente mesmo bloqueada.
                MainActivity.launchForWakeWord(this)
            }
        }
        Log.d(TAG, "Escuta da palavra 'nexo' iniciada (tela apagada OK)")
    }

    private fun stopWakeListening() {
        prefs.edit().putBoolean(PREF_ENABLED, false).apply()
        wakeListening = false
        try {
            wakeWord?.stopListening()
            wakeWord?.destroy()
        } catch (e: Exception) {
            Log.w(TAG, "Falha ao parar a palavra-chave", e)
        }
        wakeWord = null
        Log.d(TAG, "Escuta da palavra 'nexo' parada")
    }

    private fun buildNotification(): Notification {
        val stopIntent = Intent(this, NexusForegroundService::class.java).apply {
            action = ACTION_STOP
        }
        val stopPendingIntent = PendingIntent.getService(
            this, 0, stopIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        // Sem contentIntent de propósito: tocar na notificação reiniciava a
        // MainActivity com CLEAR_TASK e disparava o mascote, que podia derrubar
        // o processo. Esta notificação não abre mais nenhuma tela.
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("NEXUS")
            .setContentText(
                if (wakeListening) {
                    "Ouvindo \"nexo\" — fale para me acordar"
                } else {
                    "Serviço em segundo plano"
                }
            )
            .setSmallIcon(R.mipmap.ic_launcher)
            .addAction(R.mipmap.ic_launcher, "Parar", stopPendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "NEXUS Background Service",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Serviço de assistente de voz NEXUS em segundo plano"
                setShowBadge(false)
            }
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        stopWakeListening()
        isRunning = false
        try {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        } catch (e: Exception) {
            Log.w(TAG, "Falha ao remover a notificação ao destruir o serviço", e)
        }
        super.onDestroy()
        Log.d(TAG, "Foreground service destruído")
    }
}
