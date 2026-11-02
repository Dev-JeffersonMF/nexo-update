package com.jefferson.nexusassistente.alert

/**
 * A tela do LEMBRETE.
 *
 * Abre quando um lembrete toca: o mascote fica logo acima da descrição e o
 * Nexus fala "nome do usuário + descrição" em loop, até o usuário tocar em
 * Parar (ou Pausar por 5 segundos). O lembrete criado com a palavra
 * "trabalho" segue a regra de [AlertSpeech]: fala a frase motivacional de
 * trabalho no lugar da descrição.
 */
class LembreteActivity : AlertActivityBase() {

    override val kindLabel: String = "LEMBRETE"
}
