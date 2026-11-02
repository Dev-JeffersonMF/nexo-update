package com.jefferson.nexusassistente.alert

import android.content.Context
import kotlin.random.Random

/**
 * As frases motivacionais faladas pelo alarme.
 *
 * ## Por que um banco LOCAL
 *
 * O alarme toca com o app fechado, às vezes sem internet e às vezes com o
 * aparelho recém-ligado. Depender de uma busca online faria o despertador ficar
 * mudo justamente no dia em que a rede cai — então o banco mora no aparelho e a
 * escolha acontece aqui, sem tocar na rede.
 *
 * ## Sempre uma nova
 *
 * A frase é sorteada a CADA toque (é o pedido do usuário: "aleatória, sempre
 * vai ter uma nova"), inclusive no "Soneca" — e nunca repete a do toque
 * anterior. Tudo em `SharedPreferences`: sem banco de dados, sem permissão.
 */
object MotivationalPhrases {

    private const val PREFS = "nexus_motivational_phrases"
    private const val KEY_LAST = "last_random"
    private const val KEY_LAST_WORK = "last_random_work"

    /**
     * Frases curtas de propósito: são faladas em voz alta em cima do alarme.
     *
     * Nada de conselho médico, financeiro ou promessa de resultado — só um
     * empurrão honesto para começar o dia.
     */
    private val PHRASES = listOf(
        "Um passo de cada vez também leva longe.",
        "Comece pelo que está ao seu alcance hoje.",
        "O seu ritmo é o ritmo certo para você.",
        "Hoje é uma página em branco: escreva algo de que você goste.",
        "Pequenas escolhas, repetidas, mudam o dia inteiro.",
        "Não precisa dar conta de tudo de uma vez.",
        "Faça o primeiro movimento; o resto vai ficando mais claro.",
        "A constância vence o entusiasmo de um dia só.",
        "Cuide do agora e o depois agradece.",
        "Um dia bom também se constrói com começos simples.",
        "Se o plano mudou, o caminho continua existindo.",
        "Dê a si mesmo o mesmo incentivo que daria a um amigo.",
        "Terminar pequeno é melhor que adiar grande.",
        "O importante não é correr; é não parar por qualquer tropeço.",
        "Sua energia de hoje já é suficiente para o primeiro passo.",
        "Aprender algo novo também é descanso para a cabeça.",
        "Comece. Ajeitar no caminho é permitido.",
        "Um pouco de esforço hoje poupa muito aperto amanhã.",
        "Respire fundo: dá tempo.",
        "O dia não precisa ser perfeito para ser proveitoso.",
        "Foque no próximo passo, não na escada inteira.",
        "Aquilo que você faz com cuidado costuma durar mais.",
        "Nem todo dia é igual — e tudo bem.",
        "Sua presença já muda o ambiente. Use-a bem.",
        "Anote, planeje, comece: o resto é ajuste.",
        "Se travar, diminua o tamanho da tarefa.",
        "A melhor hora para começar é a que você tem agora.",
        "Pequenas pausas também fazem parte do trabalho.",
        "Faça o básico bem feito e o resto fica mais leve.",
        "Uma coisa bem-feita vale mais que dez pela metade.",
        "Você não precisa saber tudo para começar bem.",
        "Continue: o difícil de hoje vira rotina amanhã.",
        "Organize o dia em blocos; o papel não assusta.",
        "O primeiro minuto é o que custa. Depois flui.",
        "Escolha uma prioridade e dê a ela seu melhor.",
        "Vá com calma, mas vá.",
    )

    /**
     * Frases de TRABALHO, para os lembretes e alarmes criados com a palavra
     * "trabalho".
     *
     * Curtas de propósito (o pedido do usuário): entram na fala "nome do
     * usuário + frase" e são repetidas até o usuário tocar em Parar.
     */
    private val WORK_PHRASES = listOf(
        "Bora trabalhar com capricho hoje.",
        "Trabalho bem feito começa bem cedo.",
        "Cada tarefa de hoje é um degrau.",
        "Foco no serviço, o resto vem depois.",
        "Mãos à obra, Jefferson vai brilhar.",
        "Comece forte e mantenha o ritmo.",
        "Um bom expediente começa agora.",
        "Trabalhe com calma e com constância.",
        "A pressa é inimiga do capricho.",
        "Faça hoje o que o amanhã agradece.",
        "Seu esforço de hoje constrói o resultado.",
        "Concentre-se: o serviço rende mais.",
        "Peça de foco, peça de feita.",
        "Comece pela tarefa mais difícil.",
        "Terça de trabalho também tem recompensa.",
        "Cada hora bem usada vale ouro.",
        "Trabalho honesto, dia leve.",
        "Termine bem o que você começou.",
        "A meta de hoje é avançar um pouco.",
        "O serviço bem feito abre portas.",
        "Vista a camisa e comece sorrindo.",
        "Hoje o expediente é seu aliado.",
        "Capriche: alguém vai notar.",
        "Um expediente de cada vez.",
        "Entregue hoje o seu melhor.",
        "Disciplina hoje, resultado amanhã.",
        "Bom trabalho começa com bom começo.",
        "Faça sua parte com orgulho.",
        "O dia de trabalho é sua chance.",
    )

    /**
     * Frase sorteada para ESTE toque — sempre diferente da do toque anterior.
     */
    fun nextRandom(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val last = prefs.getString(KEY_LAST, null)

        val pool = PHRASES.filter { it != last }.ifEmpty { PHRASES }
        val pick = pool[Random.nextInt(pool.size)]

        prefs.edit().putString(KEY_LAST, pick).apply()
        return pick
    }

    /**
     * Frase de TRABALHO sorteada para ESTE toque.
     *
     * Usada pelos alarmes e lembretes criados com a palavra "trabalho": a
     * descrição é substituída por esta frase na fala (nome do usuário + frase
     * motivacional). Também nunca repete a do toque anterior.
     */
    fun nextWorkRandom(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val last = prefs.getString(KEY_LAST_WORK, null)

        val pool = WORK_PHRASES.filter { it != last }.ifEmpty { WORK_PHRASES }
        val pick = pool[Random.nextInt(pool.size)]

        prefs.edit().putString(KEY_LAST_WORK, pick).apply()
        return pick
    }
}
