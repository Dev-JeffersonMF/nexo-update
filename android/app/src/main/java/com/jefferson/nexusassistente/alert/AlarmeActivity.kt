package com.jefferson.nexusassistente.alert

import com.jefferson.nexusassistente.storage.Reminder

/**
 * A tela do ALARME (o despertador).
 *
 * A FALA é a mesma regra de todo alerta (ver [AlertSpeech]): "nome do
 * usuário + descrição". O alarme criado com a palavra "trabalho" fala
 * "nome do usuário + frase motivacional de trabalho" — a mesma frase que
 * aparece na tela, abaixo do relógio.
 */
class AlarmeActivity : AlertActivityBase() {

    override val kindLabel: String = "ALARME"

    /**
     * A etiqueta que marca o alarme de trabalho na tela.
     *
     * A frase motivacional já é a descrição mostrada; a etiqueta só explica
     * de onde ela veio.
     */
    override fun screenNote(reminder: Reminder): String? =
        if (AlertSpeech.isWorkSubject(reminder)) {
            "Mensagem motivacional de trabalho de hoje"
        } else {
            null
        }
}
