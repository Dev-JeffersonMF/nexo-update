package com.jefferson.nexusassistente.storage

import android.content.Context

/**
 * Histórico da conversa do Nexus, guardado nas preferências privadas do app.
 *
 * A conversa vivia só na memória do React: quando o Android destruía a tela em
 * segundo plano, o app voltava com o chat vazio ("sumiram as falas antigas").
 * Aqui o histórico sobrevive ao reinício — o JS manda o JSON pronto e recebe o
 * mesmo JSON de volta.
 */
class ChatStore(context: Context) {

    private val prefs = context.applicationContext
        .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    /** JSON salvo pelo JS (lista de mensagens). String vazia quando não há nada. */
    fun load(): String = prefs.getString(KEY_HISTORY, "").orEmpty()

    /** Guarda o JSON já serializado; limita o tamanho para não crescer sem fim. */
    fun save(json: String) {
        val safe = json.take(MAX_CHARS)
        prefs.edit().putString(KEY_HISTORY, safe).apply()
    }

    fun clear() {
        prefs.edit().remove(KEY_HISTORY).apply()
    }

    companion object {
        private const val PREFS_NAME = "nexus_chat"
        private const val KEY_HISTORY = "history"

        /** ~120 mensagens cabem com folga; acima disso o arquivo só pesa. */
        private const val MAX_CHARS = 400_000
    }
}
