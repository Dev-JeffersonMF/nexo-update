package com.jefferson.nexusassistente.service

import android.app.Notification
import android.app.PendingIntent
import android.app.RemoteInput
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import com.jefferson.nexusassistente.native.NexusNativeModule
import com.jefferson.nexusassistente.rea.ReaLayoutAnalyzer

/**
 * Lê as notificações do WhatsApp (mensagens E chamadas) e repassa ao Nexus.
 *
 * O Nexus pausa a mídia, avisa quem está chamando/mandando mensagem, pergunta
 * se o usuário quer ouvir/atender, e só retoma a mídia depois de tudo resolvido.
 *
 * Este serviço só funciona com a permissão especial "Acesso a notificações"
 * liberada pelo usuário nos ajustes do Android — sem ela, o Android nem
 * conecta o serviço, e `connected` fica falso.
 */
class NexusNotificationListenerService : NotificationListenerService() {

    companion object {
        private const val TAG = "NEXUS_NOTIF"

        /** Pacotes cujas mensagens/chamadas o Nexus acompanha. */
        private val WHATSAPP_PACKAGES = setOf(
            "com.whatsapp",
            "com.whatsapp.w4b",
        )

        /**
         * Notificações do discador/telefone do aparelho.
         *
         * O nome do contato costuma vir no título ("João"), e a notificação de
         * chamada recebida tem fullScreenIntent ou a ação "Atender". O estado do
         * chip (TelephonyManager) é a reserva para quando o discador não notifica.
         */
        private val DIALER_PACKAGES = setOf(
            "com.google.android.dialer",
            "com.android.dialer",
            "com.samsung.android.dialer",
            "com.android.incallui",
            "com.android.server.telecom",
            "com.android.phone",
            "com.motorola.dialer",
            "com.oneplus.dialer",
            "com.oplus.dialer",
            "com.miui.phone",
            "com.android.contacts",
        )

        /** Limite do histórico usado para não repetir o mesmo aviso. */
        private const val SEEN_LIMIT = 60

        /**
         * Títulos da ação que o WhatsApp oferece na notificação.
         *
         * Evidência (moto g84, Android 15): a notificação de mensagem traz
         * `[Responder, Marcar como lida, Silenciar]`. Disparar essa ação é o
         * caminho oficial para limpar o aviso E o contador de não lidas.
         */
        private val READ_ACTION_LABELS = listOf(
            "marcar como lida",
            "marcar como lido",
            "mark as read",
            "mark read",
        )

        /**
         * Títulos das ações de uma chamada RECEBIDA.
         *
         * Evidência (moto g84, Android 15): o banner da chamada do WhatsApp
         * mostra "Recusar" e "Atender". Disparar o `PendingIntent` da ação é o
         * caminho oficial — funciona mesmo quando o banner é do SystemUI e o
         * serviço de acessibilidade não enxerga o botão.
         */
        private val ANSWER_CALL_LABELS = listOf(
            "atender",
            "atende",
            "aceitar",
            "answer",
            "accept",
        )
        private val DECLINE_CALL_LABELS = listOf(
            "recusar",
            "recuse",
            "rejeitar",
            "decline",
            "reject",
        )

        @Volatile
        var connected: Boolean = false
            private set

        /** Chave da notificação da chamada que está tocando. */
        @Volatile
        private var ringingCallKey: String? = null

        /** Ações da notificação da chamada que está tocando. */
        @Volatile
        private var answerCallIntent: PendingIntent? = null

        @Volatile
        private var declineCallIntent: PendingIntent? = null

        /** Abre a tela da chamada (fullScreenIntent, com contentIntent de reserva). */
        @Volatile
        private var callScreenIntent: PendingIntent? = null

        /** Dispara "Atender" na notificação da chamada. */
        fun answerRingingCall(): Boolean = sendCallAction(answerCallIntent, "atender")

        /** Dispara "Recusar" na notificação da chamada. */
        fun declineRingingCall(): Boolean = sendCallAction(declineCallIntent, "recusar")

        /** Abre a tela da chamada para o toque por acessibilidade. */
        fun openRingingCallScreen(): Boolean =
            sendCallAction(callScreenIntent, "abrir a tela da chamada")

        private fun sendCallAction(intent: PendingIntent?, name: String): Boolean {
            if (intent == null) {
                Log.d(TAG, "Chamada: ação \"$name\" indisponível")
                return false
            }
            return try {
                intent.send()
                Log.d(TAG, "Chamada: ação \"$name\" disparada")
                true
            } catch (e: PendingIntent.CanceledException) {
                Log.w(TAG, "Chamada: ação \"$name\" expirou: ${e.message}")
                false
            } catch (e: Exception) {
                Log.w(TAG, "Chamada: falha na ação \"$name\": ${e.message}")
                false
            }
        }

        private fun clearRingingCall() {
            ringingCallKey = null
            answerCallIntent = null
            declineCallIntent = null
            callScreenIntent = null
        }

        /**
         * Última chamada já anunciada ao JS.
         *
         * A chamada recebida pode ser vista por DOIS caminhos: a notificação
         * (`onNotificationPosted`) e a tela do WhatsApp (`NexusAccessibilityService`).
         * Sem esta trava o Nexus falaria duas vezes e abriria dois fluxos para a
         * mesma ligação. Quem chega primeiro "reserva" o anúncio; o outro só
         * guarda as ações e fica quieto.
         */
        @Volatile
        private var announcedCallKey: String? = null

        @Volatile
        private var announcedCallAt: Long = 0L

        private const val CALL_ANNOUNCE_DEDUPE_MS = 15_000L

        /** `true` só para o primeiro aviso da mesma chamada. */
        @Synchronized
        fun claimCallAnnouncement(contact: String, type: String): Boolean {
            val key = "${contact.trim().lowercase()}|$type"
            val now = System.currentTimeMillis()
            if (announcedCallKey == key && now - announcedCallAt < CALL_ANNOUNCE_DEDUPE_MS) {
                return false
            }
            announcedCallKey = key
            announcedCallAt = now
            return true
        }

        @Volatile
        private var lastConversation: PendingIntent? = null

        /** Contato dono de [lastConversation], para abrir a conversa certa. */
        @Volatile
        private var lastConversationContact: String = ""

        /** Chaves já anunciadas, para o Android não repetir o mesmo aviso. */
        private val seen = LinkedHashSet<String>()

        /**
         * Notificações recentes que o JS ainda não viu.
         *
         * Fica no companheiro de propósito: o serviço de notificações continua
         * vivo quando a interface do React é destruída em segundo plano. Antes o
         * evento era emitido para um bridge morto e a mensagem SUMIA — o usuário
         * via a notificação no celular e o Nexus não dizia nada. Guardando aqui,
         * o app conta o que chegou assim que volta.
         */
        private val recent = java.util.Collections.synchronizedList(mutableListOf<Map<String, Any>>())

        /** Quantas notificações ficam guardadas para o próximo aviso. */
        private const val RECENT_LIMIT = 10

        /** Notificações que chegaram e ainda não foram contadas ao usuário. */
        fun recentNotifications(): List<Map<String, Any>> = synchronized(recent) {
            recent.toList()
        }

        /** Chamado depois que o Nexus já contou (ou abriu) o que chegou. */
        fun clearRecentNotifications() {
            synchronized(recent) { recent.clear() }
        }

        /**
         * Anuncia uma notificação que não veio do WhatsApp (chamada do chip).
         *
         * Guarda em [recent] pelo mesmo motivo das mensagens: se o React estiver
         * destruído em segundo plano, o aviso não se perde.
         */
        fun announceExternalNotification(payload: Map<String, Any>) {
            synchronized(recent) {
                recent.add(payload + ("at" to System.currentTimeMillis()))
                while (recent.size > RECENT_LIMIT) recent.removeAt(0)
            }
            NexusNativeModule.emitEvent("onNotificationReceived", payload)
        }

        /**
         * Abre a última conversa anunciada. Usado pelo comando "abrir a mensagem".
         *
         * @return `true` quando havia uma conversa conhecida e ela abriu.
         */
        fun openLastConversation(): Boolean {
            val intent = lastConversation ?: return false
            return try {
                intent.send()
                true
            } catch (e: Exception) {
                Log.w(TAG, "Falha ao abrir a conversa: ${e.message}")
                false
            }
        }

        /** `true` quando existe uma conversa guardada para abrir. */
        fun hasPendingConversation(): Boolean = lastConversation != null

        /**
         * A conversa guardada é deste contato?
         *
         * Com várias mensagens na fila, cada uma precisa abrir o chat CERTO. O
         * intent da última notificação só serve quando o contato coincide;
         * senão a interface procura o contato pelo nome dentro do WhatsApp.
         */
        fun isConversationFrom(contact: String): Boolean {
            if (lastConversation == null) return false
            val a = lastConversationContact.trim().lowercase()
            val b = contact.trim().lowercase()
            if (a.isEmpty() || b.isEmpty()) return false
            return a == b || a.contains(b) || b.contains(a)
        }

        /*
         * A instância conectada, para os métodos estáticos da ponte.
         *
         * `activeNotifications` só existe na instância viva do serviço; sem
         * esta referência, o "responder direto" da notificação não enxergava
         * as notificações ativas.
         */
        @Volatile
        private var instance: NexusNotificationListenerService? = null

        /**
         * RESPONDER SEM ABRIR O WHATSAPP (pedido do usuário, 24/10/2026).
         *
         * A notificação de mensagem do WhatsApp traz a ação "Responder" com
         * `RemoteInput` — o mesmo atalho que aparece na barra do Android. Um
         * NotificationListenerService pode dispará-la com o texto pronto:
         * o WhatsApp recebe a resposta e NENHUMA tela é aberta. Funciona com
         * a tela APAGADA e BLOQUEADA, o que o Auto-Bot (que precisa desenhar o
         * WhatsApp na frente) não consegue fazer sobre a trava de tela.
         *
         * @return `true` quando a ação foi disparada de fato.
         */
        fun replyToWhatsAppContact(contact: String, message: String): Boolean {
            val service = instance ?: run {
                Log.d(TAG, "Responder direto: serviço de notificações desconectado")
                return false
            }
            val text = message.trim()
            if (text.isEmpty()) return false

            val candidates = try {
                service.activeNotifications
                    ?.filter { WHATSAPP_PACKAGES.contains(it.packageName) }
                    .orEmpty()
            } catch (e: Exception) {
                Log.w(TAG, "Responder direto: falha ao ler notificações ativas: ${e.message}")
                return false
            }

            fun replyAction(sbn: StatusBarNotification): Notification.Action? =
                sbn.notification.actions?.firstOrNull { action ->
                    action.actionIntent != null && !action.remoteInputs.isNullOrEmpty()
                }

            fun titleOf(sbn: StatusBarNotification): String =
                sbn.notification.extras
                    ?.getCharSequence(Notification.EXTRA_TITLE)
                    ?.toString()
                    ?.trim()
                    .orEmpty()

            fun isGroupSummary(sbn: StatusBarNotification): Boolean =
                (sbn.notification.flags and Notification.FLAG_GROUP_SUMMARY) != 0

            val target = ReaLayoutAnalyzer.foldText(contact)

            // A conversa CERTA primeiro (título = contato), depois qualquer
            // notificação com a ação de resposta.
            val chosen = candidates.firstOrNull {
                !isGroupSummary(it) && target.isNotEmpty() &&
                    ReaLayoutAnalyzer.foldText(titleOf(it)) == target &&
                    replyAction(it) != null
            } ?: candidates.firstOrNull {
                !isGroupSummary(it) && target.isNotEmpty() &&
                    ReaLayoutAnalyzer.foldText(titleOf(it)).contains(target) &&
                    replyAction(it) != null
            } ?: candidates.firstOrNull {
                !isGroupSummary(it) && replyAction(it) != null
            } ?: run {
                Log.d(TAG, "Responder direto: nenhuma notificação com ação de resposta")
                return false
            }

            val action = replyAction(chosen) ?: return false
            val inputs = action.remoteInputs ?: return false
            val intent = Intent()
            val results = Bundle()
            inputs.forEach { input -> results.putCharSequence(input.resultKey, text) }
            RemoteInput.addResultsToIntent(inputs, intent, results)

            return try {
                action.actionIntent.send(service, 0, intent)
                Log.d(TAG, "Responder direto para \"${titleOf(chosen)}\": ação disparada")
                true
            } catch (e: Exception) {
                Log.w(TAG, "Responder direto falhou: ${e.message}")
                false
            }
        }

        /** `true` quando há notificação do WhatsApp com a ação de resposta. */
        fun canReplyWithoutOpeningWhatsApp(): Boolean {
            val service = instance ?: return false
            return try {
                service.activeNotifications
                    ?.any { sbn ->
                        WHATSAPP_PACKAGES.contains(sbn.packageName) &&
                            (sbn.notification.flags and Notification.FLAG_GROUP_SUMMARY) == 0 &&
                            sbn.notification.actions?.any { action ->
                                action.actionIntent != null && !action.remoteInputs.isNullOrEmpty()
                            } == true
                    }
                    ?: false
            } catch (e: Exception) {
                false
            }
        }
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        connected = true
        instance = this
        Log.d(TAG, "Leitura de notificações conectada")

        // Chamadas do chip (telefone normal) e do WhatsApp. O listener do chip
        // resolve o número no contato salvo e mostra a notificação com os dois
        // telefones (verde/vermelho).
        NexusPhoneCallManager.start(this)

        // Se o serviço caiu e voltou com uma chamada já tocando, o Android não
        // reenvia a notificação. Varre só as CHAMADAS ativas para não perder o
        // aviso nem reanunciar mensagens antigas.
        try {
            activeNotifications?.forEach { sbn ->
                if (WHATSAPP_PACKAGES.contains(sbn.packageName)) {
                    handleNotification(sbn, fromActiveScan = true)
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Falha ao ler notificações ativas: ${e.message}")
        }
    }

    override fun onListenerDisconnected() {
        connected = false
        instance = null
        NexusPhoneCallManager.stop()
        clearRingingCall()
        Log.d(TAG, "Leitura de notificações desconectada")
        super.onListenerDisconnected()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        handleNotification(sbn, fromActiveScan = false)
    }

    /**
     * Lê uma notificação do WhatsApp.
     *
     * @param fromActiveScan `true` na reconexão do serviço: nesse caso só uma
     *   chamada tocando interessa; mensagens antigas já foram (ou serão) tratadas.
     */
    private fun handleNotification(sbn: StatusBarNotification?, fromActiveScan: Boolean) {
        val notification = sbn?.notification ?: return
        if (sbn == null) return

        if (DIALER_PACKAGES.contains(sbn.packageName)) {
            handleDialerNotification(sbn)
            return
        }
        if (!WHATSAPP_PACKAGES.contains(sbn.packageName)) return

        val extras = notification.extras ?: return
        val contact = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim().orEmpty()
        val message = (
            extras.getCharSequence(Notification.EXTRA_TEXT)
                ?: extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
        )?.toString()?.trim().orEmpty()

        val channelId =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) notification.channelId.orEmpty() else ""
        val actionTitles = notification.actions
            ?.mapNotNull { it.title?.toString() }
            .orEmpty()
        val foldedActions = actionTitles.map { ReaLayoutAnalyzer.foldText(it) }
        val normalizedMessage = ReaLayoutAnalyzer.foldText(message)
        val hasAnswerAction = foldedActions.any { title ->
            ANSWER_CALL_LABELS.any { label -> title == label || title.contains(label) }
        }
        val hasDeclineAction = foldedActions.any { title ->
            DECLINE_CALL_LABELS.any { label -> title == label || title.contains(label) }
        }

        /*
         * CHAMADA PERDIDA: a chamada já acabou. Pedir "quer atender?" aqui seria
         * uma ação impossível — é isso que o texto do WhatsApp diferencia.
         */
        val isMissedCall = normalizedMessage.contains("perdida") ||
            normalizedMessage.contains("missed") ||
            normalizedMessage.contains("nao atendida") ||
            normalizedMessage.contains("lost call")

        /*
         * CHAMADA TOCANDO: o sinal mais forte é a AÇÃO "Atender" da notificação.
         * O canal `voip_notification_*` e o `fullScreenIntent` são a reserva
         * para quando o WhatsApp não expõe as ações. Exigir categoria CALL +
         * FLAG_ONGOING_EVENT (como antes) perdia a chamada real.
         */
        val isCallChannel = channelId.startsWith("voip_notification", ignoreCase = true)
        val isCallCategory = notification.category == Notification.CATEGORY_CALL
        val hasFullScreenIntent = notification.fullScreenIntent != null
        val looksLikeIncomingCall =
            isCallChannel && normalizedMessage.contains("chamada")
        val isRingingCall = !isMissedCall && (
            hasAnswerAction ||
                looksLikeIncomingCall ||
                (hasFullScreenIntent && (isCallChannel || isCallCategory))
            )

        Log.d(
            TAG,
            "WhatsApp bruto: canal=$channelId categoria=${notification.category} " +
                "flags=${notification.flags} fullScreen=$hasFullScreenIntent " +
                "acoes=$actionTitles titulo=\"$contact\" texto=\"$message\" " +
                "-> tocando=$isRingingCall perdida=$isMissedCall " +
                "atender=$hasAnswerAction recusar=$hasDeclineAction",
        )

        // Chamada de SAÍDA (ou já atendida) também tem categoria CALL, mas não
        // é para atender: anunciá-la como mensagem falava "Ligando…" por cima da
        // própria chamada e ainda cancelava a notificação da ligação.
        if (!isMissedCall && !isRingingCall && isCallCategory) {
            Log.d(TAG, "Chamada em andamento ignorada: \"$contact\" \"$message\"")
            return
        }

        // Resumo de grupo não tem texto útil; uma chamada, porém, não pode ser
        // descartada só porque veio marcada como resumo.
        if (!isRingingCall && (notification.flags and Notification.FLAG_GROUP_SUMMARY) != 0) return

        if (contact.isEmpty() && message.isEmpty()) return

        /*
         * RESUMO DO WHATSAPP NÃO É CONVERSA.
         *
         * A notificação "Chegaram 10 mensagens enquanto você estava fora" vem
         * com título "WhatsApp" (o nome do app), não com o nome de quem mandou.
         * Sem esta trava o Nexus perguntava "quer que eu leia?" para um resumo,
         * não tinha contato para abrir e a conversa morria em "não consegui
         * abrir" — exatamente o que aparecia na tela do usuário.
         */
        if (contact.isEmpty() ||
            contact.equals("WhatsApp", ignoreCase = true) ||
            contact.equals(appLabel(sbn.packageName), ignoreCase = true)
        ) {
            Log.d(TAG, "Resumo sem contato real ignorado: \"$message\"")
            return
        }

        // Na reconexão, só uma chamada tocando merece anúncio; mensagens já
        // vistas não podem voltar como novas.
        if (fromActiveScan && !isRingingCall) return

        val type = when {
            isRingingCall -> {
                if (normalizedMessage.contains("video")) "video-call" else "voice-call"
            }
            isMissedCall -> "missed-call"
            else -> "message"
        }

        // Guarda as ações da chamada ANTES de anunciar: o "sim" do usuário pode
        // chegar antes de a notificação ser lida de novo.
        if (isRingingCall) {
            val answerAction = findCallAction(notification, ANSWER_CALL_LABELS)
            val declineAction = findCallAction(notification, DECLINE_CALL_LABELS)
            ringingCallKey = sbn.key
            answerCallIntent = answerAction?.actionIntent
            declineCallIntent = declineAction?.actionIntent
            callScreenIntent = notification.fullScreenIntent ?: notification.contentIntent
            // Notificação do próprio Nexus com os dois telefones (verde/vermelho).
            // O toque dispara o PendingIntent "Atender"/"Recusar" do WhatsApp.
            NexusCallNotification.show(
                context = this,
                contact = contact,
                kind = if (normalizedMessage.contains("video")) "Chamada de vídeo" else "Chamada de voz",
                callSource = "whatsapp",
                contentIntent = callScreenIntent,
            )
            Log.d(
                TAG,
                "Chamada de \"$contact\": atender=${answerAction != null} " +
                    "recusar=${declineAction != null} tela=${callScreenIntent != null}",
            )
        }

        // Áudio só quando o PRÓPRIO WhatsApp escreve isso. Notificação sem texto
        // pode ser foto, figurinha ou vídeo — nesse caso `isAudio` fica falso e o
        // Nexus pergunta de forma neutra em vez de dizer "é um áudio".
        val isAudio = type == "message" && (
            normalizedMessage.contains("mensagem de voz") ||
                normalizedMessage.contains("audio") ||
                normalizedMessage.contains("gravacao") ||
                normalizedMessage.contains("voice message")
            )

        // Chamada é identificada pela chave + tipo: o texto pode mudar de
        // "Chamada de voz" para "Chamando..." sem ser outra chamada.
        val fingerprint =
            if (isRingingCall) "${sbn.key}|$type" else "${sbn.key}|$message|$type"
        synchronized(seen) {
            if (!seen.add(fingerprint)) return
            if (seen.size > SEEN_LIMIT) seen.clear()
        }

        // Guarda o contentIntent para "abrir a mensagem" funcionar
        if (type == "message" || type == "missed-call") {
            notification.contentIntent?.let {
                lastConversation = it
                lastConversationContact = contact
            }
        }

        Log.d(TAG, "WhatsApp [$type] de \"$contact\": \"$message\"")

        val payload = mapOf(
            "app" to appLabel(sbn.packageName),
            "contact" to contact,
            "message" to message,
            "type" to type,
            "isAudio" to isAudio,
        )

        // A tela de chamada pode ter anunciado esta mesma ligação enquanto a
        // notificação chegava. Nesse caso as ações já estão guardadas, mas o
        // usuário não pode ouvir "chamada de X" duas vezes.
        if (isRingingCall && !claimCallAnnouncement(contact, type)) {
            Log.d(TAG, "Chamada de \"$contact\" já anunciada pela tela; sem duplicar")
            return
        }

        // Guarda ANTES de emitir: se o bridge estiver morto (app fechado),
        // o aviso não se perde e é contado quando o Nexus abrir de novo.
        synchronized(recent) {
            recent.add(payload + ("at" to System.currentTimeMillis()))
            while (recent.size > RECENT_LIMIT) recent.removeAt(0)
        }

        NexusNativeModule.emitEvent("onNotificationReceived", payload)

        // O Nexus JÁ LEU a mensagem. Espelha isso no WhatsApp: sem esta ação o
        // aviso continuava na gaveta e a conversa seguia com o contador de não
        // lidas, como se ninguém tivesse aberto. Chamadas (tocando) não entram
        // aqui: apagar o aviso de uma chamada em andamento seria errado.
        if (type == "message") {
            markAsRead(sbn, notification)
        }
    }

    /**
     * Lê a notificação do discador/telefone do aparelho.
     *
     * O nome salvo no aparelho costuma ser o título. Só interessa uma chamada
     * RECEBIDA (fullScreenIntent ou ação "Atender"): notificação de chamada
     * saindo/em andamento não pode virar "quer atender?".
     */
    private fun handleDialerNotification(sbn: StatusBarNotification) {
        val notification = sbn.notification
        val extras = notification.extras ?: return
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim().orEmpty()
        val text = (
            extras.getCharSequence(Notification.EXTRA_TEXT)
                ?: extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
        )?.toString()?.trim().orEmpty()
        val folded = ReaLayoutAnalyzer.foldText("$title $text")

        val isMissed = folded.contains("perdida") ||
            folded.contains("missed") ||
            folded.contains("nao atendida")
        if (isMissed) {
            if (NexusCallNotification.source == "phone") {
                NexusCallNotification.dismiss(this)
            }
            return
        }

        val actionTitles = notification.actions
            ?.mapNotNull { it.title?.toString() }
            .orEmpty()
        val foldedActions = actionTitles.map { ReaLayoutAnalyzer.foldText(it) }
        val hasAnswerAction = foldedActions.any { action ->
            ANSWER_CALL_LABELS.any { label -> action == label || action.contains(label) }
        }
        val isIncoming = notification.fullScreenIntent != null || hasAnswerAction
        if (!isIncoming) return

        if (title.isBlank() || title.equals(appLabel(sbn.packageName), ignoreCase = true)) return

        // Alguns discadores põem um título genérico e o nome no texto.
        val foldedTitle = ReaLayoutAnalyzer.foldText(title)
        val genericTitle = foldedTitle == "chamada" ||
            foldedTitle == "chamada de voz" ||
            foldedTitle == "chamada de video" ||
            foldedTitle == "incoming call" ||
            foldedTitle == "ligacao"
        val contact = if (genericTitle && text.isNotBlank()) text else title

        Log.d(TAG, "Chamada do aparelho: \"$contact\" (${sbn.packageName})")
        NexusPhoneCallManager.announce(this, contact, "")
    }

    /** Encontra a ação da notificação cujo título casa com um dos rótulos. */
    private fun findCallAction(
        notification: Notification,
        labels: List<String>,
    ): Notification.Action? {
        return notification.actions?.firstOrNull { action ->
            val title = ReaLayoutAnalyzer.foldText(action.title)
            labels.any { label -> title == label || title.contains(label) }
        }
    }

    /**
     * Marca a notificação como lida no WhatsApp.
     *
     * Evidência (moto g84, Android 15): a notificação de mensagem do WhatsApp
     * expõe a ação "Marcar como lida". Disparar o PendingIntent dela é o
     * caminho oficial — o WhatsApp limpa o aviso E o contador de não lidas da
     * conversa. Se a ação não existir (versão antiga do app), a notificação é
     * cancelada para não ficar na gaveta como se ninguém tivesse visto.
     */
    private fun markAsRead(sbn: StatusBarNotification, notification: Notification) {
        val action = notification.actions?.firstOrNull { candidate ->
            val title = ReaLayoutAnalyzer.foldText(candidate.title)
            READ_ACTION_LABELS.any { title == it || title.contains(it) }
        }

        if (action != null) {
            try {
                action.actionIntent.send()
                Log.d(TAG, "Notificação marcada como lida (${action.title})")
                return
            } catch (e: PendingIntent.CanceledException) {
                Log.w(TAG, "Ação \"Marcar como lida\" falhou: ${e.message}")
            }
        }

        // Sem ação (ou ação cancelada): remove o aviso da gaveta.
        try {
            cancelNotification(sbn.key)
            Log.d(TAG, "Notificação cancelada (WhatsApp não ofereceu \"Marcar como lida\")")
        } catch (e: Exception) {
            Log.w(TAG, "Falha ao cancelar a notificação: ${e.message}")
        }
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        // Quando a notificação da chamada sai (atendida, recusada ou encerrada),
        // as ações guardadas deixam de valer. Sem isso, um "atender" atrasado
        // dispararia um PendingIntent de uma chamada que já acabou.
        val key = sbn?.key ?: return
        if (key == ringingCallKey) {
            Log.d(TAG, "Chamada encerrada/recusada; limpando ações guardadas")
            clearRingingCall()
            NexusCallNotification.dismiss(this)
        }
        if (sbn.packageName in DIALER_PACKAGES && NexusCallNotification.source == "phone") {
            NexusCallNotification.dismiss(this)
        }
    }

    /** Nome amigável do app que gerou a notificação. */
    private fun appLabel(packageName: String): String = try {
        val info = packageManager.getApplicationInfo(packageName, 0)
        packageManager.getApplicationLabel(info).toString()
    } catch (_: Exception) {
        "WhatsApp"
    }
}