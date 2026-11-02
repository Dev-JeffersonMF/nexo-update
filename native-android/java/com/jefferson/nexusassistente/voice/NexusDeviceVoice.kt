package com.jefferson.nexusassistente.voice

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import android.util.Log
import java.util.ArrayDeque
import java.util.Locale

/**
 * A voz do Nexus: a **melhor voz em português do Brasil que o aparelho tem**.
 *
 * ## Por que esta classe existe
 *
 * O `TextToSpeech` do Android, sem mais nada, usa a voz **padrão** do motor
 * instalado. No Google TTS (o motor que quase todo aparelho Android tem) essa
 * padrão é a `pt-BR-language-standard` — a que soa robótica, com sotaque de
 * locutor antigo. O `expo-speech` não resolve isso: ele não deixa escolher a
 * voz no Android (o `voiceId` dele é só de iOS).
 *
 * Aqui a voz é **escolhida**, e não herdada:
 *
 *  1. **Local** (já baixada no aparelho): responde na hora e funciona sem
 *     internet — o Nexus fala offline, como deve ser.
 *  2. Entre as locais, a **neural** (Wavenet/Enhanced) e a de **nome
 *     feminino** conhecido do Google em português (Cacilda, Katita, Maria,
 *     Yara, Athina, Luciana): é o que tira o "sotaque de robô".
 *  3. Sem voz local, a melhor voz **de rede** do mesmo jeito (Wavenet >
 *     Enhanced > standard).
 *  4. Sem nenhuma voz em português, a voz padrão do motor — o Nexus ainda
 *     fala, nunca fica mudo.
 *
 * O timbre ainda é acertado no ponto: a altura sobe um pouco (1,06) para
 * deixar a voz feminina e a velocidade desce um pouco (0,95) para a fala
 * soar natural, sem a cadência de quem lê um texto.
 *
 * ## A ordem das vozes no app
 *
 * 1. **Esta classe** (a voz do aparelho, com a melhor voz pt-BR escolhida).
 * 2. `expo-speech` — o caminho genérico, usado quando esta classe não está
 *    disponível (build sem o código nativo) ou falha.
 * 3. O texto na tela — o Nexus nunca some da conversa.
 *
 * ## Promessa
 *
 * Nenhuma chamada trava: [speak] sempre responde (`true` = falou até o fim,
 * `false` = não conseguiu) e tem teto de tempo. O Nexus prefere calar a
 * prometer que falou.
 */
class NexusDeviceVoice(private val context: Context) {

    companion object {
        private const val TAG = "NEXUS_VOICE"

        /** Identificador da fala (o Android devolve o progresso por ele). */
        private const val UTTERANCE_ID = "nexus-voice"

        /**
         * Teto da fala (ms).
         *
         * O `TextToSpeech` nem sempre avisa que terminou (o motor do aparelho
         * morre, o áudio é cortado pelo sistema). Sem este teto a promessa
         * ficaria pendurada e o microfone do Nexus nunca voltaria.
         */
        private const val SPEECH_TIMEOUT_MS = 90_000L

        /** Espera máxima pelo motor ficar pronto (ms). */
        private const val INIT_TIMEOUT_MS = 10_000L

        /**
         * Altura da voz.
         *
         * Um pouco acima de 1: a voz fica mais aguda e, portanto, feminina.
         * 1.12 para voz de mulher jovem (~18 anos).
         */
        private const val PITCH = 1.12f

        /**
         * Velocidade da fala.
         *
         * Um pouco abaixo de 1: a cadência fica humana (quem lê um texto
         * engolindo as sílabas é o que soa robótico).
         * 0.92 para fala mais suave e natural.
         */
        private const val RATE = 0.92f

        /**
         * Nomes das vozes femininas do Google em português do Brasil.
         *
         * O Android não expõe o gênero da voz — só o nome. Estes são os nomes
         * que o Google dá às vozes neurais em português do Brasil, e todas são
         * femininas. As "Wavenet" do pt-BR (A, B, C) também são femininas, mas
         * não trazem o nome da pessoa — daí a lista ser só um dos critérios.
         *
         * Prioridade para vozes que soam mais jovens e suaves.
         */
        private val FEMININE_PT_BR = listOf(
            "cacilda",      // Voz neural mais popular, soa jovem
            "katita",       // Voz neural, tom suave
            "maria",        // Voz neural, clássica
            "yara",         // Voz neural, tom jovem
            "athina",       // Voz neural
            "luciana",      // Voz neural
            "fernanda",     // Voz neural
            "bianca",       // Voz neural, tom jovem
            "helena",       // Voz neural
            "alice",        // Voz neural, soa jovem
            "laura",        // Voz neural, tom suave
            "sofia",        // Voz neural, soa jovem
            "isabela",      // Voz neural
            "valentina",    // Voz neural
            "camila",       // Voz neural
        )
    }

    private val mainHandler = Handler(Looper.getMainLooper())

    private var engine: TextToSpeech? = null
    private var ready = false
    private var failed = false

    /** A voz escolhida (a melhor pt-BR disponível). */
    private var chosen: Voice? = null

    /** Falas pedidas antes do motor ficar pronto. */
    private val waiting = ArrayDeque<Pair<String, (Boolean) -> Unit>>()

    /** Fala em andamento (o callback é chamado uma vez, no fim). */
    private var current: ((Boolean) -> Unit)? = null

    /** Timeout da fala em andamento (nulo quando não há fala). */
    private var speechTimeout: Runnable? = null

    init {
        /*
         * O `TextToSpeech` nasce e é usado sempre na thread principal.
         *
         * O módulo nativo é criado na thread de módulos do React Native, e o
         * Android exige que o motor de voz seja criado e usado na MESMA thread
         * (a que tem o Looper). Criar aqui e falar de lá é o caminho que dá
         * "CalledFromWrongThreadException".
         */
        mainHandler.post { start() }
    }

    /**
     * Liga o motor de voz do aparelho.
     *
     * O `TextToSpeech` do Android é assíncrono: ele avisa depois, no callback
     * de inicialização. Quem pede a fala antes disso fica na fila.
     */
    private fun start() {
        try {
            engine = TextToSpeech(context.applicationContext) { status ->
                mainHandler.post {
                    if (status != TextToSpeech.SUCCESS) {
                        failed = true
                        ready = false
                        Log.w(TAG, "TTS do aparelho indisponivel: a voz do Nexus esta desligada")
                        flushWaiting(false)
                        return@post
                    }

                    try {
                        engine?.language = Locale("pt", "BR")
                        engine?.setPitch(PITCH)
                        engine?.setSpeechRate(RATE)

                        val voice = selectVoice(engine)
                        chosen = voice
                        if (voice != null) {
                            engine?.voice = voice
                            Log.i(TAG, "Voz do Nexus: ${voice.name} (${voice.locale})")
                        } else {
                            Log.w(TAG, "Nenhuma voz em portugues encontrada: usando a padrao do motor")
                        }
                        engine?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                            override fun onStart(utteranceId: String?) = Unit

                            override fun onDone(utteranceId: String?) {
                                mainHandler.post { finish(true) }
                            }

                            @Deprecated("Mantido porque ainda e o callback abstrato da classe")
                            override fun onError(utteranceId: String?) {
                                mainHandler.post { finish(false) }
                            }

                            override fun onError(utteranceId: String?, errorCode: Int) {
                                mainHandler.post { finish(false) }
                            }
                        })
                        ready = true
                        failed = false
                    } catch (error: Throwable) {
                        failed = true
                        ready = false
                        Log.w(TAG, "Falha ao configurar o TTS do aparelho: ${error.message}")
                        flushWaiting(false)
                        return@post
                    }

                    flushWaiting(true)
                }
            }
        } catch (error: Throwable) {
            failed = true
            Log.w(TAG, "Nao consegui iniciar o TTS do aparelho: ${error.message}")
            flushWaiting(false)
        }
    }

    /**
     * Escolhe a melhor voz em português do Brasil que o aparelho tem.
     *
     * A ordem é: local > neural > nome feminino > qualidade. A voz padrão do
     * motor (a que soa robótica) é a última da lista.
     */
    private fun selectVoice(engine: TextToSpeech?): Voice? {
        val current = engine ?: return null
        val all = try {
            current.voices
        } catch (error: Throwable) {
            Log.w(TAG, "Nao consegui listar as vozes do motor: ${error.message}")
            return null
        }

        val portuguese = all.filter {
            it.locale.language.equals("pt", ignoreCase = true)
        }
        if (portuguese.isEmpty()) return null

        // O Brasil vem primeiro: o Nexus fala português do Brasil.
        val br = portuguese.filter {
            it.locale.country.equals("BR", ignoreCase = true)
        }
        val pool = if (br.isNotEmpty()) br else portuguese

        return pool.maxByOrNull { score(it) }
    }

    /**
     * Nota de uma voz: quanto maior, melhor.
     *
     * O critério que mais importa é **local**: a voz já baixada no aparelho
     * responde na hora e funciona sem internet. Depois vem a qualidade da
     * síntese (neural) e o gênero (pelo nome que o Google dá).
     *
     * Prioridade forte para vozes neurais femininas que soam jovens e suaves.
     */
    private fun score(voice: Voice): Int {
        val name = voice.name.lowercase()
        var points = 0

        // 1. Já está no aparelho: resposta imediata e sem internet.
        if (!voice.isNetworkConnectionRequired) points += 1000

        // 2. Síntese neural: é o que tira o "sotaque de robô".
        if (name.contains("wavenet")) points += 500
        if (name.contains("neural")) points += 500
        if (name.contains("enhanced")) points += 400

        // 3. Voz feminina conhecida do Google em português do Brasil - prioridade ALTA.
        if (FEMININE_PT_BR.any { name.contains(it) }) points += 800

        // 4. Qualidade declarada pelo motor.
        when (voice.quality) {
            Voice.QUALITY_VERY_HIGH -> points += 200
            Voice.QUALITY_HIGH -> points += 150
            else -> points += 50
        }

        // 5. A voz padrão do Google é a mais robótica: ela perde muito.
        if (name.contains("language-standard")) points -= 1000

        return points
    }

    /**
     * Fala o texto com a voz escolhida.
     *
     * Chamar de fora da thread principal. [onDone] vem SEMPRE: `true` quando a
     * fala terminou, `false` quando não deu para falar.
     */
    fun speak(text: String, onDone: (Boolean) -> Unit) {
        val spoken = text.trim()
        if (spoken.isEmpty()) {
            onDone(false)
            return
        }

        mainHandler.post {
            stopCurrent()

            if (!ready) {
                // O motor ainda não respondeu (ou falhou): a fala espera na fila.
                if (failed) {
                    onDone(false)
                    return@post
                }
                waiting.addLast(spoken to onDone)
                scheduleInitTimeout()
                return@post
            }

            if (!utter(spoken)) {
                onDone(false)
                return@post
            }

            current = onDone
            scheduleSpeechTimeout()
        }
    }

    /**
     * Interrompe a fala em andamento.
     *
     * O callback pendente é chamado com `false`: quem chamou precisa saber que
     * a fala NÃO terminou (para devolver o microfone), mesmo interrompida.
     */
    fun stop() {
        mainHandler.post { stopCurrent() }
    }

    /** Libera o motor do aparelho. */
    fun release() {
        mainHandler.post {
            stopCurrent()
            waiting.clear()
            try {
                engine?.stop()
                engine?.shutdown()
            } catch (_: Throwable) {
                // Desligar o TTS nunca pode derrubar nada.
            }
            engine = null
            ready = false
        }
    }

    /** `true` quando o motor do aparelho já está pronto para falar. */
    fun isReady(): Boolean = ready

    /** O nome da voz escolhida (para o app mostrar e para o logcat). */
    fun chosenVoiceName(): String? = chosen?.name

    /** As vozes em português do Brasil que o aparelho tem. */
    fun portugueseVoices(): List<Voice> {
        val all = try {
            engine?.voices ?: return emptyList()
        } catch (_: Throwable) {
            return emptyList()
        }
        return all
            .filter { it.locale.language.equals("pt", ignoreCase = true) }
            .sortedByDescending { score(it) }
    }

    // -----------------------------------------------------------------
    // Internos
    // -----------------------------------------------------------------

    /** Manda o texto para o motor. `false` quando o motor recusou. */
    private fun utter(text: String): Boolean {
        return try {
            engine?.speak(text, TextToSpeech.QUEUE_FLUSH, null, UTTERANCE_ID) == TextToSpeech.SUCCESS
        } catch (error: Throwable) {
            Log.w(TAG, "Falha ao falar: ${error.message}")
            false
        }
    }

    /**
     * Interrompe a fala em andamento.
     *
     * O callback pendente é chamado com `false`: quem pediu precisa saber que
     * a fala NÃO terminou (para devolver o microfone), mesmo interrompida.
     */
    private fun stopCurrent() {
        speechTimeout?.let { mainHandler.removeCallbacks(it) }
        speechTimeout = null

        val pending = current
        current = null

        try {
            engine?.stop()
        } catch (_: Throwable) {
            // O motor pode já ter terminado a fala.
        }

        // A fala foi interrompida: quem pediu precisa saber que ela NAO terminou.
        pending?.invoke(false)
    }

    /** Resolve a fala em andamento (o `onDone`/`onError` do Android). */
    private fun finish(success: Boolean) {
        speechTimeout?.let { mainHandler.removeCallbacks(it) }
        speechTimeout = null

        val pending = current
        current = null
        pending?.invoke(success)
    }

    /** Teto do motor: se ele não responder, a fila é esvaziada com `false`. */
    private fun scheduleInitTimeout() {
        mainHandler.postDelayed({
            if (ready) return@postDelayed
            failed = true
            flushWaiting(false)
        }, INIT_TIMEOUT_MS)
    }

    /** Teto da fala: sem o `onDone` do Android, a promessa não fica pendurada. */
    private fun scheduleSpeechTimeout() {
        speechTimeout = Runnable { finish(false) }
        mainHandler.postDelayed(speechTimeout!!, SPEECH_TIMEOUT_MS)
    }

    /** Esvazia a fila das falas que esperavam o motor ficar pronto. */
    private fun flushWaiting(success: Boolean) {
        while (waiting.isNotEmpty()) {
            val (text, callback) = waiting.removeFirst()
            if (!success || !utter(text)) {
                callback(false)
                continue
            }
            current = callback
            scheduleSpeechTimeout()
        }
    }
}
