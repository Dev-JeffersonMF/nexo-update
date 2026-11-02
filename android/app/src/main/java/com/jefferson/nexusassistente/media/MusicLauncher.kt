package com.jefferson.nexusassistente.media

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.jefferson.nexusassistente.core.AppDetector
import com.jefferson.nexusassistente.service.NexusAccessibilityService
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * Pesquisa e TOCA uma música pedida por voz.
 *
 * Ordem de preferência pedida para o Nexus:
 *
 *  1. OiTube (grátis, sem propaganda e com reprodução em segundo plano) — é o
 *     player padrão de qualquer pedido de música;
 *  2. YouTube — só quando o usuário o pede pelo nome.
 *
 * Sem OiTube, o pedido falha com uma mensagem clara: o Nexus não troca de
 * player nem manda a busca para o navegador sem o usuário pedir.
 *
 * Apenas UM app é aberto por pedido: a plataforma escolhida (a que o usuário
 * nomeou ou a preferida acima) é a única acionada, inclusive quando o link do
 * vídeo é recusado por ela — nesse caso a busca abre no mesmo app, nunca no
 * outro player.
 *
 * Quando o usuário nomeia a plataforma ("toca no OiTube"), ela é respeitada: se
 * não estiver instalada, o Nexus diz isso em vez de trocar de app sem avisar.
 *
 * Antes de abrir o app, o Nexus descobre o identificador do vídeo pela própria
 * busca do YouTube. Com o identificador em mãos ele manda o player TOCAR aquele
 * vídeo — e não apenas abrir a lista de resultados. Depois de abrir, o serviço
 * de acessibilidade confere se o player ficou pausado e dá play, porque o
 * OiTube (NewPipe) abre a tela do vídeo parada.
 *
 * Nada aqui roda na thread principal: a busca na internet acontece na thread de
 * trabalho que o módulo nativo usa para esta chamada.
 */
class MusicLauncher(
    private val context: Context,
    private val appDetector: AppDetector
) {

    companion object {
        private const val TAG = "NEXUS_MUSIC"

        /** Valores aceitos em [play] para escolher a plataforma. */
        const val APP_OITUBE = "oitube"
        const val APP_YOUTUBE = "youtube"

        /** Espera para o player abrir antes de conferir o botão de play. */
        private val PLAY_PRESS_DELAYS_MS = longArrayOf(1800L, 3600L, 6000L)

        private val VIDEO_ID_REGEX = Regex("\"videoId\":\"([A-Za-z0-9_-]{11})\"")
        private val TITLE_REGEX =
            Regex("\"title\":\\{\"runs\":\\[\\{\"text\":\"(.{1,120}?)\"\\}\\]\\}")

        /**
         * Identificação de navegador de computador — de propósito.
         *
         * Com identificação de celular o YouTube responde um redirecionamento
         * (302) para `m.youtube.com`, e a página móvel NÃO traz o campo
         * `"videoId"`. Era essa a razão de o Nexus não achar o vídeo e só abrir a
         * lista de resultados em vez de tocar a música. Com a identificação de
         * computador a mesma busca entrega o primeiro vídeo e o título dele.
         *
         * Conferido com pedido real, antes e depois:
         *  - celular: 302 → `m.youtube.com`, sem `"videoId"`;
         *  - computador: 200 com `"videoId":"Pg_5fiBqX5w"` e o título do vídeo.
         */
        private const val BROWSER_UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
                "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    }

    /** Um app de vídeo que pode tocar a música. */
    private inner class VideoApp(
        val label: String,
        val packageName: String,
        private val openSearch: (String) -> Boolean
    ) {
        val installed: Boolean
            get() = appDetector.isPackageInstalled(packageName)

        /** Abre a lista de resultados dentro do app (quando não dá para tocar). */
        fun search(term: String): Boolean = openSearch(term)
    }

    private val oiTube = VideoApp("OiTube", AppDetector.OITUBE_PACKAGE) {
        appDetector.openOiTubeSearch(it)
    }

    private val youTube = VideoApp("YouTube", AppDetector.YOUTUBE_PACKAGE) {
        appDetector.openYouTubeSearch(it)
    }

    /** Resultado da tentativa de tocar a música. */
    data class MusicPlayback(
        val success: Boolean,
        val played: Boolean,
        val appName: String? = null,
        val title: String? = null,
        val videoId: String? = null,
        val error: String? = null
    )

    private val mainHandler = Handler(Looper.getMainLooper())

    /**
     * Toca a música (ou o vídeo) pedido.
     *
     * @param query Nome da música, do cantor ou do gênero.
     * @param preferredApp [APP_OITUBE], [APP_YOUTUBE] ou `null` para a escolha
     *   padrão do Nexus: OiTube (grátis e com reprodução em segundo plano).
     *   O YouTube só é aberto quando o usuário o pede pelo nome.
     */
    fun play(query: String, preferredApp: String? = null): MusicPlayback {
        val term = query.trim()
        if (term.isEmpty()) {
            return MusicPlayback(
                success = false,
                played = false,
                error = "Nenhuma música ou cantor informado"
            )
        }

        val requested = when (preferredApp?.lowercase()) {
            APP_OITUBE -> oiTube
            APP_YOUTUBE -> youTube
            else -> null
        }

        if (requested != null && !requested.installed) {
            return MusicPlayback(
                success = false,
                played = false,
                error = "${requested.label} não está instalado neste aparelho"
            )
        }

        // Preferência do usuário: música toca no OiTube (grátis e com reprodução
        // em segundo plano). O YouTube só abre quando é pedido pelo nome — não
        // existe troca automática de player.
        val target = requested ?: oiTube.takeIf { it.installed }

        if (target == null) {
            return MusicPlayback(
                success = false,
                played = false,
                error = "O OiTube não está instalado neste aparelho"
            )
        }

        val found = searchFirstVideo(term)
        if (found == null) {
            // Sem internet ou busca bloqueada: abre a lista de resultados no app.
            val appName = target.takeIf { it.search(term) }?.label
            Log.w(TAG, "Não resolvi o vídeo de \"$term\"; abrindo a busca em $appName")
            return if (appName == null) {
                MusicPlayback(
                    success = false,
                    played = false,
                    error = "Não consegui pesquisar \"$term\" agora"
                )
            } else {
                MusicPlayback(success = true, played = false, appName = appName, title = term)
            }
        }

        val (videoId, title) = found

        // UM app só, sempre. O Nexus escolhe a plataforma (a pedida pelo usuário
        // ou a preferida) e TODAS as tentativas ficam dentro dela: se o link do
        // vídeo não for aceito, a lista de resultados é aberta no MESMO app. O
        // outro player não é aberto "de reserva" — era isso que fazia YouTube e
        // OiTube aparecerem os dois na tela, um depois do outro.
        val chosen = target
        val openedIn = chosen.takeIf { openVideo(videoId, it) }

        if (openedIn == null) {
            Log.w(TAG, "O ${chosen.label} recusou o link do vídeo $videoId; abrindo a busca nele")
            val sameApp = chosen.takeIf { it.search(term) }
            return MusicPlayback(
                success = sameApp != null,
                played = false,
                appName = sameApp?.label,
                title = title ?: term,
                videoId = videoId,
                error = if (sameApp == null) "Não consegui abrir o ${chosen.label}" else null
            )
        }

        // Identificador deste pedido: o serviço de acessibilidade dá no máximo UM
        // toque de play por pedido, para não pausar a música que já começou.
        schedulePlayPress("musica-" + System.currentTimeMillis())
        Log.d(TAG, "Tocando \"$title\" ($videoId) no ${openedIn.label}")

        // Se for OiTube, minimiza o app após iniciar a reprodução para continuar
        // em segundo plano (OiTube suporta background playback nativamente).
        if (openedIn.packageName == AppDetector.OITUBE_PACKAGE) {
            mainHandler.postDelayed({
                minimizeApp()
            }, 1200L)
        }

        return MusicPlayback(
            success = true,
            played = true,
            appName = openedIn.label,
            title = title ?: term,
            videoId = videoId
        )
    }

    /**
     * Manda o player abrir o vídeo encontrado.
     *
     * O YouTube entende `vnd.youtube:<id>`, que já começa a reproduzir. O
     * OiTube/NewPipe NÃO entende esse esquema (o intent era recusado e só
     * atrasava a música): nele o endereço normal do vídeo vem primeiro. Se o
     * caminho preferido falhar, o outro é tentado antes de desistir.
     */
    private fun openVideo(videoId: String, app: VideoApp): Boolean {
        val youtubeScheme = Intent(Intent.ACTION_VIEW, Uri.parse("vnd.youtube:$videoId")).apply {
            setPackage(app.packageName)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        val watchUrl = Intent(
            Intent.ACTION_VIEW,
            Uri.parse("https://www.youtube.com/watch?v=$videoId")
        ).apply {
            setPackage(app.packageName)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }

        val preferredFirst = app.packageName == AppDetector.OITUBE_PACKAGE
        val first = if (preferredFirst) watchUrl else youtubeScheme
        val second = if (preferredFirst) youtubeScheme else watchUrl

        if (startSafely(first)) return true
        return startSafely(second)
    }

    private fun startSafely(intent: Intent): Boolean = try {
        context.startActivity(intent)
        true
    } catch (e: Exception) {
        Log.w(TAG, "Intent recusado por ${intent.`package`}: ${e.message}")
        false
    }

    /**
     * Confere algumas vezes se o player ficou pausado e dá play.
     *
     * As conferências existem porque o botão de play demora a aparecer na tela
     * depois que o app abre. Quem dá o toque é o serviço de acessibilidade, e
     * ele toca no máximo UMA vez por [requestId] — assim uma música que já
     * começou não é pausada pelas conferências seguintes (era isso que fazia o
     * vídeo e a rádio ficarem pausando e voltando sozinhos).
     *
     * Só funciona com o serviço de acessibilidade ligado — sem ele o player
     * continua no controle do usuário, como qualquer app.
     */
    private fun schedulePlayPress(requestId: String) {
        if (!NexusAccessibilityService.isConnected()) {
            Log.d(TAG, "Sem serviço de acessibilidade: o play fica por conta do usuário")
            return
        }

        for (delay in PLAY_PRESS_DELAYS_MS) {
            mainHandler.postDelayed({
                try {
                    NexusAccessibilityService.pressPlayIfPaused(requestId)
                } catch (e: Exception) {
                    Log.w(TAG, "Falha ao dar play pelo serviço de acessibilidade: ${e.message}")
                }
            }, delay)
        }
    }

    /**
     * Primeiro vídeo da busca do YouTube.
     *
     * Devolve o identificador e, quando disponível, o título — usado só para o
     * Nexus falar o que está tocando. Sem internet devolve `null` e quem chamou
     * abre a lista de resultados.
     */
    private fun searchFirstVideo(query: String): Pair<String, String?>? {
        val url = "https://www.youtube.com/results?search_query=" +
            URLEncoder.encode(query, "UTF-8")

        var connection: HttpURLConnection? = null
        return try {
            connection = (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout = 6000
                readTimeout = 8000
                instanceFollowRedirects = false
                requestMethod = "GET"
                setRequestProperty("User-Agent", BROWSER_UA)
                setRequestProperty("Accept-Language", "pt-BR,pt;q=0.9,en;q=0.8")
            }

            if (connection.responseCode !in 200..299) {
                Log.w(TAG, "Busca recusada pelo YouTube: HTTP ${connection.responseCode}")
                return null
            }

            val body = connection.inputStream.bufferedReader().use { it.readText() }
            val id = VIDEO_ID_REGEX.find(body)?.groupValues?.get(1) ?: return null
            val title = TITLE_REGEX.find(body)?.groupValues?.get(1)?.let(::decodeEscapes)
            Log.d(TAG, "Busca \"$query\" resolveu para $id")
            id to title
        } catch (e: Exception) {
            Log.w(TAG, "Busca de música falhou: ${e.message}")
            null
        } finally {
            try {
                connection?.disconnect()
            } catch (_: Exception) {
                // Conexão já encerrada.
            }
        }
    }

    /** Desfaz apenas os escapes que a busca do YouTube usa no título. */
    private fun decodeEscapes(text: String): String =
        text.replace("\\u0026", "&")
            .replace("\\\"", "\"")
            .replace("\\/", "/")
            .trim()

    /**
     * Envia a tecla HOME para minimizar o app atual e voltar à tela inicial.
     *
     * Usado após abrir o vídeo no OiTube: a reprodução continua em segundo plano
     * (recurso nativo do OiTube/NewPipe) sem deixar o player na frente.
     */
    private fun minimizeApp() {
        try {
            val intent = Intent(Intent.ACTION_MAIN).apply {
                addCategory(Intent.CATEGORY_HOME)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            Log.d(TAG, "App minimizado para background playback (OiTube)")
        } catch (e: Exception) {
            Log.w(TAG, "Falha ao minimizar app: ${e.message}")
        }
    }
}
