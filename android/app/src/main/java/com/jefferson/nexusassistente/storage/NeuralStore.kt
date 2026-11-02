package com.jefferson.nexusassistente.storage

import android.content.Context

/**
 * Memória de aprendizado do Nexus (rede neural + conversa aprendida),
 * guardada nas preferências privadas do app.
 *
 * Mesmo desenho do [ChatStore]: o JS manda o JSON pronto e recebe o mesmo JSON
 * de volta. O limite é maior que o do chat porque a matriz neural (pesos e
 * ligações de palavras) pesa mais que texto — e ainda assim cabe com folga:
 * a serialização do JS arredonda os pesos e limita o vocabulário.
 */
class NeuralStore(context: Context) {

    private val prefs = context.applicationContext
        .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    /** JSON salvo pelo JS (estado da rede + pares de conversa). Vazio quando não há. */
    fun load(): String = prefs.getString(KEY_STATE, "").orEmpty()

    /** Guarda o JSON já serializado; limita o tamanho para não crescer sem fim. */
    fun save(json: String) {
        val safe = json.take(MAX_CHARS)
        prefs.edit().putString(KEY_STATE, safe).apply()
    }

    fun clear() {
        prefs.edit().remove(KEY_STATE).apply()
    }

    companion object {
        private const val PREFS_NAME = "nexus_neural"
        private const val KEY_STATE = "state"

        /**
         * A rede (256x32 pesos + vocabulário limitado) fica bem abaixo disto.
         * O corte é a rede de segurança: JSON maior que isso é estado doente.
         */
        private const val MAX_CHARS = 900_000
    }
}
