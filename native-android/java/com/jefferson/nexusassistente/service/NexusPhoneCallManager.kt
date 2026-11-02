package com.jefferson.nexusassistente.service

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.ContactsContract
import android.telecom.TelecomManager
import android.telephony.PhoneStateListener
import android.telephony.TelephonyManager
import android.util.Log
import androidx.core.content.ContextCompat
import com.jefferson.nexusassistente.rea.ReaLayoutAnalyzer

/**
 * Chamadas telefônicas recebidas (chip/SIM), inclusive de contatos salvos no
 * aparelho.
 *
 * O Android não entrega o nome do contato no estado da chamada: entrega o
 * número. Aqui o número é resolvido em [ContactsContract.PhoneLookup] para o
 * Nexus falar o NOME salvo, como o usuário pediu. A notificação do próprio
 * Nexus (verde/vermelho) é mostrada junto.
 *
 * O listener é registrado pelo serviço de notificações, que já fica vivo em
 * segundo plano. Sem READ_PHONE_STATE ele não começa; sem ANSWER_PHONE_CALLS o
 * verde/vermelho não consegue atender/desligar (o Nexus avisa em vez de fingir).
 */
object NexusPhoneCallManager {

    private const val TAG = "NEXUS_PHONE_CALL"

    /**
     * Espera curta antes de anunciar pelo estado da chamada.
     *
     * O estado do chip costuma chegar antes da notificação do discador, mas sem
     * o nome do contato. Esperar 1,2 s deixa a notificação do discador (que traz
     * o nome salvo) anunciar primeiro; o estado só anuncia se ninguém o fez.
     */
    private const val DIALER_GRACE_MS = 1_200L

    private var listener: PhoneStateListener? = null
    private var appContext: Context? = null
    private val handler = Handler(Looper.getMainLooper())

    @Volatile
    private var lastKey: String = ""

    /** `true` depois que esta chamada já foi falada; evita anúncio duplo. */
    @Volatile
    private var announcedThisRing: Boolean = false

    @Volatile
    private var ringStartedAt: Long = 0L

    @Volatile
    private var pendingNumber: String = ""

    /** `true` quando esta chamada já foi recusada por ser de desconhecido. */
    @Volatile
    private var blockedThisRing: Boolean = false

    private val pendingAnnounce = Runnable {
        val context = appContext ?: return@Runnable
        if (announcedThisRing) return@Runnable // o discador já anunciou
        if (pendingNumber.isBlank()) return@Runnable // sem número: espera o discador
        announce(context, "", pendingNumber)
    }

    /** Começa a acompanhar o estado das chamadas do chip. */
    @Suppress("DEPRECATION")
    fun start(context: Context) {
        if (listener != null) return
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_PHONE_STATE) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            Log.d(TAG, "READ_PHONE_STATE ausente: chamadas do chip não serão lidas")
            return
        }

        val telephony = context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
        if (telephony == null) {
            Log.w(TAG, "TelephonyManager indisponível")
            return
        }

        appContext = context.applicationContext
        val phoneListener = object : PhoneStateListener() {
            override fun onCallStateChanged(state: Int, phoneNumber: String?) {
                when (state) {
                    TelephonyManager.CALL_STATE_RINGING -> {
                        ringStartedAt = System.currentTimeMillis()
                        announcedThisRing = false
                        blockedThisRing = false
                        pendingNumber = phoneNumber.orEmpty()
                        handler.removeCallbacks(pendingAnnounce)
                        handler.postDelayed(pendingAnnounce, DIALER_GRACE_MS)
                    }
                    TelephonyManager.CALL_STATE_IDLE,
                    TelephonyManager.CALL_STATE_OFFHOOK,
                    -> {
                        handler.removeCallbacks(pendingAnnounce)
                        pendingNumber = ""
                        announcedThisRing = false
                        blockedThisRing = false
                        // Atendida, recusada ou encerrada: a notificação do
                        // Nexus não serve mais.
                        if (NexusCallNotification.source == "phone") {
                            appContext?.let { NexusCallNotification.dismiss(it) }
                        }
                    }
                }
            }
        }

        listener = phoneListener
        try {
            telephony.listen(phoneListener, PhoneStateListener.LISTEN_CALL_STATE)
            Log.d(TAG, "Acompanhando chamadas do chip")
        } catch (e: Exception) {
            listener = null
            Log.w(TAG, "Falha ao acompanhar chamadas do chip: ${e.message}")
        }
    }

    fun stop() {
        handler.removeCallbacks(pendingAnnounce)
        listener = null
        appContext = null
    }

    /**
     * Anuncia uma chamada do chip (do listener ou da notificação do discador).
     *
     * A mesma chamada pode ser vista pelos dois caminhos. [dedupeKey] evita o
     * anúncio duplicado; o nome já resolvido vence o número cru.
     */
    fun announce(context: Context, contact: String, number: String) {
        val resolved = contact.trim().ifBlank { resolveContactName(context, number) }
        val foldedName = ReaLayoutAnalyzer.foldText(resolved)
        val unknownLabel = foldedName.contains("desconhecid") ||
            foldedName.contains("unknown") ||
            foldedName.contains("privad") ||
            foldedName.contains("private")
        val known = !resolved.isNullOrBlank() &&
            !looksLikeNumber(resolved) &&
            !unknownLabel

        /*
         * FILTRO DE SEGURANÇA (pedido do usuário): chamada de número que NÃO
         * está na agenda é recusada na hora. Só bloqueia quando dá para saber
         * de verdade quem é desconhecido: com ANSWER_PHONE_CALLS (para
         * encerrar) e READ_CONTACTS (para consultar a agenda). Sem essas duas,
         * bloquear todo mundo seria pior do que não bloquear.
         */
        if (!known && canBlockUnknown(context)) {
            blockUnknown(context, number)
            return
        }

        val name = resolved?.takeIf { it.isNotBlank() }
            ?: number.ifBlank { "Número desconhecido" }
        synchronized(this) {
            if (announcedThisRing) {
                // A mesma chamada já foi falada. Se o discador trouxe um nome
                // melhor (o listener só tinha o número), atualiza só a
                // notificação — sem repetir a fala.
                if (!looksLikeNumber(name) && name != lastKey) {
                    lastKey = name
                    NexusCallNotification.show(
                        context = context,
                        contact = name,
                        kind = "Chamada de voz",
                        callSource = "phone",
                        contentIntent = null,
                    )
                }
                return
            }
            announcedThisRing = true
            lastKey = name
        }

        NexusCallNotification.show(
            context = context,
            contact = name,
            kind = "Chamada de voz",
            callSource = "phone",
            contentIntent = null,
        )

        NexusNotificationListenerService.announceExternalNotification(
            mapOf(
                "app" to "Telefone",
                "contact" to name,
                "message" to "Chamada recebida",
                "type" to "voice-call",
                "isAudio" to false,
                "callSource" to "phone",
                "phoneNumber" to number,
            ),
        )
        Log.d(TAG, "Chamada do chip de \"$name\" ($number) anunciada")
    }

    private fun looksLikeNumber(value: String): Boolean {
        val trimmed = value.trim()
        if (trimmed.isEmpty()) return false
        return trimmed.all { it.isDigit() || it == '+' || it == '-' || it == '(' || it == ')' || it == ' ' }
    }

    /** Atende a chamada que está tocando. */
    fun answer(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            Log.d(TAG, "Atender por API só existe no Android 8+")
            return false
        }
        if (!canAnswerCalls(context)) {
            Log.d(TAG, "ANSWER_PHONE_CALLS ausente")
            return false
        }
        return try {
            val telecom = context.getSystemService(TelecomManager::class.java)
            telecom?.acceptRingingCall()
            Log.d(TAG, "acceptRingingCall disparado")
            true
        } catch (e: SecurityException) {
            Log.w(TAG, "Sem permissão para atender: ${e.message}")
            false
        } catch (e: Exception) {
            Log.w(TAG, "Falha ao atender: ${e.message}")
            false
        }
    }

    /** Recusa/desliga a chamada que está tocando. */
    fun decline(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            Log.d(TAG, "endCall por API só existe no Android 9+")
            return false
        }
        if (!canAnswerCalls(context)) {
            Log.d(TAG, "ANSWER_PHONE_CALLS ausente")
            return false
        }
        return try {
            val telecom = context.getSystemService(TelecomManager::class.java)
            telecom?.endCall()
            Log.d(TAG, "endCall disparado")
            true
        } catch (e: SecurityException) {
            Log.w(TAG, "Sem permissão para desligar: ${e.message}")
            false
        } catch (e: Exception) {
            Log.w(TAG, "Falha ao desligar: ${e.message}")
            false
        }
    }

    /**
     * Só bloqueia quando o aparelho permite encerrar a chamada E ler a agenda.
     *
     * Sem ANSWER_PHONE_CALLS não há como recusar; sem READ_CONTACTS todo mundo
     * pareceria desconhecido. Nesses casos o Nexus anuncia e pergunta, em vez
     * de bloquear às cegas.
     */
    private fun canBlockUnknown(context: Context): Boolean {
        if (!canAnswerCalls(context)) {
            Log.d(TAG, "Desconhecido, mas ANSWER_PHONE_CALLS ausente: não bloqueio")
            return false
        }
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CONTACTS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            Log.d(TAG, "READ_CONTACTS ausente: sem agenda, não bloqueio")
            return false
        }
        return true
    }

    /**
     * Recusa a chamada de número desconhecido e avisa o JS.
     *
     * O aviso usa o tipo `blocked-call`: o fluxo fala "Chamada de número
     * desconhecido bloqueada" e NÃO pergunta "quer atender?" — a chamada já
     * não existe mais. Se o encerramento falhar, o tipo continua `voice-call`
     * para o usuário poder atender/recusar na tela.
     */
    private fun blockUnknown(context: Context, number: String) {
        synchronized(this) {
            if (blockedThisRing) return
            blockedThisRing = true
            announcedThisRing = true
            lastKey = "desconhecido"
        }

        val ended = decline(context)
        Log.d(TAG, "Chamada de número desconhecido ($number): bloqueada=$ended")

        NexusNotificationListenerService.announceExternalNotification(
            mapOf(
                "app" to "Telefone",
                "contact" to "número desconhecido",
                "message" to number.ifBlank { "chamada recebida" },
                "type" to if (ended) "blocked-call" else "voice-call",
                "isAudio" to false,
                "callSource" to "phone",
                "phoneNumber" to number,
            ),
        )
    }

    private fun canAnswerCalls(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ANSWER_PHONE_CALLS) ==
            PackageManager.PERMISSION_GRANTED

    private fun resolveContactName(context: Context, number: String): String? {
        if (number.isBlank()) return null
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CONTACTS) !=
            PackageManager.PERMISSION_GRANTED
        ) return null
        return try {
            val uri = Uri.withAppendedPath(
                ContactsContract.PhoneLookup.CONTENT_FILTER_URI,
                Uri.encode(number),
            )
            context.contentResolver.query(
                uri,
                arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME),
                null,
                null,
                null,
            )?.use { cursor ->
                if (cursor.moveToFirst()) cursor.getString(0) else null
            }
        } catch (e: Exception) {
            Log.w(TAG, "Falha ao resolver o contato de $number: ${e.message}")
            null
        }
    }
}
