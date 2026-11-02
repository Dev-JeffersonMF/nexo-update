package com.jefferson.nexusassistente.native

import android.Manifest
import android.accessibilityservice.AccessibilityServiceInfo
import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import android.view.KeyEvent
import android.view.accessibility.AccessibilityManager
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.WritableNativeArray
import com.facebook.react.bridge.WritableNativeMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.jefferson.nexusassistente.MainActivity
import com.jefferson.nexusassistente.contacts.ContactFinder
import com.jefferson.nexusassistente.core.AppDetector
import com.jefferson.nexusassistente.media.MediaKeysController
import com.jefferson.nexusassistente.media.MusicLauncher
import com.jefferson.nexusassistente.media.RadioStreamManager
import com.jefferson.nexusassistente.service.NexusAccessibilityService
import com.jefferson.nexusassistente.service.NexusCallNotification
import com.jefferson.nexusassistente.service.NexusForegroundService
import com.jefferson.nexusassistente.service.NexusNotificationListenerService
import com.jefferson.nexusassistente.service.NexusOverlayService
import com.jefferson.nexusassistente.service.NexusPhoneCallManager
import com.jefferson.nexusassistente.reminder.ReminderActions
import com.jefferson.nexusassistente.reminder.ReminderScheduler
import com.jefferson.nexusassistente.storage.ChatStore
import com.jefferson.nexusassistente.storage.NeuralStore
import com.jefferson.nexusassistente.storage.Note
import com.jefferson.nexusassistente.storage.NoteStore
import com.jefferson.nexusassistente.storage.ProfileStore
import com.jefferson.nexusassistente.storage.Reminder
import com.jefferson.nexusassistente.storage.ReminderStore
import com.jefferson.nexusassistente.voice.NexusDeviceVoice
import com.jefferson.nexusassistente.voice.NexusVoiceEngine
import com.jefferson.nexusassistente.weather.WeatherProvider
import com.jefferson.nexusassistente.web.WebSearchProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.InputStream
import java.net.URL
import java.util.concurrent.Executors

class NexusNativeModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        /** Etiqueta do logcat deste mÃ³dulo (estado da tela e do microfone). */
        private const val TAG = "NEXUS_NATIVE"

        /** Degraus da escala de volume do Nexus (0 desligado â€¦ 5 mÃ¡ximo). */
        private const val VOLUME_STEPS = 5

        /**
         * Canal Ãºnico de eventos nativo â†’ JS. Fica nulo enquanto o bridge nÃ£o
         * estÃ¡ pronto, entÃ£o chamadas de [MainActivity] e do overlay sÃ£o
         * seguras antes de o React iniciar.
         */
        @Volatile
        private var eventSink: ((String, Map<String, Any>?) -> Unit)? = null

        /**
         * Suspende a escuta flutuante quando o assistente volta Ã  frente.
         *
         * Fica no companheiro porque quem avisa Ã© a [MainActivity] (`onResume`),
         * que nÃ£o tem acesso Ã  instÃ¢ncia do mÃ³dulo. Dentro do app o microfone sÃ³
         * pode abrir no toque do botÃ£o.
         */
        @Volatile
        private var voiceSuspender: (() -> Unit)? = null

        /** Emite um evento para o JS sem depender de uma instÃ¢ncia do mÃ³dulo. */
        fun emitEvent(name: String, params: Map<String, Any>? = null) {
            try {
                eventSink?.invoke(name, params)
            } catch (_: Exception) {
                // Evento Ã© opcional: nunca deve derrubar o app.
            }
        }

        /** Chamado pela [MainActivity.onResume]. */
        fun notifyAssistantForeground() {
            try {
                voiceSuspender?.invoke()
            } catch (_: Exception) {
                // Sem escuta ligada nÃ£o hÃ¡ o que suspender.
            }
        }

        /**
         * O usuÃ¡rio quer o despertar por "nexo" ligado.
         *
         * Fica no companheiro porque o serviÃ§o em primeiro plano precisa saber
         * se deve voltar a ouvir depois de uma fala ou de uma captura.
         */
        @Volatile
        private var wakeWordRequested = false

        /** Liga a escuta da palavra-chave no serviÃ§o em primeiro plano. */
        fun startWakeWordService(context: Context) {
            if (!wakeWordRequested) return
            try {
                val intent = Intent(context, NexusForegroundService::class.java).apply {
                    action = NexusForegroundService.ACTION_START_WAKE
                }
                ContextCompat.startForegroundService(context, intent)
            } catch (e: Exception) {
                Log.w(TAG, "NÃ£o consegui iniciar a escuta da palavra-chave: ${e.message}")
            }
        }

        /** Pausa a escuta (libera o microfone) sem desligar o pedido. */
        fun pauseWakeWord(context: Context) {
            try {
                val intent = Intent(context, NexusForegroundService::class.java).apply {
                    action = NexusForegroundService.ACTION_STOP_WAKE
                }
                context.startService(intent)
            } catch (_: Exception) {
                // ServiÃ§o jÃ¡ parado.
            }
        }

        /**
         * O app voltou para a frente: o microfone Ã© do botÃ£o/toque, nÃ£o da
         * palavra-chave. Desliga o serviÃ§o e esquece o pedido atÃ© o prÃ³ximo
         * retorno ao modo mascote.
         */
        fun onAssistantForeground(context: Context) {
            wakeWordRequested = false
            try {
                context.stopService(Intent(context, NexusForegroundService::class.java))
            } catch (_: Exception) {
                // ServiÃ§o jÃ¡ parado.
            }
        }
    }

    override fun getName(): String = "NexusNativeModule"

    private val context: Context = reactContext
    private val contactFinder = ContactFinder(context)
    private val appDetector = AppDetector(context)
    private val musicLauncher = MusicLauncher(context, appDetector)

    /** Controle da mÃºsica de outros apps (OiTube/YouTube) por eventos de mÃ­dia. */
    private val mediaKeys = MediaKeysController(context)
    private val radioManager = RadioStreamManager(
        context = context,
        onPlaybackStarted = { station ->
            emitEvent("onRadioPlaying", mapOf("station" to station))
        },
        onPlaybackError = { station, message ->
            emitEvent("onRadioError", mapOf("station" to station, "error" to message))
        },
        onPlayingChanged = { playing -> onRadioPlayingChanged(playing) },
    )

    /** Tipo de mÃ­dia que tocou por Ãºltimo: "radio", "youtube", "oitube", "music" */
    private var lastMediaType: String? = null
    private val weatherProvider = WeatherProvider(context)

    /**
     * Volume do som na escala do NEXUS: de 0 a 5.
     *
     * 0 = desligado, 1 a 3 = subindo, 4 = mÃ©dio, 5 = mÃ¡ximo.
     *
     * A escala Ã© nossa porque o volume do aparelho tem degraus prÃ³prios (15 no
     * aparelho de teste) e o usuÃ¡rio precisa de um nÃºmero que dÃª para lembrar
     * e pedir: "volume 3", "aumenta o som".
     */
    private val audioManager =
        context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

    /**
     * As consultas que vÃ£o para a internet (clima, pesquisa).
     *
     * Rodam fora da thread principal: a ponte do React Native nÃ£o pode ficar
     * esperando uma resposta de rede.
     */
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    /** A pesquisa do Nexus: ele mesmo, na internet, sem abrir o navegador. */
    private val webSearchProvider = WebSearchProvider()
    private val mainHandler = Handler(Looper.getMainLooper())

    /** Perfil do usuÃ¡rio (nome) â€” usado nas falas e no despertador. */
    private val profileStore = ProfileStore(context)
    /** HistÃ³rico da conversa: sobrevive ao React ser destruÃ­do em segundo plano. */
    private val chatStore = ChatStore(context)
    /** MemÃ³ria de aprendizado: a rede neural e a conversa que ela aprendeu. */
    private val neuralStore = NeuralStore(context)

    /** AnotaÃ§Ãµes e lembretes do prÃ³prio Nexus (nada de app externo). */
    private val noteStore = NoteStore(context)
    private val reminderStore = ReminderStore(context)
    private val reminderScheduler = ReminderScheduler(context)

    /** `true` quando o receptor de tela jÃ¡ estÃ¡ registrado. */
    private var screenReceiverRegistered = false

    private lateinit var voiceEngine: NexusVoiceEngine

    /**
     * A voz do Nexus: a melhor voz em portuguÃªs do Brasil que o aparelho tem.
     *
     * Ã‰ o TTS do prÃ³prio aparelho (o motor de voz do sistema), com a voz
     * **escolhida** â€” a local e neural, quando existir. NÃ£o hÃ¡ motor neural,
     * modelo embutido nem voz premium dentro do app.
     */
    private val deviceVoice = NexusDeviceVoice(context)

    init {
        eventSink = { name, params -> sendEvent(name, params) }
        NexusOverlayService.onMascotTapped = { handleMascotTap() }
        voiceEngine = NexusVoiceEngine(
            context = context,
            onCommandRecognized = { command ->
                NexusOverlayService.setListening(false)
                emitEvent("onCommandRecognized", mapOf("command" to command))
            },
            onDirectCaptureEnded = { reason ->
                NexusOverlayService.setListening(false)
                emitEvent("onCaptureEnded", mapOf("reason" to reason))
                // Terminou a captura: se o usuÃ¡rio estÃ¡ no modo mascote, a
                // palavra-chave volta a ouvir (a fala do Nexus pausa de novo).
                startWakeWordService(context)
            },
            onStateChanged = { emitVoiceState() },
        )
        voiceSuspender = { voiceEngine.suspendForForeground() }
        registerScreenStateReceiver()
        registerMascotTapReceiver()
    }

    /**
     * Recebe o broadcast do toque no mascote quando a ponte JS ainda nÃ£o
     * estÃ¡ pronta (processo recÃ©m-criado). Garante que a captura comece
     * assim que o mÃ³dulo nativo inicializar.
     */
    private fun registerMascotTapReceiver() {
        val filter = IntentFilter("com.jefferson.nexusassistente.MASCOT_TAP")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(mascotTapReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            context.registerReceiver(mascotTapReceiver, filter)
        }
    }

    private val mascotTapReceiver = object : BroadcastReceiver() {
        override fun onReceive(receiverContext: Context?, intent: Intent?) {
            if (intent?.getBooleanExtra("startCapture", false) == true) {
                Log.d(TAG, "Broadcast MASCOT_TAP recebido: iniciando captura do mascote")
                // O voiceEngine jÃ¡ existe (init jÃ¡ passou por aqui), entÃ£o
                // podemos chamar handleMascotTap direto.
                mainHandler.post { handleMascotTap() }
            }
        }
    }

    /**
     * Toque no mascote flutuante: prepara o ambiente e avisa o JS para abrir
     * o microfone com o viÃ©s correto (SHORT_ANSWER_BIAS).
     *
     * O app nÃ£o Ã© aberto por causa disso (isso Ã© o toque longo) e o microfone
     * fecha sozinho no fim da fala â€” Ã© a forma de falar com o Nexus com mÃºsica ou
     * rÃ¡dio tocando, quando a escuta passiva fica em espera.
     *
     * FIX: NÃƒO inicia a captura aqui (usava MASCOT_BIAS fixo). O lado JS recebe
     * o evento onMascotTapped e chama startDirectCapture(SHORT_ANSWER_BIAS),
     * garantindo viÃ©s dinÃ¢mico e evitando captura dupla.
     */
    private fun handleMascotTap() {
        // O toque SEMPRE cala o Nexus: se ele estiver respondendo, a fala para
        // na hora e o microfone assume. Sem isto, o microfone abria por cima da
        // prÃ³pria resposta e o Nexus nÃ£o entendia nada.
        try {
            deviceVoice.stop()
        } catch (e: Exception) {
            // Sem TTS nativo: segue para a escuta.
        }

        // Prioridade do microfone: a rÃ¡dio e a mÃºsica que estiverem tocando sÃ£o
        // PAUSADAS antes de o microfone abrir. Sem isto, o pedido do usuÃ¡rio
        // chega com a mÃºsica por cima e o Nexus nÃ£o entende nada.
        pauseMediaForMascot()
        // O microfone agora Ã© do mascote: a palavra-chave sai da frente.
        pauseWakeWord(context)
        NexusOverlayService.setListening(true)
        // NÃƒO chama voiceEngine.startMascotCapture() aqui â€” o JS farÃ¡ via
        // startDirectCapture(SHORT_ANSWER_BIAS) para ter viÃ©s dinÃ¢mico.
        emitEvent("onMascotTapped")
    }

    /**
     * Silencia a mÃ­dia para o microfone do mascote.
     *
     * A mesma regra da pausa: a rÃ¡dio do Nexus e a mÃºsica de outro aplicativo.
     * Falhar aqui nÃ£o impede a escuta â€” o usuÃ¡rio sÃ³ quer falar.
     */
    private fun pauseMediaForMascot() {
        try {
            if (radioManager.currentStationName() != null) {
                radioManager.pauseRadio()
                voiceEngine.setMediaPlaying(false)
            }
            if (mediaKeys.isMusicActive()) {
                mediaKeys.sendAndConfirm(KeyEvent.KEYCODE_MEDIA_PAUSE, expectPlaying = false)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Falha ao pausar a mÃ­dia para o mascote: ${e.message}")
        }
    }

    /** A rÃ¡dio do app comeÃ§ou/parou de soar: o mascote entra ou sai da espera. */
    private fun onRadioPlayingChanged(playing: Boolean) {
        if (::voiceEngine.isInitialized) voiceEngine.setMediaPlaying(playing)
    }

    /**
     * Avisa o motor de voz quando a tela bloqueia/acende.
     *
     * Com a tela bloqueada o microfone ficava abrindo e fechando sozinho (a cada
     * sessÃ£o o aparelho avisava com um "apitado"), porque a escuta passiva nÃ£o
     * sabia que ninguÃ©m estava na frente da tela.
     */
    private fun registerScreenStateReceiver() {
        if (screenReceiverRegistered) return
        try {
            val filter = IntentFilter().apply {
                addAction(Intent.ACTION_SCREEN_OFF)
                addAction(Intent.ACTION_SCREEN_ON)
                addAction(Intent.ACTION_USER_PRESENT)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.registerReceiver(screenStateReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                context.registerReceiver(screenStateReceiver, filter)
            }
            screenReceiverRegistered = true
            // O app pode ter sido aberto jÃ¡ com a tela bloqueada.
            voiceEngine.setScreenLocked(isScreenLocked())
        } catch (e: Exception) {
            Log.w(TAG, "NÃ£o foi possÃ­vel observar o estado da tela: ${e.message}")
        }
    }

    /** Tela apagada ou bloqueada: o microfone nÃ£o deve abrir. */
    private fun isScreenLocked(): Boolean {
        val power = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        val keyguard = context.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
        val screenOff = power?.isInteractive == false
        return screenOff || keyguard?.isKeyguardLocked == true
    }

    private val screenStateReceiver = object : BroadcastReceiver() {
        override fun onReceive(receiverContext: Context?, intent: Intent?) {
            when (intent?.action) {
                Intent.ACTION_SCREEN_OFF -> voiceEngine.setScreenLocked(true)
                Intent.ACTION_SCREEN_ON, Intent.ACTION_USER_PRESENT ->
                    voiceEngine.setScreenLocked(isScreenLocked())
            }
        }
    }

    /** Estado real do microfone, para a tela nunca mentir para o usuÃ¡rio. */
    private fun emitVoiceState() {
        emitEvent(
            "onVoiceStateChanged",
            mapOf(
                "mode" to voiceEngine.currentMode().name.lowercase(),
                "phase" to voiceEngine.currentPhase().name.lowercase(),
                "capturing" to voiceEngine.isCapturing,
            ),
        )
    }

    // ---------------------------------------------------------------------
    // Bridge / eventos
    // ---------------------------------------------------------------------

    /**
     * Exigidos pelo NativeEventEmitter no lado JS. Sem estes dois mÃ©todos o
     * emitter reclama e os eventos deixam de ser entregues de forma confiÃ¡vel.
     */
    @ReactMethod
    fun addListener(eventName: String) {
        // Nenhum estado a manter: os eventos vÃªm do canal estÃ¡tico.
    }

    @ReactMethod
    fun removeListeners(count: Double) {
        // Nenhum estado a manter.
    }

    private fun sendEvent(eventName: String, params: Map<String, Any>?) {
        val writableParams = params?.let { mapToWritableMap(it) }
        try {
            reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, writableParams)
        } catch (_: Exception) {
            // Bridge pode estar destruÃ­do; ignorar.
        }
    }

    private fun hasPermission(permission: String): Boolean {
        return ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
    }

    private fun canDrawOverlays(): Boolean {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(context)
    }

    /**
     * `true` quando o usuario LIGOU o "NEXUS Auto-Bot" nas configuracoes.
     *
     * A prova definitiva e o PROPRIO servico rodando: quando o
     * `NexusAccessibilityService` esta conectado, a automacao esta ligada -
     * sem depender de nenhuma permissao de leitura.
     *
     * As outras duas leituras sao reservas, porque nenhuma delas serve
     * sozinha em todo aparelho:
     *
     * - `Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES` (a configuracao do
     *   Android) VOLTA `null` para apps comuns em algumas versoes do
     *   Android - a leitura e protegida. Foi por causa dela que o app dizia
     *   "a automacao esta desligada" com o auto-bot ligado e conectado, e o
     *   usuario re-liberava uma permissao que ja tinha aceito.
     * - A lista de servicos ATIVOS do sistema nao lista o servico quando ele
     *   cai, e em alguns ROMs a mascara de feedback nao devolve o servico que
     *   declara apenas `feedbackGeneric`.
     */
    private fun isAccessibilityServiceEnabled(): Boolean {
        // 1) O servico vivo: quando ele esta conectado, a automacao esta ON.
        if (NexusAccessibilityService.isConnected()) return true

        // 2) A configuracao do Android (quando o aparelho deixa ler).
        val component = "${context.packageName}/${NexusAccessibilityService::class.java.name}"
        try {
            val enabled = Settings.Secure.getString(
                context.contentResolver,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            )
            Log.d(TAG, "A11Y check: component=$component enabled=[$enabled]")
            if (!enabled.isNullOrBlank()) {
                val parts = enabled.split(':').map { it.trim() }
                if (parts.any { it.equals(component, ignoreCase = true) }) return true
                // Alguns aparelhos gravam a forma curta (sÃ³ o nome da classe).
                val shortName = component.substringAfter('/')
                if (parts.any { it.equals(shortName, ignoreCase = true) }) return true
            }
        } catch (e: Exception) {
            Log.w(TAG, "Falha ao ler as permissÃµes de acessibilidade: ${e.message}")
        }

        // 3) A lista de servicos ativos do sistema, como ultima reserva.
        return try {
            val manager = context.getSystemService(Context.ACCESSIBILITY_SERVICE) as? AccessibilityManager
            manager
                ?.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)
                ?.any { it.resolveInfo?.serviceInfo?.packageName == context.packageName } == true
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Confere o Auto-Bot ANTES de abrir o WhatsApp.
     *
     * Reinstalar o APK desliga o serviÃ§o de acessibilidade no Android. Sem esta
     * checagem o Nexus abria a conversa pelo link `wa.me` (que nÃ£o depende de
     * acessibilidade) e depois ficava sem conseguir escrever ou tocar em nada â€”
     * a promessa do React Native nunca era resolvida e a tela ficava em
     * "Pensando...". Quando o serviÃ§o estÃ¡ desligado, a resposta agora Ã©
     * imediata e diz o que fazer.
     */
    private fun ensureAccessibilityAutomation(promise: Promise): Boolean {
        if (NexusAccessibilityService.isConnected()) return true
        val enabled = isAccessibilityServiceEnabled()
        promise.resolve(
            commandResult(
                success = false,
                error = if (enabled) {
                    "O serviÃ§o de acessibilidade do Nexus estÃ¡ ligado, mas ainda nÃ£o conectou. Abra o Nexus de novo e repita o pedido."
                } else {
                    "A automaÃ§Ã£o do Nexus estÃ¡ desligada. Ative o \"NEXUS Auto-Bot\" em Acessibilidade, nas configuraÃ§Ãµes do Android."
                }
            )
        )
        return false
    }

    private fun openSettingsIntent(intent: Intent, promise: Promise) {
        try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SETTINGS_ERROR", e.message ?: "NÃ£o foi possÃ­vel abrir os ajustes")
        }
    }

    /**
     * Retorno padrÃ£o de um comando nativo.
     *
     * Precisa ser `WritableNativeMap`: o React Native 0.86 sÃ³ converte mapa
     * "writable" na volta para o JS. Devolver um `mapOf` do Kotlin derruba a
     * chamada com "Cannot convert argument of type class
     * java.util.Collections$SingletonMap" â€” era isso que fazia "tocar mÃºsica",
     * WhatsApp, ligaÃ§Ã£o e abrir app falharem mesmo com o comando reconhecido.
     */
    private fun commandResult(
        success: Boolean,
        error: String? = null,
        contactName: String? = null,
        appName: String? = null,
        video: Boolean? = null,
        mediaAction: String? = null,
    ): WritableMap = WritableNativeMap().apply {
        putBoolean("success", success)
        error?.let { putString("error", it) }
        contactName?.let { putString("contactName", it) }
        appName?.let { putString("appName", it) }
        video?.let { putBoolean("video", it) }
        mediaAction?.let { putString("mediaAction", it) }
    }

    private fun noteToMap(note: Note): WritableMap = WritableNativeMap().apply {
        putString("id", note.id)
        putString("title", note.title)
        putString("text", note.text)
        putDouble("createdAt", note.createdAt.toDouble())
    }

    private fun reminderToMap(reminder: Reminder): WritableMap = WritableNativeMap().apply {
        putString("id", reminder.id)
        putString("title", reminder.title)
        putString("description", reminder.description)
        putDouble("triggerAtMillis", reminder.triggerAtMillis.toDouble())
        putBoolean("enabled", reminder.enabled)
        putBoolean("repeatDaily", reminder.repeatDaily)
        putDouble("createdAt", reminder.createdAt.toDouble())
        putString("kind", reminder.kind)
    }

    private fun mapToWritableMap(map: Map<String, Any>): WritableMap {
        val writableMap = WritableNativeMap()
        map.forEach { (key, value) ->
            when (value) {
                is String -> writableMap.putString(key, value)
                is Int -> writableMap.putInt(key, value)
                is Long -> writableMap.putLong(key, value)
                is Double -> writableMap.putDouble(key, value)
                is Float -> writableMap.putDouble(key, value.toDouble())
                is Boolean -> writableMap.putBoolean(key, value)
                is Map<*, *> -> writableMap.putMap(key, mapToWritableMap(value as Map<String, Any>))
                is List<*> -> writableMap.putArray(key, listToWritableArray(value as List<Any?>))
                else -> writableMap.putString(key, value.toString())
            }
        }
        return writableMap
    }

    private fun listToWritableArray(list: List<Any?>): WritableArray {
        val writableArray = WritableNativeArray()
        list.forEach { value ->
            when (value) {
                is String -> writableArray.pushString(value)
                is Int -> writableArray.pushInt(value)
                is Long -> writableArray.pushLong(value)
                is Double -> writableArray.pushDouble(value)
                is Float -> writableArray.pushDouble(value.toDouble())
                is Boolean -> writableArray.pushBoolean(value)
                is Map<*, *> -> writableArray.pushMap(mapToWritableMap(value as Map<String, Any>))
                is List<*> -> writableArray.pushArray(listToWritableArray(value as List<Any?>))
                else -> writableArray.pushString(value.toString())
            }
        }
        return writableArray
    }

    // ---------------------------------------------------------------------
    // Mascote flutuante / janela do assistente
    // ---------------------------------------------------------------------

    /**
     * Summona o mascote: minimiza o assistente (vai para a home) e mostra o
     * mascote flutuante sobre os outros apps. Nunca mostra sobre o assistente.
     */
    @ReactMethod
    fun summonMascot(promise: Promise) {
        if (!canDrawOverlays()) {
            promise.reject(
                "OVERLAY_PERMISSION_DENIED",
                "Para o mascote aparecer sobre outros apps, libere \"Sobrepor outros apps\"."
            )
            return
        }
        try {
            MainActivity.moveToBack()
            mainHandler.postDelayed({
                // Regra de produto: o mascote nunca pode ficar sobre a tela do
                // assistente. Se minimizar falhou, nÃ£o mostramos nada.
                if (MainActivity.isResumedForeground()) return@postDelayed
                NexusOverlayService.show(context)
            }, 350)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("OVERLAY_ERROR", e.message ?: "NÃ£o foi possÃ­vel mostrar o mascote")
        }
    }

    /**
     * Mostra o mascote flutuante sem mexer na janela do assistente.
     *
     * Diferente de [summonMascot]: aqui o app jÃ¡ estÃ¡ em segundo plano (por
     * exemplo, quando o usuÃ¡rio abre outro aplicativo) e sÃ³ falta exibir o
     * mascote. Continua valendo a regra de nunca cobrir a tela do assistente.
     */
    @ReactMethod
    fun showMascot(promise: Promise) {
        if (!canDrawOverlays()) {
            promise.reject(
                "OVERLAY_PERMISSION_DENIED",
                "Para o mascote aparecer sobre outros apps, libere \"Sobrepor outros apps\"."
            )
            return
        }
        try {
            if (MainActivity.isResumedForeground()) {
                promise.resolve(false)
                return
            }
            NexusOverlayService.show(context)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("OVERLAY_ERROR", e.message ?: "NÃ£o foi possÃ­vel mostrar o mascote")
        }
    }

    @ReactMethod
    fun hideMascot(promise: Promise) {
        NexusOverlayService.hide()
        promise.resolve(null)
    }

    @ReactMethod
    fun isMascotVisible(promise: Promise) {
        promise.resolve(NexusOverlayService.isVisible())
    }

    /** Minimiza o assistente (volta para a home). */
    @ReactMethod
    fun minimizeApp(promise: Promise) {
        promise.resolve(MainActivity.moveToBack())
    }

    /** Traz o assistente de volta para a frente. */
    @ReactMethod
    fun openAssistant(promise: Promise) {
        try {
            MainActivity.launch(context)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("OPEN_ASSISTANT_ERROR", e.message)
        }
    }

    // ---------------------------------------------------------------------
    // Voz
    //
    // Duas portas separadas, nunca ligadas juntas:
    //  - `startDirectCapture`: o botÃ£o de microfone DENTRO do app. Uma captura,
    //    sem palavra de ativaÃ§Ã£o e sem a regra dos 5 s;
    //  - `startFloatingListening`: o mascote estÃ¡ na tela (ele NÃƒO ouve sozinho);
    //    o microfone sÃ³ abre no toque dele (`startMascotCapture`).
    // ---------------------------------------------------------------------

    /** O mascote estÃ¡ na tela. NÃƒO abre o microfone: quem abre Ã© o toque nele. */
    @ReactMethod
    fun startFloatingListening(promise: Promise) {
        if (!hasPermission(Manifest.permission.RECORD_AUDIO)) {
            promise.reject(
                "MICROPHONE_PERMISSION_DENIED",
                "PermissÃ£o de microfone nÃ£o concedida. Libere o Microfone na tela de permissÃµes."
            )
            return
        }
        try {
            voiceEngine.startFloatingListening()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("VOICE_ERROR", e.message)
        }
    }

    /**
     * O botÃ£o de microfone da tela principal: ouvir UM pedido, agora.
     *
     * Sem palavra de ativaÃ§Ã£o (o usuÃ¡rio jÃ¡ estÃ¡ falando com o Nexus) e sem
     * retentativa: termina no fim da fala, no silÃªncio ou no teto de tempo, e o
     * microfone fecha. Foi este caminho que substituiu o antigo vaivÃ©m de abre
     * e fecha sozinho.
     */
    @ReactMethod
    fun startDirectCapture(bias: ReadableArray?, promise: Promise) {
        if (!hasPermission(Manifest.permission.RECORD_AUDIO)) {
            promise.reject(
                "MICROPHONE_PERMISSION_DENIED",
                "PermissÃ£o de microfone nÃ£o concedida. Libere o Microfone na tela de permissÃµes."
            )
            return
        }
        try {
            // A captura do comando Ã© prioridade: pausa a palavra-chave para os
            // dois reconhecedores nÃ£o disputarem o microfone.
            pauseWakeWord(context)
            val words = ArrayList<String>()
            if (bias != null) {
                for (index in 0 until bias.size()) {
                    val word = bias.getString(index)?.trim().orEmpty()
                    if (word.isNotEmpty()) words.add(word)
                }
            }
            voiceEngine.startDirectCapture(words)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("VOICE_ERROR", e.message)
        }
    }

    /**
     * A RESPOSTA de uma notificaÃ§Ã£o: abre o microfone mesmo com a tela
     * APAGADA/BLOQUEADA.
     *
     * O fluxo Ã© sempre o mesmo: o Nexus PERGUNTA ("quer que eu leia?") e o
     * usuÃ¡rio responde de ouvido, muitas vezes com o aparelho no bolso. Na
     * captura comum a trava de tela fechava o microfone na hora e o "sim"
     * nunca chegava â€” por isto existe uma porta separada (ver
     * [com.jefferson.nexusassistente.voice.NexusVoiceEngine.lockProof]).
     */
    @ReactMethod
    fun startNotificationAnswerCapture(bias: ReadableArray?, promise: Promise) {
        if (!hasPermission(Manifest.permission.RECORD_AUDIO)) {
            promise.reject(
                "MICROPHONE_PERMISSION_DENIED",
                "PermissÃ£o de microfone nÃ£o concedida. Libere o Microfone na tela de permissÃµes."
            )
            return
        }
        try {
            pauseWakeWord(context)
            val words = ArrayList<String>()
            if (bias != null) {
                for (index in 0 until bias.size()) {
                    val word = bias.getString(index)?.trim().orEmpty()
                    if (word.isNotEmpty()) words.add(word)
                }
            }
            voiceEngine.startNotificationAnswerCapture(words)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("VOICE_ERROR", e.message)
        }
    }

    /**
     * Envia a resposta SEM ABRIR o WhatsApp: a aÃ§Ã£o "Responder" da prÃ³pria
     * notificaÃ§Ã£o (RemoteInput). Funciona com a tela apagada e bloqueada.
     */
    @ReactMethod
    fun sendWhatsAppNotificationReply(contact: String, message: String, promise: Promise) {
        val sent = try {
            NexusNotificationListenerService.replyToWhatsAppContact(contact, message)
        } catch (e: Exception) {
            Log.w(TAG, "Responder direto falhou: ${e.message}")
            false
        }
        promise.resolve(sent)
    }

    /** `true` quando dÃ¡ para responder sem abrir o WhatsApp agora. */
    @ReactMethod
    fun canReplyWithoutOpeningWhatsApp(promise: Promise) {
        val can = try {
            NexusNotificationListenerService.canReplyWithoutOpeningWhatsApp()
        } catch (e: Exception) {
            false
        }
        promise.resolve(can)
    }

    /** Fecha o microfone em qualquer modalidade. */
    @ReactMethod
    fun stopListening(promise: Promise) {
        try {
            voiceEngine.stopListening()
            // Terminou a captura do comando: a palavra-chave pode voltar a
            // ouvir, desde que o usuÃ¡rio esteja no modo mascote.
            startWakeWordService(context)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("VOICE_ERROR", e.message)
        }
    }

    /**
     * Avisa o motor de voz que o assistente estÃ¡ falando (ou parou de falar).
     *
     * O JS chama `true` antes de comeÃ§ar a resposta falada e `false` quando ela
     * termina. Com isso o microfone fica fechado enquanto o Nexus fala â€” sem
     * essa trava o reconhecedor ouvia a prÃ³pria resposta, um novo comando era
     * entregue e a fala seguinte cortava a pergunta no meio.
     */
    @ReactMethod
    fun setAssistantSpeaking(speaking: Boolean, promise: Promise) {
        try {
            voiceEngine.setAssistantSpeaking(speaking)
            if (speaking) {
                // O Nexus estÃ¡ falando: a palavra-chave nÃ£o pode ouvir a prÃ³pria
                // voz e acordar sozinha.
                pauseWakeWord(context)
            } else {
                // Terminou a fala: volta a ouvir "nexo" se o modo mascote estÃ¡ ativo.
                startWakeWordService(context)
            }
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("VOICE_ERROR", e.message)
        }
    }

    /** Modalidade e fase atuais do microfone (o JS usa para desenhar a tela). */
    @ReactMethod
    fun getVoiceState(promise: Promise) {
        promise.resolve(
            WritableNativeMap().apply {
                putString("mode", voiceEngine.currentMode().name.lowercase())
                putString("phase", voiceEngine.currentPhase().name.lowercase())
                putBoolean("capturing", voiceEngine.isCapturing)
            }
        )
    }

    // ---------------------------------------------------------------------
    // A voz do Nexus
    //
    // A voz Ã© a do PRÃ“PRIO APARELHO (pt-BR), com a melhor voz disponÃ­vel
    // escolhida pelo nativo (a local e neural, quando existir). O `expo-speech`
    // fica como caminho genÃ©rico, para quando o nativo nÃ£o estÃ¡ disponÃ­vel.
    //
    // NÃ£o existe nenhum outro motor dentro do app: nada de voz neural
    // embutida, nada de modelo no APK, nada de servidor.
    // ---------------------------------------------------------------------

    /**
     * Fala o texto com a voz do aparelho.
     *
     * Resolve `true` quando a fala chegou ao fim e `false` quando nÃ£o deu
     * para falar. Nunca deixa a promessa pendurada: o motor tem teto de tempo.
     */
    @ReactMethod
    fun speakVoice(text: String, promise: Promise) {
        try {
            val spoken = text.trim()
            if (spoken.isEmpty()) {
                promise.resolve(false)
                return
            }

            var settled = false
            deviceVoice.speak(spoken) { finished ->
                if (settled) return@speak
                settled = true
                promise.resolve(finished)
            }
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    /** Interrompe a fala (usado quando o Nexus para de falar). */
    @ReactMethod
    fun stopVoice(promise: Promise) {
        try {
            deviceVoice.stop()
            promise.resolve(null)
        } catch (e: Exception) {
            promise.resolve(null)
        }
    }

    /**
     * Abre a tela do Android para baixar a voz em portuguÃªs do Brasil.
     *
     * A voz que o Nexus usa Ã© a do aparelho, e o pacote de voz Ã© o que estiver
     * instalado. Quando sÃ³ existe a voz "standard" â€” a que soa robÃ³tica â€”, o
     * caminho Ã© baixar a neural (Cacilda, Katita, Maria, Yara): a partir daÃ­
     * ela aparece como voz LOCAL e o `NexusDeviceVoice` escolhe sozinho.
     */
    @ReactMethod
    fun installVoiceData(promise: Promise) {
        try {
            val install = Intent("android.speech.tts.engine.INSTALL_TTS_DATA").apply {
                putExtra("language", "pt-BR")
                putExtra("country", "BR")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            // A tela de baixar a voz Ã© do motor de voz: se nÃ£o houver (motor
            // ausente ou sem essa tela), abre a configuraÃ§Ã£o de voz do Android.
            val target = if (install.resolveActivity(context.packageManager) != null) {
                install
            } else {
                Intent("android.intent.action.TTS_SETTINGS").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(target)
            promise.resolve(true)
        } catch (e: Exception) {
            Log.w(TAG, "Nao consegui abrir a tela de voz do sistema: ${e.message}")
            promise.resolve(false)
        }
    }

    /**
     * A pesquisa do Nexus: ele mesmo, na internet, sem abrir o navegador.
     *
     * Devolve a resposta pronta para ser falada e de onde ela veio. Quando
     * nenhuma fonte responde, resolve `null` â€” o app avisa que nÃ£o conseguiu,
     * em vez de inventar.
     */
    @ReactMethod
    fun searchWeb(query: String, promise: Promise) {
        val text = query.trim()
        if (text.isEmpty()) {
            promise.resolve(null)
            return
        }
        scope.launch {
            val answer = withContext(Dispatchers.IO) { webSearchProvider.search(text) }
            if (answer == null) {
                promise.resolve(null)
                return@launch
            }
            promise.resolve(
                WritableNativeMap().apply {
                    putString("answer", answer.answer)
                    putString("title", answer.title)
                    putString("source", answer.source)
                    putString("url", answer.url)
                },
            )
        }
    }

    /**
     * As vozes em portuguÃªs que o aparelho tem (para o app mostrar e para o
     * diagnÃ³stico). A primeira da lista Ã© a que o Nexus usa.
     */
    @ReactMethod
    fun listVoices(promise: Promise) {
        try {
            val voices = WritableNativeArray()
            for (voice in deviceVoice.portugueseVoices()) {
                voices.pushMap(
                    WritableNativeMap().apply {
                        putString("id", voice.name)
                        putString("locale", voice.locale.toString())
                        putInt("quality", voice.quality)
                        putBoolean("network", voice.isNetworkConnectionRequired)
                    }
                )
            }
            promise.resolve(voices)
        } catch (e: Exception) {
            promise.resolve(WritableNativeArray())
        }
    }

    // ---------------------------------------------------------------------
    // DetecÃ§Ã£o de apps
    // ---------------------------------------------------------------------

    @ReactMethod
    fun getInstalledApps(promise: Promise) {
        try {
            val apps = appDetector.getInstalledApps()
            val writableArray = WritableNativeArray()
            for (app in apps) {
                val appMap = WritableNativeMap().apply {
                    putString("packageName", app.packageName)
                    putString("appName", app.appName)
                    putString("versionName", app.versionName ?: "")
                    putLong("versionCode", app.versionCode)
                    putBoolean("isSystemApp", app.isSystemApp)
                    val caps = WritableNativeMap().apply {
                        putBoolean("supportsWhatsAppMessaging", app.capabilities.supportsWhatsAppMessaging)
                        putBoolean("supportsWhatsAppCalls", app.capabilities.supportsWhatsAppCalls)
                        putBoolean("supportsYouTubePlayback", app.capabilities.supportsYouTubePlayback)
                        putBoolean("supportsMediaControls", app.capabilities.supportsMediaControls)
                        putBoolean("supportsRadioStreaming", app.capabilities.supportsRadioStreaming)
                        putBoolean("supportsVoiceAssistant", app.capabilities.supportsVoiceAssistant)
                    }
                    putMap("capabilities", caps)
                }
                writableArray.pushMap(appMap)
            }
            promise.resolve(writableArray)
        } catch (e: Exception) {
            promise.reject("APP_DETECTION_ERROR", e.message)
        }
    }

    @ReactMethod
    fun isPackageInstalled(packageName: String, promise: Promise) {
        promise.resolve(appDetector.isPackageInstalled(packageName))
    }

    @ReactMethod
    fun launchApp(packageName: String, promise: Promise) {
        promise.resolve(appDetector.launchApp(packageName))
    }

    /** Abre um app pelo nome amigÃ¡vel (ex.: "youtube", "calculadora"). */
    @ReactMethod
    fun launchAppByName(name: String, promise: Promise) {
        try {
            val query = name.lowercase().trim()
            val match = appDetector.getInstalledApps().firstOrNull { app ->
                !app.isSystemApp && app.appName.lowercase().contains(query)
            } ?: appDetector.getInstalledApps().firstOrNull { app ->
                app.appName.lowercase().contains(query)
            }
            if (match != null && appDetector.launchApp(match.packageName)) {
                promise.resolve(commandResult(success = true, appName = match.appName))
            } else {
                promise.resolve(commandResult(success = false, error = "App nÃ£o encontrado"))
            }
        } catch (e: Exception) {
            promise.reject("LAUNCH_APP_ERROR", e.message)
        }
    }

    // ---------------------------------------------------------------------
    // WhatsApp / chamadas
    // ---------------------------------------------------------------------

    /**
     * Envia mensagem no WhatsApp: abre o chat do contato, espera a tela carregar,
     * injeta o texto e clica em enviar. Tudo no lado nativo, sem depender de
     * coordenaÃ§Ã£o externa que falha por timing.
     *
     * Fluxo:
     * 1. Tenta abrir direto pelo wa.me (rÃ¡pido)
     * 2. Se falhar ou contato nÃ£o encontrado, abre WhatsApp e busca o nome
     * 3. Quando o chat abre, injeta o texto e clica em enviar
     */
    @ReactMethod
    fun sendWhatsAppMessage(contactName: String, message: String, promise: Promise) {
        // Sem o serviÃ§o ligado nada seria escrito nem tocado: responde antes de
        // abrir a conversa, em vez de deixar o comando travado.
        if (!ensureAccessibilityAutomation(promise)) return

        val contact = contactFinder.searchContact(contactName)
        if (contact == null) {
            // Contato nÃ£o na agenda: tenta buscar direto no WhatsApp pelo nome
            searchAndSendWhatsAppMessage(contactName, message, promise)
            return
        }

        // O nome da agenda Ã© a melhor resposta, mas hÃ¡ contatos sem
        // DISPLAY_NAME (sÃ³ nÃºmero). Nesse caso devolvemos o nome que o
        // usuÃ¡rio falou para a confirmaÃ§Ã£o nunca sair vazia.
        val displayName = contact.name.takeIf { it.isNotBlank() } ?: contactName

        // VERIFICAÃ‡ÃƒO: o contato existe na agenda, mas tem WhatsApp?
        // Nem todo contato salvo tem conta no WhatsApp. Se nÃ£o tiver, nÃ£o
        // adianta tentar enviar â€” avisa o usuÃ¡rio com clareza.
        if (!contactFinder.hasWhatsAppAccount(contact.phoneNumber)) {
            promise.resolve(
                commandResult(
                    success = false,
                    error = "$displayName nÃ£o tem WhatsApp. NÃ£o foi possÃ­vel enviar a mensagem."
                )
            )
            return
        }

        val opened = contactFinder.openWhatsAppChat(contact.phoneNumber)
        if (!opened) {
            // wa.me falhou: tenta buscar no WhatsApp
            searchAndSendWhatsAppMessage(displayName, message, promise)
            return
        }

        // Agenda a injeÃ§Ã£o + envio para quando a tela do chat abrir (via acessibilidade)
        NexusAccessibilityService.injectTextAndSendAndWait(message) { chatOpened, sent ->
            when {
                sent ->
                    promise.resolve(commandResult(success = true, contactName = displayName))
                // A conversa abriu: procurar o contato de novo reescreveria a
                // mensagem no campo (rascunho) e poderia duplicÃ¡-la. Falha honesta.
                chatOpened ->
                    promise.resolve(
                        commandResult(
                            success = false,
                            error = "A conversa com $displayName abriu, mas nÃ£o consegui confirmar o envio da mensagem."
                        )
                    )
                // Nem a conversa abriu: aÃ­ sim vale procurar pelo nome no WhatsApp.
                else -> searchAndSendWhatsAppMessage(displayName, message, promise)
            }
        }
    }

    /**
     * Apaga a ÃšLTIMA mensagem enviada na conversa do contato (ou na conversa
     * que estÃ¡ aberta, quando o pedido nÃ£o diz o nome).
     *
     * O fluxo Ã© o que o usuÃ¡rio determinou: pressionar a mensagem enviada â†’
     * lixeira no topo Ã  esquerda â†’ "Apagar para todos" (nunca "sÃ³ para mim").
     * Cada falha volta com o motivo real â€” o Nexus avisa em vez de fingir.
     */
    @ReactMethod
    fun deleteLastSentMessage(contactName: String, promise: Promise) {
        if (!ensureAccessibilityAutomation(promise)) return

        val wanted = contactName.trim()
        if (wanted.isEmpty()) {
            // Sem contato: apaga na conversa que estÃ¡ na frente agora.
            mainHandler.post {
                NexusAccessibilityService.deleteLastSentMessage { ok, reason ->
                    promise.resolve(commandResult(ok, error = reason))
                }
            }
            return
        }

        scope.launch {
            val contact = contactFinder.searchContact(wanted)
            if (contact != null && contactFinder.openWhatsAppChat(contact.phoneNumber)) {
                mainHandler.post {
                    NexusAccessibilityService.deleteLastSentMessage { ok, reason ->
                        promise.resolve(commandResult(ok, error = reason, contactName = wanted))
                    }
                }
                return@launch
            }

            // NÃ£o estÃ¡ na agenda (ou o link nÃ£o abriu): procura a conversa
            // pelo nome dentro do prÃ³prio WhatsApp.
            NexusAccessibilityService.searchAndOpenWhatsAppContact(wanted) { chatOpened ->
                if (!chatOpened) {
                    promise.resolve(
                        commandResult(false, error = "NÃ£o encontrei a conversa de $wanted.")
                    )
                    return@searchAndOpenWhatsAppContact
                }
                NexusAccessibilityService.deleteLastSentMessage { ok, reason ->
                    promise.resolve(commandResult(ok, error = reason, contactName = wanted))
                }
            }
        }
    }

    /**
     * Os nomes das listas de transmissÃ£o que existem no WhatsApp.
     *
     * Serve para o Nexus perguntar "para qual lista?" quando hÃ¡ mais de uma.
     */
    @ReactMethod
    fun listBroadcastLists(promise: Promise) {
        if (!ensureAccessibilityAutomation(promise)) return

        NexusAccessibilityService.listBroadcastLists { names ->
            val result = WritableNativeMap()
            result.putBoolean("success", names.isNotEmpty())
            val array = WritableNativeArray()
            names.forEach { array.pushString(it) }
            result.putArray("lists", array)
            if (names.isEmpty()) {
                result.putString("error", "NÃ£o achei nenhuma lista de transmissÃ£o no WhatsApp.")
            }
            promise.resolve(result)
        }
    }

    /**
     * Envia uma mensagem para a LISTA DE TRANSMISSÃƒO do WhatsApp.
     *
     * A lista jÃ¡ existe no WhatsApp: o Nexus abre o app, vai em Listas de
     * transmissÃ£o, abre a lista, escreve a mensagem dita pelo usuÃ¡rio e toca em
     * enviar.
     */
    @ReactMethod
    fun sendWhatsAppBroadcast(message: String, listName: String?, promise: Promise) {
        if (!ensureAccessibilityAutomation(promise)) return

        NexusAccessibilityService.sendToBroadcastList(message, listName) { sent ->
            if (sent) {
                promise.resolve(commandResult(success = true))
            } else {
                promise.resolve(
                    commandResult(
                        success = false,
                        error = "NÃ£o achei a lista de transmissÃ£o na conversa do WhatsApp. Crie a lista em Conversas â€º Listas de transmissÃ£o ou diga o nome dela."
                    )
                )
            }
        }
    }

    /**
     * Fallback: abre o WhatsApp, busca o contato pelo nome e envia a mensagem.
     */
    private fun searchAndSendWhatsAppMessage(contactName: String, message: String, promise: Promise) {
        NexusAccessibilityService.searchAndOpenWhatsAppContact(contactName) { chatOpened ->
            if (!chatOpened) {
                promise.resolve(commandResult(success = false, error = "NÃ£o consegui encontrar o contato no WhatsApp"))
            } else {
                // Chat aberto: injeta e envia
                NexusAccessibilityService.injectTextAndSendAndWait(message) { _, sent ->
                    if (sent) {
                        promise.resolve(commandResult(success = true, contactName = contactName))
                    } else {
                        promise.resolve(commandResult(success = false, error = "NÃ£o consegui escrever/enviar a mensagem"))
                    }
                }
            }
        }
    }

    /**
     * Faz a chamada (voz ou vÃ­deo) pelo WhatsApp.
     *
     * Antes este mÃ©todo sÃ³ ABRIA a conversa e devolvia sucesso â€” o app anunciava
     * "chamada aberta" sem nunca ter ligado. Agora ele abre a conversa, dispara
     * o fluxo real (menu de ligaÃ§Ã£o â†’ voz/vÃ­deo) e sÃ³ devolve sucesso quando a
     * tela de chamada assume a frente.
     */
    @ReactMethod
    fun makeWhatsAppCall(contactName: String, isVideo: Boolean, promise: Promise) {
        // Mesma trava do envio: o link wa.me abriria a conversa, mas a chamada
        // nunca sairia sem o serviÃ§o de acessibilidade.
        if (!ensureAccessibilityAutomation(promise)) return

        val contact = contactFinder.searchContact(contactName)

        if (contact == null) {
            // NÃ£o estÃ¡ na agenda: procura pelo nome dentro do WhatsApp e liga de lÃ¡.
            searchAndCall(contactName, isVideo, promise)
            return
        }

        // Mesmo cuidado do envio: contato sem DISPLAY_NAME nÃ£o pode deixar a
        // confirmaÃ§Ã£o da chamada sem nome.
        val displayName = contact.name.takeIf { it.isNotBlank() } ?: contactName

        // VERIFICAÃ‡ÃƒO: o contato existe na agenda, mas tem WhatsApp?
        if (!contactFinder.hasWhatsAppAccount(contact.phoneNumber)) {
            promise.resolve(
                commandResult(
                    success = false,
                    error = "$displayName nÃ£o tem WhatsApp. NÃ£o foi possÃ­vel fazer a chamada."
                )
            )
            return
        }

        val opened = contactFinder.openWhatsAppChat(contact.phoneNumber)
        if (!opened) {
            // wa.me falhou: procura pelo nome dentro do WhatsApp.
            searchAndCall(displayName, isVideo, promise)
            return
        }

        startCallAndResolve(isVideo, displayName, promise)
    }

    /** Busca o contato dentro do WhatsApp, abre a conversa e liga. */
    private fun searchAndCall(contactName: String, isVideo: Boolean, promise: Promise) {
        NexusAccessibilityService.searchAndOpenWhatsAppContact(contactName) { chatOpened ->
            if (!chatOpened) {
                promise.resolve(
                    commandResult(
                        success = false,
                        error = "NÃ£o encontrei \"$contactName\" no WhatsApp"
                    )
                )
                return@searchAndOpenWhatsAppContact
            }
            startCallAndResolve(isVideo, contactName, promise)
        }
    }

    /** Dispara a chamada no chat que estÃ¡ abrindo e responde com a verdade. */
    private fun startCallAndResolve(isVideo: Boolean, contactName: String, promise: Promise) {
        NexusAccessibilityService.startWhatsAppCall(isVideo) { started ->
            if (started) {
                promise.resolve(
                    commandResult(success = true, contactName = contactName, video = isVideo)
                )
            } else {
                promise.resolve(
                    commandResult(
                        success = false,
                        error = "Abri a conversa de $contactName, mas nÃ£o consegui iniciar a chamada"
                    )
                )
            }
        }
    }

    @ReactMethod
    fun makeLocalCall(contactNameOrNumber: String, promise: Promise) {
        val contact = contactFinder.searchContact(contactNameOrNumber)
        val number = contact?.phoneNumber ?: contactNameOrNumber
        val success = contactFinder.makeLocalCall(number)
        if (success) {
            promise.resolve(
                commandResult(success = true, contactName = contact?.name ?: number)
            )
        } else {
            promise.resolve(
                commandResult(success = false, error = "NÃ£o foi possÃ­vel fazer a ligaÃ§Ã£o")
            )
        }
    }

    @ReactMethod
    fun openWhatsAppChat(phoneNumber: String, promise: Promise) {
        promise.resolve(contactFinder.openWhatsAppChat(phoneNumber))
    }

    @ReactMethod
    fun searchContacts(query: String, promise: Promise) {
        try {
            val results = contactFinder.searchContacts(query).take(5).map {
                mapOf("name" to it.name, "phoneNumber" to it.phoneNumber)
            }
            val array = WritableNativeArray()
            results.forEach { entry ->
                array.pushMap(mapToWritableMap(entry))
            }
            promise.resolve(array)
        } catch (e: Exception) {
            promise.reject("CONTACTS_ERROR", e.message)
        }
    }

    // ---------------------------------------------------------------------
    // WhatsApp: injeÃ§Ã£o de texto e chamadas via acessibilidade
    // ---------------------------------------------------------------------

    /**
     * Escreve e envia no chat do WhatsApp que estÃ¡ aberto.
     *
     * Devolve o resultado REAL (o campo esvaziou = a mensagem saiu). Ã‰ o que o
     * fluxo de conversa usa: antes eram duas chamadas separadas e o botÃ£o de
     * enviar procurado nÃ£o existia, entÃ£o a mensagem ficava escrita e parada.
     */
    @ReactMethod
    fun sendWhatsAppMessageToOpenChat(message: String, promise: Promise) {
        try {
            NexusAccessibilityService.sendMessageInOpenChat(message) { success ->
                promise.resolve(success)
            }
        } catch (e: Exception) {
            promise.reject("SEND_MESSAGE_ERROR", e.message)
        }
    }

    /**
     * Escreve a resposta no chat aberto SEM enviar.
     *
     * Ã‰ a metade "escrever" do fluxo de resposta por voz: o texto aparece no
     * campo e espera o usuÃ¡rio confirmar. Devolve `false` quando a conversa nÃ£o
     * abriu ou o campo nÃ£o aceitou o texto.
     */
    @ReactMethod
    fun writeWhatsAppReply(text: String, promise: Promise) {
        try {
            NexusAccessibilityService.writeInOpenChat(text) { written ->
                promise.resolve(written)
            }
        } catch (e: Exception) {
            promise.reject("WRITE_REPLY_ERROR", e.message)
        }
    }

    /** Apaga o texto escrito no campo do chat aberto (usuÃ¡rio disse "nÃ£o"). */
    @ReactMethod
    fun clearWhatsAppReply(promise: Promise) {
        try {
            NexusAccessibilityService.clearOpenChat { cleared ->
                promise.resolve(cleared)
            }
        } catch (e: Exception) {
            promise.reject("CLEAR_REPLY_ERROR", e.message)
        }
    }

    /**
     * O texto da ÃšLTIMA mensagem do chat do WhatsApp que estÃ¡ aberto.
     *
     * Ã‰ a mensagem DE VERDADE: a notificaÃ§Ã£o chega truncada (e Ã s vezes sem
     * texto, por causa da privacidade), e Ã© na tela que o Nexus tem que ler.
     */
    @ReactMethod
    fun readLastChatMessage(promise: Promise) {
        try {
            NexusAccessibilityService.readLastChatMessage { text ->
                promise.resolve(text)
            }
        } catch (e: Exception) {
            promise.reject("READ_MESSAGE_ERROR", e.message)
        }
    }

    /**
     * Envia o texto que jÃ¡ estÃ¡ no campo (depois do "sim").
     *
     * Confere que o campo esvaziou antes de dizer que enviou.
     */
    @ReactMethod
    fun sendWhatsAppReply(promise: Promise) {
        try {
            NexusAccessibilityService.sendInOpenChat { sent ->
                promise.resolve(sent)
            }
        } catch (e: Exception) {
            promise.reject("SEND_REPLY_ERROR", e.message)
        }
    }

    /**
     * Toca o Ã¡udio mais recente da conversa aberta.
     *
     * Melhor esforÃ§o: devolve `true` apenas quando um controle de reproduÃ§Ã£o foi
     * realmente tocado. Sem isso, o app avisa o usuÃ¡rio em vez de fingir.
     */
    @ReactMethod
    fun playLastNotificationAudio(promise: Promise) {
        try {
            NexusAccessibilityService.playLastVoiceNote { played ->
                promise.resolve(played)
            }
        } catch (e: Exception) {
            promise.reject("PLAY_AUDIO_ERROR", e.message)
        }
    }

    /**
     * Atende a chamada do WhatsApp.
     *
     * Caminho principal: dispara a aÃ§Ã£o "Atender" da PRÃ“PRIA notificaÃ§Ã£o, que
     * funciona mesmo quando sÃ³ o banner do sistema estÃ¡ na tela. Se a aÃ§Ã£o nÃ£o
     * existir/expirou, abre a tela da chamada e tenta o toque por acessibilidade.
     *
     * `true` sÃ³ quando uma das aÃ§Ãµes foi disparada de fato â€” o app nunca anuncia
     * uma chamada atendida que nÃ£o aconteceu.
     */
    @ReactMethod
    fun answerWhatsAppCall(promise: Promise) {
        try {
            if (NexusNotificationListenerService.answerRingingCall()) {
                NexusCallNotification.dismiss(context)
                promise.resolve(true)
                return
            }
            NexusNotificationListenerService.openRingingCallScreen()
            NexusAccessibilityService.answerIncomingCall { answered ->
                if (answered) NexusCallNotification.dismiss(context)
                promise.resolve(answered)
            }
        } catch (e: Exception) {
            promise.reject("ANSWER_CALL_ERROR", e.message)
        }
    }

    /** Recusa a chamada (mesmo caminho: notificaÃ§Ã£o primeiro, tela depois). */
    @ReactMethod
    fun declineWhatsAppCall(promise: Promise) {
        try {
            if (NexusNotificationListenerService.declineRingingCall()) {
                NexusCallNotification.dismiss(context)
                promise.resolve(true)
                return
            }
            NexusNotificationListenerService.openRingingCallScreen()
            NexusAccessibilityService.declineIncomingCall { declined ->
                if (declined) NexusCallNotification.dismiss(context)
                promise.resolve(declined)
            }
        } catch (e: Exception) {
            promise.reject("DECLINE_CALL_ERROR", e.message)
        }
    }

    // ---------------------------------------------------------------------
    // Chamadas telefÃ´nicas (chip/SIM)
    // ---------------------------------------------------------------------

    /** Atende a chamada do chip que estÃ¡ tocando (botÃ£o verde da notificaÃ§Ã£o). */
    @ReactMethod
    fun answerPhoneCall(promise: Promise) {
        try {
            val answered = NexusPhoneCallManager.answer(context)
            if (answered) NexusCallNotification.dismiss(context)
            promise.resolve(answered)
        } catch (e: Exception) {
            promise.reject("ANSWER_PHONE_CALL_ERROR", e.message)
        }
    }

    /** Recusa/desliga a chamada do chip que estÃ¡ tocando (botÃ£o vermelho). */
    @ReactMethod
    fun declinePhoneCall(promise: Promise) {
        try {
            val declined = NexusPhoneCallManager.decline(context)
            if (declined) NexusCallNotification.dismiss(context)
            promise.resolve(declined)
        } catch (e: Exception) {
            promise.reject("DECLINE_PHONE_CALL_ERROR", e.message)
        }
    }

    /** Mesmo fluxo do anterior (nome antigo, mantido para compatibilidade). */
    @ReactMethod
    fun injectWhatsAppMessage(message: String, promise: Promise) {
        try {
            NexusAccessibilityService.sendMessageInOpenChat(message) { success ->
                promise.resolve(success)
            }
        } catch (e: Exception) {
            promise.reject("INJECT_MESSAGE_ERROR", e.message)
        }
    }

    @ReactMethod
    fun clickWhatsAppSend(promise: Promise) {
        try {
            val success = NexusAccessibilityService.clickWhatsAppSend()
            promise.resolve(success)
        } catch (e: Exception) {
            promise.reject("CLICK_SEND_ERROR", e.message)
        }
    }

    @ReactMethod
    fun triggerWhatsAppCall(isVideo: Boolean, promise: Promise) {
        try {
            NexusAccessibilityService.triggerCall(isVideo)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("TRIGGER_CALL_ERROR", e.message)
        }
    }

    @ReactMethod
    fun leaveForegroundMediaApp(promise: Promise) {
        try {
            val success = NexusAccessibilityService.leaveForegroundMediaApp()
            promise.resolve(success)
        } catch (e: Exception) {
            promise.reject("LEAVE_APP_ERROR", e.message)
        }
    }

    /** Volta para a tela inicial (fim da fila de mensagens). */
    @ReactMethod
    fun goHome(promise: Promise) {
        try {
            promise.resolve(NexusAccessibilityService.goHome())
        } catch (e: Exception) {
            promise.reject("GO_HOME_ERROR", e.message)
        }
    }

    // ---------------------------------------------------------------------
    // MÃ­dia / rÃ¡dio
    // ---------------------------------------------------------------------

    /**
     * Toca uma rÃ¡dio de Minas Gerais DENTRO do app (ExoPlayer), sem navegador.
     *
     * Devolve o resultado de verdade (emissora, cidade ou o motivo da falha) em
     * vez de um booleano solto: Ã© com isso que o Nexus responde "tocando a
     * Itatiaia" ou "nÃ£o consegui abrir o stream".
     */
    @ReactMethod
    fun playRadio(stationName: String, promise: Promise) {
        lastMediaType = "radio"
        promise.resolve(radioResultMap(radioManager.playStation(stationName)))
    }

    /** "Toca outra rÃ¡dio": para a atual e liga a prÃ³xima do catÃ¡logo mineiro. */
    @ReactMethod
    fun playNextRadio(promise: Promise) {
        promise.resolve(radioResultMap(radioManager.playNeighbour(1)))
    }

    @ReactMethod
    fun playPreviousRadio(promise: Promise) {
        promise.resolve(radioResultMap(radioManager.playNeighbour(-1)))
    }

    @ReactMethod
    fun stopRadio(promise: Promise) {
        promise.resolve(radioResultMap(radioManager.stopRadio()))
    }

    @ReactMethod
    fun pauseRadio(promise: Promise) {
        promise.resolve(radioResultMap(radioManager.pauseRadio()))
    }

    @ReactMethod
    fun resumeRadio(promise: Promise) {
        promise.resolve(radioResultMap(radioManager.resumeRadio()))
    }

    @ReactMethod
    fun isRadioPlaying(promise: Promise) {
        promise.resolve(radioManager.isPlaying())
    }

    /** Emissora carregada no player agora (`null` quando nÃ£o hÃ¡ nenhuma). */
    @ReactMethod
    fun getCurrentStation(promise: Promise) {
        promise.resolve(radioManager.currentStationName())
    }

    @ReactMethod
    fun getAvailableStations(promise: Promise) {
        val stations = radioManager.getAvailableStations()
        val writableArray = WritableNativeArray()
        stations.forEach { writableArray.pushString(it) }
        promise.resolve(writableArray)
    }

    /** Resultado de rÃ¡dio em mapa writable, pronto para atravessar a ponte. */
    private fun radioResultMap(result: RadioStreamManager.RadioResult): WritableMap =
        WritableNativeMap().apply {
            putBoolean("success", result.success)
            putBoolean("stopped", result.stopped)
            putBoolean("paused", result.paused)
            result.stationName?.let { putString("stationName", it) }
            result.city?.let { putString("city", it) }
            result.error?.let { putString("error", it) }
        }

    // ---------------------------------------------------------------------
    // Volume do som (escala de 0 a 5)
    // ---------------------------------------------------------------------

    /** NÃ­vel atual do volume na escala do Nexus (0 a 5). */
    private fun volumeLevel(): Int {
        val manager = audioManager ?: return 0
        val max = manager.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        if (max <= 0) return 0
        val current = manager.getStreamVolume(AudioManager.STREAM_MUSIC)
        return ((current * VOLUME_STEPS + max / 2) / max).coerceIn(0, VOLUME_STEPS)
    }

    /** Coloca o volume no nÃ­vel pedido e devolve o nÃ­vel real depois da mudanÃ§a. */
    private fun applyVolumeLevel(level: Int): Int {
        val manager = audioManager ?: return 0
        val max = manager.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        if (max <= 0) return 0
        val target = (level.coerceIn(0, VOLUME_STEPS) * max) / VOLUME_STEPS
        try {
            manager.setStreamVolume(AudioManager.STREAM_MUSIC, target, 0)
            Log.d(TAG, "Volume: nÃ­vel $level de $VOLUME_STEPS (bruto $target de $max)")
        } catch (e: Exception) {
            Log.w(TAG, "Falha ao mudar o volume: ${e.message}")
        }
        return volumeLevel()
    }

    private fun volumeResultMap(level: Int): WritableMap =
        WritableNativeMap().apply {
            putBoolean("success", true)
            putInt("level", level)
            putInt("max", VOLUME_STEPS)
        }

    /** "Qual o volume?" â€” o nÃºmero na escala do Nexus. */
    @ReactMethod
    fun getVolumeLevel(promise: Promise) {
        promise.resolve(volumeResultMap(volumeLevel()))
    }

    /**
     * Sobe ou desce UM degrau.
     *
     * O usuÃ¡rio pediu "um de cada vez": cada comando muda um passo, para o som
     * nÃ£o pular do silÃªncio no mÃ¡ximo.
     */
    @ReactMethod
    fun changeVolume(delta: Int, promise: Promise) {
        val target = (volumeLevel() + delta).coerceIn(0, VOLUME_STEPS)
        promise.resolve(volumeResultMap(applyVolumeLevel(target)))
    }

    /** "Volume 3" / "volume no mÃ¡ximo": coloca o som num nÃ­vel exato. */
    @ReactMethod
    fun setVolumeLevel(level: Int, promise: Promise) {
        promise.resolve(volumeResultMap(applyVolumeLevel(level)))
    }

    /** "Toca no YouTube": pesquisa e TOCA o resultado no app do YouTube. */
    @ReactMethod
    fun playYouTube(query: String, promise: Promise) {
        lastMediaType = "youtube"
        startMusicPlayback(query, MusicLauncher.APP_YOUTUBE, promise)
    }

    /** "Toca no OiTube": pesquisa e TOCA o resultado no OiTube. */
    @ReactMethod
    fun playOiTube(query: String, promise: Promise) {
        lastMediaType = "oitube"
        startMusicPlayback(query, MusicLauncher.APP_OITUBE, promise)
    }

    /**
     * Toca mÃºsica pelo nome da canÃ§Ã£o, do cantor ou do gÃªnero.
     *
     * O Nexus descobre o vÃ­deo pela busca do YouTube e manda o player TOCAR o
     * resultado no OiTube (grÃ¡tis e com reproduÃ§Ã£o em segundo plano). O YouTube
     * sÃ³ Ã© aberto quando o usuÃ¡rio o pede pelo nome; sem OiTube, o pedido falha
     * com uma mensagem clara em vez de abrir outro player.
     */
    @ReactMethod
    fun playMusic(query: String, promise: Promise) {
        lastMediaType = "music"
        startMusicPlayback(query, null, promise)
    }

    /**
     * Caminho Ãºnico de "tocar mÃºsica".
     *
     * A pesquisa do vÃ­deo acontece na internet, entÃ£o roda fora da thread da
     * ponte para nÃ£o segurar as outras chamadas do JS enquanto o vÃ­deo Ã©
     * resolvido.
     */
    private fun startMusicPlayback(query: String, preferredApp: String?, promise: Promise) {
        val trimmed = query.trim()
        if (trimmed.isEmpty()) {
            promise.resolve(
                commandResult(success = false, error = "Nenhuma mÃºsica ou cantor informado")
            )
            return
        }

        Thread {
            try {
                val playback = musicLauncher.play(trimmed, preferredApp)
                if (playback.success) {
                    // MÃºsica no ar (no OiTube/YouTube): o mascote entra em
                    // espera, como acontece com a rÃ¡dio do app.
                    voiceEngine.setMediaPlaying(true)
                    // Guarda quem estÃ¡ tocando: Ã© este app que "parar a mÃºsica"
                    // fecha quando o player nÃ£o estÃ¡ na frente.
                    MediaKeysController.packageFor(playback.appName)?.let {
                        mediaKeys.lastMediaPackage = it
                    }
                }
                promise.resolve(
                    WritableNativeMap().apply {
                        putBoolean("success", playback.success)
                        putBoolean("played", playback.played)
                        playback.appName?.let { putString("appName", it) }
                        playback.title?.let { putString("title", it) }
                        playback.videoId?.let { putString("videoId", it) }
                        playback.error?.let { putString("error", it) }
                    }
                )
            } catch (e: Exception) {
                promise.reject("PLAY_MUSIC_ERROR", e.message)
            }
        }.start()
    }

    /**
     * Controles de mÃ­dia falados: pausar, continuar, parar, prÃ³xima, anterior.
     *
     * A ordem Ã© sempre a mesma: se a rÃ¡dio do prÃ³prio Nexus estÃ¡ carregada, quem
     * obedece Ã© ela. Caso contrÃ¡rio o alvo Ã© a mÃºsica do OUTRO aplicativo
     * (OiTube/YouTube) â€” primeiro pelo botÃ£o da tela (o serviÃ§o de acessibilidade
     * lÃª o estado antes de tocar) e, se o player estiver em segundo plano, pelo
     * evento de mÃ­dia, que sÃ³ Ã© confirmado quando o Ã¡udio do aparelho muda de
     * verdade. Assim o Nexus nunca diz "pausei" sem ter pausado.
     *
     * Roda fora da thread da ponte porque a confirmaÃ§Ã£o espera o Ã¡udio responder.
     */
    @ReactMethod
    fun mediaControl(action: String, promise: Promise) {
        Thread {
            try {
                promise.resolve(handleMediaControl(action))
            } catch (e: Exception) {
                promise.reject("MEDIA_CONTROL_ERROR", e.message)
            }
        }.start()
    }

    private fun handleMediaControl(action: String): WritableMap = when (action) {
        "pause", "stop" -> pauseOtherAppMedia(action)
        "resume", "play" -> resumeMedia()
        "next" -> skipMedia(step = 1)
        "prev" -> skipMedia(step = -1)
        else -> commandResult(success = false, error = "AÃ§Ã£o de mÃ­dia desconhecida: $action")
    }

    /** Pausa/para: a rÃ¡dio do Nexus primeiro, depois a mÃ­dia de outro app. */
    private fun pauseOtherAppMedia(action: String): WritableMap {
        /*
         * A rÃ¡dio do Nexus e a mÃºsica de outro app podem tocar AO MESMO TEMPO.
         *
         * O pedido de pausa vale para as DUAS: o Nexus precisa falar em
         * silÃªncio. Antes, a rÃ¡dio carregada encerrava o caminho e a mÃºsica de
         * outro aplicativo continuava tocando por cima da fala.
         */
        val radioResult = if (radioManager.currentStationName() != null) {
            // Pedido explÃ­cito de pausa/parada: o mascote sai da espera.
            voiceEngine.setMediaPlaying(false)
            if (action == "stop") radioManager.stopRadio() else radioManager.pauseRadio()
        } else {
            null
        }

        val foreground = NexusAccessibilityService.foregroundMediaPackage()
        val packageName = foreground ?: mediaKeys.lastMediaPackage
        val appName = MediaKeysController.appNameFor(packageName)

        // 1) Player na tela: o toque no botÃ£o Ã© o caminho mais fiel (o estado foi
        //    lido na prÃ³pria interface: sÃ³ clica se estiver tocando). Quando o
        //    toque nÃ£o pega (acontece no OiTube), o evento de mÃ­dia abaixo assume.
        val requestId = "pausa-${System.currentTimeMillis()}"
        if (foreground != null && NexusAccessibilityService.pressPauseIfPlaying(requestId)) {
            voiceEngine.setMediaPlaying(false)
            return finishStopIfNeeded(action, packageName, appName)
        }

        // 2) Em segundo plano: nada tocando nÃ£o Ã© falha do Nexus, Ã© aviso. E, como
        //    nada toca, o mascote sai do modo espera e volta Ã  escuta passiva.
        if (!mediaKeys.isMusicActive()) {
            voiceEngine.setMediaPlaying(false)
            // A rÃ¡dio do Nexus pode ter sido a Ãºnica coisa tocando.
            return radioResult?.let { radioResultMap(it) }
                ?: commandResult(
                    success = false,
                    error = "Nada estÃ¡ tocando agora para eu pausar."
                )
        }

        val paused = mediaKeys.sendAndConfirm(KeyEvent.KEYCODE_MEDIA_PAUSE, expectPlaying = false)
        if (!paused) {
            return radioResult?.let { radioResultMap(it) }
                ?: commandResult(
                    success = false,
                    error = "NÃ£o consegui pausar a mÃºsica que estÃ¡ tocando."
                )
        }

        voiceEngine.setMediaPlaying(false)
        return finishStopIfNeeded(action, packageName, appName)
    }

    /**
     * Fecha o player quando o pedido foi "PARAR" (nÃ£o "pausar").
     *
     * Para o usuÃ¡rio, parar Ã© tambÃ©m sair do aplicativo/streaming: o Nexus manda a
     * parada da reproduÃ§Ã£o, volta uma tela se o player estiver na frente e encerra
     * os processos dele. "Pausar" continua sÃ³ pausando â€” o vÃ­deo fica onde estava.
     */
    private fun finishStopIfNeeded(
        action: String,
        packageName: String?,
        appName: String?,
    ): WritableMap {
        if (action != "stop") {
            return commandResult(success = true, appName = appName, mediaAction = action)
        }

        val leftScreen = NexusAccessibilityService.leaveForegroundMediaApp()
        val closed = mediaKeys.closeApp(packageName)
        Log.d(TAG, "Parar: saiu da tela=$leftScreen, app encerrado=$closed ($packageName)")
        return commandResult(success = true, appName = appName, mediaAction = action)
    }

    /** Play/continuar na rÃ¡dio ou na mÃºsica do outro app. */
    private fun resumeMedia(): WritableMap {
        // Prioriza o Ãºltimo tipo de mÃ­dia que tocou
        when (lastMediaType) {
            "radio" -> {
                if (radioManager.currentStationName() != null) {
                    return radioResultMap(radioManager.resumeRadio())
                }
            }
            "youtube", "oitube", "music" -> {
                val packageName = NexusAccessibilityService.foregroundMediaPackage()
                val appName = MediaKeysController.appNameFor(packageName)

                val requestId = "toca-${System.currentTimeMillis()}"
                if (packageName != null && NexusAccessibilityService.pressPlayIfPaused(requestId)) {
                    voiceEngine.setMediaPlaying(true)
                    return commandResult(success = true, appName = appName, mediaAction = "play")
                }

                if (mediaKeys.sendAndConfirm(KeyEvent.KEYCODE_MEDIA_PLAY, expectPlaying = true)) {
                    voiceEngine.setMediaPlaying(true)
                    return commandResult(success = true, appName = appName, mediaAction = "play")
                }
            }
        }

        // Fallback: se nÃ£o conseguiu pelo tipo salvo, tenta rÃ¡dio primeiro
        if (radioManager.currentStationName() != null) {
            return radioResultMap(radioManager.resumeRadio())
        }

        // ... e depois mÃºsica de outros apps
        val packageName = NexusAccessibilityService.foregroundMediaPackage()
        val appName = MediaKeysController.appNameFor(packageName)

        val requestId = "toca-${System.currentTimeMillis()}"
        if (packageName != null && NexusAccessibilityService.pressPlayIfPaused(requestId)) {
            voiceEngine.setMediaPlaying(true)
            return commandResult(success = true, appName = appName, mediaAction = "play")
        }

        if (mediaKeys.sendAndConfirm(KeyEvent.KEYCODE_MEDIA_PLAY, expectPlaying = true)) {
            voiceEngine.setMediaPlaying(true)
            return commandResult(success = true, appName = appName, mediaAction = "play")
        }

        return commandResult(
            success = false,
            error = "NÃ£o consegui tocar: nenhuma mÃºsica estava carregada para o play."
        )
    }

    /** "PrÃ³xima/anterior": troca de rÃ¡dio ou mexe no player do outro app. */
    private fun skipMedia(step: Int): WritableMap {
        // RÃ¡dio: sÃ³ troca se a rÃ¡dio estiver tocando E foi o Ãºltimo tipo
        if (radioManager.currentStationName() != null && "radio" == lastMediaType) {
            return radioResultMap(radioManager.playNeighbour(step))
        }

        // MÃºsica (YouTube/OiTube): sÃ³ pula se foi mÃºsica que tocou por Ãºltimo
        if (lastMediaType == "youtube" || lastMediaType == "oitube" || lastMediaType == "music") {
            val packageName = NexusAccessibilityService.foregroundMediaPackage()
            val appName = MediaKeysController.appNameFor(packageName)
            val action = if (step > 0) "next" else "prev"

            // BotÃ£o na tela primeiro
            val clicked = if (step > 0) {
                NexusAccessibilityService.skipNext()
            } else {
                NexusAccessibilityService.skipPrevious()
            }
            if (clicked) return commandResult(success = true, appName = appName, mediaAction = action)

            // Fora da tela, o evento de mÃ­dia fala com a sessÃ£o ativa
            val key = if (step > 0) KeyEvent.KEYCODE_MEDIA_NEXT else KeyEvent.KEYCODE_MEDIA_PREVIOUS
            val sent = mediaKeys.send(key)
            return commandResult(
                success = sent,
                appName = appName,
                mediaAction = action,
                error = if (sent) null else "NÃ£o consegui pular a mÃºsica."
            )
        }

        // Fallback: nÃ£o sabe o que estava tocando, tenta rÃ¡dio se houver, depois mÃºsica
        if (radioManager.currentStationName() != null) {
            return radioResultMap(radioManager.playNeighbour(step))
        }

        val packageName = NexusAccessibilityService.foregroundMediaPackage()
        val appName = MediaKeysController.appNameFor(packageName)
        val action = if (step > 0) "next" else "prev"

        val clicked = if (step > 0) {
            NexusAccessibilityService.skipNext()
        } else {
            NexusAccessibilityService.skipPrevious()
        }
        if (clicked) return commandResult(success = true, appName = appName, mediaAction = action)

        val key = if (step > 0) KeyEvent.KEYCODE_MEDIA_NEXT else KeyEvent.KEYCODE_MEDIA_PREVIOUS
        val sent = mediaKeys.send(key)
        return commandResult(
            success = sent,
            appName = appName,
            mediaAction = action,
            error = if (sent) null else "NÃ£o consegui pular a mÃºsica."
        )
    }

    // ---------------------------------------------------------------------
    // MÃ­dia: pausa/retomada para notificaÃ§Ãµes e chamadas
    // ---------------------------------------------------------------------

    /**
     * Diz se existe uma chamada ativa neste momento.
     *
     * O WhatsApp (VoIP) coloca o Ã¡udio do aparelho em `MODE_IN_COMMUNICATION`
     * durante a ligaÃ§Ã£o; uma chamada telefÃ´nica usa `MODE_IN_CALL`. Ã‰ essa
     * mudanÃ§a que evita o Nexus sair da tela da chamada ou devolver mÃºsica por
     * cima da conversa.
     */
    @ReactMethod
    fun isInCall(promise: Promise) {
        try {
            val audio = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
            val mode = audio?.mode ?: AudioManager.MODE_NORMAL
            val inCall =
                mode == AudioManager.MODE_IN_CALL || mode == AudioManager.MODE_IN_COMMUNICATION
            Log.d(TAG, "isInCall: mode=$mode -> $inCall")
            promise.resolve(inCall)
        } catch (e: Exception) {
            Log.w(TAG, "isInCall falhou: ${e.message}")
            promise.resolve(false)
        }
    }

    /**
     * Pausa TODA a mÃ­dia (rÃ¡dio do Nexus + mÃºsica de outros apps) para uma
     * notificaÃ§Ã£o/chamada. Guarda o estado para poder retomar depois.
     *
     * @return mapa com o que estava tocando: radio=true/false, music=true/false,
     *   appName do player de mÃºsica (se houver).
     */
    @ReactMethod
    fun pauseMediaForNotification(promise: Promise) {
        val result = WritableNativeMap().apply {
            // RÃ¡dio do Nexus
            val radioPlaying = radioManager.currentStationName() != null && radioManager.isPlaying()
            putBoolean("radioWasPlaying", radioPlaying)
            if (radioPlaying) {
                radioManager.pauseRadio()
                voiceEngine.setMediaPlaying(false)
            }

            // MÃºsica de outros apps (OiTube/YouTube)
            val foreground = NexusAccessibilityService.foregroundMediaPackage()
            val packageName = foreground ?: mediaKeys.lastMediaPackage
            val appName = MediaKeysController.appNameFor(packageName)
            val musicPlaying = appName != null && mediaKeys.isMusicActive()
            putBoolean("musicWasPlaying", musicPlaying)
            if (musicPlaying) {
                putString("musicAppName", appName)
                // Pausa via botÃ£o da tela (se app na frente) ou evento de mÃ­dia
                val requestId = "notif-pause-${System.currentTimeMillis()}"
                val byA11y = packageName != null && NexusAccessibilityService.pressPauseIfPlaying(requestId)
                if (!byA11y && mediaKeys.isMusicActive()) {
                    mediaKeys.sendAndConfirm(KeyEvent.KEYCODE_MEDIA_PAUSE, expectPlaying = false)
                }
                voiceEngine.setMediaPlaying(false)
            }
        }
        promise.resolve(result)
    }

    /**
     * Retoma a mÃ­dia que estava tocando antes da notificaÃ§Ã£o/chamada.
     * Usa o mapa devolvido por [pauseMediaForNotification].
     */
    @ReactMethod
    fun resumeMediaAfterNotification(wasRadioPlaying: Boolean, wasMusicPlaying: Boolean, musicAppName: String?, promise: Promise) {
        if (wasRadioPlaying) {
            radioManager.resumeRadio()
            voiceEngine.setMediaPlaying(true)
        }
        if (wasMusicPlaying) {
            val packageName = MediaKeysController.packageFor(musicAppName)
            if (packageName != null) {
                if (mediaKeys.sendAndConfirm(KeyEvent.KEYCODE_MEDIA_PLAY, expectPlaying = true)) {
                    voiceEngine.setMediaPlaying(true)
                }
            }
        }
        promise.resolve(true)
    }

    // ---------------------------------------------------------------------
    // Clima
    // ---------------------------------------------------------------------

    @ReactMethod
    fun getWeather(city: String?, day: String?, promise: Promise) {
        val wanted = city?.trim()?.takeIf { it.isNotEmpty() }
        val tomorrow = day == "tomorrow"
        scope.launch {
            // O clima Ã© CONSULTADO de verdade (Open-Meteo): antes este mÃ©todo
            // devolvia 25 graus e "ensolarado" fixos, e o Nexus anunciava um
            // tempo que nunca aconteceu.
            val info = withContext(Dispatchers.IO) {
                if (tomorrow) weatherProvider.getTomorrowForecast(wanted)
                else weatherProvider.getCurrentWeather(wanted)
            }
            if (info == null) {
                promise.resolve(null)
                return@launch
            }
            promise.resolve(
                WritableNativeMap().apply {
                    putDouble("temperature", info.temperature)
                    putString("condition", info.condition)
                    putDouble("humidity", info.humidity.toDouble())
                    putDouble("windSpeed", info.windSpeed)
                    putString("cityName", info.cityName)
                    putDouble("timestamp", info.timestamp.toDouble())
                    putBoolean("forecast", info.forecast)
                    info.rainChance?.let { putInt("rainChance", it) }
                },
            )
        }
    }

    // ---------------------------------------------------------------------
    // AnotaÃ§Ãµes
    //
    // O usuÃ¡rio fala uma ideia e o Nexus guarda com tÃ­tulo, data e hora. A lista
    // vive no prÃ³prio app (preferÃªncias privadas): nÃ£o depende de nenhum
    // aplicativo de notas instalado no aparelho.
    // ---------------------------------------------------------------------

    @ReactMethod
    fun saveNote(text: String, title: String, promise: Promise) {
        try {
            promise.resolve(noteToMap(noteStore.save(text, title)))
        } catch (e: Exception) {
            promise.reject("NOTE_ERROR", e.message)
        }
    }

    @ReactMethod
    fun listNotes(promise: Promise) {
        try {
            val array: WritableArray = WritableNativeArray()
            noteStore.list().forEach { array.pushMap(noteToMap(it)) }
            promise.resolve(array)
        } catch (e: Exception) {
            promise.reject("NOTE_ERROR", e.message)
        }
    }

    @ReactMethod
    fun deleteNote(id: String, promise: Promise) {
        try {
            promise.resolve(noteStore.delete(id))
        } catch (e: Exception) {
            promise.reject("NOTE_ERROR", e.message)
        }
    }

    @ReactMethod
    fun clearNotes(promise: Promise) {
        try {
            promise.resolve(noteStore.clear())
        } catch (e: Exception) {
            promise.reject("NOTE_ERROR", e.message)
        }
    }

    // ---------------------------------------------------------------------
    // Lembretes e despertador
    //
    // O Nexus guarda a lista E agenda no AlarmManager. `exact` na resposta diz
    // se o Android aceitou um alarme exato; sem ele o horÃ¡rio pode escorregar
    // alguns minutos e o app avisa em vez de fingir precisÃ£o.
    // ---------------------------------------------------------------------

    @ReactMethod
    fun saveReminder(
        title: String,
        description: String,
        triggerAtMillis: Double,
        repeatDaily: Boolean,
        kind: String?,
        promise: Promise,
    ) {
        try {
            // "lembrete" ou "alarme": o que decide a TELA que abre quando toca.
            val which = if (kind == ReminderStore.KIND_ALARM) {
                ReminderStore.KIND_ALARM
            } else {
                ReminderStore.KIND_REMINDER
            }
            val reminder = reminderStore.save(
                title,
                description,
                triggerAtMillis.toLong(),
                repeatDaily,
                which,
            )
            val (scheduled, exact) = reminderScheduler.scheduleNextExact(reminder, reminderStore)
            if (scheduled == null) {
                promise.resolve(null)
                return
            }
            // `exact` Ã© a verdade do AlarmManager: `false` = agendado de forma
            // aproximada, e o app avisa em vez de prometer a hora.
            promise.resolve(reminderToMap(scheduled).apply { putBoolean("exact", exact) })
        } catch (e: Exception) {
            promise.reject("REMINDER_ERROR", e.message)
        }
    }

    @ReactMethod
    fun listReminders(promise: Promise) {
        try {
            val array: WritableArray = WritableNativeArray()
            reminderStore.list().forEach { array.pushMap(reminderToMap(it)) }
            promise.resolve(array)
        } catch (e: Exception) {
            promise.reject("REMINDER_ERROR", e.message)
        }
    }

    @ReactMethod
    fun updateReminder(id: String, patch: ReadableMap, promise: Promise) {
        try {
            val title = if (patch.hasKey("title") && !patch.isNull("title")) patch.getString("title") else null
            val description =
                if (patch.hasKey("description") && !patch.isNull("description")) patch.getString("description") else null
            val triggerAt =
                if (patch.hasKey("triggerAtMillis") && !patch.isNull("triggerAtMillis")) {
                    patch.getDouble("triggerAtMillis").toLong()
                } else {
                    null
                }
            val enabled = if (patch.hasKey("enabled") && !patch.isNull("enabled")) patch.getBoolean("enabled") else null
            val repeatDaily =
                if (patch.hasKey("repeatDaily") && !patch.isNull("repeatDaily")) patch.getBoolean("repeatDaily") else null

            val updated = reminderStore.update(
                id = id,
                title = title,
                description = description,
                triggerAtMillis = triggerAt,
                enabled = enabled,
                repeatDaily = repeatDaily,
            )

            if (updated == null) {
                promise.resolve(null)
                return
            }

            reminderScheduler.cancel(id)
            val (scheduled, exact) = reminderScheduler.scheduleNextExact(updated, reminderStore)
            if (scheduled == null) {
                promise.resolve(null)
                return
            }
            promise.resolve(reminderToMap(scheduled).apply { putBoolean("exact", exact) })
        } catch (e: Exception) {
            promise.reject("REMINDER_ERROR", e.message)
        }
    }

    /**
     * ADIA um lembrete em [minutes] minutos sem mexer no horÃ¡rio dele.
     *
     * Ã‰ o mesmo "Daqui a pouco" da tela: o diÃ¡rio continua valendo para amanhÃ£
     * no horÃ¡rio de sempre; o de uma vez sÃ³ passa a valer no novo horÃ¡rio.
     */
    @ReactMethod
    fun snoozeReminder(id: String, minutes: Int, promise: Promise) {
        try {
            val reminder = reminderStore.get(id)
            if (reminder == null) {
                promise.resolve(null)
                return
            }

            val updated = ReminderActions.snooze(context, reminder, minutes)
            if (updated == null) {
                promise.resolve(null)
                return
            }

            // "Daqui a pouco" nunca Ã© um alarme exato: Ã© uma espera de minutos.
            promise.resolve(reminderToMap(updated).apply { putBoolean("exact", true) })
        } catch (e: Exception) {
            promise.reject("REMINDER_ERROR", e.message)
        }
    }

    @ReactMethod
    fun deleteReminder(id: String, promise: Promise) {        try {
            reminderScheduler.cancel(id)
            promise.resolve(reminderStore.delete(id))
        } catch (e: Exception) {
            promise.reject("REMINDER_ERROR", e.message)
        }
    }

    @ReactMethod
    fun setReminderEnabled(id: String, enabled: Boolean, promise: Promise) {
        try {
            val updated = reminderStore.update(id, enabled = enabled)
            if (updated == null) {
                promise.resolve(false)
                return
            }
            if (enabled) {
                reminderScheduler.scheduleNext(updated, reminderStore)
            } else {
                reminderScheduler.cancel(id)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("REMINDER_ERROR", e.message)
        }
    }

    @ReactMethod
    fun getNextReminder(promise: Promise) {
        try {
            val now = System.currentTimeMillis()
            val next = reminderStore.listEnabled().firstOrNull { it.triggerAtMillis > now }
            if (next == null) {
                promise.resolve(null)
            } else {
                promise.resolve(reminderToMap(next))
            }
        } catch (e: Exception) {
            promise.reject("REMINDER_ERROR", e.message)
        }
    }

    /** Ãštil depois de o usuÃ¡rio liberar a permissÃ£o de alarme exato. */
    @ReactMethod
    fun rescheduleReminders(promise: Promise) {
        try {
            reminderScheduler.rescheduleAll(reminderStore)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("REMINDER_ERROR", e.message)
        }
    }

    // ---------------------------------------------------------------------
    // Perfil do usuÃ¡rio
    //
    // O nome alimenta as saudaÃ§Ãµes ("Bom dia, Jefferson") e o despertador. Fica
    // nas preferÃªncias do app para o receptor de alarme conseguir lÃª-lo mesmo
    // com o React desligado.
    // ---------------------------------------------------------------------

    @ReactMethod
    fun getProfile(promise: Promise) {
        try {
            promise.resolve(
                WritableNativeMap().apply {
                    putString("name", profileStore.getName())
                    putBoolean("configured", profileStore.isConfigured())
                }
            )
        } catch (e: Exception) {
            promise.reject("PROFILE_ERROR", e.message)
        }
    }

    @ReactMethod
    fun saveProfile(name: String, promise: Promise) {
        try {
            val saved = profileStore.saveName(name)
            promise.resolve(
                WritableNativeMap().apply {
                    putString("name", saved)
                    putBoolean("configured", saved.isNotEmpty())
                }
            )
        } catch (e: Exception) {
            promise.reject("PROFILE_ERROR", e.message)
        }
    }

    /**
     * `true` quando o Auto-Bot (acessibilidade) estÃ¡ ligado AGORA.
     *
     * E [getAutoBotWasEnabled] devolve o que o usuÃ¡rio jÃ¡ tinha ligado antes:
     * o Android desliga o serviÃ§o a cada instalaÃ§Ã£o do APK, e Ã© essa lembranÃ§a
     * que permite avisar "estava ligado e a instalaÃ§Ã£o desligou".
     */
    @ReactMethod
    fun getAutoBotState(promise: Promise) {
        try {
            promise.resolve(
                WritableNativeMap().apply {
                    putBoolean("enabled", isAccessibilityServiceEnabled())
                    putBoolean("wasEnabled", profileStore.wasAutoBotEnabled())
                }
            )
        } catch (e: Exception) {
            promise.reject("AUTOBOT_ERROR", e.message)
        }
    }

    /** Grava a lembranÃ§a de que o Auto-Bot estÃ¡ ligado. */
    @ReactMethod
    fun setAutoBotEnabled(enabled: Boolean, promise: Promise) {
        try {
            profileStore.setAutoBotEnabled(enabled)
            promise.resolve(enabled)
        } catch (e: Exception) {
            promise.reject("AUTOBOT_ERROR", e.message)
        }
    }

    // ---------------------------------------------------------------------
    // PermissÃµes
    // ---------------------------------------------------------------------

    @ReactMethod
    fun getPermissionState(promise: Promise) {
        try {
            val state = WritableNativeMap().apply {
                putBoolean("microphone", hasPermission(Manifest.permission.RECORD_AUDIO))
                putBoolean("contacts", hasPermission(Manifest.permission.READ_CONTACTS))
                /*
                 * `phone` responde pelo pacote TODO de telefone, nÃ£o sÃ³ por
                 * CALL_PHONE. Antes a tela dizia "liberado" enquanto
                 * READ_PHONE_STATE/ANSWER_PHONE_CALLS estavam negados â€” e o
                 * Nexus nÃ£o conseguia ver nem atender chamada nenhuma.
                 * EvidÃªncia: logcat "READ_PHONE_STATE ausente: chamadas do
                 * chip nÃ£o serÃ£o lidas".
                 */
                putBoolean(
                    "phone",
                    hasPermission(Manifest.permission.CALL_PHONE) &&
                        hasPermission(Manifest.permission.READ_PHONE_STATE) &&
                        hasPermission(Manifest.permission.ANSWER_PHONE_CALLS)
                )
                putBoolean("location", hasPermission(Manifest.permission.ACCESS_FINE_LOCATION))
                putBoolean(
                    "notifications",
                    Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                        hasPermission(Manifest.permission.POST_NOTIFICATIONS)
                )
                putBoolean("overlay", canDrawOverlays())
                putBoolean("accessibility", isAccessibilityServiceEnabled())
                putBoolean("notificationAccess", hasNotificationAccess())
            }
            promise.resolve(state)
        } catch (e: Exception) {
            promise.reject("PERMISSION_STATE_ERROR", e.message)
        }
    }

    @ReactMethod
    fun isAccessibilityEnabled(promise: Promise) {
        promise.resolve(isAccessibilityServiceEnabled())
    }

    @ReactMethod
    fun openAppSettings(promise: Promise) {
        val intent = Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.parse("package:${context.packageName}")
        )
        openSettingsIntent(intent, promise)
    }

    @ReactMethod
    fun requestAccessibilityPermission(promise: Promise) {
        openSettingsIntent(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS), promise)
    }

    @ReactMethod
    fun requestOverlayPermission(promise: Promise) {
        if (canDrawOverlays()) {
            promise.resolve(true)
            return
        }
        openSettingsIntent(
            Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}")),
            promise
        )
    }

    // ---------------------------------------------------------------------
    // Leitura de notificaÃ§Ãµes (mensagens do WhatsApp)
    // ---------------------------------------------------------------------

    @ReactMethod
    fun isNotificationAccessGranted(promise: Promise) {
        promise.resolve(hasNotificationAccess())
    }

    @ReactMethod
    fun requestNotificationAccess(promise: Promise) {
        // Esta permissÃ£o nÃ£o tem diÃ¡logo: o Android sÃ³ oferece a tela de
        // ajustes "Acesso a notificaÃ§Ãµes".
        openSettingsIntent(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS), promise)
    }

    @ReactMethod
    fun openLastNotification(promise: Promise) {
        promise.resolve(NexusNotificationListenerService.openLastConversation())
    }

    /**
     * NotificaÃ§Ãµes do WhatsApp que chegaram e ainda nÃ£o foram contadas.
     *
     * Existe porque o aviso ao vivo pode ter sido emitido com o React jÃ¡
     * destruÃ­do (app fechado). A interface chama isto ao abrir e conta o que
     * ficou para trÃ¡s em vez de deixar a mensagem sumir.
     */
    @ReactMethod
    fun getRecentNotifications(promise: Promise) {
        try {
            val list = WritableNativeArray()
            NexusNotificationListenerService.recentNotifications().forEach { item ->
                list.pushMap(mapToWritableMap(item))
            }
            promise.resolve(list)
        } catch (e: Exception) {
            promise.reject("NOTIFICATION_ERROR", e.message)
        }
    }

    /** Marca como contadas as notificaÃ§Ãµes guardadas. */
    @ReactMethod
    fun clearRecentNotifications(promise: Promise) {
        NexusNotificationListenerService.clearRecentNotifications()
        promise.resolve(null)
    }

    /** HistÃ³rico do chat salvo pelo JS (JSON). Sobrevive ao reinÃ­cio do React. */
    @ReactMethod
    fun loadChatHistory(promise: Promise) {
        try {
            promise.resolve(chatStore.load())
        } catch (e: Exception) {
            promise.reject("CHAT_ERROR", e.message)
        }
    }

    @ReactMethod
    fun saveChatHistory(json: String, promise: Promise) {
        try {
            chatStore.save(json)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("CHAT_ERROR", e.message)
        }
    }

    @ReactMethod
    fun clearChatHistory(promise: Promise) {
        chatStore.clear()
        promise.resolve(null)
    }

    /**
     * MemÃ³ria de aprendizado do Nexus (rede neural + conversa aprendida).
     *
     * JSON salvo pelo JS, igual ao histÃ³rico do chat. O estado Ã© grande o
     * bastante para nÃ£o passar por argumento de evento â€” mas pequeno o
     * suficiente para caber nas preferÃªncias sem banco de dados.
     */
    @ReactMethod
    fun loadNeuralState(promise: Promise) {
        try {
            promise.resolve(neuralStore.load())
        } catch (e: Exception) {
            promise.reject("NEURAL_ERROR", e.message)
        }
    }

    @ReactMethod
    fun saveNeuralState(json: String, promise: Promise) {
        try {
            neuralStore.save(json)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("NEURAL_ERROR", e.message)
        }
    }

    /**
     * Abre a conversa de um contato especÃ­fico.
     *
     * Usa o intent da notificaÃ§Ã£o sÃ³ quando ele Ã© DESTE contato (rÃ¡pido e
     * exato). Com vÃ¡rias mensagens na fila, o intent da Ãºltima pode ser de
     * outro contato â€” aÃ­ procura pelo nome dentro do WhatsApp.
     */
    @ReactMethod
    fun openNotificationConversation(contactName: String, promise: Promise) {
        // O PendingIntent da notificaÃ§Ã£o Ã© o caminho mais rÃ¡pido, mas o WhatsApp
        // troca/cancela esse intent a cada notificaÃ§Ã£o nova: quando o envio
        // falha, o contato ainda estÃ¡ guardado e a busca por acessibilidade
        // resolve. Antes a funÃ§Ã£o devolvia `false` na primeira falha e o Nexus
        // dizia "nÃ£o consegui abrir a conversa" com o WhatsApp instalado.
        if (NexusNotificationListenerService.isConversationFrom(contactName) &&
            NexusNotificationListenerService.openLastConversation()
        ) {
            promise.resolve(true)
            return
        }
        if (contactName.isBlank() || !NexusAccessibilityService.isConnected()) {
            promise.resolve(false)
            return
        }

        // O fluxo do WhatsApp tem esperas prÃ³prias: se o callback nÃ£o vier
        // (tela travada, contato inexistente), responde `false` em vez de
        // deixar a conversa pendurada para sempre.
        val answered = java.util.concurrent.atomic.AtomicBoolean(false)
        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
            if (answered.compareAndSet(false, true)) promise.resolve(false)
        }, 15_000)
        NexusAccessibilityService.searchAndOpenWhatsAppContact(contactName) { opened ->
            if (answered.compareAndSet(false, true)) promise.resolve(opened)
        }
    }

    /** `true` quando o app estÃ¡ na lista de leitores de notificaÃ§Ã£o ativos. */
    private fun hasNotificationAccess(): Boolean = try {
        val enabled = Settings.Secure.getString(
            context.contentResolver,
            "enabled_notification_listeners"
        ).orEmpty()

        enabled.split(':').any { entry ->
            ComponentName.unflattenFromString(entry)?.packageName == context.packageName
        }
    } catch (_: Exception) {
        false
    }

    @ReactMethod
    fun requestMicrophonePermission(promise: Promise) {
        // Tratado pelo PermissionsAndroid no lado JS.
        promise.resolve(true)
    }

    @ReactMethod
    fun requestContactsPermission(promise: Promise) {
        promise.resolve(true)
    }

    @ReactMethod
    fun requestLocationPermission(promise: Promise) {
        promise.resolve(true)
    }

    @ReactMethod
    fun requestPhonePermission(promise: Promise) {
        promise.resolve(true)
    }

    // ---------------------------------------------------------------------
    // Despertar pela palavra "nexo"
    // ---------------------------------------------------------------------

    /**
     * Liga a escuta contÃ­nua da palavra "nexo".
     *
     * O microfone fica com o serviÃ§o em primeiro plano (tipo `microphone`), o
     * Ãºnico caminho permitido pelo Android para ouvir com a tela apagada e o
     * aparelho bloqueado. O JS chama isto quando o mascote assume o lugar do app.
     */
    @ReactMethod
    fun startWakeWordListening(promise: Promise) {
        if (!hasPermission(Manifest.permission.RECORD_AUDIO)) {
            promise.reject(
                "MICROPHONE_PERMISSION_DENIED",
                "PermissÃ£o de microfone nÃ£o concedida. Libere o Microfone para o Nexus ouvir 'nexo'."
            )
            return
        }
        try {
            wakeWordRequested = true
            startWakeWordService(context)
            Log.d(TAG, "Despertar por 'nexo' ligado")
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("WAKE_WORD_ERROR", e.message)
        }
    }

    /** Desliga a escuta da palavra "nexo" e remove o serviÃ§o em primeiro plano. */
    @ReactMethod
    fun stopWakeWordListening(promise: Promise) {
        try {
            wakeWordRequested = false
            context.stopService(Intent(context, NexusForegroundService::class.java))
            Log.d(TAG, "Despertar por 'nexo' desligado")
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("WAKE_WORD_ERROR", e.message)
        }
    }

    // ---------------------------------------------------------------------
    // Ciclo de vida do serviÃ§o em primeiro plano
    // ---------------------------------------------------------------------

    @ReactMethod
    fun startForegroundService(promise: Promise) {
        // A notificaÃ§Ã£o permanente "NEXUS em segundo plano" foi removida.
        // O mÃ©todo continua existindo para versÃµes antigas do JS nÃ£o
        // reativarem o serviÃ§o: agora ele sÃ³ encerra uma instÃ¢ncia ainda viva.
        // Quem mantÃ©m o processo vivo Ã© o serviÃ§o do mascote, quando visÃ­vel,
        // e os serviÃ§os de acessibilidade/notificaÃ§Ã£o gerenciados pelo Android.
        stopForegroundServiceInternal()
        promise.resolve(null)
    }

    @ReactMethod
    fun stopForegroundService(promise: Promise) {
        try {
            stopForegroundServiceInternal()
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("FOREGROUND_SERVICE_ERROR", e.message)
        }
    }

    private fun stopForegroundServiceInternal() {
        try {
            context.stopService(Intent(context, NexusForegroundService::class.java))
        } catch (e: Exception) {
            // Parar um serviÃ§o que jÃ¡ nÃ£o existe nunca deve derrubar o app.
            Log.w(TAG, "Falha ao parar o serviÃ§o em primeiro plano: ${e.message}")
        }
    }

    override fun onCatalystInstanceDestroy() {
        if (eventSink != null) eventSink = null
        voiceSuspender = null
        NexusOverlayService.onMascotTapped = null
        // Sem a interface viva, a escuta da palavra-chave tambÃ©m para.
        wakeWordRequested = false
        try {
            context.stopService(Intent(context, NexusForegroundService::class.java))
        } catch (_: Exception) {
        }
        if (screenReceiverRegistered) {
            try {
                context.unregisterReceiver(screenStateReceiver)
            } catch (_: Exception) {
                // Receptor jÃ¡ removido pelo sistema.
            }
            screenReceiverRegistered = false
        }
        try {
            voiceEngine.destroy()
        } catch (_: Exception) {
        }
        try {
            deviceVoice.release()
        } catch (_: Exception) {
        }
        scope.cancel()
        try {
            radioManager.release()
        } catch (_: Exception) {
        }
        super.onCatalystInstanceDestroy()
    }

    /**
     * Baixa e instala APK de atualizaÃ§Ã£o via PackageInstaller.
     *
     * Usado pelo sistema de auto-update para instalar novas versÃµes
     * baixadas do GitHub Releases sem precisar abrir o navegador.
     */
    @ReactMethod
    fun downloadAndInstallApk(downloadUrl: String, promise: Promise) {
        try {
            val context = reactApplicationContext
            val packageInstaller = context.packageManager.packageInstaller
            
            // Criar sessÃ£o de instalaÃ§Ã£o
            // Usa construtor simples compatÃ­vel com todas as versÃµes (API 24+)
            val sessionParams = PackageInstaller.SessionParams(
                PackageInstaller.SessionParams.MODE_FULL_INSTALL
            )
            
            val sessionId = packageInstaller.createSession(sessionParams)
            val session = packageInstaller.openSession(sessionId)
            
            // Baixar APK em thread separada
            kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.IO).launch {
                try {
                    val url = URL(downloadUrl)
                    val connection = url.openConnection()
                    connection.connectTimeout = 30000
                    connection.readTimeout = 60000
                    
                    val inputStream = connection.getInputStream()
                    val outputStream = session.openWrite("app-release.apk", 0, -1)
                    
                    val buffer = ByteArray(8192)
                    var bytesRead: Int
                    while (inputStream.read(buffer).also { bytesRead = it } != -1) {
                        outputStream.write(buffer, 0, bytesRead)
                    }
                    
                    outputStream.flush()
                    outputStream.close()
                    inputStream.close()
                    
                    // Commit da instalaÃ§Ã£o
                    val intentSender = android.app.PendingIntent.getBroadcast(
                        context, 0, Intent(), android.app.PendingIntent.FLAG_IMMUTABLE
                    )
                    session.commit(intentSender.intentSender)
                    session.close()
                    
                    // Resolver promise na thread principal
                    kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Main).launch {
                        promise.resolve(mapOf("success" to true))
                    }
                } catch (e: Exception) {
                    session?.close()
                    kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Main).launch {
                        promise.reject("INSTALL_ERROR", e.message)
                    }
                }
            }
        } catch (e: Exception) {
            promise.reject("DOWNLOAD_ERROR", e.message)
        }
    }
}




