package com.jefferson.nexusassistente.service

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Context
import android.content.Intent
import android.graphics.Path
import android.graphics.Rect
import android.media.AudioManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import com.jefferson.nexusassistente.native.NexusNativeModule
import com.jefferson.nexusassistente.rea.ReaLayoutAnalyzer

/**
 * Serviço de acessibilidade: é ele quem realmente toca na tela do WhatsApp
 * (abrir a conversa, escrever, enviar, ligar) e no botão de play dos players.
 *
 * As ações de WhatsApp NÃO usam mais "ação pendente + espera de evento": elas
 * perguntam à tela até ela responder (`waitFor`). Era esse mecanismo que deixava
 * a chamada sem nunca acontecer quando o evento esperado não chegava.
 */

class NexusAccessibilityService : AccessibilityService() {

    companion object {
        private const val TAG = "NEXUS_A11Y"

        /** Instância viva do serviço, publicada para o módulo nativo usar. */
        @Volatile
        private var instance: NexusAccessibilityService? = null

        /** `true` quando o usuário liberou o serviço nas configurações do Android. */
        fun isConnected(): Boolean = instance != null

        /**
         * Dá play no player que estiver na tela, se ele estiver pausado.
         *
         * É o que faz o Nexus "tocar" a música pesquisada: o OiTube e o YouTube
         * podem abrir o vídeo parados, então depois de abrir o link o app chama
         * isto algumas vezes (o botão demora a aparecer).
         *
         * [requestId] identifica o pedido (uma música, um vídeo). O serviço dá no
         * máximo UM toque de play por pedido: o botão é um alternador, e sem essa
         * trava as conferências seguintes clicavam num player que JÁ estava
         * tocando e pausavam a música — era o play/pause piscando que o usuário
         * via depois de pedir música ou rádio.
         */
        fun pressPlayIfPaused(requestId: String = DEFAULT_PLAY_REQUEST): Boolean {
            val service = instance ?: return false
            return service.togglePlayPauseInternal(requestId, wantPlaying = true)
        }

        /** Identificador usado quando quem chama não tem um pedido próprio. */
        private const val DEFAULT_PLAY_REQUEST = "pedido-padrao"

        /** Identificador da pausa: não compartilha a trava do play. */
        private const val DEFAULT_PAUSE_REQUEST = "pedido-pausa"

        /**
         * Pausa o player que estiver na tela.
         *
         * Só clica quando o botão confirma que a mídia ESTÁ tocando: ele é um
         * alternador e, sem essa conferência, "pausa a música" começaria a tocar um
         * vídeo que estava parado.
         */
        fun pressPauseIfPlaying(requestId: String = DEFAULT_PAUSE_REQUEST): Boolean {
            val service = instance ?: return false
            return service.togglePlayPauseInternal(requestId, wantPlaying = false)
        }

        /**
         * Pacote do player que está na tela agora (YouTube/OiTube), se for um deles.
         *
         * Serve para o Nexus dizer em QUAL aplicativo a música foi pausada ou
         * pulada, em vez de falar de um app genérico.
         */
        fun foregroundMediaPackage(): String? {
            val service = instance ?: return null
            val packageName = service.rootInActiveWindow?.packageName?.toString() ?: return null
            return packageName.takeIf { it in service.mediaPackages }
        }

        /**
         * Sai da tela do player (volta uma tela) — usado por "parar a música".
         *
         * Sem isso o aplicativo continuaria na frente mesmo depois de a reprodução
         * parar, e o "fecha o aplicativo" que o usuário pediu não aconteceria.
         *
         * @return `true` quando havia um player na tela e a volta foi pedida.
         */
        fun leaveForegroundMediaApp(): Boolean {
            val service = instance ?: return false
            if (service.foregroundMediaPackageInternal() == null) return false
            return try {
                service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
            } catch (e: Exception) {
                Log.w(TAG, "Falha ao sair do player: ${e.message}")
                false
            }
        }

        /** Volta para a tela inicial (usado ao terminar a fila de mensagens). */
        fun goHome(): Boolean {
            val service = instance ?: return false
            return try {
                service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME)
            } catch (e: Exception) {
                Log.w(TAG, "Falha ao voltar para a tela inicial: ${e.message}")
                false
            }
        }

        /** Avança a faixa/vídeo no player da tela, quando ele oferece o botão. */
        fun skipNext(): Boolean = clickControl("next_button")

        /** Volta a faixa/vídeo no player da tela, quando ele oferece o botão. */
        fun skipPrevious(): Boolean = clickControl("prev_button")

        /** Clica no botão "Enviar" do WhatsApp na tela atual. */
        fun clickWhatsAppSend(): Boolean = clickControl("send_button")

        /**
         * Injeta texto no campo de mensagem do WhatsApp e clica em enviar.
         * Versão síncrona sem callback (para uso simples).
         */
        fun injectTextAndSend(message: String) {
            val service = instance
            if (service == null) {
                Log.w(TAG, "Envio direto ignorado: o serviço de acessibilidade está desligado")
                return
            }
            service.injectTextAndSend(message)
        }

        /**
         * Injeta texto e envia, com callback de sucesso/falha.
         * Usado por sendWhatsAppMessage para fluxo atômico.
         */
        fun injectTextAndSendAndWait(message: String, callback: (chatOpened: Boolean, sent: Boolean) -> Unit) {
            val service = instance
            if (service == null) {
                // Sem serviço ninguém toca na tela. Responder aqui é essencial:
                // antes o retorno mudo deixava a promessa do React Native sem
                // resolução e o app travava em "Pensando...".
                Log.w(TAG, "Mensagem: serviço de acessibilidade desconectado")
                callback(false, false)
                return
            }
            service.injectTextAndSendAndWait(message, callback)
        }

        /**
         * Busca um contato no WhatsApp e abre o chat dele.
         * Usado como fallback quando o link direto wa.me falha.
         */
        fun searchAndOpenWhatsAppContact(contactName: String, callback: (Boolean) -> Unit) {
            val service = instance
            if (service == null) {
                Log.w(TAG, "Busca no WhatsApp: serviço de acessibilidade desconectado")
                callback(false)
                return
            }
            service.searchAndOpenWhatsAppContact(contactName, callback)
        }

        /**
         * Dispara chamada de voz ou vídeo no WhatsApp (sem callback).
         */
        fun triggerCall(isVideo: Boolean) {
            val service = instance
            if (service == null) {
                Log.w(TAG, "Chamada WhatsApp ignorada: o serviço de acessibilidade está desligado")
                return
            }
            service.triggerCall(isVideo)
        }

        /**
         * Faz a chamada pelo WhatsApp e DIZ se ela saiu.
         *
         * É o que permite o app responder a verdade: antes `makeWhatsAppCall`
         * só abria a conversa e devolvia sucesso, então o Nexus anunciava
         * "chamada aberta" sem nunca ter ligado.
         */
        fun startWhatsAppCall(isVideo: Boolean, callback: (Boolean) -> Unit) {
            val service = instance
            if (service == null) {
                Log.w(TAG, "Chamada WhatsApp: serviço de acessibilidade desconectado")
                callback(false)
                return
            }
            service.startWhatsAppCall(isVideo, callback)
        }

        /**
         * Escreve e envia no chat JÁ aberto, dizendo se a mensagem saiu de fato.
         *
         * É o fluxo atômico de mensagem: escrever, esperar o botão de enviar
         * aparecer e conferir que o campo esvaziou. Antes isso era feito em duas
         * chamadas separadas, e o botão de enviar procurado não existia — a
         * mensagem ficava escrita no campo e nunca era enviada.
         */
        fun sendMessageInOpenChat(message: String, callback: (Boolean) -> Unit) {
            val service = instance
            if (service == null) {
                Log.w(TAG, "Envio no chat aberto: serviço de acessibilidade desconectado")
                callback(false)
                return
            }
            service.sendFlow(message) { _, sent -> callback(sent) }
        }

        /**
         * Escreve no chat aberto SEM enviar.
         *
         * É o passo do fluxo de resposta por voz: o texto fica no campo esperando
         * o "sim" do usuário. Se ele disser não, [clearOpenChat] apaga.
         */
        fun writeInOpenChat(message: String, callback: (Boolean) -> Unit) {
            val service = instance
            if (service == null) {
                Log.w(TAG, "Resposta: serviço de acessibilidade desconectado")
                callback(false)
                return
            }
            service.writeInOpenChatInternal(message, callback)
        }

        /**
         * Envia uma mensagem para a LISTA DE TRANSMISSÃO do WhatsApp.
         *
         * A lista já existe no WhatsApp (o usuário criou). O caminho é o mesmo
         * de sempre: abrir o app, achar a lista na conversa, escrever no campo
         * e tocar em enviar. O WhatsApp entrega a mensagem para cada contato
         * da lista, um a um.
         */
        fun sendToBroadcastList(message: String, listName: String?, callback: (Boolean) -> Unit) {
            val service = instance
            if (service == null) {
                Log.w(TAG, "Transmissão: serviço de acessibilidade desconectado")
                callback(false)
                return
            }
            service.broadcastFlow(message, listName, callback)
        }

        /**
         * Os nomes das listas de transmissão que existem no WhatsApp.
         *
         * É o que permite ao Nexus perguntar "para qual lista?" quando há mais
         * de uma.
         */
        fun listBroadcastLists(callback: (List<String>) -> Unit) {
            val service = instance
            if (service == null) {
                Log.w(TAG, "Transmissão: serviço de acessibilidade desconectado")
                callback(emptyList())
                return
            }
            service.openBroadcastLists(onReady = { names -> callback(names) })
        }

        /** Apaga o que está escrito no campo do chat aberto. */
        fun clearOpenChat(callback: (Boolean) -> Unit) {
            val service = instance
            if (service == null) return callback(false)
            service.writeInOpenChatInternal("", callback)
        }

        /**
         * O texto da ÚLTIMA mensagem do chat aberto.
         *
         * A notificação do WhatsApp chega truncada (e às vezes sem texto, por
         * causa da privacidade do aplicativo). A mensagem DE VERDADE está na
         * tela: é lá que o Nexus tem que ler.
         */
        fun readLastChatMessage(callback: (String?) -> Unit) {
            val service = instance
            if (service == null) {
                Log.w(TAG, "Leitura da mensagem: serviço de acessibilidade desconectado")
                callback(null)
                return
            }
            service.readLastMessageInternal(callback)
        }

        /** Tempo máximo esperando a conversa abrir para a mensagem ser lida. */
        private const val MESSAGE_READ_TIMEOUT_MS = 3000L

        /** Menu de seleção do WhatsApp (lixeira) e diálogo de confirmação. */
        private const val SELECT_TIMEOUT_MS = 5_000L

        /** O diálogo "Apagar para todos" precisa fechar: é a prova do apagar. */
        private const val DELETE_DONE_TIMEOUT_MS = 4_000L

        /**
         * Apaga a ÚLTIMA mensagem enviada na conversa aberta.
         *
         * O fluxo é o que o usuário descreveu: pressionar a mensagem enviada
         * para marcá-la → a lixeira aparece no topo à esquerda → tocar nela →
         * "Apagar para todos" (sempre "para todos", nunca "só para mim").
         *
         * Honesto em cada passo: devolve `false` com o MOTIVO quando a
         * conversa não abre, não acha a mensagem ou o WhatsApp não mostra o
         * botão esperado — quem chamou avisa o usuário em vez de fingir.
         */
        fun deleteLastSentMessage(callback: (Boolean, String?) -> Unit) {
            val service = instance
            if (service == null) {
                Log.w(TAG, "Apagar mensagem: serviço de acessibilidade desconectado")
                callback(false, "sem automação")
                return
            }
            service.deleteLastSentMessageInternal(callback)
        }

        /** Envia o texto que já está no campo (depois do "sim"). */
        fun sendInOpenChat(callback: (Boolean) -> Unit) {
            val service = instance
            if (service == null) {
                Log.w(TAG, "Resposta: serviço de acessibilidade desconectado")
                callback(false)
                return
            }
            service.sendInOpenChatInternal(callback)
        }

        /**
         * Toca o áudio mais recente da conversa aberta.
         *
         * É melhor esforço e HONESTO: procura o controle de reprodução pelo nome
         * acessível e só devolve `true` quando o toque foi disparado de verdade.
         * Se não achar, quem chamou avisa o usuário em vez de fingir que tocou.
         */
        fun playLastVoiceNote(callback: (Boolean) -> Unit) {
            val service = instance
            if (service == null) {
                Log.w(TAG, "Áudio: serviço de acessibilidade desconectado")
                callback(false)
                return
            }
            service.playLastVoiceNoteInternal(callback)
        }

        /**
         * Toca no "atender" da chamada que está na tela.
         *
         * Não existe API pública para atender uma chamada do WhatsApp: quem toca
         * é a acessibilidade, procurando o botão pelo nome acessível ("Atender",
         * "Aceitar"). Quando o botão não aparece, devolve `false` — o Nexus pede
         * para o usuário atender na mão em vez de fingir que atendeu.
         */
        fun answerIncomingCall(callback: (Boolean) -> Unit) {
            val service = instance
            if (service == null) {
                Log.w(TAG, "Chamada: serviço de acessibilidade desconectado")
                callback(false)
                return
            }
            service.tapCallButton(ANSWER_CALL_LABELS, "atender", callback)
        }

        /** Toca no "recusar" da chamada que está na tela (mesma regra). */
        fun declineIncomingCall(callback: (Boolean) -> Unit) {
            val service = instance
            if (service == null) {
                Log.w(TAG, "Chamada: serviço de acessibilidade desconectado")
                callback(false)
                return
            }
            service.tapCallButton(DECLINE_CALL_LABELS, "recusar", callback)
        }

        /** Nomes acessíveis dos botões de uma chamada recebida. */
        private val ANSWER_CALL_LABELS =
            listOf("atender", "aceitar", "answer", "accept")
        private val DECLINE_CALL_LABELS =
            listOf("recusar", "rejeitar", "encerrar", "decline", "reject")

        /** Janela para a MESMA chamada não ser anunciada duas vezes pela tela. */
        private const val SCREEN_CALL_DEDUPE_MS = 45_000L

        /** Textos da tela de chamada que nunca são o nome do contato. */
        private val SCREEN_CALL_IGNORED_LABELS = setOf(
            "atender",
            "recusar",
            "recusar chamada",
            "aceitar",
            "rejeitar",
            "chamada de voz",
            "chamada de video",
            "whatsapp",
            "microfone",
            "camera",
            "alto-falante",
            "viva-voz",
            "ligando",
            "chamando",
            "conectando",
            "minimizar",
            "adicionar pessoas",
            "sair da ligacao",
            "selecionar dispositivo de audio",
            "mais opcoes",
            "efeito de realidade aumentada",
            "trocar para a camera traseira",
            "voce",
            "esta falando agora",
        )

        /** Tempo máximo esperando o botão da chamada aparecer. */
        private const val CALL_BUTTON_TIMEOUT_MS = 6_000L

        /** Tempo máximo para a conversa abrir depois do wa.me. */
        private const val CHAT_OPEN_TIMEOUT_MS = 15_000L

        /**
         * Tempo máximo para a conversa da LISTA DE TRANSMISSÃO abrir.
         *
         * A conversa abre com animação depois do toque na linha; o campo de
         * mensagem só existe no fim dela. 6 s dão folga e ainda permitem uma
         * segunda tentativa sem deixar o usuário esperando demais.
         */
        private const val BROADCAST_CHAT_TIMEOUT_MS = 6_000L

        /** Tempo máximo para o menu de ligação aparecer. */
        private const val CALL_MENU_TIMEOUT_MS = 5_000L

        /** Tempo máximo para a tela de chamada assumir a frente. */
        private const val CALL_SCREEN_TIMEOUT_MS = 8_000L

        /** Tempo máximo para o botão de alto-falante aparecer na chamada. */
        private const val CALL_AUDIO_TIMEOUT_MS = 5_000L

        /** Tempo máximo para o botão de enviar aparecer depois de escrever. */
        private const val SEND_READY_TIMEOUT_MS = 5_000L

        /** Tempo máximo para o campo esvaziar (sinal de que a mensagem saiu). */
        private const val SEND_CONFIRM_TIMEOUT_MS = 5_000L

        /**
         * Texto que o WhatsApp mostra DENTRO do campo quando ele está vazio.
         *
         * Não é rascunho: é o placeholder. Comparar o campo com string vazia
         * fazia o envio ser dado como falho mesmo depois de a mensagem sair.
         */
        private val EMPTY_MESSAGE_HINTS = setOf(
            "mensagem",
            "message",
            "digite uma mensagem",
            "type a message",
        )

        /** Tempo máximo para a busca do WhatsApp abrir. */
        private const val SEARCH_OPEN_TIMEOUT_MS = 8_000L

        /** Tempo máximo para o resultado da busca aparecer. */
        private const val SEARCH_RESULT_TIMEOUT_MS = 8_000L

        /**
         * Nomes acessíveis que o WhatsApp usa para o controle de reprodução da
         * mensagem de voz (e o de pausa, enquanto ela toca).
         * Cobertura ampla para PT-BR e EN, cobrindo variações do WhatsApp atual.
         */
        private val VOICE_PLAY_LABELS = listOf(
            "reproduzir",           // PT-BR padrão
            "ouvir",                // PT-BR curto
            "tocar audio",          // PT-BR "tocar áudio"
            "reproduzir audio",     // PT-BR "reproduzir áudio"
            "reproduzir mensagem",  // PT-BR "reproduzir mensagem"
            "reproduzir voz",       // PT-BR "reproduzir voz"
            "ouvir audio",          // PT-BR "ouvir áudio"
            "ouvir mensagem",       // PT-BR "ouvir mensagem"
            "tocar mensagem",       // PT-BR "tocar mensagem"
            "play voice",           // EN padrão
            "play voice message",   // EN "play voice message"
            "play voice note",      // EN "play voice note"
            "play audio",           // EN "play audio"
            "play",                 // EN curto
            "listen",               // EN "listen"
            "listen voice",         // EN "listen voice"
        )
        private val VOICE_PAUSE_LABELS = listOf(
            "pausar",               // PT-BR
            "pause",                // EN
            "parar",                // PT-BR "parar"
            "stop",                 // EN "stop"
        )

        /** Teto de espera do áudio: nenhum áudio segura o Nexus para sempre. */
        private const val VOICE_NOTE_MAX_MS = 180_000L

        /** Folga inicial: tempo para a tela mostrar que começou a tocar. */
        private const val VOICE_NOTE_GRACE_MS = 8_000L

        /** Intervalo entre duas olhadas na tela durante a reprodução. */
        private const val VOICE_NOTE_POLL_MS = 500L

        /**
         * Clica num elemento do mapa da tela atual.
         *
         * Usa o mesmo [clickOrTap] das ações de WhatsApp: os botões de mídia e o
         * de enviar aparecem como NÃO clicáveis na árvore, então o clique puro
         * por acessibilidade não funciona neles.
         */
        private fun clickControl(elementKey: String): Boolean {
            val service = instance ?: return false
            val root = service.rootInActiveWindow ?: return false
            val packageName = root.packageName?.toString() ?: return false
            val node = service.reaAnalyzer.findTargetElement(root, packageName, elementKey)
                ?: return false
            return service.clickOrTap(node)
        }
    }

    private val reaAnalyzer = ReaLayoutAnalyzer()
    private val mainHandler = Handler(Looper.getMainLooper())

    /** Pedido de play atual e se já houve toque de play por causa dele. */
    private var playRequestId: String? = null
    private var playClickedForRequest = false

    /** Última chamada anunciada pela TELA (fallback da notificação). */
    @Volatile
    private var lastScreenCallContact: String? = null

    @Volatile
    private var lastScreenCallAt: Long = 0L

    /** Evita empilhar várias verificações enquanto a tela de chamada desenha. */
    @Volatile
    private var callProbeScheduled = false

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        playRequestId = null
        playClickedForRequest = false
        Log.d("NEXUS_A11Y", "Serviço de acessibilidade conectado")
        // O app lê o estado das permissões num retrato (snapshot). Se ele leu
        // antes de o serviço conectar, ficava mostrando "PERMITIR" mesmo com a
        // automação já ligada - e o usuário re-liberava o que já tinha
        // liberado. O aviso deixa a tela se atualizar sozinha.
        NexusNativeModule.emitEvent(
            "onAccessibilityStateChanged",
            mapOf("connected" to true),
        )
        // Se o serviço reconectou com uma chamada já na tela, a notificação
        // pode ter sido perdida: a tela ainda é uma evidência válida.
        mainHandler.postDelayed({ probeIncomingCallScreen() }, 800L)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Reconexões do sistema não passam por onServiceConnected em alguns
        // aparelhos: guardar a instância aqui mantém o atalho do play válido.
        instance = this

        // FALLBACK DA CHAMADA RECEBIDA: quando o WhatsApp abre a tela de
        // chamada (ou o Android não entrega a notificação ao listener), a
        // própria tela é a única evidência da ligação. A verificação é
        // agendada com atraso curto porque o nome e os botões só aparecem
        // depois que a Activity termina de desenhar.
        val packageName = event?.packageName?.toString() ?: return
        if (packageName != ReaLayoutAnalyzer.WHATSAPP_PACKAGE) return
        if (
            event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED &&
            event.eventType != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
        ) {
            return
        }
        if (callProbeScheduled) return
        callProbeScheduled = true
        mainHandler.postDelayed({
            callProbeScheduled = false
            probeIncomingCallScreen()
        }, 500L)
    }

    /**
     * Lê a tela de chamada RECEBIDA e avisa o JS.
     *
     * Só age quando os dois botões existem ("Atender" e "Recusar"): uma
     * chamada já atendida/em andamento não tem essa dupla, então não vira um
     * novo aviso. O nome sai do texto da tela; se ele não for encontrado, é
     * melhor não falar do que falar o nome errado.
     */
    private fun probeIncomingCallScreen() {
        val root = rootInActiveWindow ?: return
        if (root.packageName?.toString() != ReaLayoutAnalyzer.WHATSAPP_PACKAGE) return

        val answerNodes = ArrayList<AccessibilityNodeInfo>()
        val declineNodes = ArrayList<AccessibilityNodeInfo>()
        collectCallButtons(root, answerNodes, 0, ANSWER_CALL_LABELS)
        collectCallButtons(root, declineNodes, 0, DECLINE_CALL_LABELS)
        if (answerNodes.isEmpty() || declineNodes.isEmpty()) return

        val contact = extractCallContact(root) ?: run {
            Log.w(TAG, "Chamada recebida na tela, mas não achei o nome do contato")
            return
        }
        val type = if (screenLooksLikeVideo(root)) "video-call" else "voice-call"
        val now = System.currentTimeMillis()
        if (
            contact.equals(lastScreenCallContact, ignoreCase = true) &&
            now - lastScreenCallAt < SCREEN_CALL_DEDUPE_MS
        ) {
            return
        }
        if (!NexusNotificationListenerService.claimCallAnnouncement(contact, type)) {
            Log.d(TAG, "Chamada de \"$contact\" já anunciada pela notificação; sem duplicar")
            return
        }

        lastScreenCallContact = contact
        lastScreenCallAt = now
        Log.d(TAG, "Chamada recebida pela tela: \"$contact\" ($type)")
        NexusNativeModule.emitEvent(
            "onNotificationReceived",
            mapOf(
                "app" to "WhatsApp",
                "contact" to contact,
                "message" to if (type == "video-call") "Chamada de vídeo" else "Chamada de voz",
                "type" to type,
                "isAudio" to false,
            ),
        )
    }

    /**
     * Nome do contato na tela de chamada.
     *
     * O WhatsApp costuma escrever "Chamada de voz com Amor" no nome acessível
     * e o nome puro num TextView do topo. As duas formas são aceitas; a
     * primeira é preferida por não depender da posição do texto.
     */
    private fun extractCallContact(root: AccessibilityNodeInfo): String? {
        val fromDescription = findContactInText(root, preferDescription = true)
        if (!fromDescription.isNullOrBlank()) return fromDescription
        return findContactInText(root, preferDescription = false)
    }

    private fun findContactInText(
        node: AccessibilityNodeInfo,
        preferDescription: Boolean,
        depth: Int = 0,
        best: String? = null,
    ): String? {
        if (depth > 40) return best
        val raw = if (preferDescription) node.contentDescription?.toString() else node.text?.toString()
        val candidate = raw?.let { contactFromSentence(it) }
        val nextBest = when {
            candidate.isNullOrBlank() -> best
            best.isNullOrBlank() -> candidate
            candidate.length < best.length -> candidate
            else -> best
        }

        var result = nextBest
        for (index in 0 until node.childCount) {
            val child = node.getChild(index) ?: continue
            result = findContactInText(child, preferDescription, depth + 1, result)
        }
        return result
    }

    /** Extrai o nome de frases como "Chamada de voz com Amor" ou "Amor está chamando". */
    private fun contactFromSentence(text: String): String? {
        val clean = text.replace(Regex("\\s+"), " ").trim()
        if (clean.isEmpty()) return null
        val folded = ReaLayoutAnalyzer.foldText(clean)

        val patterns = listOf(
            Regex("(?:chamada|ligacao) de (?:video|voz) (?:com|de) (.+)", RegexOption.IGNORE_CASE),
            Regex("(.+?) (?:esta|ta) (?:chamando|ligando)", RegexOption.IGNORE_CASE),
            Regex("(?:chamada|ligacao) (?:de|com) (.+)", RegexOption.IGNORE_CASE),
        )
        for (pattern in patterns) {
            val match = pattern.find(clean)
            val value = match?.groupValues?.getOrNull(1)?.trim()
            if (!value.isNullOrBlank()) {
                return cleanContactName(value)
            }
        }

        // Nome puro no topo da tela: evita rótulos de botões e status.
        if (folded in SCREEN_CALL_IGNORED_LABELS) return null
        if (folded.contains("criptografia") || folded.contains("protegida")) return null
        if (folded.contains("chamada de voz") || folded.contains("chamada de video")) return null
        if (clean.length !in 2..40) return null
        if (clean.matches(Regex("^[0-9:.,\\s]+$"))) return null
        if (clean.any { it.isDigit() } && clean.count { it.isDigit() } > 6) return null
        return cleanContactName(clean)
    }

    private fun cleanContactName(value: String): String? {
        val cleaned = value
            .replace(Regex("\\s+"), " ")
            .replace(Regex("\\s+(?:esta|ta) (?:chamando|ligando).*$", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\s+protegida.*$", RegexOption.IGNORE_CASE), "")
            .trim()
        return cleaned.takeIf { it.length in 2..60 }
    }

    /** O texto da tela menciona vídeo? */
    private fun screenLooksLikeVideo(root: AccessibilityNodeInfo): Boolean {
        val found = containsVideoLabel(root, 0)
        return found
    }

    private fun containsVideoLabel(node: AccessibilityNodeInfo, depth: Int): Boolean {
        if (depth > 40) return false
        val combined = "${node.contentDescription ?: ""} ${node.text ?: ""}"
        if (ReaLayoutAnalyzer.foldText(combined).contains("video")) return true
        for (index in 0 until node.childCount) {
            val child = node.getChild(index) ?: continue
            if (containsVideoLabel(child, depth + 1)) return true
        }
        return false
    }

    override fun onInterrupt() {
        Log.w(TAG, "Serviço de acessibilidade interrompido")
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        super.onDestroy()
    }

    override fun onUnbind(intent: Intent?): Boolean {
        if (instance === this) instance = null
        return super.onUnbind(intent)
    }

    /** Apps em que o Nexus tem permissão de mexer no botão de play. */
    private val mediaPackages = setOf(
        ReaLayoutAnalyzer.YOUTUBE_PACKAGE,
        ReaLayoutAnalyzer.OITUBE_PACKAGE,
    )

    /** Mesma checagem do companion, para uso interno do serviço. */
    internal fun foregroundMediaPackageInternal(): String? {
        val packageName = rootInActiveWindow?.packageName?.toString() ?: return null
        return packageName.takeIf { it in mediaPackages }
    }

    /** Estado do botão de play/pause que o Nexus conseguiu ler na tela. */
    private enum class PlayState { PLAYING, PAUSED, UNKNOWN }

    /**
     * Toca no botão de play/pause da tela, respeitando o estado lido.
     *
     * O botão é um alternador: clicar sem olhar o estado faz o contrário do que o
     * usuário pediu (era o play/pause "piscando" da música e da rádio).
     *
     * @param wantPlaying `true` para dar play (só clica se estiver parado),
     *   `false` para pausar (só clica se estiver tocando).
     */
    private fun togglePlayPauseInternal(requestId: String, wantPlaying: Boolean): Boolean {
        // Pedido novo: zera a trava de "um toque por pedido".
        if (requestId != playRequestId) {
            playRequestId = requestId
            playClickedForRequest = false
        }

        val root = rootInActiveWindow ?: return false
        val packageName = root.packageName?.toString() ?: return false

        if (packageName !in mediaPackages) {
            Log.d(TAG, "Botão de mídia ignorado: o app na tela não é player ($packageName)")
            return false
        }

        val node = reaAnalyzer.findTargetElement(root, packageName, "play_pause_button")
        if (node == null) {
            Log.d(TAG, "Botão de play/pause ainda não apareceu em $packageName")
            return false
        }

        when (readPlayState(node)) {
            PlayState.PLAYING -> if (wantPlaying) {
                Log.d(TAG, "Player já está tocando: nada a fazer")
                return false
            }
            PlayState.PAUSED -> if (!wantPlaying) {
                Log.d(TAG, "Player já está pausado: nada a fazer")
                return false
            }
            // Estado ilegível: vale UM toque por pedido no play — era isso que
            // deixava a música e a rádio piscando (pausa, volta, pausa) logo
            // depois de o Nexus abrir o player. Para PAUSAR o toque não vale o
            // risco: começaria a tocar um vídeo que estava parado.
            PlayState.UNKNOWN -> if (wantPlaying) {
                if (playClickedForRequest) {
                    Log.d(TAG, "Play já foi disparado neste pedido: não clico de novo")
                    return false
                }
            } else {
                Log.d(TAG, "Sem saber se toca, não arrisco pausar em $packageName")
                return false
            }
        }

        if (playClickedForRequest) {
            Log.d(TAG, "Toque já foi disparado neste pedido: não clico de novo")
            return false
        }

        val clicked = node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        if (clicked) playClickedForRequest = true
        Log.d(
            TAG,
            if (wantPlaying) {
                "Play disparado em $packageName: $clicked"
            } else {
                "Pausa disparada em $packageName: $clicked"
            }
        )
        return clicked
    }

    /**
     * Lê o estado do botão de play/pause.
     *
     * O mesmo botão serve para as duas ações, então o app escreve no
     * identificador ou na descrição qual ação ele oferece agora: "pausar"
     * significa que a mídia ESTÁ tocando.
     */
    private fun readPlayState(node: AccessibilityNodeInfo): PlayState {
        val id = node.viewIdResourceName?.lowercase(java.util.Locale.ROOT).orEmpty()
        val description = node.contentDescription?.toString()?.lowercase(java.util.Locale.ROOT).orEmpty()

        // "play_pause_button", "al_exo_play_pause" e "bottomPlayPauseButton" são
        // alternadores: o identificador não diz o estado, só a descrição diz.
        val toggleId = id.contains("play_pause") || id.contains("playpause")
        if (!toggleId) {
            if (id.endsWith("pause") || id.endsWith("pause_button") || id.contains("exo_pause")) {
                return PlayState.PLAYING
            }
            if (id.endsWith("play") || id.endsWith("play_button") || id.contains("exo_play")) {
                return PlayState.PAUSED
            }
        }

        if (description.contains("paus")) return PlayState.PLAYING
        if (
            description.contains("play") ||
            description.contains("reproduz") ||
            description.contains("tocar")
        ) {
            return PlayState.PAUSED
        }

        return PlayState.UNKNOWN
    }

    // ---------------------------------------------------------------------
    // Helpers de tela: procurar, esperar e tocar
    // ---------------------------------------------------------------------

    /** Normaliza nome/texto para comparar (sem acento, minúsculo). */
    private fun fold(value: CharSequence?): String = ReaLayoutAnalyzer.foldText(value)

    /** Raiz da tela, só quando o app na frente é o WhatsApp. */
    private fun whatsAppRoot(): AccessibilityNodeInfo? {
        val root = rootInActiveWindow ?: return null
        return root.takeIf { it.packageName?.toString() == ReaLayoutAnalyzer.WHATSAPP_PACKAGE }
    }

    /** Procura um elemento do mapa do WhatsApp na tela atual. */
    private fun find(key: String, root: AccessibilityNodeInfo? = whatsAppRoot()): AccessibilityNodeInfo? {
        val current = root ?: return null
        return reaAnalyzer.findTargetElement(current, ReaLayoutAnalyzer.WHATSAPP_PACKAGE, key)
    }

    /**
     * Espera a tela responder: tenta [predicate] a cada [intervalMs] até
     * [timeoutMs] e entrega o resultado (ou `null` quando o tempo acaba).
     *
     * Substitui os sleeps fixos que existiam aqui ("dorme 800 ms e torce"):
     * pergunta de novo até a tela responder e desiste com um motivo claro. Nada
     * bloqueia — cada tentativa é um post na thread principal.
     */
    private fun <T> waitFor(
        timeoutMs: Long,
        intervalMs: Long = 150L,
        predicate: () -> T?,
        onDone: (T?) -> Unit
    ) {
        val deadline = System.currentTimeMillis() + timeoutMs
        val attempt = object : Runnable {
            override fun run() {
                val value = try {
                    predicate()
                } catch (e: Exception) {
                    null
                }
                if (value != null) {
                    onDone(value)
                    return
                }
                if (System.currentTimeMillis() >= deadline) {
                    onDone(null)
                    return
                }
                mainHandler.postDelayed(this, intervalMs)
            }
        }
        mainHandler.post(attempt)
    }

    /** Primeiro ancestral clicável, se houver. */
    private fun clickableAncestor(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        var current: AccessibilityNodeInfo? = node
        var depth = 0
        while (current != null && depth < 6) {
            if (current.isClickable) return current
            current = current.parent
            depth++
        }
        return null
    }

    /**
     * Clica no nó; se ele (nem os pais) se diz clicável, toca na coordenada.
     *
     * Os botões de chamada e de enviar do WhatsApp vêm com `clickable=false` na
     * árvore de acessibilidade — o toque é tratado por baixo. Sem o toque por
     * coordenada, `ACTION_CLICK` devolve false e nada acontece.
     */
    private fun clickOrTap(node: AccessibilityNodeInfo): Boolean {
        val clickable = clickableAncestor(node)
        if (clickable != null && clickable.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
            return true
        }
        return tapNode(node)
    }

    /** Toque curto no centro do nó. */
    private fun tapNode(node: AccessibilityNodeInfo): Boolean {
        val bounds = Rect()
        node.getBoundsInScreen(bounds)
        if (bounds.width() <= 0 || bounds.height() <= 0) return false
        val path = Path().apply { moveTo(bounds.exactCenterX(), bounds.exactCenterY()) }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0L, 60L))
            .build()
        val dispatched = dispatchGesture(gesture, null, null)
        Log.d(TAG, "Toque em ${bounds.exactCenterX()},${bounds.exactCenterY()}: $dispatched")
        return dispatched
    }

    // ---------------------------------------------------------------------
    // WhatsApp: apagar a última mensagem enviada
    // ---------------------------------------------------------------------

    /**
     * A ÚLTIMA mensagem ENVIADA (nossa) na conversa aberta.
     *
     * As bolhas de texto do WhatsApp têm o resource-id `text_view` — as
     * enviadas e as recebidas. A nossa é a que fica na METADE DIREITA da
     * tela (o receptor fica à esquerda). Entre as nossas, vale a de baixo.
     *
     * Sem nenhuma na direita (a conversa termina em mensagem DO contato),
     * devolve `null`: apagar a mensagem de OUTRO não é o que foi pedido.
     */
    private fun lastSentMessageNode(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        val candidates = mutableListOf<AccessibilityNodeInfo>()
        val bounds = Rect()
        collectNodes(root) { node ->
            val id = node.viewIdResourceName ?: return@collectNodes
            if (!id.endsWith("text_view")) return@collectNodes
            val text = node.text
            if (text.isNullOrBlank()) return@collectNodes
            node.getBoundsInScreen(bounds)
            if (bounds.width() <= 0) return@collectNodes
            val width = resources.displayMetrics.widthPixels
            if (bounds.exactCenterX() < width / 2f) return@collectNodes
            candidates.add(node)
        }

        var best: AccessibilityNodeInfo? = null
        var bestTop = Int.MIN_VALUE
        for (node in candidates) {
            node.getBoundsInScreen(bounds)
            if (bounds.top >= bestTop) {
                bestTop = bounds.top
                best = node
            }
        }
        return best
    }

    /** Percorre a árvore visitando cada nó (sem alocar listas inteiras). */
    private fun collectNodes(
        node: AccessibilityNodeInfo,
        visit: (AccessibilityNodeInfo) -> Unit,
    ) {
        visit(node)
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            collectNodes(child, visit)
        }
    }

    /**
     * Pressão LONGA no nó: primeiro `ACTION_LONG_CLICK` no ancestral
     * clicável (é assim que o WhatsApp expõe a bolha); se ele recusar, um
     * gesto de 700 ms no centro — que é o que o dedo faria.
     */
    private fun longPressNode(node: AccessibilityNodeInfo): Boolean {
        val clickable = clickableAncestor(node)
        if (clickable != null && clickable.performAction(AccessibilityNodeInfo.ACTION_LONG_CLICK)) {
            return true
        }
        val bounds = Rect()
        node.getBoundsInScreen(bounds)
        if (bounds.width() <= 0 || bounds.height() <= 0) return false
        val path = Path().apply { moveTo(bounds.exactCenterX(), bounds.exactCenterY()) }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0L, 700L))
            .build()
        return dispatchGesture(gesture, null, null)
    }

    /**
     * O fluxo de apagar, passo a passo, cada um com o seu motivo de falha:
     *
     *  1. conversa aberta (o campo de mensagem é a prova);
     *  2. pressão longa na ÚLTIMA mensagem enviada → menu de seleção;
     *  3. lixeira ("Apagar") no topo;
     *  4. "Apagar para todos" no diálogo — SEMPRE "para todos", conforme o
     *     usuário determinou, nunca "apagar só para mim";
     *  5. o diálogo precisa FECHAR: o clique sozinho não é prova de nada.
     */
    internal fun deleteLastSentMessageInternal(callback: (Boolean, String?) -> Unit) {
        waitForOpenChat(CHAT_OPEN_TIMEOUT_MS) { chatReady ->
            if (!chatReady) {
                Log.w(TAG, "Apagar mensagem: a conversa não abriu")
                callback(false, "a conversa não abriu")
                return@waitForOpenChat
            }

            val root = whatsAppRoot()
            val target = root?.let { lastSentMessageNode(it) }
            if (target == null) {
                callback(false, "não achei mensagem enviada por você nesta conversa")
                return@waitForOpenChat
            }

            if (!longPressNode(target)) {
                callback(false, "não consegui selecionar a mensagem")
                return@waitForOpenChat
            }

            // Menu de seleção: a lixeira.
            waitFor(SELECT_TIMEOUT_MS, predicate = { find("delete_button") }, onDone = { bin ->
                if (bin == null) {
                    callback(false, "a lixeira de apagar não apareceu")
                    return@waitFor
                }
                clickOrTap(bin)

                // Diálogo: "Apagar para todos".
                waitFor(SELECT_TIMEOUT_MS, predicate = { find("delete_for_everyone") }, onDone = { forEveryone ->
                    if (forEveryone == null) {
                        callback(false, "não apareceu o \"apagar para todos\"")
                        return@waitFor
                    }
                    clickOrTap(forEveryone)

                    // Prova: o diálogo sumiu da tela.
                    waitFor(DELETE_DONE_TIMEOUT_MS, predicate = {
                        if (find("delete_for_everyone") == null) true else null
                    }, onDone = { closed ->
                        if (closed == true) {
                            Log.d(TAG, "Mensagem apagada para todos")
                            callback(true, null)
                        } else {
                            callback(false, "o diálogo de apagar não fechou")
                        }
                    })
                })
            })
        }
    }

    /** Espera a conversa abrir: o campo de mensagem na tela é a prova. */
    private fun waitForOpenChat(timeoutMs: Long, onDone: (Boolean) -> Unit) {
        waitFor(timeoutMs = timeoutMs, predicate = {
            val root = whatsAppRoot() ?: return@waitFor null
            val chatOpen = find("message_input", root) != null
            // A BUSCA também tem EditText. Enquanto o overlay de busca está
            // aberto não é conversa: sem esta trava o Nexus escrevia a mensagem
            // na caixa de busca (evidência: search_input com "teste do nexus 4").
            if (chatOpen && find("search_input", root) == null) true else null
        }, onDone = { ready -> onDone(ready == true) })
    }

    // ---------------------------------------------------------------------
    // WhatsApp: chamada (menu de ligação → voz/vídeo)
    // ---------------------------------------------------------------------

    /**
     * Chamada pelo WhatsApp no chat que está abrindo.
     *
     * Evidência (WhatsApp atual, Android 15, tela real): o topo da conversa tem
     * DOIS botões diretos — "Ligação de vídeo" e "Ligação de voz" (ImageButton
     * sem resource-id, só content-desc). Versões antigas mostravam um
     * "Menu de ligação" com as mesmas opções; por isso o caminho direto é
     * tentado primeiro e o menu fica como plano B.
     */
    private fun callFlow(isVideo: Boolean, callback: (Boolean) -> Unit) {
        waitForOpenChat(CHAT_OPEN_TIMEOUT_MS) { chatReady ->
            if (!chatReady) {
                Log.w(TAG, "Chamada WhatsApp: a conversa não abriu")
                callback(false)
            } else {
                startCall(isVideo, callback)
            }
        }
    }

    /** Botão direto do topo primeiro; menu de ligação só se ele não existir. */
    private fun startCall(isVideo: Boolean, callback: (Boolean) -> Unit) {
        val itemKey = if (isVideo) "video_call_item" else "voice_call_item"
        val direct = find(itemKey)
        if (direct != null) {
            Log.d(TAG, "Chamada WhatsApp: botão direto $itemKey encontrado")
            tapCallItem(itemKey, callback)
            return
        }
        Log.d(TAG, "Chamada WhatsApp: botão direto ausente, tentando o menu")
        openCallMenu(isVideo, callback)
    }

    private fun openCallMenu(isVideo: Boolean, callback: (Boolean) -> Unit) {
        val trigger = find("call_menu_trigger")
        val opened = trigger != null && clickOrTap(trigger)
        Log.d(TAG, "Chamada WhatsApp: menu de ligação aberto = $opened")

        val itemKey = if (isVideo) "video_call_item" else "voice_call_item"
        waitFor(timeoutMs = CALL_MENU_TIMEOUT_MS, predicate = {
            find(itemKey)?.let { true }
        }, onDone = { menuReady ->
            if (menuReady != true) {
                Log.w(TAG, "Chamada WhatsApp: opção ${if (isVideo) "de vídeo" else "de voz"} não apareceu")
                callback(false)
            } else {
                tapCallItem(itemKey, callback)
            }
        })
    }

    private fun tapCallItem(itemKey: String, callback: (Boolean) -> Unit) {
        val item = find(itemKey)
        val tapped = item != null && clickOrTap(item)
        Log.d(TAG, "Chamada WhatsApp: toque em $itemKey = $tapped")
        if (!tapped) {
            callback(false)
            return
        }
        // O campo de mensagem só existe na conversa: quando ele some e o pacote
        // continua sendo o WhatsApp, a tela de chamada assumiu a frente.
        waitFor(timeoutMs = CALL_SCREEN_TIMEOUT_MS, predicate = {
            val root = whatsAppRoot()
            val stillInChat = root != null && find("message_input", root) != null
            if (root != null && !stillInChat) true else null
        }, onDone = { started ->
            Log.d(TAG, "Chamada WhatsApp: tela de chamada confirmada = ${started == true}")
            if (started == true) {
                // A chamada assumiu a tela: viva-voz + volume alto, em paralelo,
                // sem segurar a resposta do comando.
                enableCallAudio()
            }
            callback(started == true)
        })
    }

    /**
     * Deixa a chamada em viva-voz e aumenta o volume de voz.
     *
     * Evidência (moto g84, Android 15, chamada real): o botão da tela de
     * chamada é `com.whatsapp:id/audio_route_button`, content-desc
     * "Desligar alto-falante" quando o viva-voz JÁ está ligado e "Ativar
     * alto-falante" quando está desligado. O texto embaixo ("Alto-falante") é
     * só o rótulo; por isso a decisão usa o content-desc do botão.
     *
     * O volume é ajustado no STREAM_VOICE_CALL, o mesmo stream da chamada.
     * Nada aqui bloqueia o callback: se o botão demorar, a chamada segue.
     */
    private fun enableCallAudio() {
        val audio = getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        if (audio == null) {
            Log.w(TAG, "Chamada: AudioManager indisponível")
            return
        }

        // Sobe já o volume da rota atual; depois do toque no viva-voz o volume
        // é ajustado de novo, porque o Android mantém um índice por dispositivo.
        raiseVoiceCallVolume(audio)

        waitFor(
            timeoutMs = CALL_AUDIO_TIMEOUT_MS,
            intervalMs = 200L,
            predicate = { find("call_speaker_button") },
            onDone = { node ->
                if (node == null) {
                    Log.w(TAG, "Chamada: botão de alto-falante não apareceu")
                } else {
                    val label = ReaLayoutAnalyzer.foldText(node.contentDescription)
                    val alreadyOn = label.contains("desligar") ||
                        label.contains("desativar") ||
                        label.contains("turn off")
                    if (alreadyOn) {
                        Log.d(TAG, "Chamada: viva-voz já estava ligado (\"$label\")")
                    } else {
                        val tapped = clickOrTap(node)
                        Log.d(TAG, "Chamada: toque no viva-voz=$tapped (\"$label\")")
                    }
                }
                raiseVoiceCallVolume(audio)
            },
        )
    }

    /**
     * Sobe o volume da chamada para o máximo do aparelho.
     *
     * `setStreamVolume` pode ser recusado em algumas ROMs; nesse caso o código
     * tenta o ajuste incremental e registra o que realmente aconteceu.
     */
    private fun raiseVoiceCallVolume(audio: AudioManager) {
        try {
            val max = audio.getStreamMaxVolume(AudioManager.STREAM_VOICE_CALL)
            val before = audio.getStreamVolume(AudioManager.STREAM_VOICE_CALL)
            if (max <= 0) {
                Log.w(TAG, "Chamada: volume de voz fixo/indisponível (max=$max)")
                return
            }
            audio.setStreamVolume(AudioManager.STREAM_VOICE_CALL, max, 0)
            val after = audio.getStreamVolume(AudioManager.STREAM_VOICE_CALL)
            Log.d(
                TAG,
                "Chamada: volume de voz $before -> $after (max=$max), modo=${audio.mode}",
            )
        } catch (e: SecurityException) {
            Log.w(TAG, "Chamada: sem permissão para o volume: ${e.message}")
            try {
                repeat(3) {
                    audio.adjustStreamVolume(
                        AudioManager.STREAM_VOICE_CALL,
                        AudioManager.ADJUST_RAISE,
                        0,
                    )
                }
                Log.d(
                    TAG,
                    "Chamada: volume ajustado no fallback para " +
                        "${audio.getStreamVolume(AudioManager.STREAM_VOICE_CALL)}",
                )
            } catch (fallback: Exception) {
                Log.w(TAG, "Chamada: fallback de volume falhou: ${fallback.message}")
            }
        } catch (e: Exception) {
            Log.w(TAG, "Chamada: falha ao ajustar o volume: ${e.message}")
        }
    }

    // ---------------------------------------------------------------------
    // WhatsApp: mensagem (escrever → enviar → conferir)
    // ---------------------------------------------------------------------

    /**
     * Escreve e envia no chat que está abrindo.
     *
     * O callback diz DUAS coisas: se a conversa abriu e se a mensagem saiu.
     * Quem chama não confunde mais "não abriu" com "não enviou" — e não tenta
     * buscar o contato de novo quando o chat já estava aberto (o que duplicava
     * a mensagem e podia acabar saindo da tela do WhatsApp).
     */
    private fun sendFlow(message: String, callback: (chatOpened: Boolean, sent: Boolean) -> Unit) {
        waitForOpenChat(CHAT_OPEN_TIMEOUT_MS) { chatReady ->
            if (!chatReady) {
                Log.w(TAG, "Mensagem: a conversa não abriu")
                callback(false, false)
            } else {
                writeAndSend(message) { sent -> callback(true, sent) }
            }
        }
    }

    private fun writeAndSend(message: String, callback: (Boolean) -> Unit) {
        // O campo de busca também é um EditText. Se a busca está aberta, o
        // texto iria para o lugar errado — aborta antes de escrever.
        if (find("search_input") != null) {
            Log.w(TAG, "Mensagem: a busca do WhatsApp está aberta; não vou escrever nela")
            callback(false)
            return
        }
        val input = find("message_input")
        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, message)
        }
        val written = input != null && input.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
        Log.d(TAG, "Mensagem escrita no campo: $written")
        if (!written) {
            callback(false)
            return
        }

        // O microfone (voice_note_btn) só existe com o campo VAZIO: quando ele
        // some, o botão de enviar tomou o lugar (evidência do app real). Sem
        // essa conferência o Nexus tocaria no microfone e começaria a gravar.
        waitFor(timeoutMs = SEND_READY_TIMEOUT_MS, predicate = {
            // "voice_note_button" some quando o campo deixa de estar vazio
            if (find("send_button") != null) true else null
        }, onDone = { ready ->
            if (ready != true) {
                Log.w(TAG, "Mensagem: o botão de enviar não apareceu")
                callback(false)
            } else {
                tapSendAndConfirm(callback)
            }
        })
    }

    private fun tapSendAndConfirm(callback: (Boolean) -> Unit) {
        val sendButton = find("send_button")
        val tapped = sendButton != null && clickOrTap(sendButton)
        Log.d(TAG, "Toque em enviar: $tapped")
        if (!tapped) {
            callback(false)
            return
        }
        // O campo vazio mostra o placeholder "Mensagem": ele NÃO é rascunho.
        // Antes a checagem exigia string vazia, dava o envio como falho e o
        // Nexus reescrevia a mensagem — deixando rascunho e até duplicando.
        waitFor(timeoutMs = SEND_CONFIRM_TIMEOUT_MS, predicate = {
            if (messageFieldIsClear()) true else null
        }, onDone = { emptied ->
            Log.d(TAG, "Campo esvaziou (mensagem saiu) = ${emptied == true}")
            callback(emptied == true)
        })
    }

    /** `true` quando o campo está vazio (ou só com o placeholder do WhatsApp). */
    private fun messageFieldIsClear(): Boolean {
        val text = fold(find("message_input")?.text)
        return text.isEmpty() || EMPTY_MESSAGE_HINTS.contains(text)
    }

    // ---------------------------------------------------------------------
    // WhatsApp: resposta falada (escrever → confirmar → enviar / apagar)
    // ---------------------------------------------------------------------

    /**
     * Escreve no campo do chat aberto sem enviar.
     *
     * Separado do [sendFlow] de propósito: aqui o usuário ainda vai confirmar. Se
     * ele negar, o texto é apagado com uma chamada com string vazia.
     */
    private fun writeInOpenChatInternal(message: String, callback: (Boolean) -> Unit) {
        waitForOpenChat(CHAT_OPEN_TIMEOUT_MS) { chatReady ->
            if (!chatReady) {
                Log.w(TAG, "Resposta: a conversa não abriu")
                callback(false)
                return@waitForOpenChat
            }

            val input = find("message_input")
            val args = Bundle().apply {
                putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, message)
            }
            val written = input != null && input.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
            Log.d(TAG, "Resposta escrita no campo (sem enviar): $written")
            callback(written)
        }
    }

    /** Envia o texto que já está no campo (o usuário confirmou). */
    private fun sendInOpenChatInternal(callback: (Boolean) -> Unit) {
        waitFor(timeoutMs = SEND_READY_TIMEOUT_MS, predicate = {
            // "voice_note_button" some quando o campo deixa de estar vazio
            if (find("send_button") != null) true else null
        }, onDone = { ready ->
            if (ready != true) {
                Log.w(TAG, "Resposta: o botão de enviar não apareceu")
                callback(false)
            } else {
                tapSendAndConfirm(callback)
            }
        })
    }

    /**
     * Toca o áudio mais recente da conversa e ESPERA ele terminar.
     *
     * Percorre a árvore procurando o controle de reprodução da mensagem de voz.
     * Pega o ÚLTIMO encontrado (as mensagens são empilhadas de cima para baixo, a
     * mais nova por último) e toca no centro dele. Nada de ID inventado: quando
     * não há controle reconhecível, devolve `false`.
     *
     * A espera existe para o Nexus não perguntar "quer responder?" por cima do
     * áudio. Quem sabe que a reprodução acabou é a própria tela (o botão volta a
     * ser "reproduzir"), com um teto de tempo para nunca travar.
     */
    private fun playLastVoiceNoteInternal(callback: (Boolean) -> Unit) {
        waitForOpenChat(CHAT_OPEN_TIMEOUT_MS) { chatReady ->
            if (!chatReady) {
                Log.w(TAG, "Áudio: a conversa não abriu")
                callback(false)
                return@waitForOpenChat
            }

            val root = whatsAppRoot()
            val controls = ArrayList<AccessibilityNodeInfo>()
            if (root != null) collectVoiceNoteControls(root, controls, 0)

            val target = controls.lastOrNull()
            val tapped = target != null && clickOrTap(target)
            Log.d(TAG, "Áudio: controles encontrados=${controls.size}, tocado=$tapped")

            if (!tapped) {
                callback(false)
                return@waitForOpenChat
            }

            waitForVoiceNoteEnd(System.currentTimeMillis())
            callback(true)
        }
    }

    /**
     * Espera a reprodução terminar olhando a tela.
     *
     * Enquanto o áudio toca, o controle vira "pausar". Quando ele volta a ser
     * "reproduzir" (ou quando a folga inicial passa sem a tela nunca mostrar
     * "pausar"), a reprodução acabou. Teto de tempo: nunca travar o assistente.
     */
    private fun waitForVoiceNoteEnd(startedAt: Long) {
        val elapsed = System.currentTimeMillis() - startedAt
        if (elapsed >= VOICE_NOTE_MAX_MS) {
            Log.d(TAG, "Áudio: teto de espera atingido")
            return
        }

        val playing = voiceNotePlaying()
        if (playing) {
            mainHandler.postDelayed({ waitForVoiceNoteEnd(startedAt) }, VOICE_NOTE_POLL_MS)
            return
        }

        // Não está tocando agora. Se ainda estamos na folga inicial, pode ser só
        // o tempo do app começar: espera mais um pouco antes de dar por acabado.
        if (elapsed < VOICE_NOTE_GRACE_MS) {
            mainHandler.postDelayed({ waitForVoiceNoteEnd(startedAt) }, VOICE_NOTE_POLL_MS)
        } else {
            Log.d(TAG, "Áudio: reprodução terminou")
        }
    }

    /** `true` quando a conversa aberta mostra um controle de "pausar". */
    private fun voiceNotePlaying(): Boolean {
        val root = whatsAppRoot() ?: return false
        val nodes = ArrayList<AccessibilityNodeInfo>()
        collectByLabels(root, nodes, 0, VOICE_PAUSE_LABELS)
        return nodes.isNotEmpty()
    }

    /**
     * Toca num botão da tela de chamada recebida (atender ou recusar).
     *
     * Espera o botão aparecer (a tela de chamada leva um instante para assumir a
     * frente), toca no centro dele e devolve `true` só quando o toque foi
     * disparado. Sem botão reconhecível, devolve `false` — nunca há aqui um
     * "atendeu de mentira".
     */
    private fun tapCallButton(
        labels: List<String>,
        actionName: String,
        callback: (Boolean) -> Unit,
    ) {
        waitFor(
            timeoutMs = CALL_BUTTON_TIMEOUT_MS,
            predicate = {
                callButtonRoots().asSequence()
                    .mapNotNull { root ->
                        val nodes = ArrayList<AccessibilityNodeInfo>()
                        collectCallButtons(root, nodes, 0, labels)
                        nodes.lastOrNull()
                    }
                    .firstOrNull()
            },
            onDone = { node ->
                if (node == null) {
                    Log.w(TAG, "Chamada: botão de $actionName não apareceu na tela")
                    callback(false)
                } else {
                    val tapped = clickOrTap(node)
                    Log.d(TAG, "Chamada: toque em $actionName=$tapped")
                    callback(tapped)
                }
            },
        )
    }

    /**
     * Raízes onde o botão de atender/recusar pode estar.
     *
     * Quando a chamada está em tela cheia, o botão é do WhatsApp. Quando só o
     * banner do sistema aparece, o botão é do SystemUI — por isso a busca inclui
     * as janelas interativas (flagRetrieveInteractiveWindows no XML do serviço).
     */
    private fun callButtonRoots(): List<AccessibilityNodeInfo> {
        val roots = ArrayList<AccessibilityNodeInfo>()
        whatsAppRoot()?.let { roots.add(it) }
        try {
            windows?.forEach { window ->
                val root = window.root ?: return@forEach
                if (roots.none { it == root }) roots.add(root)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Chamada: falha ao listar janelas: ${e.message}")
        }
        return roots
    }

    /**
     * Lê a ÚLTIMA mensagem do chat que está aberto.
     *
     * Os balões do WhatsApp têm o id `message_text` (lido do aparelho real) e
     * o último da lista é o mais novo. O campo de escrita NÃO entra: ele tem o
     * id `entry` e o texto digitado pelo usuário.
     */
    private fun readLastMessageInternal(callback: (String?) -> Unit) {
        val root = whatsAppRoot()
        if (root == null) {
            Log.w(TAG, "Leitura da mensagem: o WhatsApp não está na tela")
            callback(null)
            return
        }

        // A conversa pode estar ABRINDO: os balões demoram um instante a
        // aparecer na tela.
        waitFor(timeoutMs = MESSAGE_READ_TIMEOUT_MS, predicate = {
            val current = whatsAppRoot() ?: return@waitFor null
            val texts = mutableListOf<String>()
            collectMessageTexts(current, texts, 0)
            texts.lastOrNull { it.isNotBlank() }
        }, onDone = { last ->
            val message = last?.trim()
            Log.d(TAG, "Última mensagem do chat: ${message ?: "(nenhuma)"}")
            callback(message)
        })
    }

    /** Junta os textos das mensagens do chat, na ordem em que aparecem. */
    private fun collectMessageTexts(
        node: AccessibilityNodeInfo,
        out: MutableList<String>,
        depth: Int
    ) {
        if (depth > 40) return

        val id = node.viewIdResourceName.orEmpty()
        if (id.endsWith("message_text")) {
            val text = node.text?.toString()?.trim().orEmpty()
            if (text.isNotEmpty()) out.add(text)
        }

        for (index in 0 until node.childCount) {
            val child = node.getChild(index) ?: continue
            collectMessageTexts(child, out, depth + 1)
        }
    }

    /**
     * Junta os controles de reprodução de mensagem de voz, em ordem de tela.
     */
    private fun collectVoiceNoteControls(
        node: AccessibilityNodeInfo,
        out: MutableList<AccessibilityNodeInfo>,
        depth: Int,
    ) {
        collectByLabels(node, out, depth, VOICE_PLAY_LABELS)
    }

    /**
     * Junta os nós visíveis cujo NOME ACESSÍVEL contém uma das palavras.
     *
     * O nome acessível (`contentDescription`) é o que identifica um CONTROLE no
     * WhatsApp ("Reproduzir", "Pausar"). O texto do nó é ignorado de propósito:
     * uma mensagem que diga "vou ouvir depois" tem a palavra "ouvir" e viraria
     * um falso controle — tocar nela abriria o menu da mensagem em vez de
     * reproduzir o áudio.
     */
    private fun collectByLabels(
        node: AccessibilityNodeInfo,
        out: MutableList<AccessibilityNodeInfo>,
        depth: Int,
        labels: List<String>,
    ) {
        if (depth > 40) return

        val label = fold(node.contentDescription ?: "")
        if (label.isNotEmpty() && labels.any { label.contains(it) } && node.isVisibleToUser) {
            out.add(node)
        }

        for (index in 0 until node.childCount) {
            val child = node.getChild(index) ?: continue
            collectByLabels(child, out, depth + 1, labels)
        }
    }

    /**
     * Junta os controles da tela de CHAMADA pelo nome acessível OU pelo texto.
     *
     * Na tela de chamada o botão "Atender"/"Recusar" pode ser um TextView sem
     * `contentDescription`. O texto é aceito só aqui; em [collectByLabels] ele
     * continua ignorado para não confundir uma mensagem com um controle.
     */
    private fun collectCallButtons(
        node: AccessibilityNodeInfo,
        out: MutableList<AccessibilityNodeInfo>,
        depth: Int,
        labels: List<String>,
    ) {
        if (depth > 40) return
        val description = ReaLayoutAnalyzer.foldText(node.contentDescription ?: "")
        val text = ReaLayoutAnalyzer.foldText(node.text ?: "")
        val matches = { value: String ->
            value.isNotEmpty() && labels.any { label -> value == label || value.contains(label) }
        }
        if ((matches(description) || matches(text)) && node.isVisibleToUser) {
            out.add(node)
        }
        for (index in 0 until node.childCount) {
            val child = node.getChild(index) ?: continue
            collectCallButtons(child, out, depth + 1, labels)
        }
    }

    // ---------------------------------------------------------------------
    // WhatsApp: busca de contato (quando ele não está na agenda)
    // ---------------------------------------------------------------------

    /**
     * Abre o WhatsApp, busca o contato pela lupa e abre a conversa dele.
     *
     * Os identificadores vêm do app real: a caixa de busca da lista é
     * `my_search_bar`, o campo da busca é `search_input` e os resultados ficam
     * em `result_list` (não existia `search_src_text` nem `contact_cell_layout`).
     */
    private fun searchContactFlow(contactName: String, callback: (Boolean) -> Unit) {
        launchWhatsAppIfNeeded()
        // A caixa de busca (`my_search_bar`) só existe na LISTA de conversas.
        // Se o WhatsApp abriu dentro de um chat — o caso depois da primeira
        // mensagem — a busca nunca aparecia e o Nexus desistia. Volta uma tela
        // antes de esperar.
        if (find("conversation_contact_name") != null || find("search_input") != null) {
            Log.d(TAG, "Busca no WhatsApp: voltando para a lista de conversas")
            performGlobalAction(GLOBAL_ACTION_BACK)
        }
        waitFor(timeoutMs = SEARCH_OPEN_TIMEOUT_MS, predicate = {
            if (whatsAppRoot() == null) null else find("search_box")?.let { true }
        }, onDone = { ready ->
            if (ready != true) {
                Log.w(TAG, "Busca no WhatsApp: a caixa de busca não apareceu")
                callback(false)
            } else {
                openSearchAndType(contactName, callback)
            }
        })
    }

    /**
     * Abre o WhatsApp pela activity de lançamento REAL do app.
     *
     * Evidência (moto g84, Android 15): montar um intent implícito
     * `ACTION_MAIN` + `CATEGORY_LAUNCHER` com `setPackage("com.whatsapp")`
     * falhava com "No Activity found to handle Intent" — o WhatsApp não
     * resolvia o intent implícito. `getLaunchIntentForPackage` devolve o intent
     * com o componente explícito e é o caminho suportado pelo Android.
     */
    private fun launchWhatsAppIfNeeded() {
        if (whatsAppRoot() != null) return
        val launch = packageManager.getLaunchIntentForPackage(ReaLayoutAnalyzer.WHATSAPP_PACKAGE)
        if (launch == null) {
            Log.w(TAG, "Falha ao abrir o WhatsApp: o app não tem intent de abertura")
            return
        }
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            applicationContext.startActivity(launch)
        } catch (e: Exception) {
            Log.w(TAG, "Falha ao abrir o WhatsApp: ${e.message}")
        }
    }

    private fun openSearchAndType(contactName: String, callback: (Boolean) -> Unit) {
        val box = find("search_box")
        val opened = box != null && clickOrTap(box)
        Log.d(TAG, "Busca no WhatsApp: caixa de busca tocada = $opened")
        waitFor(timeoutMs = SEARCH_OPEN_TIMEOUT_MS, predicate = {
            find("search_input")?.let { true }
        }, onDone = { ready ->
            if (ready != true) {
                Log.w(TAG, "Busca no WhatsApp: o campo de busca não abriu")
                callback(false)
            } else {
                typeSearchQuery(contactName, callback)
            }
        })
    }

    private fun typeSearchQuery(contactName: String, callback: (Boolean) -> Unit) {
        val input = find("search_input")
        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, contactName)
        }
        val typed = input != null && input.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
        Log.d(TAG, "Busca no WhatsApp: nome digitado = $typed")
        if (!typed) {
            callback(false)
            return
        }
        waitFor(timeoutMs = SEARCH_RESULT_TIMEOUT_MS, predicate = {
            findListRowByName(contactName)?.let { true }
        }, onDone = { found ->
            if (found != true) {
                Log.w(TAG, "Busca no WhatsApp: nenhum resultado para \"$contactName\"")
                callback(false)
            } else {
                val row = findListRowByName(contactName)
                val tapped = row != null && clickOrTap(row)
                Log.d(TAG, "Busca no WhatsApp: resultado tocado = $tapped")
                callback(tapped)
            }
        })
    }

    /**
     * Envia uma mensagem para a LISTA DE TRANSMISSÃO do WhatsApp.
     *
     * O caminho é o do próprio WhatsApp: menu (três pontinhos) › Listas de
     * transmissão › a lista. Aciona a lista, escreve no campo e toca em enviar.
     */
    private fun broadcastFlow(message: String, listName: String?, callback: (Boolean) -> Unit) {
        openBroadcastLists(onReady = { names ->
            // Sem nome pedido, o caminho é o do usuário: a primeira linha
            // abaixo de "Suas transmissões". Com nome pedido, a lista TEM de
            // casar: enviar para a primeira quando o nome não bate seria
            // mandar a mensagem para as pessoas erradas.
            val requested = listName?.trim()?.takeIf { it.isNotEmpty() }
            val target = if (requested != null) {
                pickBroadcastList(names, requested)
            } else {
                pickBroadcastList(names, null)
                    ?: names.firstOrNull()
                    ?: firstBroadcastListName()
            }

            if (target == null) {
                Log.w(TAG, "Transmissão: nenhuma lista na tela (listas=$names pedido=$listName)")
                callback(false)
                return@openBroadcastLists
            }

            val row = findBroadcastListRow(target)
            if (row == null) {
                Log.w(TAG, "Transmissão: linha \"$target\" não encontrada em $names")
                callback(false)
                return@openBroadcastLists
            }

            val rowBounds = Rect()
            row.getBoundsInScreen(rowBounds)
            Log.d(TAG, "Transmissão: lista \"$target\" em $rowBounds; tocando")
            val opened = clickOrTap(row)
            if (!opened) {
                Log.w(TAG, "Transmissão: o toque na lista não foi aceito")
                callback(false)
                return@openBroadcastLists
            }

            // O toque abre a conversa com uma animação; o campo de mensagem só
            // existe depois dela. Sem esta espera o Nexus escrevia antes de a
            // tela montar e desistia no meio do caminho.
            waitForOpenChat(BROADCAST_CHAT_TIMEOUT_MS) { chatReady ->
                if (!chatReady) {
                    // Segunda tentativa: alguns toques caem durante a animação
                    // da lista e são descartados pelo WhatsApp. Toca de novo no
                    // centro da linha e espera mais uma vez.
                    Log.w(TAG, "Transmissão: a conversa não abriu no primeiro toque; tentando de novo")
                    val retry = findBroadcastListRow(target)
                    val retried = retry != null && tapNode(retry)
                    Log.d(TAG, "Transmissão: segundo toque = $retried")
                    if (!retried) {
                        callback(false)
                        return@waitForOpenChat
                    }
                    waitForOpenChat(BROADCAST_CHAT_TIMEOUT_MS) { secondTry ->
                        if (!secondTry) {
                            Log.w(TAG, "Transmissão: a conversa da lista não abriu")
                            callback(false)
                        } else {
                            logBroadcastChatIdentity(target)
                            writeAndSendBroadcast(message, callback)
                        }
                    }
                    return@waitForOpenChat
                }

                logBroadcastChatIdentity(target)
                writeAndSendBroadcast(message, callback)
            }
        })
    }

    /**
     * Escreve e envia já dentro da conversa da lista.
     *
     * A conversa de transmissão é uma conversa normal do WhatsApp: o campo é
     * `entry` e o botão de enviar é `send` (ImageButton). O `send_container`
     * NÃO recebe clique — era por isso que o envio "não acontecia".
     */
    private fun writeAndSendBroadcast(message: String, callback: (Boolean) -> Unit) {
        writeInOpenChatInternal(message) { written ->
            if (!written) {
                Log.w(TAG, "Transmissão: a mensagem não entrou no campo")
                callback(false)
                return@writeInOpenChatInternal
            }
            sendInOpenChatInternal { sent ->
                Log.d(TAG, "Transmissão: enviada = $sent")
                callback(sent)
            }
        }
    }

    /** Só registra o que a conversa aberta mostra (diagnóstico no logcat). */
    private fun logBroadcastChatIdentity(expected: String) {
        val root = whatsAppRoot() ?: return
        val elements = reaAnalyzer.scanActiveWindow(root)
        fun textOf(idSuffix: String): String = elements.firstOrNull {
            it.viewId.orEmpty().endsWith(idSuffix)
        }?.text?.toString().orEmpty()
        Log.d(
            TAG,
            "Transmissão: conversa aberta para \"$expected\" " +
                "(título=\"${textOf("conversation_contact_name")}\", " +
                "status=\"${textOf("conversation_contact_status")}\")"
        )
    }

    /**
     * Abre o caminho das listas de transmissão do WhatsApp e devolve os nomes.
     *
     * O caminho é o do app: menu (três pontinhos) › Listas de transmissão. Os
     * identificadores dessa tela mudam de versão para versão, então a busca é
     * pelo que está VISÍVEL — o texto "Listas de transmissão" no menu e o nome
     * de cada lista na tela — e não por id fixo.
     */
    private fun openBroadcastLists(onReady: (List<String>) -> Unit, depth: Int = 0) {
        launchWhatsAppIfNeeded()

        waitFor(timeoutMs = CHAT_OPEN_TIMEOUT_MS, predicate = {
            when {
                whatsAppRoot() == null -> null
                isBroadcastHome() -> true
                isInsideWhatsAppChat() -> true
                findTopMenuButton() != null -> true
                else -> null
            }
        }, onDone = { ready ->
            if (ready != true) {
                Log.w(TAG, "Transmissão: o WhatsApp não abriu")
                onReady(emptyList())
                return@waitFor
            }

            // Já estamos na tela "Listas de transmissão": não existe menu de
            // três pontinhos aqui, então ler os nomes é o passo certo.
            if (isBroadcastHome()) {
                val names = broadcastListNames()
                Log.d(TAG, "Transmissão: já na tela de listas = $names")
                onReady(names)
                return@waitFor
            }

            // Uma conversa aberta não tem o item "Listas de transmissão" no
            // menu. Volta para a lista de conversas e recomeça.
            if (isInsideWhatsAppChat() && depth < 2) {
                Log.d(TAG, "Transmissão: conversa aberta; voltando para a lista de conversas")
                performGlobalAction(GLOBAL_ACTION_BACK)
                mainHandler.postDelayed({ openBroadcastLists(onReady, depth + 1) }, 900)
                return@waitFor
            }

            // 1) O botão de menu do topo (três pontinhos).
            val menu = findTopMenuButton()
            if (menu == null || !clickOrTap(menu)) {
                Log.w(TAG, "Transmissão: o menu do WhatsApp não abriu")
                onReady(emptyList())
                return@waitFor
            }

            // 2) O item "Listas de transmissão" dentro do menu.
            waitFor(timeoutMs = CHAT_OPEN_TIMEOUT_MS, predicate = {
                findTextRowContaining("transmiss")?.let { true }
            }, onDone = { found ->
                if (found != true) {
                    Log.w(TAG, "Transmissão: o menu não tem \"Listas de transmissão\"")
                    onReady(emptyList())
                    return@waitFor
                }

                val item = findTextRowContaining("transmiss")
                if (item == null || !clickOrTap(item)) {
                    Log.w(TAG, "Transmissão: \"Listas de transmissão\" não abriu")
                    onReady(emptyList())
                    return@waitFor
                }

                // 3) A tela com as listas: os nomes.
                waitFor(timeoutMs = CHAT_OPEN_TIMEOUT_MS, predicate = {
                    val names = broadcastListNames()
                    if (names.isEmpty()) null else names
                }, onDone = { names ->
                    val found2 = names ?: emptyList()
                    Log.d(TAG, "Transmissão: listas na tela = $found2")
                    onReady(found2)
                })
            })
        })
    }

    /** A tela "Listas de transmissão" (título "Suas transmissões"). */
    private fun isBroadcastHome(): Boolean {
        val root = whatsAppRoot() ?: return false
        return reaAnalyzer.scanActiveWindow(root).any { element ->
            val text = fold(element.text)
            val description = fold(element.contentDescription)
            text.contains("suas transmiss") ||
                text.contains("criar nova lista") ||
                description.contains("nova transmiss")
        }
    }

    /** Existe um campo de mensagem: o WhatsApp está dentro de uma conversa. */
    private fun isInsideWhatsAppChat(): Boolean = find("message_input") != null

    /** Uma linha de lista de transmissão pelo nome, ignorando emoji/acento. */
    private fun findBroadcastListRow(name: String): AccessibilityNodeInfo? {
        val root = whatsAppRoot() ?: return null
        val wanted = foldLoose(name)
        val elements = reaAnalyzer.scanActiveWindow(root)
        val headerBottom = elements
            .firstOrNull { fold(it.text).contains("suas transmiss") }
            ?.boundsInScreen?.bottom ?: 0

        fun isNameElement(element: ReaLayoutAnalyzer.UIElementInfo): Boolean =
            element.viewId.orEmpty().endsWith("broadcast_list_name")

        fun matches(element: ReaLayoutAnalyzer.UIElementInfo): Boolean {
            val bounds = element.boundsInScreen ?: return false
            if (bounds.top < headerBottom) return false
            val text = foldLoose(element.text)
            if (text.isEmpty()) return false
            return text == wanted || text.contains(wanted) || wanted.contains(text)
        }

        // 1) O id real do nome da lista (evidência da tela do WhatsApp). Ele
        //    existe mesmo quando o texto vem com emoji ("📢Isak, Leo Novo").
        val byId = elements.firstOrNull { isNameElement(it) && matches(it) }
        val chosen = byId ?: elements.firstOrNull { matches(it) } ?: return null

        // 2) O nome é um TextView NÃO clicável. Quem abre a conversa é o
        //    LinearLayout da linha (sem id). Devolver o texto fazia o toque
        //    cair num ponto que o WhatsApp ignora; devolver a linha clicável
        //    é o que abre o chat da transmissão.
        return broadcastRowContainer(chosen.node) ?: chosen.node
    }

    /**
     * O contêiner clicável da linha da lista (o pai do nome).
     *
     * A linha tem a altura de um item de lista; exigir essa altura evita
     * devolver um ancestral genérico (a tela inteira) e tocar no lugar errado.
     */
    private fun broadcastRowContainer(textNode: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        var current: AccessibilityNodeInfo? = textNode
        var depth = 0
        while (current != null && depth < 6) {
            val bounds = Rect()
            current.getBoundsInScreen(bounds)
            if (current.isClickable && bounds.height() >= 100) return current
            current = current.parent
            depth++
        }
        return null
    }

    /** Texto sem acento, emoji, pontuação e espaços repetidos. */
    private fun foldLoose(value: CharSequence?): String =
        fold(value).replace(Regex("[^a-z0-9 ]"), " ").replace(Regex("\\s+"), " ").trim()

    /**
     * Os nomes das listas de transmissão na tela.
     *
     * A tela traz o título ("Listas de transmissão"), o contador de
     * destinatários de cada linha e o botão de criar uma lista nova: nenhum
     * deles é uma lista. O texto da linha NÃO é clicável na árvore do
     * WhatsApp — exigir `isClickable` era o que devolvia lista vazia.
     */
    private fun broadcastListNames(): List<String> {
        val root = whatsAppRoot() ?: return emptyList()
        val elements = reaAnalyzer.scanActiveWindow(root)

        // Caminho principal: o id real do nome da lista. Evidência da tela do
        // WhatsApp (24/10/2026): `com.whatsapp:id/broadcast_list_name`.
        val byId = elements.asSequence()
            .filter { it.viewId.orEmpty().endsWith("broadcast_list_name") }
            .map { it.text?.toString()?.trim().orEmpty() }
            .filter { it.isNotEmpty() }
            .distinct()
            .toList()
        if (byId.isNotEmpty()) return byId

        // Reserva: a mesma leitura por texto, para versões do WhatsApp que
        // mudem o id. O resto continua valendo (nada de cabeçalho/contador).
        val headerBottom = elements
            .firstOrNull { fold(it.text).contains("suas transmiss") }
            ?.boundsInScreen?.bottom ?: 0
        val screenHeight = resources.displayMetrics.heightPixels
        val screenWidth = resources.displayMetrics.widthPixels

        return elements.asSequence()
            .filter { element ->
                val text = element.text?.trim().orEmpty()
                val bounds = element.boundsInScreen
                if (text.isEmpty() || bounds == null) return@filter false
                if (bounds.top < headerBottom) return@filter false
                // O botão flutuante "Nova transmissão" fica no canto inferior.
                if (bounds.left > screenWidth * 3 / 4 && bounds.bottom > screenHeight * 3 / 4) {
                    return@filter false
                }
                val folded = fold(text)
                folded.isNotEmpty() &&
                    !folded.contains("transmiss") &&
                    !folded.contains("destinat") &&
                    !folded.contains("voce pode enviar") &&
                    !folded.contains("saiba mais") &&
                    !folded.contains("este mes") &&
                    !folded.contains("criar") &&
                    !folded.equals("nova lista") &&
                    !folded.equals("voltar") &&
                    !folded.matches(Regex("^[0-9\\s.,:h-]+$"))
            }
            .map { element -> element.text.orEmpty().trim() }
            .distinct()
            .toList()
    }

    /** Nome da primeira lista visível (reserva quando a leitura veio vazia). */
    private fun firstBroadcastListName(): String? = broadcastListNames().firstOrNull()

    /**
     * A lista pedida, entre as que estão na tela.
     *
     * Sem nome pedido: só dá para escolher quando há UMA lista. Com várias, o
     * Nexus pergunta ao usuário (a interface decide) — aqui é a falha honesta.
     */
    private fun pickBroadcastList(names: List<String>, listName: String?): String? {
        val wanted = foldLoose(listName ?: "")
        if (wanted.isNotEmpty()) {
            return names.firstOrNull { foldLoose(it) == wanted }
                ?: names.firstOrNull { foldLoose(it).contains(wanted) }
        }
        return if (names.size == 1) names.first() else null
    }

    /** O botão de menu do topo do WhatsApp (três pontinhos). */
    private fun findTopMenuButton(): AccessibilityNodeInfo? {
        val root = whatsAppRoot() ?: return null
        val nodes = reaAnalyzer.scanActiveWindow(root)

        val byDescription = nodes.firstOrNull { element ->
            val description = fold(element.contentDescription)
            description.contains("mais opcoes") ||
                description.contains("opcoes") ||
                description == "menu" ||
                description.contains("more options")
        }
        if (byDescription != null) return clickableAncestor(byDescription.node) ?: byDescription.node

        // Sem descrição: o botão de menu é o último clicável da barra do topo.
        val topBar = nodes.filter { it.node.isClickable && (it.boundsInScreen?.top ?: 9999) < 500 }
        return topBar.lastOrNull()?.node
    }

    /** Uma linha cujo texto contém o pedaço (menu do WhatsApp). */
    private fun findTextRowContaining(needle: String): AccessibilityNodeInfo? {
        val root = whatsAppRoot() ?: return null
        val wanted = fold(needle)
        val nodes = reaAnalyzer.scanActiveWindow(root).filter { fold(it.text).contains(wanted) }
        return nodes.firstOrNull()?.let { clickableAncestor(it.node) ?: it.node }
    }

    /** Uma linha cujo texto é exatamente o nome pedido (a lista). */
    private fun findTextRowExact(name: String): AccessibilityNodeInfo? {
        val root = whatsAppRoot() ?: return null
        val wanted = fold(name)
        val nodes = reaAnalyzer.scanActiveWindow(root).filter { fold(it.text) == wanted }
        return nodes.firstOrNull()?.let { clickableAncestor(it.node) ?: it.node }
    }

    /**
     * A linha da lista de transmissão na conversa.
     *
     * O WhatsApp dá o nome da lista ("Lista de transmissão" é o padrão) e a
     * conversa mostra esse nome na linha. A busca é por "transmiss" no nome —
     * o único pedaço que sobrevive a acento e a nome personalizado.
     */
    private fun findBroadcastRow(listName: String? = null): AccessibilityNodeInfo? {
        val root = whatsAppRoot() ?: return null
        val wanted = fold(listName ?: "")
        val rows = reaAnalyzer.scanActiveWindow(root).filter { element ->
            val id = element.viewId.orEmpty()
            val text = fold(element.text)
            text.isNotEmpty() && (
                id.endsWith("conversations_row_contact_name") ||
                    id.endsWith("contact_name") ||
                    id.endsWith("conversation_row_text")
                ) && (text.contains("transmiss") || (wanted.isNotEmpty() && text.contains(wanted)))
        }
        return rows.firstOrNull()?.let { clickableAncestor(it.node) ?: it.node }
    }

    /**
     * Primeira linha da lista cujo nome bate com o contato pedido.
     *
     * Antes o código tocava no PRIMEIRO item da lista sem olhar o nome: se a
     * busca trouxesse outra pessoa na frente, o Nexus abria a conversa errada.
     */
    private fun findListRowByName(contactName: String): AccessibilityNodeInfo? {
        val root = whatsAppRoot() ?: return null
        val wanted = fold(contactName)
        if (wanted.isEmpty()) return null

        val nameNodes = reaAnalyzer.scanActiveWindow(root).filter { element ->
            val id = element.viewId.orEmpty()
            val text = fold(element.text)
            text.isNotEmpty() && (
                id.endsWith("conversations_row_contact_name") ||
                    id.endsWith("contact_name") ||
                    id.endsWith("conversation_row_text")
                )
        }

        val match = nameNodes.firstOrNull { fold(it.text) == wanted }
            ?: nameNodes.firstOrNull { fold(it.text).contains(wanted) }
            ?: nameNodes.firstOrNull { fold(it.text).length >= 3 && wanted.contains(fold(it.text)) }

        return match?.let { clickableAncestor(it.node) ?: it.node }
    }

    // ---------------------------------------------------------------------
    // API usada pelo módulo nativo
    // ---------------------------------------------------------------------

    /**
     * Escreve e envia no chat que está abrindo, com callback de verdade.
     * Usado por `sendWhatsAppMessage` (fluxo atômico).
     */
    fun injectTextAndSendAndWait(message: String, callback: (chatOpened: Boolean, sent: Boolean) -> Unit) {
        sendFlow(message, callback)
    }

    /** Igual ao anterior, sem callback (usado pelo `injectWhatsAppMessage`). */
    fun injectTextAndSend(message: String) {
        sendFlow(message) { _, sent -> Log.d(TAG, "Envio direto terminou: $sent") }
    }

    /**
     * Faz a chamada pelo WhatsApp e devolve se ela realmente saiu.
     * Usado por `makeWhatsAppCall`.
     */
    fun startWhatsAppCall(isVideo: Boolean, callback: (Boolean) -> Unit) {
        callFlow(isVideo, callback)
    }

    /** Chamada sem callback (mantida para o atalho de atender chamada). */
    fun triggerCall(isVideo: Boolean) {
        callFlow(isVideo) { success -> Log.d(TAG, "Chamada direta terminou: $success") }
    }

    /** Busca o contato no WhatsApp e abre a conversa dele. */
    fun searchAndOpenWhatsAppContact(contactName: String, callback: (Boolean) -> Unit) {
        searchContactFlow(contactName, callback)
    }

}
