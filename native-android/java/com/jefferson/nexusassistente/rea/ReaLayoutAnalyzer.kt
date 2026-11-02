package com.jefferson.nexusassistente.rea

import android.view.accessibility.AccessibilityNodeInfo
import android.util.Log

class ReaLayoutAnalyzer {

    data class UIElementInfo(
        val viewId: String?,
        val text: String?,
        val contentDescription: String?,
        val className: String?,
        val boundsInScreen: android.graphics.Rect?,
        val node: AccessibilityNodeInfo
    )

    data class ResilienceMap(
        val primaryId: String,
        val fallbackIds: List<String>,
        val fallbackDescriptions: List<String>,
        val fallbackClassNames: List<String>,
        val relativePosition: RelativePosition?
    ) {
        data class RelativePosition(
            val anchorId: String,
            val direction: Direction,
            val maxDistance: Int
        )
        enum class Direction { ABOVE, BELOW, LEFT_OF, RIGHT_OF, CHILD_OF, DESCENDANT_OF }
    }

    /**
     * Mapa do WhatsApp com os identificadores EXTRAÍDOS do app real (REA +
     * árvore de acessibilidade do aparelho), não supostos.
     *
     * O que estava aqui antes não existia no WhatsApp: `conversations_list`,
     * `contact_cell_layout`, `send_btn`, `voice_call`, `chat_bar_entry`. Como o
     * `findTargetElement` desiste quando o ID não bate e a descrição não existe,
     * a chamada e o envio falhavam em silêncio — o app dizia "chamada aberta"
     * sem nunca ter ligado.
     *
     * Evidência (tela real, Android 15, WhatsApp instalado):
     *  - conversa:  entry / send_container / voice_note_btn / conversation_contact_name
     *  - topo da conversa (ImageButton sem id, só content-desc):
     *               "Ligação de vídeo" e "Ligação de voz" — botões DIRETOS
     *  - versões antigas: "Menu de ligação" com "Ligação de voz"/"Ligação de vídeo"
     *  - busca:     my_search_bar (FrameLayout) clicável e search_input (EditText)
     *  - resultados: result_list / conversation_list_view_host +
     *               conversations_row_contact_name (o nome exato separa
     *               "Amor" de "Amor Kezia"/"Amor 2 Claro")
     */
    private val whatsappResilienceMaps = mapOf(
        // ----- Conversa aberta ---------------------------------------------
        "message_input" to ResilienceMap(
            primaryId = "entry",
            fallbackIds = listOf(),
            fallbackDescriptions = listOf("Mensagem", "Message", "Digite uma mensagem"),
            // Sem classe: a busca do WhatsApp TAMBÉM é um EditText. Quando a
            // conversa não estava aberta, o texto da mensagem era escrito na
            // caixa de busca (evidência: search_input com "teste do nexus 4").
            fallbackClassNames = listOf(),
            relativePosition = null
        ),
        "send_button" to ResilienceMap(
            /*
             * EVIDÊNCIA (moto g84, Android 15, 24/10/2026):
             *   send_container = FrameLayout clickable=false
             *   conversation_entry_action_button = RelativeLayout clickable=false
             *   send = ImageButton clickable=true, content-desc="Enviar"
             *
             * O envio tocava no container (que não recebe clique) e dava o
             * envio como falho. O botão REAL é o `send`; os containers ficam
             * só como reserva para versões antigas do WhatsApp.
             */
            primaryId = "send",
            fallbackIds = listOf("send_container", "conversation_entry_action_button"),
            fallbackDescriptions = listOf("Enviar", "Send"),
            // Sem fallback por classe: FrameLayout/RelativeLayout/ImageButton
            // existem às dezenas na tela e o primeiro deles não é o enviar.
            // O `send_container` só aparece com texto no campo (evidência real).
            fallbackClassNames = listOf(),
            relativePosition = ResilienceMap.RelativePosition("entry", ResilienceMap.Direction.RIGHT_OF, 400)
        ),
        /** O microfone: existe SÓ com o campo vazio. Sumiu = botão de enviar. */
        "voice_note_button" to ResilienceMap(
            primaryId = "voice_note_btn",
            fallbackIds = listOf(),
            fallbackDescriptions = listOf(),
            // Sem classe: qualquer ImageButton da tela (menus, chamada de
            // vídeo) fazia o microfone "existir" mesmo com o campo cheio — o
            // envio esperava 5 s, desistia e a mensagem ficava como rascunho.
            fallbackClassNames = listOf(),
            relativePosition = null
        ),
        "chat_contact_name" to ResilienceMap(
            primaryId = "conversation_contact_name",
            fallbackIds = listOf("conversation_contact"),
            fallbackDescriptions = listOf(),
            fallbackClassNames = listOf("android.widget.TextView"),
            relativePosition = null
        ),
        // ----- Menu de ligação ---------------------------------------------
        "call_menu_trigger" to ResilienceMap(
            primaryId = "",
            fallbackIds = listOf(),
            fallbackDescriptions = listOf("Menu de ligação", "Menu de chamada", "Call menu"),
            fallbackClassNames = listOf("android.widget.ImageButton"),
            relativePosition = ResilienceMap.RelativePosition("toolbar", ResilienceMap.Direction.CHILD_OF, 400)
        ),
        "voice_call_item" to ResilienceMap(
            primaryId = "",
            fallbackIds = listOf(),
            fallbackDescriptions = listOf("Ligação de voz", "Chamada de voz", "Voice call"),
            fallbackClassNames = listOf("android.widget.Button", "android.widget.TextView"),
            relativePosition = null
        ),
        "video_call_item" to ResilienceMap(
            primaryId = "",
            fallbackIds = listOf(),
            fallbackDescriptions = listOf("Ligação de vídeo", "Chamada de vídeo", "Video call"),
            fallbackClassNames = listOf("android.widget.Button", "android.widget.TextView"),
            relativePosition = null
        ),
        // ----- Apagar a última mensagem enviada ------------------------------
        //
        // Fluxo do usuário (AGENTS.md): pressionar a mensagem enviada →
        // aparece a lixeira no topo à esquerda → "Apagar para todos".
        //
        // "Apagar" casa por CONTEM (o findTargetElement usa contains), então
        // a ordem importa na tela: a lixeira só é procurada com o menu de
        // seleção aberto, e o "Apagar para todos" só com o diálogo na frente.
        "delete_button" to ResilienceMap(
            // Sem id no aparelho de referência: o menu de seleção do WhatsApp
            // expõe a lixeira por content-desc ("Apagar"/"Delete").
            primaryId = "",
            fallbackIds = listOf(),
            fallbackDescriptions = listOf("Apagar", "Delete"),
            fallbackClassNames = listOf(),
            relativePosition = null
        ),
        "delete_for_everyone" to ResilienceMap(
            primaryId = "",
            fallbackIds = listOf(),
            fallbackDescriptions = listOf("Apagar para todos", "Delete for everyone"),
            fallbackClassNames = listOf("android.widget.TextView", "android.widget.Button"),
            relativePosition = null
        ),
        // ----- Controles da chamada em andamento ---------------------------
        /**
         * Botão de viva-voz da tela de chamada.
         *
         * Evidência (moto g84, Android 15, chamada real):
         * `com.whatsapp:id/audio_route_button`, classe Button. O content-desc
         * diz o ESTADO: "Desligar alto-falante" quando já está ligado e
         * "Ativar alto-falante" quando está desligado.
         */
        "call_speaker_button" to ResilienceMap(
            primaryId = "audio_route_button",
            fallbackIds = listOf("speaker_button", "call_speaker"),
            fallbackDescriptions = listOf(
                "alto-falante",
                "alto falante",
                "viva-voz",
                "viva voz",
                "speaker",
                "speakerphone",
            ),
            fallbackClassNames = listOf("android.widget.Button", "android.widget.ImageButton"),
            relativePosition = null
        ),
        // ----- Lista de conversas e busca ----------------------------------
        "search_box" to ResilienceMap(
            primaryId = "my_search_bar",
            fallbackIds = listOf("search_bar_inner_layout", "search_text"),
            fallbackDescriptions = listOf("Pesquisar", "Buscar", "Search"),
            // Sem classe: o primeiro FrameLayout da tela é a LISTA de conversas,
            // não a caixa de busca. Tocar nele não abria a busca e o Nexus
            // concluía "contato não encontrado" sem ter procurado.
            fallbackClassNames = listOf(),
            relativePosition = null
        ),
        "search_input" to ResilienceMap(
            primaryId = "search_input",
            fallbackIds = listOf("search_src_text", "search_bar_text", "search_edit_text"),
            fallbackDescriptions = listOf("Pesquisar", "Buscar", "Search"),
            // Sem classe: o campo de mensagem (`entry`) também é EditText.
            // Aceitar qualquer EditText fazia o nome do contato ser digitado
            // dentro da conversa em vez da busca.
            fallbackClassNames = listOf(),
            relativePosition = null
        ),
        "chat_list" to ResilienceMap(
            primaryId = "conversation_list_view_host",
            fallbackIds = listOf("result_list", "list"),
            fallbackDescriptions = listOf(),
            fallbackClassNames = listOf(
                "android.widget.ListView",
                "androidx.recyclerview.widget.RecyclerView"
            ),
            relativePosition = null
        ),
        "chat_list_item" to ResilienceMap(
            primaryId = "contact_row_container",
            fallbackIds = listOf("contact_selector", "conversations_swipe_to_reveal_container"),
            fallbackDescriptions = listOf(),
            fallbackClassNames = listOf(
                "android.widget.LinearLayout",
                "android.widget.RelativeLayout",
                "android.widget.FrameLayout"
            ),
            relativePosition = null
        ),
        "chat_list_name" to ResilienceMap(
            primaryId = "conversations_row_contact_name",
            fallbackIds = listOf("contact_name", "conversation_row_text", "title"),
            fallbackDescriptions = listOf(),
            fallbackClassNames = listOf("android.widget.TextView"),
            relativePosition = null
        ),
        /** Nome do contato no topo da conversa (confere se abriu o contato certo). */
        "contact_name" to ResilienceMap(
            primaryId = "conversation_contact_name",
            fallbackIds = listOf("conversations_row_contact_name"),
            fallbackDescriptions = listOf(),
            fallbackClassNames = listOf("android.widget.TextView"),
            relativePosition = null
        )
    )

    private val youtubeResilienceMaps = mapOf(
        "search_box" to ResilienceMap(
            primaryId = "search_box",
            fallbackIds = listOf("search_edit_text"),
            fallbackDescriptions = listOf("Search", "Pesquisar"),
            fallbackClassNames = listOf("android.widget.EditText", "android.widget.SearchView"),
            relativePosition = ResilienceMap.RelativePosition("action_toolbar", ResilienceMap.Direction.CHILD_OF, 500)
        ),
        "play_pause_button" to ResilienceMap(
            primaryId = "play_pause_button",
            fallbackIds = listOf("play_button", "pause_button", "lc_play_pause_button", "floaty_play_pause_button", "immersive_live_play_pause_button"),
            fallbackDescriptions = listOf("Play", "Pause", "Reproduzir", "Pausar"),
            fallbackClassNames = listOf("android.widget.ImageButton"),
            relativePosition = null
        ),
        "next_button" to ResilienceMap(
            primaryId = "next_button",
            fallbackIds = listOf("cast_button_type_skip_next", "creation_next_button"),
            fallbackDescriptions = listOf("Next", "Próximo", "Pular"),
            fallbackClassNames = listOf("android.widget.ImageButton"),
            relativePosition = null
        ),
        "prev_button" to ResilienceMap(
            primaryId = "prev_button",
            fallbackIds = listOf("cast_button_type_skip_previous"),
            fallbackDescriptions = listOf("Previous", "Anterior", "Voltar"),
            fallbackClassNames = listOf("android.widget.ImageButton"),
            relativePosition = null
        )
    )

    private val oitubeResilienceMaps = mapOf(
        "search_box" to ResilienceMap(
            primaryId = "etSearch",
            fallbackIds = listOf(),
            fallbackDescriptions = listOf("Search", "Pesquisar"),
            fallbackClassNames = listOf("android.widget.EditText", "android.widget.SearchView"),
            relativePosition = null
        ),
        "play_pause_button" to ResilienceMap(
            primaryId = "al_exo_play_pause",
            fallbackIds = listOf("bottomPlayPauseButton", "exo_play_pause", "exo_play", "exo_pause"),
            fallbackDescriptions = listOf("Play", "Pause", "Reproduzir", "Pausar"),
            fallbackClassNames = listOf("android.widget.ImageButton", "com.google.android.exoplayer2.ui.PlayerControlView"),
            relativePosition = null
        ),
        "next_button" to ResilienceMap(
            primaryId = "action_play_next",
            fallbackIds = listOf("al_exo_next", "exo_next", "playNextButton"),
            fallbackDescriptions = listOf("Next", "Próximo", "Pular"),
            fallbackClassNames = listOf("android.widget.ImageButton"),
            relativePosition = null
        ),
        "prev_button" to ResilienceMap(
            primaryId = "al_exo_prev",
            fallbackIds = listOf("exo_prev", "playPreviousButton", "playPrevious"),
            fallbackDescriptions = listOf("Previous", "Anterior", "Voltar"),
            fallbackClassNames = listOf("android.widget.ImageButton"),
            relativePosition = null
        )
    )

    // App package names for detection
    companion object {
        const val WHATSAPP_PACKAGE = "com.whatsapp"
        const val YOUTUBE_PACKAGE = "com.google.android.youtube"
        const val OITUBE_PACKAGE = "com.skipads.oitube.official"
        const val GEMINI_PACKAGE = "com.google.android.apps.bard"
        const val ALEXA_PACKAGE = "com.amazon.dee.app"

        /**
         * Texto comparável: sem acento, minúsculo e com espaços simples.
         *
         * O WhatsApp escreve "Ligação de voz" com acento. Comparar assim evita
         * depender de como o texto chega da árvore de acessibilidade.
         */
        fun foldText(value: CharSequence?): String =
            java.text.Normalizer.normalize(value?.toString().orEmpty(), java.text.Normalizer.Form.NFD)
                .replace(Regex("\\p{InCombiningDiacriticalMarks}"), "")
                .lowercase(java.util.Locale.ROOT)
                .replace(Regex("\\s+"), " ")
                .trim()
    }

    fun scanActiveWindow(rootNode: AccessibilityNodeInfo?): List<UIElementInfo> {
        val elements = mutableListOf<UIElementInfo>()
        rootNode?.let { traverseNode(it, elements) }
        return elements
    }

    private fun traverseNode(node: AccessibilityNodeInfo, list: MutableList<UIElementInfo>) {
        val viewId = node.viewIdResourceName
        val text = node.text?.toString()
        val desc = node.contentDescription?.toString()
        val className = node.className?.toString()
        val bounds = android.graphics.Rect()
        node.getBoundsInScreen(bounds)

        if (!viewId.isNullOrEmpty() || !text.isNullOrEmpty() || !desc.isNullOrEmpty()) {
            list.add(UIElementInfo(viewId, text, desc, className, bounds, node))
        }

        for (i in 0 until node.childCount) {
            val child = node.getChild(i)
            if (child != null) {
                traverseNode(child, list)
            }
        }
    }

    fun findTargetElement(rootNode: AccessibilityNodeInfo?, appPackage: String, elementKey: String): AccessibilityNodeInfo? {
        val resilienceMap = getResilienceMap(appPackage, elementKey) ?: return null
        val allElements = scanActiveWindow(rootNode)

        // 1. Primary ID exact match
        //    (primaryId vazio = elemento que só existe por descrição/classe)
        for (el in allElements) {
            if (resilienceMap.primaryId.isNotEmpty() &&
                el.viewId != null &&
                el.viewId.endsWith(resilienceMap.primaryId)
            ) {
                Log.d("NEXUS_REA", "Encontrado por ID primário: ${el.viewId}")
                return el.node
            }
        }

        // 2. Fallback by alternative IDs
        for (el in allElements) {
            if (el.viewId != null) {
                for (fallbackId in resilienceMap.fallbackIds) {
                    if (el.viewId.endsWith(fallbackId)) {
                        Log.d("NEXUS_REA", "Encontrado por ID alternativo: ${el.viewId}")
                        return el.node
                    }
                }
            }
        }

        // 3. Fallback by contentDescription (ou pelo texto visível)
        //    Sem acento: "Ligação de voz" tem de casar com "ligacao de voz".
        for (el in allElements) {
            for (desc in resilienceMap.fallbackDescriptions) {
                val wanted = foldText(desc)
                if (wanted.isEmpty()) continue
                if (foldText(el.contentDescription).contains(wanted) ||
                    foldText(el.text).contains(wanted)
                ) {
                    Log.d("NEXUS_REA", "Encontrado por descrição/texto: ${el.contentDescription ?: el.text}")
                    return el.node
                }
            }
        }

        // 4. Fallback by className + relative position
        if (resilienceMap.relativePosition != null) {
            val anchor = findAnchor(allElements, resilienceMap.relativePosition!!.anchorId)
            if (anchor != null) {
                val candidate = findByRelativePosition(allElements, anchor, resilienceMap.relativePosition!!, resilienceMap.fallbackClassNames)
                if (candidate != null) {
                    Log.d("NEXUS_REA", "Encontrado por posição relativa")
                    return candidate
                }
            }
        }

        // 5. Fallback by className only
        //    Só para elementos que TÊM identificador no mapa. Sem essa trava, um
        //    elemento que só existe por descrição (as opções do menu de ligação)
        //    cairia no primeiro widget daquela classe da tela — e o Nexus
        //    clicaria em qualquer coisa.
        val hasIds = resilienceMap.primaryId.isNotEmpty() || resilienceMap.fallbackIds.isNotEmpty()
        if (hasIds) {
            for (el in allElements) {
                if (el.className != null && resilienceMap.fallbackClassNames.contains(el.className)) {
                    Log.d("NEXUS_REA", "Encontrado por className: ${el.className}")
                    return el.node
                }
            }
        }

        Log.w("NEXUS_REA", "Elemento não encontrado: $elementKey para $appPackage")
        return null
    }

    private fun getResilienceMap(appPackage: String, elementKey: String): ResilienceMap? {
        return when (appPackage) {
            WHATSAPP_PACKAGE -> whatsappResilienceMaps[elementKey]
            YOUTUBE_PACKAGE -> youtubeResilienceMaps[elementKey]
            OITUBE_PACKAGE -> oitubeResilienceMaps[elementKey]
            else -> null
        }
    }

    private fun findAnchor(elements: List<UIElementInfo>, anchorId: String): UIElementInfo? {
        return elements.firstOrNull { it.viewId != null && it.viewId.endsWith(anchorId) }
    }

    private fun findByRelativePosition(
        elements: List<UIElementInfo>,
        anchor: UIElementInfo,
        relPos: ResilienceMap.RelativePosition,
        allowedClasses: List<String>
    ): AccessibilityNodeInfo? {
        val anchorBounds = anchor.boundsInScreen ?: return null

        return elements.firstOrNull { el ->
            if (el.className != null && !allowedClasses.contains(el.className)) return@firstOrNull false
            el.boundsInScreen?.let { bounds ->
                when (relPos.direction) {
                    ResilienceMap.Direction.ABOVE -> bounds.bottom <= anchorBounds.top && (anchorBounds.top - bounds.bottom) <= relPos.maxDistance
                    ResilienceMap.Direction.BELOW -> bounds.top >= anchorBounds.bottom && (bounds.top - anchorBounds.bottom) <= relPos.maxDistance
                    ResilienceMap.Direction.LEFT_OF -> bounds.right <= anchorBounds.left && (anchorBounds.left - bounds.right) <= relPos.maxDistance
                    ResilienceMap.Direction.RIGHT_OF -> bounds.left >= anchorBounds.right && (bounds.left - anchorBounds.right) <= relPos.maxDistance
                    ResilienceMap.Direction.CHILD_OF -> isChildOf(el.node, anchor.node)
                    ResilienceMap.Direction.DESCENDANT_OF -> isDescendantOf(el.node, anchor.node)
                }
            } ?: false
        }?.node
    }

    private fun isChildOf(child: AccessibilityNodeInfo, parent: AccessibilityNodeInfo): Boolean {
        var current = child.parent
        while (current != null) {
            if (current == parent) return true
            current = current.parent
        }
        return false
    }

    private fun isDescendantOf(descendant: AccessibilityNodeInfo, ancestor: AccessibilityNodeInfo): Boolean {
        var current = descendant.parent
        while (current != null) {
            if (current == ancestor) return true
            current = current.parent
        }
        return false
    }

    fun updateResilienceMap(elementKey: String, newMap: ResilienceMap) {
        // This would be used for OTA updates from REA analysis
        // For now, maps are hardcoded but can be extended to load from JSON
    }
}