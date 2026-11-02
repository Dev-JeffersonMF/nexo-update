package com.jefferson.nexusassistente.storage

import android.content.Context

/**
 * Perfil do usuário, guardado nas preferências privadas do app.
 *
 * Hoje guarda só o nome — é ele que o despertador fala e que as saudações usam
 * ("Bom dia, Jefferson"). Fica em `SharedPreferences` porque precisa estar
 * disponível também fora do React (o receptor de alarme roda sem a ponte JS).
 */
class ProfileStore(context: Context) {

    private val prefs = context.applicationContext
        .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    /** Nome do usuário; string vazia quando ele ainda não se apresentou. */
    fun getName(): String = prefs.getString(KEY_NAME, "").orEmpty().trim()

    /** `true` quando o nome já foi informado (onboarding concluído). */
    fun isConfigured(): Boolean = getName().isNotEmpty()

    /**
     * Salva o nome. Limita a 60 caracteres para não virar um texto absurdo vindo
     * de um reconhecimento de voz ruim, e devolve o que ficou guardado.
     */
    fun saveName(name: String): String {
        val clean = name.trim().replace(Regex("\\s+"), " ").take(60)
        prefs.edit().putString(KEY_NAME, clean).apply()
        return clean
    }

    /** Primeiro nome, para falas curtas ("Bom dia, Jefferson"). */
    fun getFirstName(): String = getName().substringBefore(' ').trim()

    /**
     * `true` quando o usuário já deixou o Auto-Bot (acessibilidade) ligado.
     *
     * O Android DESLIGA o serviço de acessibilidade a cada instalação do APK.
     * Guardar a escolha do usuário é o que permite ao Nexus avisar na hora
     * certa ("o Auto-Bot estava ligado e foi desligado pela instalação") em
     * vez de só falar do Auto-Bot como se nunca tivesse existido.
     */
    fun wasAutoBotEnabled(): Boolean = prefs.getBoolean(KEY_AUTO_BOT, false)

    /** Grava (ou limpa) a lembrança de que o Auto-Bot estava ligado. */
    fun setAutoBotEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_AUTO_BOT, enabled).apply()
    }

    companion object {
        private const val PREFS_NAME = "nexus_profile"
        private const val KEY_NAME = "user_name"
        private const val KEY_AUTO_BOT = "auto_bot_enabled"
    }
}
