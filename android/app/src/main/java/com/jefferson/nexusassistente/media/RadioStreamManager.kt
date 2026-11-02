package com.jefferson.nexusassistente.media

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.media3.common.AudioAttributes
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import java.text.Normalizer
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Rádios de Minas Gerais que tocam DENTRO do Nexus.
 *
 * O áudio sai pelo ExoPlayer do próprio aplicativo: nada de abrir navegador,
 * nada de sair do assistente. O usuário pede por voz e a rádio começa a tocar;
 * pedir outra emissora troca a atual pela nova, e "pausar"/"parar" obedecem na
 * hora (o áudio continua tocando com o Nexus minimizado, porque o processo fica
 * vivo pelo serviço em primeiro plano).
 *
 * Sobre os endereços: cada `streamUrl` abaixo foi conferido de verdade contra o
 * player oficial da emissora (resposta HTTP 200 com `audio/aac`). Endereço
 * inventado não entra nesta lista — se um stream cair, o Nexus avisa "não
 * consegui tocar" em vez de fingir que está tocando. Para acrescentar outra
 * rádio de Minas, abra o player oficial dela, copie o endereço do áudio (o
 * `src` de uma tag `<audio>` ou um `.m3u8`/`/stream`) e acrescente aqui com um
 * apelido curto em [RadioStation.aliases].
 */
class RadioStreamManager(
    private val context: Context,
    /** Avisa o JS quando o áudio realmente começou (para o Nexus confirmar). */
    private val onPlaybackStarted: (String) -> Unit = {},
    /** Avisa o JS quando o stream falhou (para o Nexus avisar em vez de mentir). */
    private val onPlaybackError: (String, String) -> Unit = { _, _ -> },
    /**
     * Avisa quando a rádio começou ou parou de soar de verdade.
     *
     * É o que faz o mascote entrar em espera enquanto há rádio no ar (microfone
     * fechado, sem ouvir a própria transmissão) e voltar a escutar quando ela
     * para, inclusive se a emissora cair sozinha.
     */
    private val onPlayingChanged: (Boolean) -> Unit = {}
) {

    companion object {
        private const val TAG = "NEXUS_RADIO"

        /** Teto de espera pelo thread principal (o ExoPlayer vive nele). */
        private const val PLAYER_CALL_TIMEOUT_MS = 5000L

        private val ACCENT_MARKS_REGEX = Regex("\\p{Mn}+")
        private val EXTRA_SPACES_REGEX = Regex("\\s+")

        /** Minúsculas, sem acento e com espaços simples ("Rádio Itatiaia" → "radio itatiaia"). */
        private fun normalize(text: String): String =
            Normalizer.normalize(text.trim().lowercase(Locale.ROOT), Normalizer.Form.NFD)
                .replace(ACCENT_MARKS_REGEX, "")
                .replace(EXTRA_SPACES_REGEX, " ")
    }

    /** Uma emissora de Minas Gerais. */
    data class RadioStation(
        val name: String,
        val aliases: List<String>,
        val city: String,
        val streamUrl: String
    )

    /** Resultado de um pedido de rádio, pronto para virar mapa na ponte. */
    data class RadioResult(
        val success: Boolean,
        val stationName: String? = null,
        val city: String? = null,
        val error: String? = null,
        val stopped: Boolean = false,
        val paused: Boolean = false
    )

    /**
     * Catálogo de Minas Gerais (Belo Horizonte).
     *
     * Todo endereço entra aqui só depois de conferido por HTTP: responde áudio
     * (`content-type: audio/mpeg`) e o `icy-name` bate com a emissora. Os da
     * Itatiaia/98 saíram do player oficial delas (`itatiaia.com.br`,
     * `98live.com.br`); o da Alvorada saiu do player oficial dela
     * (`alvoradafm.com.br` → ListenLive/Triton, estação `RADIO_ALVORADA`).
     */
    private val stations = listOf(
        RadioStation(
            name = "Itatiaia",
            aliases = listOf("itatiaia", "radio itatiaia", "itatiaia bh", "a radio de minas", "itatiaia am"),
            city = "Belo Horizonte - MG",
            streamUrl = "https://8903.brasilstream.com.br/stream"
        ),
        RadioStation(
            name = "98 FM",
            aliases = listOf("98", "98 fm", "98fm", "noventa e oito fm", "98 fm bh"),
            city = "Belo Horizonte - MG",
            streamUrl = "https://9554.brasilstream.com.br/stream"
        ),
        RadioStation(
            name = "98 News",
            aliases = listOf("98 news", "98 fm news", "noventa e oito news"),
            city = "Belo Horizonte - MG",
            streamUrl = "https://8339.brasilstream.com.br/stream"
        ),
        RadioStation(
            name = "98 Rock",
            aliases = listOf("98 rock", "98 fm rock", "noventa e oito rock"),
            city = "Belo Horizonte - MG",
            streamUrl = "https://8185.brasilstream.com.br/stream"
        ),
        RadioStation(
            name = "Alvorada FM",
            aliases = listOf(
                "alvorada",
                "alvorada fm",
                "radio alvorada",
                "alvorada 94",
                "alvorada 94.9",
                "noventa e quatro alvorada"
            ),
            city = "Belo Horizonte - MG",
            // Endereço do player oficial (alvoradafm.com.br → ListenLive, estação
            // RADIO_ALVORADA). Conferido por HTTP: responde 302 para o nó da
            // Triton e entrega áudio (`audio/mpeg`) com `icy-name: RADIO_ALVORADA`.
            streamUrl = "https://playerservices.streamtheworld.com/api/livestream-redirect/RADIO_ALVORADA.mp3"
        )
    )

    private var currentStation: RadioStation? = null
    private var lastError: String? = null
    private var released = false

    private val mainHandler = Handler(Looper.getMainLooper())

    private val player: ExoPlayer = ExoPlayer.Builder(context)
        .setAudioAttributes(AudioAttributes.DEFAULT, /* handleAudioFocus= */ true)
        .setHandleAudioBecomingNoisy(true)
        .build()

    /**
     * Executa o bloco no thread principal (o thread em que o ExoPlayer nasceu).
     *
     * O ExoPlayer recusa qualquer acesso fora do thread de criação, e as chamadas
     * chegam pelo thread dos módulos nativos do React. Sem este desvio, toda
     * operação de rádio terminava em `Player is accessed on the wrong thread`: o
     * áudio nunca começava, "pausar" não pausava e o Nexus só conseguia dizer que
     * não deu certo. Se o thread principal não responder a tempo, devolve
     * [fallback] em vez de mentir que tocou.
     */
    private fun <T : Any> onPlayerThread(fallback: T, block: () -> T): T {
        if (Looper.myLooper() == Looper.getMainLooper()) return block()

        val latch = CountDownLatch(1)
        var outcome: T? = null
        var failure: Throwable? = null
        val posted = mainHandler.post {
            try {
                outcome = block()
            } catch (t: Throwable) {
                failure = t
            } finally {
                latch.countDown()
            }
        }

        if (!posted || !latch.await(PLAYER_CALL_TIMEOUT_MS, TimeUnit.MILLISECONDS)) {
            Log.w(TAG, "Operação de rádio sem resposta do thread principal")
            return fallback
        }
        failure?.let { throw it }
        return outcome ?: fallback
    }

    init {
        player.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                Log.d(TAG, "Estado de reprodução: $playbackState")
                if (playbackState == Player.STATE_READY && player.playWhenReady) {
                    currentStation?.let { station ->
                        lastError = null
                        onPlaybackStarted(station.name)
                    }
                }
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                Log.d(TAG, "Tocando: $isPlaying (${currentStation?.name ?: "nada"})")
                onPlayingChanged(isPlaying)
            }

            override fun onPlayerError(error: PlaybackException) {
                val station = currentStation?.name ?: "rádio"
                val message = describeError(error)
                lastError = message
                Log.e(TAG, "Falha ao tocar $station: $message")
                onPlaybackError(station, message)
            }
        })
    }

    /** Nome da emissora que está (ou estava) carregada no player. */
    fun currentStationName(): String? = currentStation?.name

    fun isPlaying(): Boolean =
        onPlayerThread(fallback = false) { !released && player.isPlaying }

    fun lastError(): String? = lastError

    /** Nomes das emissoras disponíveis, na ordem do catálogo. */
    fun getAvailableStations(): List<String> = stations.map { it.name }

    /**
     * Toca a emissora pedida por voz ou texto.
     *
     * A emissora anterior é parada e descartada antes de carregar a nova — é o
     * "toca outra rádio" que o usuário pediu, sem duas tocando juntas.
     */
    fun playStation(query: String): RadioResult {
        if (released) {
            return RadioResult(success = false, error = "Player de rádio indisponível")
        }

        val station = matchStation(query)
            ?: return RadioResult(
                success = false,
                error = "Não tenho o stream de \"${query.trim()}\". Hoje toco: " +
                    stations.joinToString(", ") { it.name } + "."
            )

        return onPlayerThread(
            fallback = RadioResult(
                success = false,
                stationName = station.name,
                error = "A ${station.name} não respondeu a tempo"
            )
        ) {
            try {
                switchTo(station)
                RadioResult(success = true, stationName = station.name, city = station.city)
            } catch (e: Exception) {
                Log.e(TAG, "Falha ao abrir ${station.name}: ${e.message}")
                RadioResult(
                    success = false,
                    stationName = station.name,
                    error = "Não consegui abrir o stream da ${station.name}"
                )
            }
        }
    }

    /**
     * Troca para a próxima emissora do catálogo (ou a anterior).
     *
     * Serve para "toca outra rádio" e para "próxima rádio" quando o usuário não
     * diz o nome.
     */
    fun playNeighbour(step: Int): RadioResult {
        if (released) {
            return RadioResult(success = false, error = "Player de rádio indisponível")
        }

        val currentIndex = stations.indexOfFirst { it.name == currentStation?.name }
        val baseIndex = if (currentIndex >= 0) currentIndex else -step
        val targetIndex = Math.floorMod(baseIndex + step, stations.size)
        val station = stations[targetIndex]

        return onPlayerThread(
            fallback = RadioResult(
                success = false,
                stationName = station.name,
                error = "A ${station.name} não respondeu a tempo"
            )
        ) {
            try {
                switchTo(station)
                RadioResult(success = true, stationName = station.name, city = station.city)
            } catch (e: Exception) {
                Log.e(TAG, "Falha ao abrir ${station.name}: ${e.message}")
                RadioResult(
                    success = false,
                    stationName = station.name,
                    error = "Não consegui abrir o stream da ${station.name}"
                )
            }
        }
    }

    /** Para a rádio e solta a mídia: nada continua tocando. */
    fun stopRadio(): RadioResult {
        val name = currentStation?.name
        onPlayerThread(fallback = Unit) {
            try {
                player.stop()
                player.clearMediaItems()
            } catch (e: Exception) {
                Log.w(TAG, "Falha ao parar a rádio: ${e.message}")
            }
        }
        currentStation = null
        Log.d(TAG, "Rádio parada (era ${name ?: "nada"})")
        return RadioResult(success = true, stationName = name, stopped = true)
    }

    /** Pausa mantendo a emissora carregada (dá para retomar de onde estava). */
    fun pauseRadio(): RadioResult {
        val name = currentStation?.name
        return onPlayerThread(
            fallback = RadioResult(
                success = false,
                stationName = name,
                error = "Não consegui pausar a rádio"
            )
        ) {
            try {
                player.pause()
                RadioResult(success = true, stationName = name, paused = true)
            } catch (e: Exception) {
                Log.w(TAG, "Falha ao pausar a rádio: ${e.message}")
                RadioResult(success = false, stationName = name, error = "Não consegui pausar a rádio")
            }
        }
    }

    /** Retoma a emissora pausada; se nada estava carregado, avisa. */
    fun resumeRadio(): RadioResult {
        val station = currentStation
            ?: return RadioResult(
                success = false,
                error = "Nenhuma rádio estava tocando. Diga qual você quer ouvir."
            )

        return onPlayerThread(
            fallback = RadioResult(
                success = false,
                stationName = station.name,
                error = "Não consegui retomar a rádio"
            )
        ) {
            try {
                if (player.mediaItemCount == 0) {
                    switchTo(station)
                } else {
                    player.playWhenReady = true
                }
                RadioResult(success = true, stationName = station.name, city = station.city)
            } catch (e: Exception) {
                Log.w(TAG, "Falha ao retomar a rádio: ${e.message}")
                RadioResult(
                    success = false,
                    stationName = station.name,
                    error = "Não consegui retomar a rádio"
                )
            }
        }
    }

    fun release() {
        released = true
        onPlayerThread(fallback = Unit) {
            try {
                player.release()
            } catch (e: Exception) {
                Log.w(TAG, "Falha ao liberar o player: ${e.message}")
            }
        }
        currentStation = null
    }

    // ---------------------------------------------------------------- internos

    /** Para a emissora atual e carrega a nova, já tocando. */
    private fun switchTo(station: RadioStation) {
        try {
            player.stop()
            player.clearMediaItems()
        } catch (e: Exception) {
            Log.w(TAG, "Falha ao parar a rádio anterior: ${e.message}")
        }

        currentStation = station
        lastError = null
        Log.d(TAG, "Tocando ${station.name} (${station.streamUrl})")

        player.setMediaItem(MediaItem.fromUri(station.streamUrl))
        player.prepare()
        player.playWhenReady = true
    }

    /**
     * Encontra a emissora mais provável para o texto falado.
     *
     * Compara primeiro o nome/apelido inteiro, depois pedaços — assim
     * "toca a rádio itatiaia de minas" e "itatiaia" chegam na mesma emissora.
     */
    private fun matchStation(query: String): RadioStation? {
        val needle = normalize(query)
        if (needle.isEmpty()) return null

        val keys = stations.map { station -> station to (listOf(station.name) + station.aliases).map(::normalize) }

        // 1. Igual ao nome ou a um apelido.
        keys.firstOrNull { (_, aliases) -> aliases.any { it == needle } }?.let { return it.first }

        // 2. O pedido traz o nome/apelido ("quero ouvir a 98 rock agora").
        val byContainment = keys
            .flatMap { (station, aliases) -> aliases.map { station to it } }
            .filter { (_, alias) -> alias.length >= 2 && needle.contains(alias) }
            .maxByOrNull { (_, alias) -> alias.length }
        if (byContainment != null) return byContainment.first

        // 3. O pedido é um pedaço do nome ("itatia" ou "98 f").
        if (needle.length >= 3) {
            keys.firstOrNull { (_, aliases) -> aliases.any { it.contains(needle) } }?.let { return it.first }
        }

        return null
    }

    /** Mensagem curta e útil sobre a falha do stream. */
    private fun describeError(error: PlaybackException): String {
        val detail = error.cause?.message?.takeIf { it.isNotBlank() }
        return when {
            detail != null -> "stream indisponível ($detail)"
            else -> "stream indisponível"
        }
    }
}
