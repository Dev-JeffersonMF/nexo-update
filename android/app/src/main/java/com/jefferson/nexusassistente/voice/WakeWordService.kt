package com.jefferson.nexusassistente.voice

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import java.util.Locale
import kotlin.concurrent.thread

/**
 * Serviço de palavra-chave "nexo" para despertar o NEXO Assistente.
 *
 * Escuta continuamente em segundo plano pelas palavras "nexo", "nêxo", "néxo", "nexô".
 * Quando detectada:
 *  1. Para a escuta da palavra-chave
 *  2. Abre o microfone para o usuário falar o comando
 *  3. Emite evento `onWakeWordDetected` para o JS abrir o app e executar o comando
 *
 * Funciona com a tela bloqueada e o app em segundo plano (modo mascote).
 */
class WakeWordService(private val context: Context) {

    companion object {
        private const val TAG = "NEXO_WAKEWORD"
        const val ACTION_WAKE_WORD = "com.jefferson.nexusassistente.WAKE_WORD"
        const val ACTION_START_LISTENING = "com.jefferson.nexusassistente.START_WAKEWORD"
        const val ACTION_STOP_LISTENING = "com.jefferson.nexusassistente.STOP_WAKEWORD"
    }

    private var recognizer: SpeechRecognizer? = null
    private var isListening = false
    private var isProcessing = false
    private val mainHandler = Handler(Looper.getMainLooper())
    private var wakeWordCallback: (() -> Unit)? = null

    /** Palavras-chave aceitas para despertar o assistente. */
    private val WAKE_WORDS = listOf("nexo", "nêxo", "néxo", "nexô")

    /** Inicia a escuta contínua pelas palavras "nexo"/"nêxo"/"néxo"/"nexô". */
    fun startListening(callback: () -> Unit) {
        if (isListening) {
            wakeWordCallback = callback
            return
        }
        wakeWordCallback = callback

        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            Log.w(TAG, "SpeechRecognizer não disponível neste aparelho")
            return
        }

        try {
            recognizer = SpeechRecognizer.createSpeechRecognizer(context)
            recognizer?.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) {
                    Log.d(TAG, "Pronto para escutar a palavra-chave 'nexo'")
                }

                override fun onBeginningOfSpeech() {
                    Log.d(TAG, "Início da fala detectado")
                }

                override fun onRmsChanged(rmsdB: Float) {
                    // Monitora o volume do microfone (não usado para decisão)
                }

                override fun onBufferReceived(buffer: ByteArray?) {
                    // Não usado
                }

                override fun onEndOfSpeech() {
                    Log.d(TAG, "Fim da fala detectado")
                }

                override fun onError(error: Int) {
                    Log.w(TAG, "Erro no reconhecimento de fala: $error")
                    // Reinicia a escuta automaticamente após erro
                    if (isListening) {
                        mainHandler.postDelayed({ restartListening() }, 1000)
                    }
                }

                override fun onResults(results: Bundle?) {
                    if (!isListening || isProcessing) return
                    isProcessing = true

                    val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION) ?: return
                    for (match in matches) {
                        val lower = match.lowercase()
                        if (WAKE_WORDS.any { lower.contains(it) }) {
                            Log.d(TAG, "Palavra-chave detectada: $match")
                            isListening = false
                            stopListeningInternal()
                            mainHandler.post {
                                wakeWordCallback?.invoke()
                            }
                            return
                        }
                    }

                    // Não detectou palavra-chave: reinicia a escuta
                    isProcessing = false
                    if (isListening) {
                        mainHandler.postDelayed({ restartListening() }, 500)
                    }
                }

                override fun onPartialResults(results: Bundle?) {
                    // Verifica resultados parciais para detecção mais rápida
                    if (!isListening || isProcessing) return
                    val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION) ?: return
                    for (match in matches) {
                        val lower = match.lowercase()
                        if (WAKE_WORDS.any { lower.contains(it) }) {
                            Log.d(TAG, "Palavra-chave detectada (parcial): $match")
                            isListening = false
                            stopListeningInternal()
                            mainHandler.post {
                                wakeWordCallback?.invoke()
                            }
                            return
                        }
                    }
                }

                override fun onEvent(eventType: Int, params: Bundle?) {
                    // Não usado
                }
            })

            startListeningInternal()
            isListening = true
            Log.d(TAG, "Escuta pela palavra-chave 'nexo' iniciada")
        } catch (e: Exception) {
            Log.e(TAG, "Falha ao iniciar a escuta da palavra-chave", e)
        }
    }

    /** Para a escuta da palavra-chave. */
    fun stopListening() {
        isListening = false
        isProcessing = false
        stopListeningInternal()
        Log.d(TAG, "Escuta pela palavra-chave 'nexo' parada")
    }

    private fun startListeningInternal() {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale("pt", "BR"))
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 500)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1000)
        }
        recognizer?.startListening(intent)
    }

    private fun stopListeningInternal() {
        recognizer?.stopListening()
        recognizer?.cancel()
    }

    private fun restartListening() {
        if (!isListening) return
        stopListeningInternal()
        mainHandler.postDelayed({ startListeningInternal() }, 500)
    }

    /** Libera recursos. */
    fun destroy() {
        stopListening()
        recognizer?.destroy()
        recognizer = null
    }
}

/**
 * Instância singleton do serviço de palavra-chave.
 * Acessível de qualquer lugar no app.
 */
object WakeWordManager {
    @Volatile
    private var service: WakeWordService? = null

    fun init(context: Context): WakeWordService {
        return service ?: synchronized(this) {
            service ?: WakeWordService(context.applicationContext).also { service = it }
        }
    }

    fun getService(): WakeWordService? = service

    fun destroy() {
        service?.destroy()
        service = null
    }
}
