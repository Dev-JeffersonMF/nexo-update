package com.jefferson.nexusassistente.voice

import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import java.util.Locale

/**
 * Motor de voz do Nexus â€” dono Ãºnico do microfone.
 *
 * O microfone NUNCA abre sozinho. Existem duas portas, uma por contexto, e nunca
 * as duas ao mesmo tempo:
 *
 *  A) DENTRO DO APP â€” [startDirectCapture]. Ã‰ o botÃ£o de microfone da tela
 *     principal: UMA captura do pedido, sem palavra de ativaÃ§Ã£o (o usuÃ¡rio jÃ¡
 *     estÃ¡ dentro do app) e sem tentar de novo. A captura termina na primeira
 *     fala reconhecida, no silÃªncio, no teto de [DIRECT_MAX_MS] ou em erro â€” e o
 *     microfone FECHA. NÃ£o existe reabertura automÃ¡tica nesta modalidade: era
 *     exatamente esse vaivÃ©m que fazia o microfone abrir e fechar sem parar
 *     dentro do aplicativo.
 *
 *  B) MASCOTE (fora do app) â€” [startMascotCapture]. Um TOQUE no mascote abre o
 *     microfone NA HORA para UM pedido: o aviso falado "Estou ouvindo" foi
 *     tirado de propÃ³sito (roubava ~2,5 s e obrigava o usuÃ¡rio a falar alto),
 *     e o pedido Ã© ouvido com a janela de [COMMAND_SILENCE_MS]. No fim, fecha
 *     e volta ao repouso â€” o prÃ³ximo pedido exige outro toque.
 *
 *     A palavra de ativaÃ§Ã£o Ã© OPCIONAL e vira filtro quando hÃ¡ mÃ­dia tocando:
 *     "Nexus, toca a rÃ¡dio Itatiaia" executa "toca a rÃ¡dio Itatiaia" (o nome Ã©
 *     o convite, nÃ£o o comando) e, com a rÃ¡dio no ar, sÃ³ o pedido que passou
 *     pelo nome do Nexus Ã© executado â€” senÃ£o a prÃ³pria rÃ¡dio seria obedecida.
 *
 *  NÃ£o existe ESCUTA PASSIVA: nem de palavra de ativaÃ§Ã£o, nem de detector
 *  neural. O antigo KWS "Nexo" segurava um AudioRecord contÃ­nuo, religava
 *  sozinho depois de cada fala e travava o SpeechRecognizer do sistema
 *  (ERROR_AUDIO/RECOGNIZER_BUSY) â€” dentro e fora do app.
 *  [startFloatingListening] continua existindo para a ponte, mas sÃ³ registra
 *  que o mascote estÃ¡ na tela.
 *
 * Regras que sustentam a separaÃ§Ã£o:
 *
 * - Qualquer `start*` derruba a modalidade anterior antes de abrir o microfone,
 *   entÃ£o app e mascote nunca disputam o hardware;
 * - [suspendForForeground] Ã© chamado pelo `MainActivity.onResume`: dentro do
 *   app nada do mascote continua ligado;
 * - cada sessÃ£o tem um nÃºmero e o reconhecedor Ã© REAPROVEITADO (uma instÃ¢ncia),
 *   com folga entre sessÃµes: recriar o objeto a cada sessÃ£o gerava
 *   `ERROR_RECOGNIZER_BUSY` e `ERROR_SERVER_DISCONNECTED`;
 * - o microfone fica fechado enquanto o Nexus fala, para ele nÃ£o se ouvir;
 * - com a TELA BLOQUEADA/apagada o microfone fica fechado: ali ninguÃ©m estÃ¡
 *   vendo a tela e cada sessÃ£o sÃ³ produzia o aviso sonoro do reconhecedor (o
 *   "apitado" que o usuÃ¡rio ouvia com o aparelho no bolso);
 * - com MÃDIA tocando (rÃ¡dio do app ou mÃºsica aberta pelo assistente) nada muda:
 *   o microfone jÃ¡ estÃ¡ fechado e o toque no mascote continua funcionando.
 *
 * Todo acesso ao SpeechRecognizer e ao TTS acontece na thread principal.
 */
class NexusVoiceEngine(
    private val context: Context,
    private val onCommandRecognized: (String) -> Unit,
    /** Fim de uma captura da modalidade DENTRO DO APP, com o motivo. */
    private val onDirectCaptureEnded: (String) -> Unit,
    /** Modalidade ou fase mudou: o JS precisa saber para nÃ£o mentir na tela. */
    private val onStateChanged: () -> Unit
) {

    companion object {
        private const val TAG = "NEXUS_VOICE"

        /** Fala curta que confirma a ativaÃ§Ã£o. */
        private const val ACK_PHRASE = "Estou ouvindo"

        /** Identificador da fala de confirmaÃ§Ã£o no motor TTS. */
        private const val ACK_UTTERANCE_ID = "nexus-ack"

        /** Motivos entregues ao JS no fim de uma captura dentro do app. */
        const val REASON_COMMAND = "command"
        const val REASON_SILENCE = "silence"
        const val REASON_ERROR = "error"
        const val REASON_TIMEOUT = "timeout"
        const val REASON_UNSUPPORTED = "unsupported"

        /** O usuÃ¡rio fechou o microfone no meio da captura (toque no botÃ£o). */
        const val REASON_CANCELED = "canceled"

        /**
         * O reconhecedor devolveu uma frase, mas o volume medido diz que ali sÃ³
         * havia barulho (televisÃ£o, vento, conversa longe) â€” nada de fala.
         */
        const val REASON_NOISE = "noise"

        /**
         * A captura falhou por rede: o reconhecimento do Google precisa do
         * serviÃ§o dele. Ã‰ diferente de "nÃ£o falou nada" e a tela explica isso.
         */
        const val REASON_NETWORK = "network"

        /** O idioma nÃ£o estÃ¡ instalado no dispositivo (ex.: portuguÃªs sem pacote do Google). */
        const val REASON_LANGUAGE_NOT_SUPPORTED = "language-not-supported"

        // -----------------------------------------------------------------
        // SeparaÃ§Ã£o fala x barulho (VAD)
        //
        // O reconhecedor do Google nÃ£o responde "nada" ao ruÃ­do: ele responde
        // uma frase. Sem medir o volume, o Nexus executava comandos que ninguÃ©m
        // pediu (a TV ligada virava pedido de mÃºsica). NÃ£o hÃ¡ reescrita de
        // AudioRecord aqui: o prÃ³prio reconhecedor entrega o volume medido em
        // [RecognitionListener.onRmsChanged], e Ã© isso que decide.
        // -----------------------------------------------------------------

        /**
         * Quanto o volume precisa passar do piso do ambiente para contar como
         * fala. Alto o bastante para nÃ£o confundir murmÃºrio de ambiente, baixo o
         * bastante para nÃ£o exigir grito.
         */
        private const val SPEECH_MARGIN_DB = 8f

        /**
         * Margem usada quando nÃ£o hÃ¡ silÃªncio de referÃªncia (ambiente cheio).
         *
         * Sem um trecho quieto no comeÃ§o da sessÃ£o o piso nÃ£o serve para
         * julgar a fala: aÃ­ a barra desce e a voz do usuÃ¡rio passa.
         */
        private const val SPEECH_MARGIN_DB_LOW = 4f

        /**
         * Trechos lidos no comeÃ§o da sessÃ£o para estimar o ambiente.
         *
         * O piso Ã© o MENOR volume desse comeÃ§o â€” e nÃ£o o primeiro: o microfone
         * abre no toque e a pessoa jÃ¡ comeÃ§a a falar.
         */
        private const val FLOOR_SAMPLES = 8

        /** Quanto o ambiente pode variar e ainda contar como "tinha silÃªncio". */
        private const val FLOOR_SPREAD_DB = 6f

        /**
         * Amostras de volume mÃ­nimas antes de julgar qualquer coisa.
         *
         * Nem todo aparelho entrega [onRmsChanged]. Sem amostras, o Nexus nÃ£o
         * julga: prefere ouvir de mais a inventar surdez e recusar um pedido real.
         */
        private const val MIN_VAD_SAMPLES = 5

        /** ExtensÃ£o do teto do pedido quando ainda hÃ¡ fala em andamento. */
        private const val DIRECT_EXTEND_MS = 5000L

        /** Quantas vezes o teto do pedido pode ser estendido. */
        private const val MAX_DIRECT_EXTENSIONS = 3

        /**
         * Folga mÃ­nima entre uma sessÃ£o e a seguinte.
         *
         * Medido no aparelho: reabrir o microfone menos de ~1 s depois de a sessÃ£o
         * anterior terminar faz a nova morrer na largada com
         * `ERROR_SERVER_DISCONNECTED` â€” o microfone "abre e fecha" e nenhuma fala Ã©
         * ouvida. A folga sÃ³ Ã© aplicada quando houve sessÃ£o viva antes; da primeira
         * abertura (e de uma captura parada hÃ¡ tempo) o microfone abre na hora.
         */
        private const val SESSION_SETTLE_MS = 1000L

        /**
         * SessÃ£o que morreu na largada (`ERROR_SERVER_DISCONNECTED`).
         *
         * Depois de um silÃªncio o reconhecedor Ã s vezes recusa a sessÃ£o seguinte
         * na hora.
         */
        private const val ERROR_SERVER_DISCONNECTED = 11

        /**
         * Quanto tempo a espera por causa de mÃ­dia tocando dura no mÃ¡ximo.
         *
         * A rÃ¡dio do app informa quando comeÃ§a e quando para. A mÃºsica aberta em
         * outro aplicativo (OiTube/YouTube) nÃ£o avisa o fim: se o usuÃ¡rio deixar
         * o vÃ­deo tocando e esquecer, a espera expira sozinha depois deste tempo
         * â€” o estado nunca fica preso dizendo que hÃ¡ mÃ­dia tocando.
         */
        private const val MEDIA_WAIT_TIMEOUT_MS = 20 * 60 * 1000L

        /**
         * De quanto em quanto tempo a espera de mÃ­dia Ã© conferida no aparelho.
         *
         * O aviso "mÃ­dia tocando" vem do JS e pode ficar ligado depois de a mÃºsica
         * parar sozinha (fim do vÃ­deo, player fechado, fone desconectado). Sem esta
         * conferÃªncia o estado ficava preso e o toque no mascote parecia morto.
         * Aqui a espera Ã© comparada com o Ã¡udio real do aparelho e liberada
         * assim que ele silencia.
         */
        private const val MEDIA_CHECK_MS = 15 * 1000L

        /** Espera depois da confirmaÃ§Ã£o falada, para o alto-falante calar. */
        private const val ACK_TAIL_MS = 260L

        /** Teto de espera pela confirmaÃ§Ã£o falada antes de abrir o microfone. */
        private const val ACK_MAX_MS = 2600L

        /** Espera curta quando o TTS nÃ£o estÃ¡ disponÃ­vel. */
        private const val ACK_FALLBACK_MS = 600L

        /**
         * SilÃªncio que encerra a captura do comando no modo FLUTUANTE.
         *
         * A janela precisa ser larga o bastante para o pedido inteiro: com 2 s
         * o motor fechava no meio da frase e devolvia um pedaÃ§o ("tudo joia"
         * em vez de "toca a rÃ¡dio Itatiaia"). 3 s Ã© o ponto em que a frase
         * fecha sem cortar a Ãºltima palavra.
         */
        private const val COMMAND_SILENCE_MS = 3000L

        /**
         * Palavras que o NEXO espera no pedido do mascote.
         *
         * O nome vem primeiro porque o pedido pode ser sÃ³ "NEXO, toca a
         * rÃ¡dio Itatiaia". As outras sÃ£o os comandos que mais se repetem: com
         * elas como viÃ©s, o motor acerta a primeira vez e mais rÃ¡pido.
         *
         * SÃ³ entram palavras COM SILABAS: forÃ§ar "sim"/"nÃ£o"/"para" no
         * reconhecedor fazia um pedido curto virar essas palavras e o motor
         * devolver um resto sem sentido.
         */
        private val MASCOT_BIAS = listOf(
            "nexo", "nêxo", "néxo", "nexô", "radio", "musica", "continuar", "retomar", "voltar",
            "pular", "tocar", "ligar", "mensagem", "lembrete", "volume", "estacao",
        )

        /**
         * A palavra de ativaÃ§Ã£o do NEXO.
         *
         * "NEXO" (e as grafias que o ditado produzem) Ã© o convite: sai do
         * pedido, nÃ£o faz parte dele. Prioridade: "nexo", "nêxo", "néxo", "nexô".
         */
        private val WAKE_WORD = Regex("(?i)\\b(nexo|nêxo|néxo|nexô|meu nexo)\\b")

        /**
         * SilÃªncio que encerra uma captura DENTRO DO APP.
         *
         * Mais generoso de propÃ³sito: dentro do app o usuÃ¡rio estÃ¡ falando com o
         * Nexus, nÃ£o respondendo a uma palavra-chave, entÃ£o nÃ£o pode ser cortado
         * aos 5 s. Estes extras sÃ£o um pedido ao reconhecedor â€” se ele ignorar, o
         * teto de [DIRECT_MAX_MS] e o prÃ³prio fim de fala dele encerram a captura.
         */
        private const val DIRECT_SILENCE_MS = 3000L

        /** Teto de uma captura dentro do app: o microfone nunca fica preso. */
        private const val DIRECT_MAX_MS = 15000L

        /**
         * Quantas vezes o pedido do mascote pode ser retentado depois de uma
         * falha passageira.
         *
         * Um: o usuÃ¡rio tocou uma vez, entÃ£o o microfone abre uma vez. Retentar
         * sozinho era o antigo vaivÃ©m de sessÃµes (com aviso sonoro a cada
         * abertura) que incomodava â€” se a fala nÃ£o foi capturada, o usuÃ¡rio toca
         * de novo e fala.
         */
        private const val MAX_COMMAND_ATTEMPTS = 1

        /** Nome legÃ­vel do erro, para o logcat. */
        private fun errorName(error: Int): String = when (error) {
            SpeechRecognizer.ERROR_AUDIO -> "AUDIO"
            SpeechRecognizer.ERROR_CLIENT -> "CLIENT"
            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "INSUFFICIENT_PERMISSIONS"
            SpeechRecognizer.ERROR_NETWORK -> "NETWORK"
            SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "NETWORK_TIMEOUT"
            SpeechRecognizer.ERROR_NO_MATCH -> "NO_MATCH"
            SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "RECOGNIZER_BUSY"
            SpeechRecognizer.ERROR_SERVER -> "SERVER"
            SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "SPEECH_TIMEOUT"
            ERROR_SERVER_DISCONNECTED -> "SERVER_DISCONNECTED"
            else -> "DESCONHECIDO($error)"
        }
    }

    /** Modalidade da escuta. SÃ³ uma por vez, sempre. */
    enum class Mode {
        /** Microfone fechado. */
        OFF,

        /** Uma captura de comando dentro do app (botÃ£o de microfone). */
        IN_APP,

        /** Mascote flutuante: aviso falado + janela de 5 s. */
        FLOATING,
    }

    /** Fase da escuta dentro da modalidade. */
    enum class Phase {
        IDLE,

        /** Falando "Estou ouvindo" antes de abrir o comando (sÃ³ no flutuante). */
        ACK,

        /** Janela de 5 s do pedido (sÃ³ no flutuante). */
        COMMAND,

        /** Captura Ãºnica dentro do app. */
        DIRECT,
    }

    private val mainHandler = Handler(Looper.getMainLooper())

    /**
     * Reconhecedor ÃšNICO do motor.
     *
     * Criado na primeira sessÃ£o e reaproveitado atÃ© [destroy]. Antes cada sessÃ£o
     * era aberta com uma instÃ¢ncia nova (a anterior era destruÃ­da), e isso
     * derrubava a sessÃ£o seguinte na largada com `ERROR_SERVER_DISCONNECTED`: o
     * microfone abria e fechava sem nunca ouvir o pedido do usuÃ¡rio.
     */
    private var recognizer: SpeechRecognizer? = null

    /** NÃºmero da sessÃ£o atual: callbacks de sessÃµes antigas sÃ£o descartados. */
    private var sessionId = 0

    /** `true` enquanto uma sessÃ£o estÃ¡ de fato escutando. */
    private var sessionActive = false

    /**
     * Instante em que a Ãºltima sessÃ£o terminou.
     *
     * Serve para dar folga ao serviÃ§o de reconhecimento antes de abrir a prÃ³xima
     * ([SESSION_SETTLE_MS]): reabrir colado na sessÃ£o anterior Ã© o que produzia o
     * "abre e fecha" â€” a segunda sessÃ£o morria na largada.
     */
    private var lastSessionEndAt = 0L

    /** Invalida uma abertura que esteja esperando a folga. */
    private var openToken = 0

    @Volatile
    private var mode = Mode.OFF

    @Volatile
    private var phase = Phase.IDLE

    private var tts: TextToSpeech? = null
    private var ttsReady = false

    /** Tentativas de captura do comando na ativaÃ§Ã£o atual (modo flutuante). */
    private var commandAttempts = 0

    /**
     * `true` enquanto o assistente (o JS) estÃ¡ falando a resposta.
     *
     * O Nexus falava com o microfone ainda aberto: o reconhecedor ouvia a
     * prÃ³pria resposta dele, entregava um "comando" inventado e a resposta
     * seguinte cortava a fala anterior. Era por isso que perguntas como "qual
     * estaÃ§Ã£o de rÃ¡dio vocÃª quer ouvir?" e "qual mÃºsica ou cantor?" nunca
     * chegavam inteiras â€” o usuÃ¡rio ficava com a impressÃ£o de um assistente mudo.
     */
    @Volatile
    private var assistantSpeaking = false

    /**
     * `true` enquanto mÃ­dia do Nexus estÃ¡ no ar (rÃ¡dio do app ou mÃºsica que o
     * assistente abriu no OiTube/YouTube).
     *
     * Com mÃ­dia tocando o microfone fica fechado, porque o reconhecedor ouviria
     * a prÃ³pria mÃºsica e ainda avisaria a cada sessÃ£o. Nesse estado quem abre o
     * microfone Ã© o usuÃ¡rio, tocando no mascote ([startMascotCapture]).
     *
     * FIX: O estado tambÃ©m Ã© conferido contra o AudioManager real do sistema,
     * para nÃ£o ficar preso se o JS nÃ£o avisou que a mÃºsica parou.
     */
    @Volatile
    private var mediaPlaying = false

    /**
     * `true` quando a tela estÃ¡ bloqueada ou apagada.
     *
     * Com a tela bloqueada o microfone NÃƒO abre: ninguÃ©m estÃ¡ olhando a tela e o
     * vaivÃ©m de sessÃµes sÃ³ produzia aviso sonoro Ã  toa â€” era o "apitado" que o
     * usuÃ¡rio ouvia com o aparelho no bolso.
     */
    @Volatile
    private var screenLocked = false

    /**
     * `true` enquanto a captura aberta Ã© a RESPOSTA de uma notificaÃ§Ã£o.
     *
     * A regra "tela bloqueada = microfone fechado" existe para a escuta do
     * mascote (ninguÃ©m pediu nada com o aparelho no bolso). Mas a resposta
     * "sim"/"nÃ£o" de uma notificaÃ§Ã£o Ã© justamente o caso em que o usuÃ¡rio
     * FALA com a tela apagada: o Nexus acabou de perguntar "quer que eu
     * leia?" e quem responde Ã© a pessoa, nÃ£o a tela. Com esta marca, a trava
     * da tela nÃ£o mata a resposta.
     *
     * O microfone em segundo plano continua legÃ­timo: o serviÃ§o em primeiro
     * plano do Nexus Ã© do tipo `microphone` (Ã© o mesmo caminho da palavra de
     * ativaÃ§Ã£o, que jÃ¡ ouve com a tela bloqueada).
     */
    @Volatile
    private var lockProof = false

    /**
     * `true` enquanto o JS estÃ¡ pedindo a escuta passiva do mascote.
     *
     * A escuta pode estar adiada por fala do Nexus, mÃ­dia tocando ou tela
     * bloqueada mesmo com a permissÃ£o do JS â€” quando o motivo passa, Ã© este
     * campo que diz se ela deve voltar.
     */
    private var floatingWanted = false

    /** Solta a espera de mÃ­dia sozinha, se o usuÃ¡rio esquecer algo tocando. */
    private val mediaWaitTimeoutRunnable = Runnable {
        if (!mediaPlaying) return@Runnable
        Log.d(TAG, "Espera de mÃ­dia vencida: escuta passiva liberada de novo")
        setMediaPlayingInternal(false)
    }

    /**
     * Confere de tempo em tempo se a mÃ­dia que o JS anunciou ainda toca mesmo.
     *
     * Era este o "modo de espera eterno": o aviso de mÃ­dia chegava do JS e nunca
     * era desfeito quando a mÃºsica parava sozinha (fim do vÃ­deo, player fechado,
     * fone fora). Com a espera presa, o toque no mascote parecia morto. Agora
     * cada conferÃªncia olha o Ã¡udio real do aparelho; silÃªncio libera o estado de
     * mÃ­dia.
     *
     * FIX: TambÃ©m verifica AudioManager.isMusicActive como fallback.
     */
    private val mediaCheckRunnable = object : Runnable {
        override fun run() {
            if (!mediaPlaying) return
            if (isAudioPlayingNow()) {
                mainHandler.postDelayed(this, MEDIA_CHECK_MS)
                return
            }
            Log.d(TAG, "A mÃ­dia anunciada nÃ£o estÃ¡ mais tocando (AudioManager): estado liberado")
            setMediaPlayingInternal(false)
        }
    }

    /** `true` quando algum aplicativo estÃ¡ tocando Ã¡udio neste instante. */
    private fun isAudioPlayingNow(): Boolean {
        val audio = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        return audio?.isMusicActive == true
    }

    /** `true` quando a captura direta jÃ¡ ouviu alguma fala (o teto aguenta mais). */
    private var directHeardSpeech = false

    /** Quantas vezes o teto do pedido jÃ¡ foi estendido nesta captura. */
    private var directExtensions = 0

    /** Piso de volume do ambiente, medido durante a sessÃ£o (VAD). */
    private var noiseFloorDb = 0f

    /** O maior volume do ambiente no comeÃ§o da sessÃ£o. */
    private var floorMaxDb = 0f

    /** `true` quando o comeÃ§o da sessÃ£o teve um trecho de silÃªncio de verdade. */
    private var floorReliable = true

    /** O maior volume de toda a sessÃ£o (o pico da fala, se houve). */
    private var peakDb = -120f

    /** Quantas amostras de volume chegaram nesta sessÃ£o. */
    private var vadSamples = 0

    /** `true` quando o volume passou do piso do ambiente: houve fala de verdade. */
    private var voiceDetected = false

    /** `true` depois que o reconhecedor avisou que a fala terminou. */
    private var speechEnded = false

    /**
     * Respostas curtas esperadas nesta captura ("sim", "nÃ£o", "leia").
     *
     * O reconhecedor recebe estas palavras como viÃ©s. Sem contexto, um "sim"
     * sozinho Ã s vezes voltava como NO_MATCH; a dicÃ§Ã£o de uma mensagem inteira
     * nÃ£o usa viÃ©s (quem chama decide).
     */
    private var directBias: List<String> = emptyList()

    /**
     * `true` quando o nome do Nexus jÃ¡ foi ouvido nesta captura.
     *
     * Com mÃ­dia tocando, o pedido sÃ³ vale depois do nome: sem isso a prÃ³pria
     * rÃ¡dio seria obedecida ("toca a rÃ¡dio Itatiaia" dito pela emissora).
     */
    private var wakeWordHeard = false

    /** Zera a mediÃ§Ã£o de volume no comeÃ§o de cada sessÃ£o. */
    private fun resetVad() {
        noiseFloorDb = 0f
        floorMaxDb = 0f
        floorReliable = true
        peakDb = -120f
        vadSamples = 0
        voiceDetected = false
        speechEnded = false
        directExtensions = 0
        directHeardSpeech = false
        wakeWordHeard = false
    }

    /**
     * Acompanha o volume do microfone para separar fala de barulho.
     *
     * O piso Ã© o ambiente: cai rÃ¡pido (silÃªncio chegou) e sobe devagar (um
     * barulho passageiro nÃ£o pode virar "o novo silÃªncio"), e nunca sobe
     * enquanto hÃ¡ fala â€” senÃ£o a prÃ³pria fala seria rebaixada a ruÃ­do.
     *
     * O piso do COMEÃ‡O Ã© o MENOR volume do primeiro trecho, nÃ£o o primeiro
     * volume: o microfone abre no toque e a pessoa jÃ¡ comeÃ§a a falar â€” se o
     * piso fosse a primeira amostra, a VOZ dela viraria "o novo silÃªncio" e o
     * pedido seria recusado como barulho. Ã‰ o que fazia a voz do usuÃ¡rio nÃ£o
     * ser reconhecida.
     *
     * FIX: Se a primeira amostra jÃ¡ Ã© fala (usuÃ¡rio fala rÃ¡pido), nÃ£o deixamos
     * o piso subir para a voz. Usamos a MENOR amostra dos primeiros
     * FLOOR_SAMPLES, mesmo que ela chegue depois.
     */
    private fun noteRms(rmsdB: Float) {
        if (rmsdB.isNaN() || rmsdB.isInfinite()) return

        vadSamples++
        if (rmsdB > peakDb) peakDb = rmsdB

        if (vadSamples <= FLOOR_SAMPLES) {
            // O ambiente do comeÃ§o: vale o MENOR volume observado, nÃ£o o primeiro.
            // Isso protege contra o caso em que o usuÃ¡rio jÃ¡ estÃ¡ falando quando
            // o microfone abre (a primeira amostra seria a voz, nÃ£o o silÃªncio).
            if (vadSamples == 1) {
                noiseFloorDb = rmsdB
                floorMaxDb = rmsdB
            } else {
                if (rmsdB < noiseFloorDb) noiseFloorDb = rmsdB
                if (rmsdB > floorMaxDb) floorMaxDb = rmsdB
            }
            if (vadSamples == FLOOR_SAMPLES) {
                // O ambiente Ã© considerado "constante" (confiÃ¡vel para julgar fala)
                // se houve variaÃ§Ã£o de pelo menos FLOOR_SPREAD_DB entre o mais quieto
                // e o mais alto do comeÃ§o. Se nÃ£o houve variaÃ§Ã£o, assumimos que
                // nÃ£o tivemos silÃªncio de referÃªncia e NÃƒO julgamos a fala por VAD.
                floorReliable = (floorMaxDb - noiseFloorDb) >= FLOOR_SPREAD_DB
                if (!floorReliable) {
                    Log.d(TAG, "Ambiente constante (spread=${"%.1f".format(floorMaxDb - noiseFloorDb)} dB): o piso nÃ£o vai julgar a fala")
                }
            }
            return
        }

        // ApÃ³s o perÃ­odo de calibraÃ§Ã£o: piso desce rÃ¡pido no silÃªncio, sobe
        // devagar no ruÃ­do, e NÃƒO sobe enquanto hÃ¡ fala detectada.
        if (rmsdB < noiseFloorDb) {
            noiseFloorDb = noiseFloorDb * 0.6f + rmsdB * 0.4f
        } else if (!voiceDetected) {
            noiseFloorDb = noiseFloorDb * 0.9f + rmsdB * 0.1f
        }

        val margin = if (floorReliable) SPEECH_MARGIN_DB else SPEECH_MARGIN_DB_LOW
        if (rmsdB >= noiseFloorDb + margin) {
            voiceDetected = true
        }
    }

    /**
     * `true` quando a frase reconhecida parece ter vindo do RUÃDO.
     *
     * Sem amostras de volume o Nexus nÃ£o julga â€” devolve `false` e deixa o
     * pedido passar. Julgar sem dado seria recusar fala de verdade.
     *
     * A decisÃ£o olha o PICO do volume da sessÃ£o: se em algum momento o som
     * passou do piso do ambiente, houve fala â€” e a frase que o reconhecedor
     * entregou Ã© do usuÃ¡rio, nÃ£o da televisÃ£o.
     */
    private fun isNoiseOnly(): Boolean {
        if (vadSamples < MIN_VAD_SAMPLES) return false
        // Sem um trecho de silÃªncio de referÃªncia, nÃ£o se julga a fala.
        if (!floorReliable) return false
        if (peakDb >= noiseFloorDb + SPEECH_MARGIN_DB) return false
        return !voiceDetected
    }

    /** Fala ouvida por qualquer das duas vias (evento do motor ou volume). */
    private fun heardSpeech(): Boolean = voiceDetected || directHeardSpeech

    /** Modalidade/fase atuais, para o JS. */
    fun currentMode(): Mode = mode

    fun currentPhase(): Phase = phase

    val isCapturing: Boolean
        get() = phase == Phase.DIRECT || phase == Phase.COMMAND

    // Tipo explÃ­cito: o corpo do Runnable se referencia (reagenda a si mesmo),
    // e sem a anotaÃ§Ã£o o Kotlin nÃ£o consegue inferir o tipo (recursive problem).
    private val directTimeoutRunnable: Runnable = Runnable {
        if (mode != Mode.IN_APP || phase != Phase.DIRECT) return@Runnable

        // Ainda estÃ¡ falando? O teto espera mais uma rodada em vez de cortar o
        // pedido no meio. A extensÃ£o tem limite (e o fim de fala do reconhecedor
        // encerra antes), entÃ£o o microfone nunca fica preso.
        if (heardSpeech() && !speechEnded && directExtensions < MAX_DIRECT_EXTENSIONS) {
            directExtensions++
            Log.d(
                TAG,
                "Teto do pedido atingido, mas hÃ¡ fala: esperando mais ${DIRECT_EXTEND_MS} ms",
            )
            mainHandler.postDelayed(directTimeoutRunnable, DIRECT_EXTEND_MS)
            return@Runnable
        }

        Log.d(TAG, "Captura direta passou do teto sem ouvir o pedido")
        endDirectCapture(REASON_TIMEOUT)
    }

    private val ackTimeoutRunnable = Runnable {
        if (phase == Phase.ACK) {
            Log.w(TAG, "ConfirmaÃ§Ã£o falada nÃ£o terminou: abrindo o microfone de qualquer forma")
            startCommandCapture()
        }
    }

    /** Ãšnica retentativa de comando pendente (modo flutuante). */
    private val commandRetryRunnable = Runnable { retryCommandCapture() }

    init {
        mainHandler.post { ensureTts() }
    }

    // ----------------------------------------------------------------
    // Ciclo de vida â€” quem manda Ã© o JS, com duas portas separadas
    // ----------------------------------------------------------------

    /**
     * O JS avisa que o mascote estÃ¡ na tela.
     *
     * IMPORTANTE: esta chamada NÃƒO abre o microfone. O mascote nÃ£o fica ouvindo
     * sozinho: a Ãºnica porta do microfone fora do app Ã© o TOQUE nele
     * ([startMascotCapture]).
     */
    fun startFloatingListening() {
        mainHandler.post {
            floatingWanted = false
            Log.d(TAG, "Mascote na tela: microfone fechado (abre no toque)")
        }
    }

    /**
     * Modalidade DENTRO DO APP: uma captura de comando.
     *
     * Sem retentativa e sem reabertura: quando termina, o microfone fecha e sÃ³
     * um novo toque no botÃ£o abre de novo.
     */
    fun startDirectCapture(bias: List<String> = emptyList()) {
        startCapture("app", bias)
    }

    /**
     * A RESPOSTA de uma notificaÃ§Ã£o ("sim", "nÃ£o", a mensagem da resposta).
     *
     * Ã‰ a Ãºnica captura que continua de pÃ© com a tela APAGADA/BLOQUEADA: o
     * Nexus acabou de falar a pergunta e o usuÃ¡rio responde de ouvido â€” sem
     * isto, o motor fechava o microfone na hora da trava de tela e o "sim"
     * do usuÃ¡rio nunca chegava.
     */
    fun startNotificationAnswerCapture(bias: List<String> = emptyList()) {
        startCapture("notification", bias, allowLocked = true)
    }

    /**
     * Toque no mascote: o microfone abre NA HORA e ouve o pedido.
     *
     * Antes o Nexus falava "Estou ouvindo" antes de abrir o microfone. O aviso
     * custava ~2,5 s, obrigava o usuÃ¡rio a falar alto e ainda segurava o Ã¡udio
     * (a mÃºsica era cortada). Agora o microfone abre direto: o pedido chega
     * rÃ¡pido e a mÃ­dia pode continuar tocando.
     */
    fun startMascotCapture() {
        if (screenLocked || isScreenLocked()) {
            Log.d(TAG, "Toque no mascote ignorado: tela bloqueada")
            return
        }

        mainHandler.post {
            stopInternal(notify = false)

            if (!SpeechRecognizer.isRecognitionAvailable(context)) {
                Log.w(TAG, "Reconhecimento de voz indisponÃ­vel neste aparelho")
                emitState()
                onDirectCaptureEnded(REASON_UNSUPPORTED)
                return@post
            }

            mode = Mode.FLOATING
            phase = Phase.COMMAND
            resetVad()
            commandAttempts = 1
            Log.d(TAG, "Toque no mascote: microfone aberto direto para o pedido")
            emitState()
            openSession(mascotIntent(), Phase.COMMAND)
        }
    }

    private fun startCapture(origin: String, bias: List<String> = emptyList(), allowLocked: Boolean = false) {
        mainHandler.post {
            // Cada captura define a sua prÃ³pria regra de tela bloqueada.
            lockProof = false
            stopInternal(notify = false)
            if (!SpeechRecognizer.isRecognitionAvailable(context)) {
                mode = Mode.OFF
                phase = Phase.IDLE
                Log.w(TAG, "Reconhecimento de voz indisponÃ­vel neste aparelho")
                emitState()
                onDirectCaptureEnded(REASON_UNSUPPORTED)
                return@post
            }

            mode = Mode.IN_APP
            phase = Phase.DIRECT
            // A resposta de notificaÃ§Ã£o vale mesmo com a tela apagada (ver
            // [lockProof]): a pergunta acabou de ser falada para o usuÃ¡rio.
            lockProof = allowLocked
            directBias = bias
            resetVad()
            commandAttempts = 0
            Log.d(TAG, "Captura direta ($origin): ouvindo o pedido")
            emitState()
            openSession(directIntent(), Phase.DIRECT)
            mainHandler.removeCallbacks(directTimeoutRunnable)
            mainHandler.postDelayed(directTimeoutRunnable, DIRECT_MAX_MS)
        }
    }

    /** Fecha o microfone e volta ao repouso (usado pelas duas modalidades). */
    fun stopListening(reason: String = REASON_CANCELED) {
        val wasDirect = mode == Mode.IN_APP && phase == Phase.DIRECT
        mainHandler.post {
            val hadSession = mode != Mode.OFF
            floatingWanted = false
            lockProof = false
            stopInternal(notify = false)
            if (hadSession) Log.d(TAG, "Microfone fechado por pedido")
            emitState()
            if (wasDirect) onDirectCaptureEnded(reason)
        }
    }

    /**
     * O assistente voltou para a frente: uma captura flutuante nÃ£o pode continuar.
     *
     * Ã‰ a garantia de que dentro do app o microfone sÃ³ abre no toque do botÃ£o.
     */
    fun suspendForForeground() {
        mainHandler.post {
            floatingWanted = false
            if (mode != Mode.FLOATING) return@post
            Log.d(TAG, "Assistente em primeiro plano: escuta flutuante suspensa")
            stopInternal(notify = false)
            emitState()
        }
    }

    /**
     * A tela bloqueou/apagou (ou voltou).
     *
     * Com a tela bloqueada o microfone fica fechado â€” inclusive a captura do
     * mascote. Era com o aparelho no bolso que o vaivÃ©m de sessÃµes mais
     * incomodava: ninguÃ©m estÃ¡ vendo a tela e o aparelho sÃ³ avisava (apitava) a
     * cada abertura. Ao desbloquear, o microfone segue FECHADO: quem abre Ã© o
     * toque.
     */
    fun setScreenLocked(locked: Boolean) {
        mainHandler.post {
            if (screenLocked == locked) return@post
            screenLocked = locked

            if (locked) {
                /*
                 * A RESPOSTA de uma notificaÃ§Ã£o nÃ£o pode cair aqui: o Nexus
                 * perguntou "quer que eu leia?" e o usuÃ¡rio respondeu "sim"
                 * de ouvido, com o aparelho na mÃ£o e a tela apagada. Fechar o
                 * microfone neste instante era exatamente o motivo de o Nexus
                 * nunca ouvir o "sim".
                 */
                if (lockProof && mode == Mode.IN_APP && phase == Phase.DIRECT) {
                    Log.d(TAG, "Tela bloqueada: microfone segue aberto (resposta de notificaÃ§Ã£o)")
                    return@post
                }
                val wasDirect = mode == Mode.IN_APP && phase == Phase.DIRECT
                Log.d(TAG, "Tela bloqueada: microfone fechado")
                stopInternal(notify = false)
                emitState()
                if (wasDirect) onDirectCaptureEnded(REASON_CANCELED)
            } else {
                Log.d(TAG, "Tela liberada: microfone segue fechado (abre no toque)")
            }
        }
    }

    /**
     * MÃ­dia do Nexus comeÃ§ou ou parou de tocar (rÃ¡dio do app ou mÃºsica aberta
     * pelo assistente).
     *
     * O microfone jÃ¡ estÃ¡ fechado quando a mÃ­dia comeÃ§a, entÃ£o isto serve para o
     * app saber o estado real da reproduÃ§Ã£o: a espera de mÃ­dia expira sozinha e Ã©
     * conferida contra o Ã¡udio do aparelho, para o estado nunca ficar preso
     * dizendo que hÃ¡ mÃºsica tocando.
     */
    fun setMediaPlaying(playing: Boolean) {
        mainHandler.post { setMediaPlayingInternal(playing) }
    }

    private fun setMediaPlayingInternal(playing: Boolean) {
        if (mediaPlaying == playing) {
            if (playing) scheduleMediaWaitTimeout()
            return
        }
        mediaPlaying = playing

        if (playing) {
            Log.d(TAG, "MÃ­dia tocando: mascote em espera (toque nele para falar)")
            if (mode != Mode.OFF) {
                stopInternal(notify = false)
                emitState()
            }
            scheduleMediaWaitTimeout()
        } else {
            Log.d(TAG, "MÃ­dia parada: microfone segue fechado (abre no toque)")
            mainHandler.removeCallbacks(mediaWaitTimeoutRunnable)
            mainHandler.removeCallbacks(mediaCheckRunnable)
        }
    }

    private fun scheduleMediaWaitTimeout() {
        mainHandler.removeCallbacks(mediaWaitTimeoutRunnable)
        mainHandler.postDelayed(mediaWaitTimeoutRunnable, MEDIA_WAIT_TIMEOUT_MS)
        mainHandler.removeCallbacks(mediaCheckRunnable)
        mainHandler.postDelayed(mediaCheckRunnable, MEDIA_CHECK_MS)
    }

    /**
     * Garante que nenhuma intenÃ§Ã£o antiga de escuta fique pendente.
     *
     * O microfone do mascote abre SÃ“ no toque ([startMascotCapture]): nÃ£o existe
     * reabertura automÃ¡tica depois da fala, da mÃ­dia ou do desbloqueio.
     */
    private fun clearPendingListening() {
        floatingWanted = false
    }

    /**
     * Avisa o motor que o assistente comeÃ§ou ou terminou de falar.
     *
     * Enquanto o Nexus fala, o microfone fica FECHADO â€” ele nÃ£o pode ouvir a
     * prÃ³pria voz. Ã‰ isso que garante que a resposta saia inteira: sem esta
     * trava, o reconhecedor transcrevia a prÃ³pria fala do assistente, um novo
     * "comando" era entregue ao JS e a resposta seguinte cortava a pergunta que
     * o usuÃ¡rio ainda estava ouvindo.
     *
     * O microfone NÃƒO reabre no fim da fala: quem abre Ã© o toque do usuÃ¡rio.
     */
    fun setAssistantSpeaking(speaking: Boolean) {
        mainHandler.post {
            if (assistantSpeaking == speaking) return@post
            assistantSpeaking = speaking

            if (speaking) {
                clearPendingListening()
                stopInternal(notify = false)
                Log.d(TAG, "Assistente falando: microfone fechado")
                emitState()
                return@post
            }

            Log.d(TAG, "Assistente terminou de falar: microfone segue fechado (abre no toque)")
            clearPendingListening()
        }
    }

    fun destroy() {
        mainHandler.post {
            mainHandler.removeCallbacks(mediaWaitTimeoutRunnable)
            mainHandler.removeCallbacks(mediaCheckRunnable)
            stopInternal(notify = false)
            // Aqui sim o reconhecedor vai embora: Ã© o fim do motor (recarga do JS).
            try {
                recognizer?.destroy()
            } catch (_: Exception) {
                // SessÃ£o jÃ¡ encerrada.
            }
            recognizer = null
            sessionActive = false
            try {
                tts?.shutdown()
            } catch (_: Exception) {
                // TTS Ã© opcional.
            }
            tts = null
            ttsReady = false
        }
    }

    /** Encerra sessÃ£o, callbacks e fala. Exige a thread principal. */
    private fun stopInternal(notify: Boolean) {
        mode = Mode.OFF
        phase = Phase.IDLE
        commandAttempts = 0
        resetVad()
        mainHandler.removeCallbacks(ackTimeoutRunnable)
        mainHandler.removeCallbacks(commandRetryRunnable)
        mainHandler.removeCallbacks(directTimeoutRunnable)
        closeSession()
        stopSpeaking()
        if (notify) emitState()
    }

    private fun emitState() {
        try {
            onStateChanged()
        } catch (_: Exception) {
            // Evento Ã© opcional: nunca deve derrubar a escuta.
        }
    }

    // ----------------------------------------------------------------
    // SessÃµes de reconhecimento
    // ----------------------------------------------------------------

    private fun commandIntent(): Intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, "pt-BR")
        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
        putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
        // Janela de captura do comando: termina depois de 5s de silÃªncio.
        putExtra(
            RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS,
            COMMAND_SILENCE_MS
        )
        putExtra(
            RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS,
            COMMAND_SILENCE_MS
        )
        putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 600L)
    }

    /**
     * Pedido do mascote: microfone jÃ¡ aberto, palavra de ativaÃ§Ã£o e viÃ©s.
     *
     * O pedido chega rÃ¡pido: sem aviso falado antes e com a janela de silÃªncio
     * curta (2 s). O viÃ©s diz ao motor quais palavras sÃ£o as do dia â€” o nome do
     * Nexus e os comandos que mais se repetem.
     */
    private fun mascotIntent(): Intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, "pt-BR")
        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
        putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
        putExtra(
            RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS,
            COMMAND_SILENCE_MS
        )
        putExtra(
            RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS,
            COMMAND_SILENCE_MS
        )
        putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 900L)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            putStringArrayListExtra(RecognizerIntent.EXTRA_BIASING_STRINGS, ArrayList(MASCOT_BIAS))
        }
    }

    /**
     * Captura dentro do app: sem palavra de ativaÃ§Ã£o e sem a regra dos 5 s.
     *
     * Resultados parciais ficam ligados sÃ³ para saber que houve fala (mantÃ©m o
     * teto de tempo longe enquanto o usuÃ¡rio ainda estÃ¡ falando).
     */
    private fun directIntent(): Intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, "pt-BR")
        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
        putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
        putExtra(
            RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS,
            DIRECT_SILENCE_MS
        )
        putExtra(
            RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS,
            DIRECT_SILENCE_MS
        )
        // Um "sim" tem menos de 1 s. O piso de 500 ms deixava o motor encerrar
        // a fala antes de ter contexto suficiente e devolver NO_MATCH.
        putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 1000L)

        // SÃ³ a resposta curta ("sim", "nÃ£o", "leia") recebe viÃ©s; a captura do
        // botÃ£o e a dicÃ§Ã£o de uma mensagem inteira seguem sem palavras armadas.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && directBias.isNotEmpty()) {
            putStringArrayListExtra(RecognizerIntent.EXTRA_BIASING_STRINGS, ArrayList(directBias))
        }
    }

    /**
     * Fecha a sessÃ£o atual e invalida qualquer callback que ainda esteja a caminho.
     *
     * O reconhecedor NÃƒO Ã© destruÃ­do: ele fica pronto para a prÃ³xima sessÃ£o. SÃ³
     * [destroy] desmancha o motor (o vaivÃ©m de destruir/criar Ã© que fazia a sessÃ£o
     * seguinte morrer na largada).
     */
    private fun closeSession() {
        sessionId++
        // Uma abertura que esteja esperando a folga nÃ£o vale mais.
        openToken++
        if (sessionActive) {
            lastSessionEndAt = System.currentTimeMillis()
            sessionActive = false
        }
        try {
            recognizer?.cancel()
        } catch (_: Exception) {
            // SessÃ£o jÃ¡ encerrada.
        }
    }

    /**
     * Fim do pedido do mascote: fecha o microfone e volta ao repouso.
     *
     * O microfone NÃƒO reabre sozinho â€” depois do pedido ele fecha e sÃ³ o prÃ³ximo
     * toque no mascote abre de novo.
     *
     * @param reason quando informado e havia um pedido do mascote em andamento, o
     *   app recebe o aviso (por exemplo "nÃ£o ouvi nada"); `null` quando o pedido
     *   jÃ¡ foi entregue e nÃ£o hÃ¡ o que explicar.
     */
    private fun endMascotCapture(reason: String?) {
        mainHandler.removeCallbacks(commandRetryRunnable)
        val wasMascotCapture =
            mode == Mode.FLOATING && (phase == Phase.COMMAND || phase == Phase.ACK)
        if (wasMascotCapture) {
            Log.d(TAG, "Pedido do mascote encerrado: microfone fechado (volta no toque)")
        }
        stopInternal(notify = false)
        emitState()
        if (wasMascotCapture && reason != null) onDirectCaptureEnded(reason)
    }

    /**
     * Abre o microfone reaproveitando o reconhecedor do motor.
     *
     * Dois cuidados, ambos medidos no aparelho:
     *  1. sessÃ£o anterior ainda viva Ã© fechada (cancel, sem destruir o objeto);
     *  2. folga de [SESSION_SETTLE_MS] desde o fim da Ãºltima sessÃ£o â€” reabrir
     *     colado fazia a nova morrer na largada (`ERROR_SERVER_DISCONNECTED`).
     */
    private fun openSession(intent: Intent, sessionPhase: Phase) {
        if (sessionActive) closeSession()

        val wait = SESSION_SETTLE_MS - (System.currentTimeMillis() - lastSessionEndAt)
        if (wait > 0) {
            val token = ++openToken
            mainHandler.postDelayed({
                if (token != openToken) return@postDelayed
                if (mode == Mode.OFF || phase != sessionPhase) return@postDelayed
                openSession(intent, sessionPhase)
            }, wait)
            return
        }

        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            Log.w(TAG, "Reconhecimento de voz indisponÃ­vel neste aparelho")
            failDirectCaptureIfNeeded(sessionPhase, REASON_UNSUPPORTED)
            endMascotCapture(REASON_UNSUPPORTED)
            return
        }

        val active = ensureRecognizer()
        if (active == null) {
            failDirectCaptureIfNeeded(sessionPhase, REASON_ERROR)
            endMascotCapture(REASON_ERROR)
            return
        }

        val id = sessionId
        active.setRecognitionListener(listenerFor(id, sessionPhase))
        try {
            active.startListening(intent)
            sessionActive = true
        } catch (e: Exception) {
            Log.e(TAG, "Falha ao abrir o microfone: ${e.message}")
            lastSessionEndAt = System.currentTimeMillis()
            failDirectCaptureIfNeeded(sessionPhase, REASON_ERROR)
            endMascotCapture(REASON_ERROR)
        }
    }

    /** Cria o reconhecedor na primeira sessÃ£o e reaproveita nas seguintes. */
    private fun ensureRecognizer(): SpeechRecognizer? {
        recognizer?.let { return it }
        return try {
            SpeechRecognizer.createSpeechRecognizer(context).also { recognizer = it }
        } catch (e: Exception) {
            Log.e(TAG, "NÃ£o foi possÃ­vel criar o reconhecedor: ${e.message}")
            null
        }
    }

    /**
     * Marca o fim de uma sessÃ£o (resultado ou erro).
     *
     * O instante Ã© guardado para a prÃ³xima abertura respeitar [SESSION_SETTLE_MS]:
     * reabrir colado Ã© o que fazia a sessÃ£o nova morrer na largada.
     */
    private fun markSessionEnded() {
        sessionActive = false
        lastSessionEndAt = System.currentTimeMillis()
    }

    /**
     * Estado real da tela, consultado no sistema.
     *
     * Usado como trava de seguranÃ§a antes de abrir o microfone: mesmo que um aviso
     * de broadcast se perca (tela desligando no meio de uma sessÃ£o, por exemplo),
     * o microfone nÃ£o abre com o aparelho bloqueado.
     */
    private fun isScreenLocked(): Boolean {
        val power = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        val keyguard = context.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
        return power?.isInteractive == false || keyguard?.isKeyguardLocked == true
    }

    /**
     * Numa captura dentro do app, uma sessÃ£o que nem chegou a abrir encerra a
     * captura na hora: sem isso o botÃ£o ficaria "ouvindo" para sempre, porque
     * esta modalidade nÃ£o reabre o microfone sozinha.
     */
    private fun failDirectCaptureIfNeeded(sessionPhase: Phase, reason: String) {
        if (sessionPhase != Phase.DIRECT) return
        if (mode != Mode.IN_APP || phase != Phase.DIRECT) return
        endDirectCapture(reason)
    }

    private fun listenerFor(id: Int, sessionPhase: Phase): RecognitionListener =
        object : RecognitionListener {
            /** `false` quando esta sessÃ£o jÃ¡ foi substituÃ­da por outra. */
            private fun stale(): Boolean = id != sessionId

            /**
             * Ãšltimo texto parcial desta sessÃ£o.
             *
             * O Android Ã s vezes entrega o resultado final vazio ou cortado no
             * meio da frase (o parcial jÃ¡ tinha tudo). Guardar o parcial evita
             * "faltar a Ãºltima palavra" e evita perder o pedido inteiro.
             */
            private var lastPartial: String = ""

            override fun onPartialResults(partialResults: Bundle?) {
                if (stale()) return
                val text = firstResult(partialResults)
                if (text.isNotEmpty()) lastPartial = text.trim()

                if (sessionPhase == Phase.DIRECT) {
                    // Falou algo: o teto de tempo nÃ£o pode cortar o pedido.
                    if (mode == Mode.IN_APP && phase == Phase.DIRECT && text.isNotEmpty()) {
                        directHeardSpeech = true
                        voiceDetected = true
                        Log.d(TAG, "Parcial do pedido: \"${text.trim()}\"")
                    }
                } else if (sessionPhase == Phase.COMMAND && text.isNotEmpty()) {
                    // O parcial do mascote Ã© o que mostra se o microfone pegou a
                    // frase inteira (o final Ã s vezes vem cortado).
                    Log.d(TAG, "Parcial do pedido (mascote): \"${text.trim()}\"")
                }
            }

            override fun onResults(results: Bundle?) {
                if (stale()) return
                markSessionEnded()
                val finalText = firstResult(results).trim()
                // Final vazio â†’ usa o parcial. Final que Ã© sÃ³ o COMEÃ‡O do
                // parcial â†’ o parcial estava mais completo (a Ãºltima palavra
                // tinha sido reconhecida e o final a perdeu).
                val text =
                    when {
                        finalText.isEmpty() -> lastPartial
                        lastPartial.length > finalText.length &&
                            lastPartial.lowercase().startsWith(finalText.lowercase()) -> lastPartial
                        else -> finalText
                    }.trim()

                if (sessionPhase == Phase.DIRECT) {
                    if (mode != Mode.IN_APP || phase != Phase.DIRECT) return
                    if (text.isEmpty()) {
                        Log.d(TAG, "Captura direta sem fala")
                        endDirectCapture(REASON_SILENCE)
                    } else if (isNoiseOnly()) {
                        // O reconhecedor "ouviu" uma frase, mas o volume medido
                        // diz que ali sÃ³ havia barulho: nada Ã© executado.
                        Log.d(TAG, "Captura direta recusada: sÃ³ barulho (\"$text\")")
                        endDirectCapture(REASON_NOISE)
                    } else {
                        Log.d(TAG, "Pedido reconhecido no app: \"$text\"")
                        endDirectCapture(REASON_COMMAND, text)
                    }
                    return
                }

                // Fase de comando do mascote.
                if (phase != Phase.COMMAND) return

                Log.d(
                    TAG,
                    "Pedido do mascote: piso=${"%.1f".format(noiseFloorDb)} dB " +
                        "pico=${"%.1f".format(peakDb)} dB amostras=$vadSamples"
                )

                if (text.isEmpty()) {
                    Log.d(TAG, "Nenhuma fala no pedido do mascote: microfone fechado")
                    endMascotCapture(REASON_SILENCE)
                    return
                }

                if (isNoiseOnly()) {
                    // Mesma regra do app: frase vinda do barulho nÃ£o Ã© pedido.
                    Log.d(TAG, "Pedido do mascote recusado: sÃ³ barulho (\"$text\")")
                    endMascotCapture(REASON_NOISE)
                    return
                }

                val (command, saidWakeWord) = splitWakeWord(text)
                if (saidWakeWord) wakeWordHeard = true

                if (command.isEmpty()) {
                    // O usuÃ¡rio chamou ("Nexus") e o comando vem depois: o
                    // microfone continua aberto para pegar o pedido.
                    Log.d(TAG, "Nome do Nexus ouvido: esperando o comando")
                    if (commandAttempts < MAX_COMMAND_ATTEMPTS) {
                        commandAttempts++
                        mainHandler.postDelayed(commandRetryRunnable, 350L)
                    } else {
                        endMascotCapture(REASON_SILENCE)
                    }
                    return
                }

                if (mediaPlaying && !wakeWordHeard) {
                    // A rÃ¡dio estÃ¡ no ar, mas o microfone SÃ“ abriu porque o
                    // usuÃ¡rio tocou no mascote: o pedido Ã© dele, e a rÃ¡dio nÃ£o
                    // tem nada a ver com isso.
                    Log.d(TAG, "Pedido com mÃ­dia tocando (toque do usuÃ¡rio): aceito")
                }

                commandAttempts = 0
                Log.d(TAG, "Comando reconhecido: \"$command\"")
                onCommandRecognized(command)
                endMascotCapture(null)
            }

            override fun onError(error: Int) {
                if (stale()) return
                markSessionEnded()

                if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
                    // Sem microfone liberado: parar de tentar (e nÃ£o drenar bateria).
                    Log.e(TAG, "Microfone sem permissÃ£o: escuta interrompida")
                    val wasDirect = sessionPhase == Phase.DIRECT && phase == Phase.DIRECT
                    stopInternal(notify = false)
                    emitState()
                    if (wasDirect) onDirectCaptureEnded(REASON_ERROR)
                    return
                }

                // Captura dentro do app: nada de retentativa nem de reabertura.
                // SilÃªncio ou erro encerram a captura e o microfone fecha.
                if (sessionPhase == Phase.DIRECT) {
                    if (mode != Mode.IN_APP || phase != Phase.DIRECT) return

                    // A resposta curta pode ter chegado sÃ³ nos parciais: o
                    // resultado final veio vazio e o motor devolveu NO_MATCH.
                    // Antes o parcial era descartado e a resposta virava
                    // "nÃ£o ouvi nada", mesmo tendo sido ouvida.
                    if ((error == SpeechRecognizer.ERROR_NO_MATCH ||
                            error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) &&
                        lastPartial.isNotEmpty()
                    ) {
                        if (isNoiseOnly()) {
                            Log.d(TAG, "Captura direta recusada: sÃ³ barulho (parcial)")
                            endDirectCapture(REASON_NOISE)
                        } else {
                            Log.d(TAG, "Pedido recuperado do parcial: \"$lastPartial\"")
                            endDirectCapture(REASON_COMMAND, lastPartial)
                        }
                        return
                    }

                    val reason = directFailureReason(error)
                    Log.d(TAG, "Captura direta encerrada (${errorName(error)})")
                    endDirectCapture(reason)
                    return
                }

                /*
                 * O pedido do MASCOTE: o final Ã s vezes vem vazio ou cortado,
                 * mas o PARCIAL jÃ¡ tinha a frase.
                 *
                 * Sem isto, o Nexus respondia "nÃ£o ouvi nada" DEPOIS de ter
                 * ouvido o pedido â€” era o jeito mais rÃ¡pido de o usuÃ¡rio
                 * acreditar que o mascote nÃ£o escuta.
                 */
                if (sessionPhase == Phase.COMMAND &&
                    phase == Phase.COMMAND &&
                    (error == SpeechRecognizer.ERROR_NO_MATCH ||
                        error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) &&
                    lastPartial.isNotEmpty()
                ) {
                    if (isNoiseOnly()) {
                        Log.d(TAG, "Pedido do mascote recusado: sÃ³ barulho (parcial)")
                        endMascotCapture(REASON_NOISE)
                    } else {
                        Log.d(TAG, "Pedido do mascote recuperado do parcial: \"$lastPartial\"")
                        commandAttempts = 0
                        onCommandRecognized(lastPartial)
                        endMascotCapture(null)
                    }
                    return
                }

                // Durante o comando flutuante, uma falha passageira nÃ£o pode
                // custar a fala: tenta abrir o microfone de novo antes de desistir.
                if (sessionPhase == Phase.COMMAND && phase == Phase.COMMAND && isTransient(error)) {
                    Log.w(TAG, "Comando interrompido (${errorName(error)}): tentando de novo")
                    mainHandler.removeCallbacks(commandRetryRunnable)
                    mainHandler.postDelayed(commandRetryRunnable, 350L)
                    return
                }

                // SilÃªncio, ruÃ­do, sessÃ£o que morreu na largada ou falha de rede:
                // nenhuma fala foi ouvida. NÃ£o existe nova tentativa automÃ¡tica â€”
                // o microfone fecha e o usuÃ¡rio decide quando falar de novo
                // (toque no mascote ou no botÃ£o do app).
                Log.d(TAG, "SessÃ£o encerrada (${errorName(error)}): microfone fechado")

                endMascotCapture(failureReason(error))
            }

            override fun onReadyForSpeech(params: Bundle?) {
                if (stale()) return
                val fase = when (sessionPhase) {
                    Phase.DIRECT -> "pedido no app"
                    Phase.COMMAND -> "comando"
                    else -> "aviso"
                }
                Log.d(TAG, "Microfone aberto ($fase, sessÃ£o $id)")
            }

            override fun onBeginningOfSpeech() {
                if (stale()) return
                // Sinal direto do motor: houve fala. Vale para as duas vias.
                voiceDetected = true
                if (sessionPhase == Phase.DIRECT) directHeardSpeech = true
                Log.d(TAG, "Fala detectada")
            }

            override fun onRmsChanged(rmsdB: Float) {
                if (stale()) return
                noteRms(rmsdB)
            }

            override fun onBufferReceived(buffer: ByteArray?) {}

            override fun onEndOfSpeech() {
                if (stale()) return
                // A fala terminou: se o teto do pedido chegar agora, ele NÃƒO
                // estende (nÃ£o hÃ¡ mais ninguÃ©m falando para esperar).
                speechEnded = true
            }

            override fun onEvent(eventType: Int, params: Bundle?) {}
        }

    private fun firstResult(bundle: Bundle?): String =
        bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()

    // ----------------------------------------------------------------
    // Captura dentro do app
    // ----------------------------------------------------------------

    /**
     * Fecha a captura do app entregando (ou nÃ£o) o pedido.
     *
     * Sempre encerra a modalidade: o microfone fica fechado atÃ© o prÃ³ximo toque.
     */
    private fun endDirectCapture(reason: String, command: String? = null) {
        mainHandler.removeCallbacks(directTimeoutRunnable)
        lockProof = false
        stopInternal(notify = false)
        emitState()

        if (!command.isNullOrBlank()) {
            onCommandRecognized(command)
        }
        onDirectCaptureEnded(reason)
    }

    // ----------------------------------------------------------------
    // Comando do mascote (modo flutuante)
    // ----------------------------------------------------------------

    private fun startCommandCapture() {
        mainHandler.removeCallbacks(ackTimeoutRunnable)
        if (mode != Mode.FLOATING || phase != Phase.ACK) return

        phase = Phase.COMMAND
        commandAttempts = 1
        // SessÃ£o nova do pedido: o ambiente pode ser outro (o aviso "Estou
        // ouvindo" acabou de tocar), entÃ£o a mediÃ§Ã£o de volume recomeÃ§a.
        resetVad()
        Log.d(TAG, "Ouvindo o comando (${COMMAND_SILENCE_MS / 1000}s de silÃªncio)")
        emitState()
        openSession(commandIntent(), Phase.COMMAND)
    }

    /**
     * Separa a palavra de ativaÃ§Ã£o do pedido.
     *
     * "Nexus, toca a rÃ¡dio Itatiaia" Ã© o mesmo pedido que "toca a rÃ¡dio
     * Itatiaia": o nome Ã© o convite, nÃ£o o comando.
     *
     * A comparaÃ§Ã£o Ã© feita SEM acento ("NÃ©xus" = "nexus"), mas o corte Ã© feito
     * no texto original â€” Ã© o que o usuÃ¡rio ouviu que vai ser executado.
     *
     * @return o pedido sem o nome e `true` quando o nome foi dito.
     */
    private fun splitWakeWord(text: String): Pair<String, Boolean> {
        val cleaned = text.trim()
        val normalized = withoutAccents(cleaned)
        val match = WAKE_WORD.find(normalized) ?: return cleaned to false
        // A palavra de ativaÃ§Ã£o sÃ³ vale no COMEÃ‡O: "me manda o nexo da
        // mensagem" Ã© outro pedido.
        if (match.range.first > 2) return cleaned to false
        val without = cleaned.removeRange(match.range)
        return without.trim().trimStart(',', '.', '!', '-', ':').trim() to true
    }

    /** O texto sem acento e sem acento combinante ("NÃ©xus" â†’ "Nexus"). */
    private fun withoutAccents(value: String): String =
        java.text.Normalizer.normalize(value, java.text.Normalizer.Form.NFD)
            .replace(Regex("\\p{InCombiningDiacriticalMarks}+"), "")

    /**
     * Reabre o microfone do pedido depois de uma falha passageira.
     *
     * FIX: Reseta voiceDetected para nÃ£o carregar detecÃ§Ã£o da tentativa anterior.
     * Usa mascotIntent() (com bias MASCOT_BIAS) para consistÃªncia com a captura inicial.
     */
    private fun retryCommandCapture() {
        if (mode != Mode.FLOATING || phase != Phase.COMMAND) return

        if (commandAttempts >= MAX_COMMAND_ATTEMPTS) {
            Log.d(TAG, "Pedido nÃ£o capturado: microfone fechado (volta no toque)")
            endMascotCapture(REASON_ERROR)
            return
        }

        commandAttempts++
        resetVad() // FIX: reseta VAD completo incluindo voiceDetected
        Log.d(TAG, "Tentando o comando de novo ($commandAttempts/$MAX_COMMAND_ATTEMPTS)")
        openSession(mascotIntent(), Phase.COMMAND)
    }

    /** Falhas que costumam passar sozinhas na sessÃ£o seguinte. */
    private fun isTransient(error: Int): Boolean =
        error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY ||
            error == SpeechRecognizer.ERROR_CLIENT ||
            error == SpeechRecognizer.ERROR_AUDIO

    /**
     * Motivo do fim de uma captura DENTRO DO APP.
     *
     * Separa trÃªs coisas que a tela precisa dizer de formas diferentes: ninguÃ©m
     * falou, a rede falhou (o reconhecedor do Google depende dela) ou o
     * microfone deu problema. Antes tudo isso chegava como "error" e o usuÃ¡rio
     * recebia sempre o mesmo conselho, muitas vezes errado.
     */
    private fun directFailureReason(error: Int): String {
        if (isTransient(error) && vadSamples > 0 && !voiceDetected) {
            // Barulho interrompeu a sessÃ£o sem nenhuma fala: Ã© silÃªncio, nÃ£o
            // defeito â€” a tela pede para falar de novo em vez de acusar o microfone.
            return REASON_NOISE
        }
        return failureReason(error)
    }

    /** Motivo legÃ­vel de uma falha do reconhecedor. */
    private fun failureReason(error: Int): String = when (error) {
        SpeechRecognizer.ERROR_NO_MATCH,
        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> REASON_SILENCE

        SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED -> REASON_LANGUAGE_NOT_SUPPORTED

        SpeechRecognizer.ERROR_NETWORK,
        SpeechRecognizer.ERROR_NETWORK_TIMEOUT,
        SpeechRecognizer.ERROR_SERVER,
        ERROR_SERVER_DISCONNECTED -> REASON_NETWORK

        SpeechRecognizer.ERROR_AUDIO,
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> REASON_ERROR

        else -> REASON_ERROR
    }

    // ----------------------------------------------------------------
    // ConfirmaÃ§Ã£o falada
    // ----------------------------------------------------------------

    private fun ensureTts() {
        if (tts != null) return

        tts = TextToSpeech(context.applicationContext) { status ->
            mainHandler.post {
                ttsReady = status == TextToSpeech.SUCCESS
                if (!ttsReady) {
                    Log.w(TAG, "TTS indisponÃ­vel: confirmaÃ§Ã£o falada desativada")
                    return@post
                }
                try {
                    tts?.language = Locale("pt", "BR")
                    tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                        override fun onStart(utteranceId: String?) {}

                        override fun onDone(utteranceId: String?) {
                            mainHandler.post {
                                if (utteranceId == ACK_UTTERANCE_ID && phase == Phase.ACK) {
                                    mainHandler.postDelayed({
                                        startCommandCapture()
                                    }, ACK_TAIL_MS)
                                }
                            }
                        }

                        override fun onError(utteranceId: String?) {
                            mainHandler.post {
                                if (utteranceId == ACK_UTTERANCE_ID && phase == Phase.ACK) {
                                    startCommandCapture()
                                }
                            }
                        }

                        override fun onError(utteranceId: String?, errorCode: Int) {
                            onError(utteranceId)
                        }
                    })
                } catch (e: Exception) {
                    Log.w(TAG, "Falha ao configurar o TTS: ${e.message}")
                }
            }
        }
    }

    private fun speakAcknowledgement() {
        var speaking = false
        try {
            val engine = tts
            if (engine != null && ttsReady) {
                engine.stop()
                speaking = engine.speak(
                    ACK_PHRASE,
                    TextToSpeech.QUEUE_FLUSH,
                    null,
                    ACK_UTTERANCE_ID
                ) == TextToSpeech.SUCCESS
            }
        } catch (e: Exception) {
            Log.w(TAG, "Falha ao falar a confirmaÃ§Ã£o: ${e.message}")
        }

        if (!speaking) {
            Log.d(TAG, "ConfirmaÃ§Ã£o falada indisponÃ­vel: abrindo o microfone direto")
        }
        mainHandler.postDelayed(ackTimeoutRunnable, if (speaking) ACK_MAX_MS else ACK_FALLBACK_MS)
    }

    private fun stopSpeaking() {
        try {
            tts?.stop()
        } catch (_: Exception) {
            // TTS Ã© opcional.
        }
    }
}





