package com.jefferson.nexusassistente.media

import android.content.Context
import android.app.ActivityManager
import android.media.AudioManager
import android.os.SystemClock
import android.util.Log
import android.view.KeyEvent

/**
 * Controle da música que está tocando em OUTRO aplicativo (OiTube, YouTube...).
 *
 * O Nexus não tem como dar ordem direta para o player de outro app. O caminho que
 * o Android reserva para fones de ouvido e controles são os EVENTOS DE MÍDIA: eles
 * chegam na sessão de mídia ativa, então funcionam mesmo com o aplicativo em
 * segundo plano — que é justamente o caso quando o usuário fala com o mascote
 * ("pausa a música", "pula", "volta").
 *
 * Para não mentir, cada comando de play/pause é conferido no áudio do aparelho
 * ([isMusicActive]): o Nexus só confirma que pausou quando o áudio realmente para.
 */
class MediaKeysController(private val context: Context) {

    companion object {
        private const val TAG = "NEXUS_MEDIAKEY"

        /** Tempo máximo esperando o áudio do aparelho responder ao comando. */
        private const val CONFIRM_TIMEOUT_MS = 2500L

        /** Intervalo entre as conferências do áudio. */
        private const val CONFIRM_STEP_MS = 100L

        /** Nome amigável do app de mídia, para o Nexus dizer onde mexeu. */
        fun appNameFor(packageName: String?): String? = when (packageName) {
            "com.google.android.youtube" -> "YouTube"
            "com.skipads.oitube.official" -> "OiTube"
            else -> null
        }

        /** Pacote do app de música pelo nome que o Nexus usa nas respostas. */
        fun packageFor(appName: String?): String? = when (appName) {
            "YouTube" -> "com.google.android.youtube"
            "OiTube" -> "com.skipads.oitube.official"
            else -> null
        }
    }

    private val audioManager =
        context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

    /**
     * Último app de mídia em que o Nexus mexeu (música aberta ou player pausado).
     *
     * Serve para "parar a música" saber QUAL aplicativo fechar quando o player
     * está em segundo plano: nesse momento o app da frente é o próprio Nexus, mas
     * o usuário quer que o player saia de cena.
     */
    @Volatile
    var lastMediaPackage: String? = null

    /** `true` quando algum aplicativo está tocando áudio agora. */
    fun isMusicActive(): Boolean = audioManager?.isMusicActive == true

    /** Manda um evento de mídia (play/pause/próxima/anterior) para a sessão ativa. */
    fun send(keyCode: Int): Boolean {
        val manager = audioManager ?: return false
        return try {
            manager.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, keyCode))
            manager.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, keyCode))
            Log.d(TAG, "Evento de mídia enviado: ${KeyEvent.keyCodeToString(keyCode)}")
            true
        } catch (e: Exception) {
            Log.w(TAG, "Falha ao enviar evento de mídia: ${e.message}")
            false
        }
    }

    /**
     * Manda o comando e confirma olhando o áudio do aparelho.
     *
     * @param expectPlaying como o áudio deve ficar: `false` para pausar/parar,
     *   `true` para voltar a tocar.
     * @return `true` só quando o áudio do aparelho mudou como pedido.
     */
    fun sendAndConfirm(keyCode: Int, expectPlaying: Boolean): Boolean {
        if (!send(keyCode)) return false

        val deadline = SystemClock.elapsedRealtime() + CONFIRM_TIMEOUT_MS
        while (SystemClock.elapsedRealtime() < deadline) {
            if (isMusicActive() == expectPlaying) return true
            try {
                Thread.sleep(CONFIRM_STEP_MS)
            } catch (_: InterruptedException) {
                return false
            }
        }

        Log.w(TAG, "O áudio do aparelho não mudou como pedido")
        return false
    }

    /**
     * Fecha o aplicativo de música depois de parar a reprodução.
     *
     * Para o usuário, "parar a música" também significa sair do player: o Nexus
     * manda o evento de parada e depois limpa o app que estava tocando. Não existe
     * API para encerrar a atividade de outro aplicativo à força, então o caminho é
     * encerrar os processos dele — se o player estiver na frente, o serviço de
     * acessibilidade volta uma tela antes (o app sai de cena e fica encerrável).
     *
     * @return `true` quando havia um aplicativo para fechar e a ordem foi aceita.
     */
    fun closeApp(packageName: String?): Boolean {
        val target = packageName ?: return false
        val activityManager =
            context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return false
        return try {
            activityManager.killBackgroundProcesses(target)
            if (target == lastMediaPackage) lastMediaPackage = null
            Log.d(TAG, "Aplicativo de mídia encerrado: $target")
            true
        } catch (e: Exception) {
            Log.w(TAG, "Falha ao encerrar $target: ${e.message}")
            false
        }
    }
}
